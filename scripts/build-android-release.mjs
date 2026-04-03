#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
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

run('npx', ['expo', 'prebuild', '--platform', 'android', '--non-interactive', '--clean'], {
  cwd: repoRoot,
});

const keystoreBase64 = requireEnv('ANDROID_KEYSTORE_BASE64').replace(/\s+/g, '');
const keystorePassword = requireEnv('ANDROID_KEYSTORE_PASSWORD');
const keyAlias = requireEnv('ANDROID_KEY_ALIAS');
const keyPassword = requireEnv('ANDROID_KEY_PASSWORD');

fs.writeFileSync(keystorePath, Buffer.from(keystoreBase64, 'base64'));

// Pass signing props to Gradle. The Android Gradle Plugin will pick these up
// during non-interactive CI builds.
// Detect keystore type (pkcs12 vs jks). keytool can list a keystore with a
// specific storetype; try pkcs12 first and fall back to jks.
function detectStoreType(keystoreFile, password) {
  try {
    const tryPkcs12 = spawnSync('keytool', [
      '-list',
      '-keystore',
      keystoreFile,
      '-storepass',
      password,
      '-storetype',
      'pkcs12',
    ]);
    if (tryPkcs12.status === 0) return 'pkcs12';
  } catch (e) {
    // ignore
  }

  try {
    const tryJks = spawnSync('keytool', [
      '-list',
      '-keystore',
      keystoreFile,
      '-storepass',
      password,
      '-storetype',
      'jks',
    ]);
    if (tryJks.status === 0) return 'jks';
  } catch (e) {
    // ignore
  }

  return undefined;
}

const detectedStoreType = detectStoreType(keystorePath, keystorePassword);
if (detectedStoreType) {
  console.log(`Detected keystore type: ${detectedStoreType}`);
} else {
  console.warn('Could not detect keystore type; defaulting to pkcs12');
}
run('./gradlew', [
  'bundleRelease',
  'assembleRelease',
  `-Pandroid.injected.signing.store.file=${keystorePath}`,
  `-Pandroid.injected.signing.store.password=${keystorePassword}`,
  `-Pandroid.injected.signing.key.alias=${keyAlias}`,
  `-Pandroid.injected.signing.key.password=${keyPassword}`,
  ...(detectedStoreType ? [`-Pandroid.injected.signing.store.type=${detectedStoreType}`] : []),
], {
  cwd: androidDir,
});

console.log('Android production build complete.');
