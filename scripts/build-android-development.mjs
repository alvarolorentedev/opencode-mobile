#!/usr/bin/env node

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

// Expo SDK 54+ deprecated --non-interactive; CI=1 forces the same non-interactive mode.
run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    EXPO_APP_VARIANT: 'development',
    CI: '1',
  },
});

run('./gradlew', ['assembleDebug', ...extraGradleArgs], {
  cwd: androidDir,
});

console.log('Android development build complete.');
