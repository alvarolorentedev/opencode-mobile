import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// This package publishes a CommonJS `exports.default`; Node's direct ESM
// interop differs from Vite's synthetic default used by the unit-test runner.
const plist = createRequire(import.meta.url)('@expo/plist').default;

/** @param {Record<string, string | undefined>} env */
export function isUnsignedTestBuild(env = process.env) {
  if (env.IOS_UNSIGNED_TEST_BUILD !== '1') return false;
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_WORKFLOW !== 'iOS unsigned test build') {
    throw new Error('IOS_UNSIGNED_TEST_BUILD=1 is restricted to the iOS unsigned test build GitHub workflow.');
  }
  if (env.EXPO_APP_VARIANT !== 'production') {
    throw new Error('Unsigned test builds require EXPO_APP_VARIANT=production and Release configuration.');
  }
  return true;
}

export function archiveSigningArguments(unsigned, teamId) {
  return unsigned
    ? ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=']
    : ['-allowProvisioningUpdates', `DEVELOPMENT_TEAM=${teamId}`];
}

export function archiveBuildNumberArguments(unsigned, buildNumber) {
  // Expo may write a literal CFBundleVersion in the app's Info.plist while the
  // extension resolves CURRENT_PROJECT_VERSION. Keep CNG's matching defaults.
  if (unsigned && !buildNumber) return [];
  if (unsigned && !/^\d+(?:\.\d+){0,2}$/.test(buildNumber)) {
    throw new Error('Unsigned IOS_BUILD_NUMBER must contain one to three numeric components.');
  }
  return [`CURRENT_PROJECT_VERSION=${buildNumber}`];
}

function readPlist(filename) {
  const contents = fs.readFileSync(filename);
  const xml = contents.subarray(0, 6).toString() === 'bplist'
    ? execFileSync('plutil', ['-convert', 'xml1', '-o', '-', filename], { encoding: 'utf8' })
    : contents.toString('utf8');
  return plist.parse(xml);
}

function deviceBundle(bundlePath) {
  const info = readPlist(path.join(bundlePath, 'Info.plist'));
  if (info.DTPlatformName !== 'iphoneos'
    || !Array.isArray(info.CFBundleSupportedPlatforms)
    || info.CFBundleSupportedPlatforms.length !== 1
    || info.CFBundleSupportedPlatforms[0] !== 'iPhoneOS') {
    throw new Error(`Not an iPhoneOS device bundle: ${bundlePath}`);
  }
  const executable = info.CFBundleExecutable;
  if (typeof executable !== 'string' || path.basename(executable) !== executable) {
    throw new Error(`Invalid bundle executable: ${bundlePath}`);
  }
  const stat = fs.statSync(path.join(bundlePath, executable));
  if (!stat.isFile() || stat.size === 0 || !(stat.mode & 0o111)) {
    throw new Error(`Missing executable or executable permissions: ${bundlePath}`);
  }
  for (const key of ['CFBundleVersion', 'CFBundleShortVersionString']) {
    if (typeof info[key] !== 'string' || !/^\d+(?:\.\d+){0,2}$/.test(info[key])) {
      throw new Error(`Missing or invalid ${key}: ${bundlePath}`);
    }
  }
  return info;
}

// This is a test container, not xcodebuild -exportArchive or an installable signed release.
export function packageUnsignedTestIpa({ archivePath, outputDir, bundleIdentifier, requireLiveActivity = false }) {
  if (!bundleIdentifier) throw new Error('An explicit test bundle identifier is required.');
  const applications = path.join(archivePath, 'Products', 'Applications');
  const apps = fs.readdirSync(applications).filter((name) => name.endsWith('.app'));
  if (apps.length !== 1) throw new Error('Expected exactly one archived .app.');
  const appPath = path.join(applications, apps[0]);
  const info = deviceBundle(appPath);
  if (info.CFBundleIdentifier !== bundleIdentifier) throw new Error('Archived app bundle identifier does not match test configuration.');
  if (fs.statSync(path.join(appPath, 'main.jsbundle')).size === 0) throw new Error('Embedded JavaScript bundle is empty.');
  const pluginsPath = path.join(appPath, 'PlugIns');
  const extensions = fs.existsSync(pluginsPath)
    ? fs.readdirSync(pluginsPath).filter((name) => name.endsWith('.appex')) : [];
  let hasWidgetExtension = false;
  for (const extension of extensions) {
    const extensionInfo = deviceBundle(path.join(pluginsPath, extension));
    if (!extensionInfo.CFBundleIdentifier?.startsWith(`${bundleIdentifier}.`)) {
      throw new Error(`Extension has the wrong bundle identifier: ${extension}`);
    }
    for (const key of ['CFBundleVersion', 'CFBundleShortVersionString']) {
      if (extensionInfo[key] !== info[key]) {
        throw new Error(`Extension ${key} does not match the app: ${extension}`);
      }
    }
    hasWidgetExtension ||= extensionInfo.NSExtension?.NSExtensionPointIdentifier === 'com.apple.widgetkit-extension';
  }
  if (requireLiveActivity && (info.NSSupportsLiveActivities !== true || !hasWidgetExtension)) {
    throw new Error('Live Activity support or embedded WidgetKit .appex is missing.');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const staging = fs.mkdtempSync(path.join(outputDir, '.unsigned-payload-'));
  const ipaPath = path.resolve(outputDir, 'opencode-mobile-unsigned-test.ipa');
  try {
    const payload = path.join(staging, 'Payload');
    fs.mkdirSync(payload);
    fs.cpSync(appPath, path.join(payload, apps[0]), { recursive: true, verbatimSymlinks: true });
    fs.rmSync(ipaPath, { force: true });
    // System zip preserves UNIX executable modes and symlinks (-y), including every .appex/framework.
    execFileSync('zip', ['-q', '-r', '-y', ipaPath, 'Payload'], { cwd: staging, stdio: 'inherit' });
    const digest = createHash('sha256').update(fs.readFileSync(ipaPath)).digest('hex');
    fs.writeFileSync(path.join(outputDir, 'SHA256SUMS.txt'), `${digest}  ${path.basename(ipaPath)}\n`);
    fs.writeFileSync(path.join(outputDir, 'UNSIGNED-TEST-BUILD.txt'),
      'Unsigned iPhoneOS Release test build. Not an App Store/TestFlight release.\n'
      + 'Requires external signing/provisioning before installation on a standard iPhone.\n'
      + `Bundle identifier: ${bundleIdentifier}\nEmbedded extensions: ${extensions.join(', ') || 'none'}\n`);
    return ipaPath;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
