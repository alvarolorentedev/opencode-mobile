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

function injectReleaseSigningConfig(filePath, signing) {
  const original = fs.readFileSync(filePath, 'utf8');

  if (original.includes('signingConfigs {\n        release {')) {
    return;
  }

  let updated = original;
  const signingBlock = `\n    signingConfigs {\n        release {\n            storeFile file('${signing.storeFile}')\n            storePassword '${signing.storePassword}'\n            keyAlias '${signing.keyAlias}'\n            keyPassword '${signing.keyPassword}'\n        }\n    }\n`;

  if (updated.includes('buildTypes {')) {
    updated = updated.replace('buildTypes {', `${signingBlock}    buildTypes {`);
  } else {
    fail(`Unable to find buildTypes block in ${filePath}`);
  }

  updated = updated.replace(/release \{([\s\S]*?)\n\s*\}/, (match, body) => {
    if (body.includes('signingConfig signingConfigs.release')) {
      return match;
    }
    return `release {${body}\n            signingConfig signingConfigs.release\n        }`;
  });

  fs.writeFileSync(filePath, updated);
}

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

injectReleaseSigningConfig(path.join(androidDir, 'app', 'build.gradle'), {
  storeFile: '../release.keystore',
  storePassword: keystorePassword,
  keyAlias,
  keyPassword,
});

run('./gradlew', [
  'bundleRelease',
  'assembleRelease',
], {
  cwd: androidDir,
});

console.log('Android production build complete.');
