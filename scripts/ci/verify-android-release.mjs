#!/usr/bin/env node
// Static release-artifact verification for Android.
//
// This gate proves packaging, signing, identity, ABI, native-library,
// 16 KB page-size and FOSS-exclusion correctness. It cannot prove that the app
// starts on a device; Play internal testing and TestFlight own that check.
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';

function fail(message) {
  console.error(`[android-release] ${message}`);
  process.exit(1);
}

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] || '';
}

function has(name) {
  return process.argv.includes(`--${name}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    fail(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : ''}`);
  }
  return result.stdout ?? '';
}

function which(name) {
  try {
    return execFileSync('which', [name], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function sdkRoot() {
  const root = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!root || !fs.existsSync(root)) fail('ANDROID_HOME or ANDROID_SDK_ROOT must point at the Android SDK');
  return root;
}

function versionedTool(root, group, name) {
  const dir = path.join(root, group);
  if (!fs.existsSync(dir)) return '';
  const versions = fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse();
  for (const version of versions) {
    const candidate = path.join(dir, version, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function findAndroidTool(name) {
  const root = sdkRoot();
  if (name === 'apkanalyzer') {
    const latest = path.join(root, 'cmdline-tools', 'latest', 'bin', name);
    if (fs.existsSync(latest)) return latest;
    return versionedTool(root, 'cmdline-tools', `bin/${name}`) || which(name);
  }
  return versionedTool(root, 'build-tools', name) || which(name);
}

function entries(file) {
  return run('unzip', ['-Z1', file])
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function extract(file, entry) {
  return execFileSync('unzip', ['-p', file, entry], {
    maxBuffer: 256 * 1024 * 1024,
  });
}

function checkAbi(file, prefix, expectedAbi) {
  const all = entries(file);
  const nativeEntries = all.filter((entry) => entry.startsWith(prefix) && entry.endsWith('.so'));
  if (nativeEntries.length === 0) fail(`${file}: no native libraries under ${prefix}`);

  const abis = new Set(nativeEntries.map((entry) => entry.slice(prefix.length).split('/')[0]));
  if (abis.size !== 1 || !abis.has(expectedAbi)) {
    fail(`${file}: expected only ${expectedAbi} native libraries, found: ${[...abis].sort().join(', ') || 'none'}`);
  }

  for (const required of ['libappmodules.so', 'libreactnative.so', 'librnllama.so']) {
    if (!nativeEntries.some((entry) => entry.endsWith(`/${required}`))) {
      fail(`${file}: missing required native library ${required}`);
    }
  }

  return nativeEntries;
}

function elfLoadAlignments(buffer, label) {
  if (buffer.length < 64 || buffer[0] !== 0x7f || buffer[1] !== 0x45 || buffer[2] !== 0x4c || buffer[3] !== 0x46) {
    fail(`${label}: not an ELF file`);
  }
  if (buffer[4] !== 2) fail(`${label}: expected ELF64`);
  const littleEndian = buffer[5] === 1;
  if (!littleEndian) fail(`${label}: expected little-endian ELF`);

  const phoff = buffer.readBigUInt64LE(32);
  const phentsize = buffer.readUInt16LE(54);
  const phnum = buffer.readUInt16LE(56);
  const alignments = [];
  for (let index = 0; index < phnum; index += 1) {
    const offset = Number(phoff) + index * phentsize;
    if (offset + 56 > buffer.length) fail(`${label}: truncated program header`);
    const type = buffer.readUInt32LE(offset);
    if (type === 1) alignments.push(buffer.readBigUInt64LE(offset + 48));
  }
  if (alignments.length === 0) fail(`${label}: no PT_LOAD segments`);
  return alignments;
}

function check16KbElf(file, nativeEntries) {
  for (const entry of nativeEntries) {
    const buffer = extract(file, entry);
    for (const alignment of elfLoadAlignments(buffer, `${file}:${entry}`)) {
      if (alignment < 16384n) {
        fail(`${file}:${entry}: PT_LOAD alignment ${alignment} is below 16 KB`);
      }
    }
  }
}

function checkApk(apk, expected) {
  const apkanalyzer = findAndroidTool('apkanalyzer');
  const apksigner = findAndroidTool('apksigner');
  const zipalign = findAndroidTool('zipalign');
  if (!apkanalyzer) fail('apkanalyzer not found in the Android SDK');
  if (!apksigner) fail('apksigner not found in the Android SDK');
  if (!zipalign) fail('zipalign not found in the Android SDK');

  const packageName = run(apkanalyzer, ['manifest', 'application-id', apk]).trim();
  const versionName = run(apkanalyzer, ['manifest', 'version-name', apk]).trim();
  const versionCode = run(apkanalyzer, ['manifest', 'version-code', apk]).trim();
  const debuggable = run(apkanalyzer, ['manifest', 'debuggable', apk]).trim();
  if (packageName !== expected.package) fail(`${apk}: package ${packageName} != ${expected.package}`);
  if (versionName !== expected.version) fail(`${apk}: versionName ${versionName} != ${expected.version}`);
  if (versionCode !== expected.versionCode) fail(`${apk}: versionCode ${versionCode} != ${expected.versionCode}`);
  if (debuggable !== 'false') fail(`${apk}: debuggable must be false`);

  const constructor = run(apkanalyzer, [
    'dex', 'code', '--class', 'androidx.work.impl.WorkDatabase_Impl', '--method', '<init>()V', apk,
  ]);
  if (!constructor.includes('.method public constructor <init>()V')) {
    fail(`${apk}: R8 removed WorkDatabase_Impl's public no-arg constructor`);
  }

  const packages = run(apkanalyzer, ['dex', 'packages', apk]);
  for (const keepClass of [
    'io.github.expo.pika',
    'com.rnllama',
    'com.reactnativeandroidwidget.RNWidgetBackgroundTaskWorker',
  ]) {
    if (!packages.includes(keepClass)) fail(`${apk}: expected R8 keep class ${keepClass} is missing`);
  }

  // apksigner revisions differ on which stream carries the signer digest, so
  // parse the combined output instead of stdout alone. A parse miss fails with
  // the raw output attached so the next failure is diagnosable.
  const verifyResult = spawnSync(apksigner, ['verify', '--verbose', '--print-certs', apk], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  const combinedOutput = [verifyResult.stdout, verifyResult.stderr].filter(Boolean).join('\n');
  if (verifyResult.status !== 0) {
    fail(`${apk}: apksigner verification failed:\n${combinedOutput.trim()}`);
  }
  // Newer build-tools label v2/v3 signers as "V2 Signer:"/"V3 Signer:"
  // instead of the legacy "Signer #1" numbering; accept both.
  const certMatch = combinedOutput.match(/(?:Signer #\d+|V\d(?:\.\d)? Signer): certificate SHA-256 digest:\s*([0-9a-f:\s]+)/i);
  if (!certMatch) {
    const excerpt = combinedOutput.split('\n').slice(0, 20).join('\n');
    fail(`${apk}: could not read signing certificate. apksigner output:\n${excerpt}`);
  }
  const cert = certMatch[1].replace(/[:\s]/g, '').toLowerCase();
  if (!expected.certSha256) fail('Missing --cert-sha256; release signing identity must be pinned');
  if (cert !== expected.certSha256.replace(/:/g, '').toLowerCase()) {
    fail(`${apk}: signing certificate ${cert} does not match ANDROID_CERT_SHA256`);
  }

  run(zipalign, ['-c', '-P', '16', '-v', '4', apk]);
  check16KbElf(apk, checkAbi(apk, 'lib/', expected.abi));
  return { packageName, versionName, versionCode, cert };
}

function checkAab(aab, expected) {
  const jarsigner = which('jarsigner');
  if (!jarsigner) fail('jarsigner not found');
  run(jarsigner, ['-verify', '-verbose', '-certs', aab]);

  if (expected.bundletool) {
    const java = which('java');
    if (!java) fail('java not found for bundletool');
    const manifest = run('java', ['-jar', expected.bundletool, 'dump', 'manifest', `--bundle=${aab}`, '--module=base']);
    const packageMatch = manifest.match(/\bpackage="([^"]+)"/);
    const versionCodeMatch = manifest.match(/\bandroid:versionCode="([^"]+)"/);
    const versionNameMatch = manifest.match(/\bandroid:versionName="([^"]+)"/);
    if (!packageMatch || packageMatch[1] !== expected.package) {
      fail(`${aab}: package ${packageMatch?.[1] ?? 'missing'} != ${expected.package}`);
    }
    if (!versionCodeMatch || versionCodeMatch[1] !== expected.versionCode) {
      fail(`${aab}: versionCode ${versionCodeMatch?.[1] ?? 'missing'} != ${expected.versionCode}`);
    }
    if (!versionNameMatch || versionNameMatch[1] !== expected.version) {
      fail(`${aab}: versionName ${versionNameMatch?.[1] ?? 'missing'} != ${expected.version}`);
    }
  } else {
    console.warn('[android-release] bundletool not supplied; AAB manifest identity was not checked');
  }

  check16KbElf(aab, checkAbi(aab, 'base/lib/', expected.abi));
}

function checkFoss(apk) {
  const dexEntries = entries(apk).filter((entry) => /^classes\d*\.dex$/.test(entry));
  if (dexEntries.length === 0) fail(`${apk}: no classes.dex entries found`);
  const needles = [
    'com/android/billingclient',
    'com/google/mlkit',
    'com/android/installreferrer',
    'play-services-code-scanner',
    'com/google/android/play/core/appupdate',
    'com/google/android/play/core/install',
  ];
  for (const entry of dexEntries) {
    const dex = extract(apk, entry);
    for (const needle of needles) {
      if (dex.includes(Buffer.from(needle))) {
        fail(`${apk}: FOSS APK unexpectedly contains ${needle}`);
      }
    }
  }
}

const apk = arg('apk');
if (!apk || !fs.existsSync(apk)) fail(`APK not found: ${apk}`);

const expected = {
  package: arg('package'),
  version: arg('version'),
  versionCode: arg('version-code'),
  abi: arg('abi', 'arm64-v8a'),
  certSha256: arg('cert-sha256'),
  bundletool: arg('bundletool'),
};
if (!expected.package || !expected.version || !expected.versionCode) {
  fail('--package, --version and --version-code are required');
}
if (expected.abi !== 'arm64-v8a') fail(`Unsupported release ABI: ${expected.abi}`);

const mapping = arg('mapping');
if (mapping) {
  if (!fs.existsSync(mapping) || fs.statSync(mapping).size === 0) {
    fail(`R8 mapping file is missing or empty: ${mapping}`);
  }
}

const apkResult = checkApk(apk, expected);
if (has('foss')) checkFoss(apk);

const aab = arg('aab');
if (aab) {
  if (!fs.existsSync(aab)) fail(`AAB not found: ${aab}`);
  checkAab(aab, expected);
}

console.log(`[android-release] verified ${apkResult.packageName} ${apkResult.versionName} (${apkResult.versionCode}), ${expected.abi} only, 16 KB aligned, signing certificate ${apkResult.cert}`);
if (aab) console.log(`[android-release] verified AAB ${aab}`);
if (has('foss')) console.log('[android-release] verified FOSS proprietary-library exclusions');
