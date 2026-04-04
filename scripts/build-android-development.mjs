#!/usr/bin/env node

import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
});

run('./gradlew', ['assembleDebug'], {
  cwd: androidDir,
});

console.log('Android development build complete.');
