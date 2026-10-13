#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnv(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(' ')}`);
  }
}

// NOTE: Avoid modifying generated Gradle files in a fragile way. Instead pass
// signing properties to Gradle via -P arguments. This keeps the build script
// compatible with different Android Gradle plugin versions.

const repoRoot = process.cwd();
const androidDir = path.join(repoRoot, 'android');
const keystorePath = path.join(androidDir, 'release.keystore');
const gradlePropertiesPath = path.join(androidDir, 'gradle.properties');

// Signing credentials are injected through gradle.properties instead of -P
// arguments so they never appear in the process list or in the command echoed
// by `run()` on failure. The generated file is restored on exit.
let gradlePropertiesBackup;
let gradlePropertiesDirty = false;

// Java properties values only need `\`, newlines, and a leading space escaped;
// `=`, `:`, `#`, and `!` are literal once the key/value separator has passed.
function escapePropertiesValue(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/^ /, '\\ ');
}

function writeSigningProperties(props) {
  gradlePropertiesBackup = fs.readFileSync(gradlePropertiesPath);
  const lines = Object.entries(props).map(([key, value]) => `${key}=${escapePropertiesValue(value)}`);
  fs.appendFileSync(gradlePropertiesPath, `\n# Injected release signing (scripts/build-android-release.mjs)\n${lines.join('\n')}\n`);
  gradlePropertiesDirty = true;
}

function restoreGradleProperties() {
  if (gradlePropertiesDirty && gradlePropertiesBackup) {
    fs.writeFileSync(gradlePropertiesPath, gradlePropertiesBackup);
    gradlePropertiesDirty = false;
  }
}

process.on('exit', restoreGradleProperties);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

// The script pins the Expo variant so a conflicting EXPO_APP_VARIANT in the
// caller's environment cannot leak into Gradle. FOSS is selected through a
// dedicated flavor switch rather than overloading EXPO_APP_VARIANT.
const buildFlavor = process.env.OPENCODE_BUILD_FLAVOR?.trim() || 'production';
const appVariant = buildFlavor === 'foss' ? 'foss' : 'production';
const isFossVariant = appVariant === 'foss';
const buildEnv = {
  ...process.env,
  EXPO_APP_VARIANT: appVariant,
  ...(isFossVariant
    ? {
        EXPO_PUBLIC_FOSS: '1',
        // Pin the FOSS package id so a local `.env` EXPO_ANDROID_PACKAGE cannot
        // override it (shell env wins over Expo's .env loading).
        EXPO_ANDROID_PACKAGE: process.env.EXPO_ANDROID_PACKAGE || 'app.getopencode.fdroid',
      }
    : {}),
};

const packageJsonPath = path.join(repoRoot, 'package.json');
let packageJsonBackup;

function restorePackageJson() {
  if (packageJsonBackup) {
    fs.writeFileSync(packageJsonPath, packageJsonBackup);
    packageJsonBackup = undefined;
  }
}

if (isFossVariant) {
  process.on('exit', restorePackageJson);

  if (!buildEnv.FIREBASE_STUB_SRC_DIR?.trim()) {
    const stubRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-firebase-stubs-'));
    process.on('exit', () => fs.rmSync(stubRoot, { recursive: true, force: true }));
    run('git', ['clone', '--no-checkout', 'https://gitlab.com/freed-by-fdroid/firebase-stubs.git', stubRoot]);
    run('git', ['checkout', '--detach', 'ce90a956aacda17a85c60577ee443aeb83d876ef'], { cwd: stubRoot });
    buildEnv.FIREBASE_STUB_SRC_DIR = path.join(stubRoot, 'firebase-messaging', 'src');
  }

  // Shared with the fdroiddata recipe (scripts/foss-prepare.mjs) so upstream and
  // F-Droid apply byte-identical dependency patches. It edits package.json, so
  // back it up and restore it once the build finishes.
  packageJsonBackup = fs.readFileSync(packageJsonPath);
  run('node', [path.join(repoRoot, 'scripts', 'foss-prepare.mjs')], { cwd: repoRoot, env: buildEnv });
}

// Expo SDK 54+ deprecated --non-interactive; CI=1 forces the same non-interactive mode.
run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean'], {
  cwd: repoRoot,
  env: { ...buildEnv, CI: '1' },
});

const keystorePassword = requireEnv('ANDROID_KEYSTORE_PASSWORD');
const keyAlias = requireEnv('ANDROID_KEY_ALIAS');
const keyPassword = requireEnv('ANDROID_KEY_PASSWORD');
const keystoreSourcePath = getOptionalEnv('ANDROID_KEYSTORE_PATH');
const keystoreBase64 = getOptionalEnv('ANDROID_KEYSTORE_BASE64')?.replace(/\s+/g, '');

if (!keystoreSourcePath && !keystoreBase64) {
  fail('Missing keystore input. Set either ANDROID_KEYSTORE_PATH or ANDROID_KEYSTORE_BASE64.');
}

if (keystoreSourcePath) {
  if (!fs.existsSync(keystoreSourcePath)) {
    fail(`Keystore file does not exist: ${keystoreSourcePath}`);
  }
  fs.copyFileSync(keystoreSourcePath, keystorePath);
} else {
  if (!keystoreBase64 || keystoreBase64.length < 100) {
    fail('ANDROID_KEYSTORE_BASE64 is too short to be a valid keystore payload.');
  }
  fs.writeFileSync(keystorePath, Buffer.from(keystoreBase64, 'base64'));
}

const keystoreStats = fs.statSync(keystorePath);
if (keystoreStats.size < 100) {
  fail(`Decoded keystore is too small (${keystoreStats.size} bytes). Check the uploaded secret or keystore file.`);
}

// Debug: compute and print sha256 and size of the decoded keystore so CI logs
// can be compared with a locally computed value to detect upload corruption.
try {
  const { createHash } = await import('node:crypto');
  const data = fs.readFileSync(keystorePath);
  const hash = createHash('sha256').update(data).digest('hex');
  console.log(`Keystore written: ${keystorePath} (size=${data.length} bytes, sha256=${hash})`);
} catch (e) {
  console.warn('Unable to compute keystore hash for debugging:', e?.message ?? e);
}

// Detect keystore type (pkcs12 vs jks). keytool can list a keystore with a
// specific storetype; try pkcs12 first and fall back to jks. The password is
// read from the environment via `-storepass:env` so it never enters argv.
function runKeytoolList(keystoreFile, storetype) {
  try {
    const proc = spawnSync('keytool', [
      '-list',
      '-keystore',
      keystoreFile,
      '-storepass:env',
      'ANDROID_KEYSTORE_PASSWORD',
      '-storetype',
      storetype,
    ], { encoding: 'utf8', env: process.env });
    return { status: proc.status, stdout: proc.stdout || '', stderr: proc.stderr || '' };
  } catch (e) {
    return { status: 1, stdout: '', stderr: String(e) };
  }
}

function validateKeystore(keystoreFile) {
  // Try pkcs12 then jks
  const tried = [];
  for (const t of ['pkcs12', 'jks']) {
    const res = runKeytoolList(keystoreFile, t);
    tried.push({ type: t, res });
    if (res.status === 0) {
      // parse aliases from stdout
      const aliases = [];
      for (const line of res.stdout.split(/\r?\n/)) {
        const m = line.match(/Alias name:\s*(.+)/i) || line.match(/alias name:\s*(.+)/i) || line.match(/^\s*alias:\s*(.+)/i);
        if (m) aliases.push(m[1].trim());
      }
      return { storeType: t, aliases };
    }
  }

  // If neither succeeded, return diagnostics
  return { storeType: undefined, tried };
}

const validation = validateKeystore(keystorePath);
if (validation.storeType) {
  console.log(`Detected keystore type: ${validation.storeType}`);
  if (validation.aliases && validation.aliases.length) {
    console.log('Keystore aliases:');
    for (const a of validation.aliases) console.log(` - ${a}`);
    if (!validation.aliases.includes(keyAlias)) {
      fail(`Configured ANDROID_KEY_ALIAS \"${keyAlias}\" was not found in the keystore aliases.`);
    }
  } else {
    console.log('No aliases found in keystore output (this may be normal for some keystore types).');
  }
} else {
  console.error('Failed to read the provided keystore with keytool using either pkcs12 or jks store types.');
  for (const t of validation.tried) {
    console.error(`--- store type: ${t.type} ---`);
    if (t.res.stderr) console.error(t.res.stderr.split(/\r?\n/).slice(0,50).join('\n'));
  }
  fail('Keystore validation failed. Ensure the base64 secret decodes to a valid PKCS12 or JKS keystore and that the password is correct.');
}

const detectedStoreType = validation.storeType;

// When using PKCS12 keystores the key password is typically the same as the
// store password; some toolchains (and keytool) may fail decrypting a private
// key if a different key password is supplied. If we detected pkcs12, prefer
// the store password as the key password to avoid "Given final block not
// properly padded" decryption errors.
let effectiveKeyPassword = keyPassword;
if (detectedStoreType === 'pkcs12') {
  console.log('PKCS12 keystore detected: using store password as key password for signing');
  effectiveKeyPassword = keystorePassword;
}

// The FOSS build produces an ARM64 APK for the F-Droid package. The Play build
// also produces the AAB and honors ANDROID_RELEASE_ABIS.
const gradleTasks = isFossVariant ? ['assembleRelease'] : ['bundleRelease', 'assembleRelease'];

// Pass signing props to Gradle via gradle.properties. The Android Gradle Plugin
// picks up `android.injected.signing.*` during non-interactive builds.
writeSigningProperties({
  'android.injected.signing.store.file': keystorePath,
  'android.injected.signing.store.password': keystorePassword,
  'android.injected.signing.key.alias': keyAlias,
  'android.injected.signing.key.password': effectiveKeyPassword,
  ...(detectedStoreType ? { 'android.injected.signing.store.type': detectedStoreType } : {}),
});

run('./gradlew', [
  ...gradleTasks,
  // Trim ABIs for release artifacts. Play needs at most armeabi-v7a + arm64-v8a;
  // x86/x86_64 only matter for emulators (covered by development builds). CI sets
  // the wider set on version tags. Building fewer ABIs cuts native compile and
  // packaging work, plus bundletool's peak memory.
  `-PreactNativeArchitectures=${getOptionalEnv('ANDROID_RELEASE_ABIS') ?? 'arm64-v8a'}`,
], {
  cwd: androidDir,
  env: buildEnv,
});

console.log(`Android ${appVariant} build complete.`);
