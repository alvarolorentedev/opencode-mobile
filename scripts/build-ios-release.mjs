#!/usr/bin/env node

/**
 * iOS release build script.
 *
 * Generates the native iOS project via Expo prebuild, then builds a signed
 * archive and exports an .ipa for App Store distribution.
 *
 * Required env vars:
 *   APPLE_CERTIFICATE_BASE64      – base64-encoded .p12 distribution certificate
 *   APPLE_CERTIFICATE_PASSWORD    – password for the .p12
 *   APPLE_PROVISIONING_PROFILE_BASE64 – base64-encoded .mobileprovision
 *   IOS_TEAM_ID                   – Apple Developer Team ID
 *
 * Optional env vars:
 *   IOS_BUILD_NUMBER              – override build number (unsigned defaults to generated Expo values)
 *   IOS_SCHEME                    – override auto-detected Xcode scheme
 *   IOS_EXPORT_METHOD             – distribution method (default: app-store)
 *   EXPO_APP_VARIANT              – app variant (default: production)
 *   IOS_UNSIGNED_TEST_BUILD=1     – CI-only unsigned device test container; no export/signing
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import { archiveBuildNumberArguments, archiveSigningArguments, isUnsignedTestBuild, packageUnsignedTestIpa } from './ci/ios-unsigned-test-build.mjs';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Missing required environment variable: ${name}`);
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) fail(`Command failed: ${command} ${args.join(' ')}`);
}

const repoRoot = process.cwd();
const iosDir = path.join(repoRoot, 'ios');
const unsignedTestBuild = isUnsignedTestBuild();

if (fs.existsSync(iosDir)) {
  fs.rmSync(iosDir, { recursive: true, force: true });
}

// 1. Generate native iOS project
console.log('Running Expo prebuild for iOS...');
run('npx', ['expo', 'prebuild', '--platform', 'ios'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    EXPO_APP_VARIANT: process.env.EXPO_APP_VARIANT || 'production',
    CI: '1',
  },
});

// 2. Detect project and scheme
const projects = fs.readdirSync(iosDir).filter((f) => f.endsWith('.xcworkspace'));
if (projects.length === 0) fail('No .xcworkspace found after prebuild.');
const projectPath = path.join(iosDir, projects[0]);

let scheme = process.env.IOS_SCHEME;
if (!scheme) {
  const listOutput = execSync(
    `xcodebuild -workspace "${projectPath}" -list -json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const parsed = JSON.parse(listOutput);
  const appScheme = path.basename(projectPath, '.xcworkspace');
  scheme = parsed.workspace?.schemes?.includes(appScheme) ? appScheme : undefined;
  if (!scheme) fail('Could not detect Xcode scheme. Set IOS_SCHEME.');
}
console.log(`Using scheme: ${scheme}`);

// 3. Derive build number
const buildNumber = unsignedTestBuild
  ? process.env.IOS_BUILD_NUMBER
  : process.env.IOS_BUILD_NUMBER || String(Date.now());
const buildNumberArguments = archiveBuildNumberArguments(unsignedTestBuild, buildNumber);
console.log(`Build number: ${buildNumber || 'generated Expo values (no override)'}`);

// 4. Create archive
const ipaDir = path.join(repoRoot, 'ios-build');
const archivePath = unsignedTestBuild
  ? path.join(ipaDir, 'unsigned-test.xcarchive')
  : path.join(os.tmpdir(), 'build.xcarchive');
if (unsignedTestBuild) fs.mkdirSync(ipaDir, { recursive: true });
const exportMethod = process.env.IOS_EXPORT_METHOD || 'app-store';

run('xcodebuild', [
  '-workspace', projectPath,
  '-scheme', scheme,
  '-configuration', 'Release',
  '-archivePath', archivePath,
  '-destination', 'generic/platform=iOS',
  ...archiveSigningArguments(unsignedTestBuild, unsignedTestBuild ? undefined : requireEnv('IOS_TEAM_ID')),
  ...buildNumberArguments,
  'COMPILER_INDEX_STORE_ENABLE=NO',
  ...(unsignedTestBuild ? ['-resultBundlePath', path.join(ipaDir, 'unsigned-test.xcresult')] : []),
  'archive',
], { cwd: iosDir });

if (!fs.existsSync(archivePath)) fail('Archive not found at expected path.');

if (unsignedTestBuild) {
  const ipaPath = packageUnsignedTestIpa({
    archivePath,
    outputDir: ipaDir,
    bundleIdentifier: requireEnv('EXPO_IOS_BUNDLE_ID'),
    requireLiveActivity: process.env.EXPO_IOS_LIVE_ACTIVITIES === '1',
  });
  console.log(`Unsigned iOS test container complete (requires signing to install): ${ipaPath}`);
  process.exit(0);
}

// 5. Export signed IPA (ordinary release behavior is unchanged)
const exportOptionsPlist = path.join(os.tmpdir(), 'ExportOptions.plist');
const exportOptionsContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${exportMethod}</string>
  <key>teamID</key>
  <string>${requireEnv('IOS_TEAM_ID')}</string>
  <key>uploadBitcode</key>
  <false/>
  <key>compileBitcode</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>`;
fs.writeFileSync(exportOptionsPlist, exportOptionsContent);

run('xcodebuild', [
  '-exportArchive',
  '-archivePath', archivePath,
  '-exportOptionsPlist', exportOptionsPlist,
  '-exportPath', ipaDir,
]);

const ipaFiles = fs.readdirSync(ipaDir).filter((f) => f.endsWith('.ipa'));
if (ipaFiles.length === 0) fail('No .ipa file produced.');

console.log(`iOS build complete: ${path.join(ipaDir, ipaFiles[0])}`);
