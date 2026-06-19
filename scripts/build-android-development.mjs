#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const extraGradleArgs = (process.env.GRADLE_ARGS ?? '').split(/\s+/).filter(Boolean);

function fail(message) {
  console.error(message);
  process.exit(1);
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

const repoRoot = process.cwd();
const androidDir = path.join(repoRoot, 'android');

run('npx', ['expo', 'prebuild', '--platform', 'android', '--non-interactive', '--clean'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    EXPO_APP_VARIANT: 'development',
  },
});

// Patch foojay-resolver-convention from 0.5.0 to 0.9.0 to avoid Maven Central
// 403 errors for its transitive dependency com.google.code.gson:gson:2.9.1.
function patchFoojayResolver() {
  const settingsFile = path.join(androidDir, 'settings.gradle');
  if (!fs.existsSync(settingsFile)) {
    console.log('settings.gradle not found, skipping foojay-resolver patch.');
    return;
  }
  let content = fs.readFileSync(settingsFile, 'utf8');
  const original = content;

  // Handle single-quoted format: id 'org.gradle.toolchains.foojay-resolver-convention' version '0.5.0'
  content = content.replace(
    /(['"])org\.gradle\.toolchains\.foojay-resolver-convention\1\s+version\s+(['"])0\.5\.0\2/g,
    (match, q1, q2) => `${q1}org.gradle.toolchains.foojay-resolver-convention${q1} version ${q2}0.9.0${q2}`
  );

  if (content !== original) {
    fs.writeFileSync(settingsFile, content, 'utf8');
    console.log('Patched foojay-resolver-convention 0.5.0 -> 0.9.0 in android/settings.gradle');
  } else {
    console.log('foojay-resolver-convention 0.5.0 not found in settings.gradle, no patch needed.');
  }
}

patchFoojayResolver();

run('./gradlew', ['assembleDebug', ...extraGradleArgs], {
  cwd: androidDir,
});

console.log('Android development build complete.');
