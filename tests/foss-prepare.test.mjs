import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareFoss } from '../scripts/foss-prepare.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-foss-'));
const override = process.env.FIREBASE_STUB_SRC_DIR;
delete process.env.FIREBASE_STUB_SRC_DIR;
try {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    expo: { autolinking: { exclude: ['existing-module'] } },
  }));
  for (const name of ['expo-notifications', 'expo-application']) {
    fs.cpSync(path.resolve('node_modules', name, 'android'),
      path.join(root, 'node_modules', name, 'android'), { recursive: true });
  }
  fs.mkdirSync(path.join(root, 'vendor'));
  fs.symlinkSync(path.resolve('vendor/firebase-stubs'), path.join(root, 'vendor/firebase-stubs'));

  prepareFoss(root);
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const notificationDir = 'node_modules/expo-notifications/android';
  const applicationDir = 'node_modules/expo-application/android';
  const stub = 'src/main/java/com/google/firebase/messaging/FirebaseMessaging.java';
  assert.equal(read(`${notificationDir}/${stub}`),
    read(`vendor/firebase-stubs/firebase-messaging/${stub}`));
  assert.doesNotMatch(read(`${notificationDir}/build.gradle`), /firebase-messaging/);
  assert.doesNotMatch(read(`${applicationDir}/build.gradle`), /installreferrer/);
  const application = read(`${applicationDir}/src/main/java/expo/modules/application/ApplicationModule.kt`);
  assert.doesNotMatch(application, /com\.android\.installreferrer|import android\.os\.RemoteException/);
  assert.match(application, /getInstallReferrerAsync[\s\S]*promise\.resolve\(""\)/);
  assert.deepEqual(JSON.parse(read('package.json')).expo.autolinking.exclude,
    ['existing-module', 'expo-iap', 'expo-camera']);

  const files = ['package.json', `${notificationDir}/build.gradle`,
    `${applicationDir}/build.gradle`, `${applicationDir}/src/main/java/expo/modules/application/ApplicationModule.kt`];
  const patched = files.map(read);
  prepareFoss(root);
  assert.deepEqual(files.map(read), patched, 'Repeated preparation must leave the same build inputs');

  fs.unlinkSync(path.join(root, `${notificationDir}/${stub}`));
  fs.unlinkSync(path.join(root, 'vendor/firebase-stubs'));
  assert.throws(() => prepareFoss(root), /git submodule update --init --recursive/);
  console.log('FOSS preparation: pinned source, proprietary dependency removal, and idempotence passed');
} finally {
  if (override === undefined) delete process.env.FIREBASE_STUB_SRC_DIR;
  else process.env.FIREBASE_STUB_SRC_DIR = override;
  fs.rmSync(root, { recursive: true, force: true });
}
