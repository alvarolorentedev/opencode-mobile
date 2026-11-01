import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import plist from '@expo/plist';
import { unzipSync } from 'fflate';
import ts from 'typescript';
import { parse } from 'yaml';
import { describe, it } from 'vitest';
import { archiveBuildNumberArguments, archiveSigningArguments, isUnsignedTestBuild, packageUnsignedTestIpa } from '../../scripts/ci/ios-unsigned-test-build.mjs';

const root = new URL('../../', import.meta.url);
const bundleIdentifier = 'app.yuv41.opencodemobile.liveactivitytest';
const unsignedEnv = {
  IOS_UNSIGNED_TEST_BUILD: '1',
  GITHUB_ACTIONS: 'true',
  GITHUB_WORKFLOW: 'iOS unsigned test build',
  EXPO_APP_VARIANT: 'production',
};

function fixture(run: (fixture: { archivePath: string; appPath: string; extensionPath: string; outputDir: string; temp: string }) => void) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-unsigned-test-'));
  const archivePath = path.join(temp, 'fixture.xcarchive');
  const appPath = path.join(archivePath, 'Products/Applications/OpenCode.app');
  const extensionPath = path.join(appPath, 'PlugIns/LiveActivity.appex');
  for (const [directory, executable, identifier] of [
    [appPath, 'OpenCode', bundleIdentifier],
    [extensionPath, 'LiveActivity', `${bundleIdentifier}.liveactivity`],
  ]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, executable), 'synthetic executable', { mode: 0o755 });
    fs.writeFileSync(path.join(directory, 'Info.plist'), plist.build({
      CFBundleIdentifier: identifier,
      CFBundleExecutable: executable,
      CFBundleVersion: '119',
      CFBundleShortVersionString: '1.0.119',
      DTPlatformName: 'iphoneos',
      CFBundleSupportedPlatforms: ['iPhoneOS'],
      ...(directory === appPath ? { NSSupportsLiveActivities: true } : {
        NSExtension: { NSExtensionPointIdentifier: 'com.apple.widgetkit-extension' },
      }),
    }));
  }
  fs.writeFileSync(path.join(appPath, 'main.jsbundle'), 'synthetic embedded JavaScript');
  fs.mkdirSync(path.join(appPath, 'Frameworks/Example.framework/Versions/A'), { recursive: true });
  fs.writeFileSync(path.join(appPath, 'Frameworks/Example.framework/Versions/A/Example'), 'framework');
  fs.symlinkSync('A', path.join(appPath, 'Frameworks/Example.framework/Versions/Current'));
  try {
    run({ archivePath, appPath, extensionPath, outputDir: path.join(temp, 'ios-build'), temp });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

describe('optional unsigned iPhoneOS test build', () => {
  it('defaults to the exact signed archive arguments and requires explicit CI-only opt-in', () => {
    assert.equal(isUnsignedTestBuild({}), false);
    assert.equal(isUnsignedTestBuild({ IOS_UNSIGNED_TEST_BUILD: 'true' }), false);
    assert.equal(isUnsignedTestBuild({ IOS_UNSIGNED_TEST_BUILD: '0' }), false);
    assert.deepEqual(archiveSigningArguments(false, 'TEAM'), ['-allowProvisioningUpdates', 'DEVELOPMENT_TEAM=TEAM']);
    assert.throws(() => isUnsignedTestBuild({ IOS_UNSIGNED_TEST_BUILD: '1' }), /restricted/);
    assert.throws(() => isUnsignedTestBuild({ ...unsignedEnv, GITHUB_WORKFLOW: 'Release' }), /restricted/);
    assert.throws(() => isUnsignedTestBuild({ ...unsignedEnv, EXPO_APP_VARIANT: 'development' }), /production/);
    assert.equal(isUnsignedTestBuild(unsignedEnv), true);
    assert.deepEqual(archiveSigningArguments(true), ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=']);
    const script = fs.readFileSync(new URL('scripts/build-ios-release.mjs', root), 'utf8');
    assert.match(script, /'-configuration', 'Release'/);
    assert.match(script, /'-destination', 'generic\/platform=iOS'/);
    assert.match(script, /unsignedTestBuild \? undefined : requireEnv\('IOS_TEAM_ID'\)/);
    assert.ok(script.indexOf('packageUnsignedTestIpa({') < script.indexOf("'-exportArchive'"));
  });

  it('keeps generated unsigned build numbers unless explicitly supplied and validated', () => {
    assert.deepEqual(archiveBuildNumberArguments(true, undefined), []);
    assert.deepEqual(archiveBuildNumberArguments(true, ''), []);
    assert.deepEqual(archiveBuildNumberArguments(true, '119'), ['CURRENT_PROJECT_VERSION=119']);
    assert.deepEqual(archiveBuildNumberArguments(true, '119.1.2'), ['CURRENT_PROJECT_VERSION=119.1.2']);
    for (const invalid of ['$(CURRENT_PROJECT_VERSION)', '119abc', ' 119 ', '1.2.3.4', '-119']) {
      assert.throws(() => archiveBuildNumberArguments(true, invalid), /Unsigned IOS_BUILD_NUMBER/);
    }
    // Signed mode retains the original override/default value without new validation.
    assert.deepEqual(archiveBuildNumberArguments(false, '1793563200000'), ['CURRENT_PROJECT_VERSION=1793563200000']);
    assert.deepEqual(archiveBuildNumberArguments(false, 'existing-override'), ['CURRENT_PROJECT_VERSION=existing-override']);
    const script = fs.readFileSync(new URL('scripts/build-ios-release.mjs', root), 'utf8');
    assert.match(script, /const buildNumber = unsignedTestBuild\s*\? process\.env\.IOS_BUILD_NUMBER\s*: process\.env\.IOS_BUILD_NUMBER \|\| String\(Date\.now\(\)\)/);
    assert.match(script, /\.\.\.buildNumberArguments,/);
  });

  it('validates the same commit before macOS and uses no secrets, signing or store publication', () => {
    const source = fs.readFileSync(new URL('.github/workflows/ios-test-build.yml', root), 'utf8');
    const workflow = parse(source);
    assert.equal(workflow.name, unsignedEnv.GITHUB_WORKFLOW);
    assert.ok(Object.hasOwn(workflow.on, 'workflow_dispatch'));
    assert.deepEqual(workflow.on.push.branches, ['feat/ios-live-activities']);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.equal(workflow.jobs.validate.uses, './.github/workflows/ci.yml');
    assert.deepEqual(workflow.jobs.validate.with, { mode: 'smoke', ref: '${{ github.sha }}' });
    const job = workflow.jobs['ios-test'];
    assert.equal(job.needs, 'validate');
    assert.equal(job['runs-on'], 'macos-26');
    assert.equal(job['timeout-minutes'], 90);
    assert.equal(job.env.EXPO_APP_VARIANT, 'production');
    assert.equal(job.env.IOS_UNSIGNED_TEST_BUILD, '1');
    assert.equal(job.env.EXPO_IOS_LIVE_ACTIVITIES, '1');
    assert.equal(job.env.EXPO_IOS_DISABLE_PUSH_ENTITLEMENT, '1');
    assert.equal(job.env.EXPO_IOS_BUNDLE_ID, bundleIdentifier);
    assert.equal(job.env.DEVELOPER_DIR, '/Applications/Xcode_26.6.app/Contents/Developer');
    const checkout = job.steps.find((step: any) => step.uses === 'actions/checkout@v4');
    assert.equal(checkout.with.ref, workflow.jobs.validate.with.ref);
    assert.equal(checkout.with['persist-credentials'], false);
    assert.doesNotMatch(source, /secrets:|secrets\.|contents: write|allowProvisioningUpdates|RNLLAMA_BUILD_FROM_SOURCE|--upload-app|release create/);
    assert.ok(job.steps.some((step: any) => step.run?.includes('node scripts/build-ios-release.mjs')));
    assert.ok(job.steps.some((step: any) => step.run?.includes('set -euo pipefail') && step.run.includes('tee ios-build/logs/build.log')));
    const diagnostics = job.steps.find((step: any) => step.name === 'Upload native build diagnostics');
    assert.equal(diagnostics.if, 'always()');
    assert.equal(diagnostics.with['retention-days'], 3);
    assert.match(diagnostics.with.path, /unsigned-test\.xcresult/);

    const configSource = fs.readFileSync(new URL('app.config.ts', root), 'utf8');
    const compiled = ts.transpileModule(configSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const context = { exports: {}, require: createRequire(new URL('app.config.ts', root)), process: { env: job.env } };
    runInNewContext(compiled, context);
    const config = (context.exports as { default: any }).default;
    assert.equal(config.ios.bundleIdentifier, bundleIdentifier);
    assert.ok(config.plugins.some((plugin: unknown) => (plugin as Function).name === 'withoutPushEntitlement'));
  });

  it('packages the complete .app, embedded JS, extension, permissions and framework symlinks', () => {
    fixture(({ archivePath, appPath, extensionPath, outputDir, temp }) => {
      const ipa = packageUnsignedTestIpa({ archivePath, outputDir, bundleIdentifier, requireLiveActivity: true });
      const files = unzipSync(fs.readFileSync(ipa));
      for (const source of [path.join(appPath, 'main.jsbundle'), path.join(extensionPath, 'Info.plist'), path.join(extensionPath, 'LiveActivity')]) {
        const relative = `Payload/OpenCode.app/${path.relative(appPath, source)}`;
        assert.deepEqual(Buffer.from(files[relative]), fs.readFileSync(source));
      }
      const extracted = path.join(temp, 'unpacked');
      execFileSync('unzip', ['-q', ipa, '-d', extracted]);
      for (const executable of ['OpenCode', 'PlugIns/LiveActivity.appex/LiveActivity']) {
        assert.equal(fs.statSync(path.join(extracted, 'Payload/OpenCode.app', executable)).mode & 0o777, 0o755);
      }
      assert.equal(fs.readlinkSync(path.join(extracted, 'Payload/OpenCode.app/Frameworks/Example.framework/Versions/Current')), 'A');
      assert.match(fs.readFileSync(path.join(outputDir, 'UNSIGNED-TEST-BUILD.txt'), 'utf8'), /Requires external signing/);
      assert.match(fs.readFileSync(path.join(outputDir, 'SHA256SUMS.txt'), 'utf8'), /^[a-f0-9]{64}  opencode-mobile-unsigned-test\.ipa\n$/);
      assert.deepEqual(fs.readdirSync(outputDir).filter((name) => name.startsWith('.unsigned-payload-')), []);
    });
  });

  it('packages through direct Node ESM, not only the test runner interop', () => {
    fixture(({ archivePath, outputDir }) => {
      const helper = new URL('scripts/ci/ios-unsigned-test-build.mjs', root).href;
      const options = { archivePath, outputDir, bundleIdentifier, requireLiveActivity: true };
      const script = `import { packageUnsignedTestIpa } from ${JSON.stringify(helper)}; console.log(packageUnsignedTestIpa(${JSON.stringify(options)}));`;
      const ipa = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim();
      assert.ok(fs.statSync(ipa).size > 0);
      assert.ok(unzipSync(fs.readFileSync(ipa))['Payload/OpenCode.app/main.jsbundle']);
    });
  });

  it.each(['app', 'extension'])('rejects a simulator/wrong-platform %s instead of packaging it', (target) => {
    fixture(({ archivePath, appPath, extensionPath, outputDir }) => {
      const infoPath = path.join(target === 'app' ? appPath : extensionPath, 'Info.plist');
      const info = plist.parse(fs.readFileSync(infoPath, 'utf8')) as Record<string, any>;
      fs.writeFileSync(infoPath, plist.build({ ...info, DTPlatformName: 'iphonesimulator', CFBundleSupportedPlatforms: ['iPhoneSimulator'] }));
      assert.throws(() => packageUnsignedTestIpa({ archivePath, outputDir, bundleIdentifier, requireLiveActivity: true }), /Not an iPhoneOS device bundle/);
      assert.equal(fs.existsSync(outputDir), false);
    });
  });

  it.each(['CFBundleVersion', 'CFBundleShortVersionString'])('rejects an extension with mismatched %s', (key) => {
    fixture(({ archivePath, extensionPath, outputDir }) => {
      const infoPath = path.join(extensionPath, 'Info.plist');
      const info = plist.parse(fs.readFileSync(infoPath, 'utf8')) as Record<string, any>;
      fs.writeFileSync(infoPath, plist.build({ ...info, [key]: key === 'CFBundleVersion' ? '1793563200000' : '1.0.120' }));
      assert.throws(() => packageUnsignedTestIpa({ archivePath, outputDir, bundleIdentifier, requireLiveActivity: true }),
        new RegExp(`Extension ${key} does not match the app`));
      assert.equal(fs.existsSync(outputDir), false);
    });
  });

  it.each(['CFBundleVersion', 'CFBundleShortVersionString'])('requires a resolved %s in the app and extension', (key) => {
    fixture(({ archivePath, appPath, extensionPath, outputDir }) => {
      for (const bundlePath of [appPath, extensionPath]) {
        const infoPath = path.join(bundlePath, 'Info.plist');
        const info = plist.parse(fs.readFileSync(infoPath, 'utf8')) as Record<string, any>;
        for (const invalid of [undefined, '', '$(CURRENT_PROJECT_VERSION)']) {
          const changed = { ...info };
          if (invalid === undefined) delete changed[key];
          else changed[key] = invalid;
          fs.writeFileSync(infoPath, plist.build(changed));
          assert.throws(() => packageUnsignedTestIpa({ archivePath, outputDir, bundleIdentifier, requireLiveActivity: true }),
            new RegExp(`Missing or invalid ${key}`));
          assert.equal(fs.existsSync(outputDir), false);
        }
        fs.writeFileSync(infoPath, plist.build(info));
      }
    });
  });

  it('rejects missing JS, wrong identity, absent extensions and non-executable binaries', () => {
    fixture(({ archivePath, appPath, extensionPath, outputDir }) => {
      const options = { archivePath, outputDir, bundleIdentifier, requireLiveActivity: true };
      assert.throws(() => packageUnsignedTestIpa({ ...options, bundleIdentifier: 'wrong.id' }), /identifier/);
      fs.chmodSync(path.join(extensionPath, 'LiveActivity'), 0o644);
      assert.throws(() => packageUnsignedTestIpa(options), /permissions/);
      fs.chmodSync(path.join(extensionPath, 'LiveActivity'), 0o755);
      fs.rmSync(extensionPath, { recursive: true });
      assert.throws(() => packageUnsignedTestIpa(options), /WidgetKit/);
      fs.writeFileSync(path.join(appPath, 'main.jsbundle'), '');
      assert.throws(() => packageUnsignedTestIpa(options), /JavaScript bundle is empty/);
      fs.rmSync(path.join(appPath, 'main.jsbundle'));
      assert.throws(() => packageUnsignedTestIpa(options), /main\.jsbundle/);
      assert.equal(fs.existsSync(outputDir), false);
    });
  });
});
