#!/usr/bin/env node
// Applies every patch that turns the vendored dependencies into a build that
// F-Droid's inclusion policy accepts. Shared by scripts/build-android-release.mjs
// (FOSS flavor) and the fdroiddata recipe so both apply the same patches.
//
// Patches:
//   1. package.json   -> exclude the native expo-iap / expo-camera /
//      expo-store-review modules
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
    ...new Set([...(pkg.expo.autolinking.exclude ?? []), 'expo-iap', 'expo-camera', 'expo-store-review', 'expo-in-app-updates']),
  ];
  pkg.expo.autolinking.android = { ...(pkg.expo.autolinking.android ?? {}) };
  pkg.expo.autolinking.android.buildFromSource = [...new Set([...(pkg.expo.autolinking.android.buildFromSource ?? []), 'expo-application', 'expo-notifications'])];
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

  const localSrcDir = process.env.FIREBASE_STUB_SRC_DIR?.trim();
  const stubSrcDir = localSrcDir ? path.resolve(localSrcDir) : undefined;
  if (!stubSrcDir || !fs.existsSync(path.join(stubSrcDir, 'main/java/com/google/firebase/messaging/FirebaseMessaging.java'))) {
    throw new Error('Firebase stub sources are missing. Set FIREBASE_STUB_SRC_DIR or run npm run build:foss:android.');
  }
  run('cp', ['-a', `${stubSrcDir}/.`, `${path.join(androidDir, 'src')}/`]);
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

  const cleaned = source
    .split('\n')
    .filter((line) => !line.includes('com.android.installreferrer'))
    .filter((line) => line.trim() !== 'import android.os.RemoteException')
    .join('\n');
  const start = cleaned.indexOf('  suspend fun getInstallReferrerAsync(): String =');
  if (start < 0) throw new Error('Review expo-application FOSS install-referrer removal for this SDK.');
  const open = cleaned.indexOf('{', start);
  let depth = 1;
  let end = open + 1;
  for (; end < cleaned.length && depth; end++) {
    if (cleaned[end] === '{') depth++;
    else if (cleaned[end] === '}') depth--;
  }
  if (open < 0 || depth) throw new Error('Unrecognized install-referrer function.');
  const patched = cleaned.slice(0, start) + '  suspend fun getInstallReferrerAsync(): String = ""' + cleaned.slice(end);
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
