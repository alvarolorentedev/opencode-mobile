import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { withIOSLiveActivities } = require('../../config/plugins/ios-live-activities.cjs') as {
  withIOSLiveActivities: (config: any) => any;
};
const xcode = require('xcode');
const plist = require('@expo/plist').default;
const roots: string[] = [];

function fixture(bundleIdentifier = 'app.example.opencode') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-live-activity-'));
  roots.push(root);
  const projectPath = path.join(root, 'project.pbxproj');
  const template = path.join(path.dirname(require.resolve('expo/package.json')), 'template.tgz');
  // Exercise the installed SDK's real CNG project with the installed xcode API.
  fs.writeFileSync(projectPath, execFileSync('tar', [
    '-xOf', template, 'package/ios/HelloWorld.xcodeproj/project.pbxproj',
  ]));
  const project = xcode.project(projectPath);
  project.parseSync();
  const config = withIOSLiveActivities({
    name: 'Test', slug: 'test', version: '2.3.4',
    ios: { bundleIdentifier, buildNumber: '42' },
    mods: { ios: {} },
  });
  return { root, project, config, projectPath };
}

async function apply(value: ReturnType<typeof fixture>, project = value.project) {
  return value.config.mods.ios.xcodeproj({
    ...value.config,
    modResults: project,
    modRequest: { projectRoot: value.root, platformProjectRoot: value.root },
  });
}

function entries(section: Record<string, any>): [string, any][] {
  return Object.entries(section).filter(([key]) => !key.endsWith('_comment'));
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('opt-in local iOS Live Activity plugin', () => {
  it('only registers iOS mods and preserves app permissions and background modes', async () => {
    const { config } = fixture();
    expect(config.mods.android).toBeUndefined();
    const result = await config.mods.ios.infoPlist({
      ...config,
      modResults: { UIBackgroundModes: ['fetch'], NSCameraUsageDescription: 'Keep camera permission' },
    });
    expect(result.modResults).toEqual({
      UIBackgroundModes: ['fetch'], NSCameraUsageDescription: 'Keep camera permission',
      NSSupportsLiveActivities: true, OpencodeLiveActivitiesEnabled: true,
    });
    expect(config.mods.ios.entitlements).toBeUndefined();
  });

  it.each(['app.example.opencode', 'app.example.opencode.dev', 'com.personal.unique']) (
    'generates an isolated extension for %s without changing the app deployment target', async (bundleIdentifier) => {
      const value = fixture(bundleIdentifier);
      const main = value.project.getTarget('com.apple.product-type.application');
      const before = structuredClone(value.project.pbxXCBuildConfigurationSection());
      await apply(value);
      const extension = entries(value.project.pbxNativeTargetSection())
        .find(([, target]) => target.name === '"OpencodeLiveActivity"');
      expect(extension).toBeDefined();
      const objects = value.project.hash.project.objects;
      const list = objects.XCConfigurationList[extension![1].buildConfigurationList];
      for (const item of list.buildConfigurations) {
        expect(objects.XCBuildConfiguration[item.value].buildSettings).toMatchObject({
          PRODUCT_BUNDLE_IDENTIFIER: `"${bundleIdentifier}.LiveActivity"`,
          IPHONEOS_DEPLOYMENT_TARGET: '17.0', APPLICATION_EXTENSION_API_ONLY: 'YES',
          SUPPORTED_PLATFORMS: '"iphoneos iphonesimulator"',
          CURRENT_PROJECT_VERSION: '"42"', MARKETING_VERSION: '"2.3.4"',
          INFOPLIST_FILE: '"OpencodeLiveActivity/Info.plist"', SWIFT_VERSION: '5.0',
        });
      }
      for (const [key, original] of entries(before)) {
        expect(objects.XCBuildConfiguration[key]).toEqual(original);
      }
      expect(main.target.dependencies).toHaveLength(1);
      expect(objects.PBXTargetDependency[main.target.dependencies[0].value].target).toBe(extension![0]);
      const embedRef = main.target.buildPhases.find((phase: any) => phase.comment === 'Embed App Extensions');
      const embed = objects.PBXCopyFilesBuildPhase[embedRef.value];
      expect(embed.dstSubfolderSpec).toBe(13);
      expect(embed.files).toHaveLength(1);
      const buildFile = objects.PBXBuildFile[embed.files[0].value];
      expect(buildFile.fileRef).toBe(extension![1].productReference);
      expect(buildFile.settings.ATTRIBUTES).toContain('CodeSignOnCopy');
      const extensionSources = extension![1].buildPhases.find((phase: any) => phase.comment === 'Sources');
      expect(objects.PBXSourcesBuildPhase[extensionSources.value].files).toHaveLength(2);

      const folder = path.join(value.root, 'OpencodeLiveActivity');
      expect(fs.readFileSync(path.join(folder, 'OpencodeActivityAttributes.swift'), 'utf8')).toBe(
        fs.readFileSync(new URL('../../modules/opencode-activity/ios/OpencodeActivityAttributes.swift', import.meta.url), 'utf8'),
      );
      const info = plist.parse(fs.readFileSync(path.join(folder, 'Info.plist'), 'utf8'));
      expect(info.NSExtension).toEqual({ NSExtensionPointIdentifier: 'com.apple.widgetkit-extension' });
      const serialized = value.project.writeSync();
      expect(serialized).not.toContain('com.apple.security.application-groups');
      expect(serialized).not.toContain('aps-environment');
      expect(serialized).not.toContain('CODE_SIGN_ENTITLEMENTS = OpencodeLiveActivity');
      expect(fs.readdirSync(folder).sort()).toEqual([
        'Info.plist', 'OpencodeActivityAttributes.swift', 'OpencodeLiveActivity.swift',
      ]);
    },
  );

  it('is idempotent after writing and reparsing a prebuild project', async () => {
    const value = fixture();
    await apply(value);
    const first = value.project.writeSync();
    fs.writeFileSync(value.projectPath, first);
    const reparsed = xcode.project(value.projectPath);
    reparsed.parseSync();
    await apply(value, reparsed);
    expect(reparsed.writeSync()).toBe(first);
  });

  it('does not steal another extension product from an existing copy phase', async () => {
    const value = fixture();
    value.project.addTarget('OtherExtension', 'app_extension', 'OtherExtension', 'app.example.opencode.other');
    await apply(value);
    const main = value.project.getTarget('com.apple.product-type.application');
    const phases = value.project.hash.project.objects.PBXCopyFilesBuildPhase;
    const embedded = main.target.buildPhases.filter((phase: any) => phases[phase.value]);
    expect(embedded).toHaveLength(2);
    const copy = embedded.find((phase: any) => phase.comment === 'Copy Files');
    expect(phases[copy.value].files).toHaveLength(1);
    expect(phases[copy.value].files[0].comment).toContain('OtherExtension');
    const own = embedded.find((phase: any) => phase.comment === 'Embed App Extensions');
    expect(phases[own.value].files).toHaveLength(1);
    expect(phases[own.value].files[0].comment).toContain('OpencodeLiveActivity');
  });

  it('keeps WidgetKit out of the pod and ordinary completion notifications enabled', () => {
    const source = (file: string) => fs.readFileSync(
      new URL(`../../modules/opencode-activity/ios/${file}`, import.meta.url), 'utf8',
    );
    expect(source('OpencodeActivity.podspec')).toContain("s.source_files = '*.swift'");
    expect(source('OpencodeActivityModule.swift')).toContain('Function("suppressesCompletion") { false }');
    expect(source('OpencodeActivityModule.swift')).toContain('AsyncFunction("waitUntilStopped")');
    expect(source('OpencodeActivityController.swift')).toContain('pushType: nil');
    expect(source('LiveActivity/OpencodeLiveActivity.swift')).not.toMatch(/Button\(|AppIntent|Link\(/);
  });
});
