import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareFoss } from '../scripts/foss-prepare.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-foss-'));
const override = process.env.FIREBASE_STUB_SRC_DIR;
const stub = 'src/main/java/com/google/firebase/messaging/FirebaseMessaging.java';
const stubSource = path.join(root, 'firebase-messaging', stub);
process.env.FIREBASE_STUB_SRC_DIR = path.join(root, 'firebase-messaging/src');
try {
  fs.mkdirSync(path.dirname(stubSource), { recursive: true });
  fs.writeFileSync(stubSource, 'package com.google.firebase.messaging;\npublic class FirebaseMessaging {}\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    expo: { autolinking: { exclude: ['existing-module'] } },
  }));
  for (const name of ['expo-notifications', 'expo-application']) {
    fs.cpSync(path.resolve('node_modules', name, 'android'),
      path.join(root, 'node_modules', name, 'android'), { recursive: true });
  }
  prepareFoss(root);
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const notificationDir = 'node_modules/expo-notifications/android';
  const applicationDir = 'node_modules/expo-application/android';
  assert.equal(read(`${notificationDir}/${stub}`),
    fs.readFileSync(stubSource, 'utf8'));
  assert.doesNotMatch(read(`${notificationDir}/build.gradle`), /firebase-messaging/);
  assert.doesNotMatch(read(`${applicationDir}/build.gradle`), /installreferrer/);
  const application = read(`${applicationDir}/src/main/java/expo/modules/application/ApplicationModule.kt`);
  assert.doesNotMatch(application, /com\.android\.installreferrer|import android\.os\.RemoteException/);
  assert.match(application, /getInstallReferrerAsync[\s\S]*promise\.resolve\(""\)/);
  assert.deepEqual(JSON.parse(read('package.json')).expo.autolinking.exclude,
    ['existing-module', 'expo-iap', 'expo-camera', 'opencode-updates']);

  const files = ['package.json', `${notificationDir}/build.gradle`,
    `${applicationDir}/build.gradle`, `${applicationDir}/src/main/java/expo/modules/application/ApplicationModule.kt`];
  const patched = files.map(read);
  prepareFoss(root);
  assert.deepEqual(files.map(read), patched, 'Repeated preparation must leave the same build inputs');

  fs.unlinkSync(path.join(root, `${notificationDir}/${stub}`));
  delete process.env.FIREBASE_STUB_SRC_DIR;
  assert.throws(() => prepareFoss(root), /FIREBASE_STUB_SRC_DIR/);
  console.log('FOSS preparation: supplied stub source, proprietary dependency removal, and idempotence passed');
} finally {
  if (override === undefined) delete process.env.FIREBASE_STUB_SRC_DIR;
  else process.env.FIREBASE_STUB_SRC_DIR = override;
  fs.rmSync(root, { recursive: true, force: true });
}
