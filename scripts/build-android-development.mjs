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

run('npx', ['expo', 'prebuild', '--platform', 'android', '--non-interactive', '--clean'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    EXPO_APP_VARIANT: 'development',
  },
});

run('./gradlew', ['assembleDebug', ...extraGradleArgs], {
  cwd: androidDir,
});

console.log('Android development build complete.');
