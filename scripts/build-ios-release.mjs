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
 *   IOS_BUILD_NUMBER              – override auto-derived build number
 *   IOS_SCHEME                    – override auto-detected Xcode scheme
 *   IOS_EXPORT_METHOD             – distribution method (default: app-store)
 *   EXPO_APP_VARIANT              – app variant (default: production)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { execSync } from 'node:child_process';
import os from 'node:os';

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

if (fs.existsSync(iosDir)) {
  fs.rmSync(iosDir, { recursive: true, force: true });
}

// 1. Generate native iOS project
console.log('Running Expo prebuild for iOS...');
run('npx', ['expo', 'prebuild', '--platform', 'ios', '--non-interactive'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    EXPO_APP_VARIANT: process.env.EXPO_APP_VARIANT || 'production',
  },
});

// 2. Detect workspace and scheme
const workspaces = fs.readdirSync(iosDir).filter((f) => f.endsWith('.xcworkspace'));
if (workspaces.length === 0) fail('No .xcworkspace found after prebuild.');
const workspacePath = path.join(iosDir, workspaces[0]);

let scheme = process.env.IOS_SCHEME;
if (!scheme) {
  const listOutput = execSync(
    `xcodebuild -workspace "${workspacePath}" -list -json`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const parsed = JSON.parse(listOutput);
  scheme = parsed.project?.schemes?.[0];
  if (!scheme) fail('Could not detect Xcode scheme. Set IOS_SCHEME.');
}
console.log(`Using scheme: ${scheme}`);

// 3. Derive build number
const buildNumber = process.env.IOS_BUILD_NUMBER || String(Date.now());
console.log(`Build number: ${buildNumber}`);

// 4. Create archive
const archivePath = path.join(os.tmpdir(), 'build.xcarchive');
const exportMethod = process.env.IOS_EXPORT_METHOD || 'app-store';

run('xcodebuild', [
  '-workspace', workspacePath,
  '-scheme', scheme,
  '-configuration', 'Release',
  '-archivePath', archivePath,
  '-destination', 'generic/platform=iOS',
  '-allowProvisioningUpdates',
  `DEVELOPMENT_TEAM=${requireEnv('IOS_TEAM_ID')}`,
  `CURRENT_PROJECT_VERSION=${buildNumber}`,
  'COMPILER_INDEX_STORE_ENABLE=NO',
], { cwd: path.join(iosDir, scheme) });

if (!fs.existsSync(archivePath)) fail('Archive not found at expected path.');

// 5. Export IPA
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

const ipaDir = path.join(repoRoot, 'ios-build');
run('xcodebuild', [
  '-exportArchive',
  '-archivePath', archivePath,
  '-exportOptionsPlist', exportOptionsPlist,
  '-exportPath', ipaDir,
]);

const ipaFiles = fs.readdirSync(ipaDir).filter((f) => f.endsWith('.ipa'));
if (ipaFiles.length === 0) fail('No .ipa file produced.');

console.log(`iOS build complete: ${path.join(ipaDir, ipaFiles[0])}`);
