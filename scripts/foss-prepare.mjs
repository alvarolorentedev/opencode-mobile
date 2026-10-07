#!/usr/bin/env node
// Applies every patch that turns the vendored dependencies into a build that
// F-Droid's inclusion policy accepts. Shared by scripts/build-android-release.mjs
// (FOSS flavor) and the fdroiddata recipe so both apply the same patches.
//
// Patches:
//   1. package.json   -> exclude the native expo-iap / expo-camera modules
//   2. expo-notifications -> drop proprietary firebase-messaging, compile
//      against F-Droid's firebase-stubs instead (local notifications only)
//   3. expo-application -> drop the proprietary com.android.installreferrer
//      dependency and replace its AsyncFunction with a no-op
//
// Safe to run more than once.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function patchAutolinking(repoRoot) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  pkg.expo = { ...(pkg.expo ?? {}) };
  pkg.expo.autolinking = { ...(pkg.expo.autolinking ?? {}) };
  pkg.expo.autolinking.exclude = [
    ...new Set([...(pkg.expo.autolinking.exclude ?? []), 'expo-iap', 'expo-camera']),
  ];
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function patchExpoNotifications(repoRoot) {
  const androidDir = path.join(repoRoot, 'node_modules', 'expo-notifications', 'android');
  const gradlePath = path.join(androidDir, 'build.gradle');
  const gradle = fs.readFileSync(gradlePath, 'utf8');
  if (gradle.includes('firebase-messaging')) {
    fs.writeFileSync(
      gradlePath,
      gradle.split('\n').filter((line) => !line.includes('firebase-messaging')).join('\n'),
    );
  }

  const marker = path.join(
    androidDir,
    'src/main/java/com/google/firebase/messaging/FirebaseMessaging.java',
  );
  if (fs.existsSync(marker)) return;

  const localSrcDir = process.env.FIREBASE_STUB_SRC_DIR;
  const stubSrcDir = localSrcDir
    ? path.resolve(localSrcDir)
    : path.join(repoRoot, 'vendor/firebase-stubs/firebase-messaging/src');
  if (!fs.existsSync(path.join(stubSrcDir, 'main/java/com/google/firebase/messaging/FirebaseMessaging.java'))) {
    throw new Error('Firebase stub sources are missing. Run git submodule update --init --recursive.');
  }
  run('cp', ['-a', `${stubSrcDir}/.`, `${path.join(androidDir, 'src')}/`]);
}

// Replace an `AsyncFunction("name") { ... }` block with `replacement`, matching
// balanced braces so nested lambdas/objects do not confuse the boundaries.
function replaceAsyncFunction(source, name, replacement) {
  const marker = `AsyncFunction("${name}")`;
  const start = source.indexOf(marker);
  if (start === -1) return source;
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const lineStart = source.lastIndexOf('\n', start) + 1;
  return source.slice(0, lineStart) + replacement + source.slice(end);
}

function patchExpoApplication(repoRoot) {
  const androidDir = path.join(repoRoot, 'node_modules', 'expo-application', 'android');
  const gradlePath = path.join(androidDir, 'build.gradle');
  const gradle = fs.readFileSync(gradlePath, 'utf8');
  if (gradle.includes('installreferrer')) {
    fs.writeFileSync(
      gradlePath,
      gradle.split('\n').filter((line) => !line.includes('installreferrer')).join('\n'),
    );
  }

  const modulePath = path.join(
    androidDir,
    'src/main/java/expo/modules/application/ApplicationModule.kt',
  );
  const source = fs.readFileSync(modulePath, 'utf8');
  if (!source.includes('com.android.installreferrer')) return;

  const patched = replaceAsyncFunction(
    source
      .split('\n')
      .filter((line) => !line.includes('com.android.installreferrer'))
      .filter((line) => line.trim() !== 'import android.os.RemoteException')
      .join('\n'),
    'getInstallReferrerAsync',
    '    AsyncFunction("getInstallReferrerAsync") { promise: Promise ->\n      promise.resolve("")\n    }',
  );
  fs.writeFileSync(modulePath, patched);
}

export function prepareFoss(repoRoot = process.cwd()) {
  patchAutolinking(repoRoot);
  patchExpoNotifications(repoRoot);
  patchExpoApplication(repoRoot);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  prepareFoss();
  console.log('FOSS dependency patches applied.');
}
