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

// Pass signing props to Gradle. The Android Gradle Plugin will pick these up
// during non-interactive CI builds.
// Detect keystore type (pkcs12 vs jks). keytool can list a keystore with a
// specific storetype; try pkcs12 first and fall back to jks.
function runKeytoolList(keystoreFile, password, storetype) {
  try {
    const proc = spawnSync('keytool', [
      '-list',
      '-keystore',
      keystoreFile,
      '-storepass',
      password,
      '-storetype',
      storetype,
    ], { encoding: 'utf8' });
    return { status: proc.status, stdout: proc.stdout || '', stderr: proc.stderr || '' };
  } catch (e) {
    return { status: 1, stdout: '', stderr: String(e) };
  }
}

function validateKeystore(keystoreFile, password) {
  // Try pkcs12 then jks
  const tried = [];
  for (const t of ['pkcs12', 'jks']) {
    const res = runKeytoolList(keystoreFile, password, t);
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

const validation = validateKeystore(keystorePath, keystorePassword);
if (validation.storeType) {
  console.log(`Detected keystore type: ${validation.storeType}`);
  if (validation.aliases && validation.aliases.length) {
    console.log('Keystore aliases:');
    for (const a of validation.aliases) console.log(` - ${a}`);
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
