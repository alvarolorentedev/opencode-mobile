#!/usr/bin/env node

// Apple-SDK compilation and a standalone SwiftUI harness, never an RN app boot.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const plist = createRequire(import.meta.url)('@expo/plist').default;
const activityCopy = JSON.parse(fs.readFileSync(new URL('../../shared/i18n/locales/en/notifications.json', import.meta.url), 'utf8')).activity;
export const previewBundleIdentifier = 'app.yuv41.opencodemobile.activitypreview';
export const previewModes = [
  { id: 'light', appearance: 'light', textSize: 'large' },
  { id: 'dark', appearance: 'dark', textSize: 'large' },
  { id: 'accessibility', appearance: 'dark', textSize: 'accessibility3' },
];

export function previewFixtures(now = new Date()) {
  const date = (seconds) => new Date(now.getTime() + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const state = {
    link: `opencodemobile-activities://session/preview?project=%2Fpreview&connectionScope=activity-sha256:${'0'.repeat(64)}`,
    phase: 'thinking', count: 1, updatedAt: date(-5), isPaused: false,
  };
  /**
   * @param {string} id
   * @param {{ phase?: string, count?: number, isPaused?: boolean, updatedAt?: string, frozenAt?: string, endedAt?: string,
   * agentCount?: number, toolCount?: number, filesChanged?: number, completedSteps?: number, totalSteps?: number }} changes
   * @param {{ locale?: string, direction?: string, isStale?: boolean }} extra
   * @param {Record<string, string>} copy
   */
  const fixture = (id, changes = {}, extra = {}, copy = activityCopy) => {
    const current = { ...state, ...changes };
    const label = (key, values = {}) => copy[key].replace(/\{\{(\w+)\}\}/g, (_, field) => {
      if (values[field] === undefined) throw new Error(`Missing ${field} in preview label: ${key}`);
      return String(values[field]);
    });
    return {
      id, startedAt: date(-125), isStale: false, locale: 'en', direction: 'ltr',
      copySource: copy === activityCopy ? 'production-en' : 'synthetic-stress',
      state: {
        ...current, body: label(current.phase), pausedLabel: label('updatesPaused'),
        chip: ['finished', 'failed', 'stopped'].includes(current.phase) ? label(current.phase)
          : current.count > 1 ? label('tasks', { count: current.count }) : label('working'),
        ...(id === 'thinking' ? {} : {
          updatedLabel: label('updatedLabel'), elapsedLabel: label('elapsedLabel'),
          ...(current.agentCount === undefined ? {} : { agentsLabel: label('agentsLabel', { count: current.agentCount }) }),
          ...(current.toolCount === undefined ? {} : { toolsLabel: label('toolsLabel', { count: current.toolCount }) }),
          ...(current.filesChanged === undefined ? {} : { filesLabel: label('filesLabel', { count: current.filesChanged }) }),
          ...(current.completedSteps === undefined || current.totalSteps === undefined ? {} : {
            progressLabel: label('progressLabel', { completed: current.completedSteps, total: current.totalSteps }),
          }),
        }),
      }, ...extra,
    };
  };
  return [
    // Intentionally omits every new optional field: old ContentState must decode.
    fixture('thinking'),
    fixture('reading', { phase: 'reading', agentCount: 2, toolCount: 3, completedSteps: 3, totalSteps: 6, filesChanged: 2 }),
    fixture('editing', { phase: 'editing', completedSteps: 3, totalSteps: 6, filesChanged: 4 }),
    fixture('searching', { phase: 'searching', toolCount: 2 }),
    fixture('executing', { phase: 'executing', toolCount: 1 }),
    fixture('delegating', { phase: 'delegating', agentCount: 3, count: 3 }),
    fixture('needs-input', { phase: 'needsInput' }),
    fixture('reconnecting', { phase: 'reconnecting' }),
    fixture('paused', { phase: 'reading', isPaused: true, frozenAt: date(-10) }),
    fixture('paused-insights', { phase: 'reading', isPaused: true, frozenAt: date(-10), completedSteps: 3, totalSteps: 6, agentCount: 2, toolCount: 3, filesChanged: 2 }),
    fixture('stale', { updatedAt: date(-90) }, { isStale: true }),
    fixture('finished', { phase: 'finished', count: 0, isPaused: true, endedAt: date(-10), completedSteps: 6, totalSteps: 6 }),
    fixture('failed', { phase: 'failed', count: 0, isPaused: true, endedAt: date(-10) }),
    // Deliberately synthetic stress copy, not a claim of shipped translations.
    fixture('french-long', {
      phase: 'editing', count: 3, agentCount: 2, toolCount: 3, filesChanged: 4, completedSteps: 3, totalSteps: 6,
    }, { locale: 'fr' }, {
      ...activityCopy, editing: 'Mise à jour des fichiers et vérification des modifications en cours',
      tasks: '{{count}} tâches en cours', updatesPaused: 'Les mises à jour sont temporairement suspendues',
      progressLabel: 'Progression des étapes du plan : {{completed}} sur {{total}}', agentsLabel: 'Agents actifs : {{count}}', toolsLabel: 'Outils utilisés : {{count}}',
      filesLabel: 'Fichiers modifiés : {{count}}', updatedLabel: 'Dernière mise à jour', elapsedLabel: 'Temps écoulé',
    }),
    fixture('hebrew-rtl', {
      phase: 'needsInput', count: 3, completedSteps: 3, totalSteps: 6, agentCount: 2, toolCount: 3, filesChanged: 4,
    }, { locale: 'he', direction: 'rtl' }, {
      ...activityCopy, needsInput: 'נדרשת תשומת לב כדי להמשיך במשימות הפעילות', tasks: '{{count}} משימות פעילות',
      updatesPaused: 'העדכונים מושהים עד לחזרה לאפליקציה', progressLabel: 'התקדמות התוכנית: {{completed}} מתוך {{total}}',
      agentsLabel: 'סוכנים: {{count}}', toolsLabel: 'כלים: {{count}}', filesLabel: 'קבצים: {{count}}', updatedLabel: 'עודכן', elapsedLabel: 'זמן שחלף',
    }),
  ];
}

export function validateFixtures(fixtures) {
  const ids = new Set();
  const phases = new Set(['thinking', 'reading', 'editing', 'searching', 'executing', 'delegating', 'needsInput', 'reconnecting', 'finished', 'failed']);
  for (const fixture of fixtures) {
    const state = fixture.state;
    if (!/^[a-z-]+$/.test(fixture.id) || ids.has(fixture.id)) throw new Error('Invalid or duplicate preview fixture id');
    ids.add(fixture.id);
    if (!state || !phases.has(state.phase) || typeof state.isPaused !== 'boolean' || typeof fixture.isStale !== 'boolean'
      || state.count === undefined || typeof fixture.startedAt !== 'string' || typeof state.updatedAt !== 'string') throw new Error(`Invalid preview state: ${fixture.id}`);
    for (const key of ['body', 'link', 'chip', 'pausedLabel']) {
      if (typeof state[key] !== 'string' || !state[key].trim()) throw new Error(`Invalid ${key}: ${fixture.id}`);
    }
    for (const key of ['progressLabel', 'agentsLabel', 'toolsLabel', 'filesLabel', 'updatedLabel', 'elapsedLabel']) {
      if (state[key] !== undefined && (typeof state[key] !== 'string' || !state[key].trim())) throw new Error(`Invalid ${key}: ${fixture.id}`);
    }
    for (const key of ['count', 'agentCount', 'toolCount', 'completedSteps', 'totalSteps', 'filesChanged']) {
      if (state[key] !== undefined && (!Number.isInteger(state[key]) || state[key] < 0 || state[key] > 9999)) throw new Error(`Invalid ${key}: ${fixture.id}`);
    }
    if ((state.completedSteps === undefined) !== (state.totalSteps === undefined)
      || (state.totalSteps !== undefined && (state.totalSteps === 0 || state.completedSteps > state.totalSteps))) throw new Error(`Invalid progress: ${fixture.id}`);
    for (const value of [fixture.startedAt, state.updatedAt, state.frozenAt, state.endedAt].filter((value) => value !== undefined)) {
      if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid preview date: ${fixture.id}`);
    }
    if (!['ltr', 'rtl'].includes(fixture.direction) || !['en', 'fr', 'he'].includes(fixture.locale)) throw new Error(`Invalid preview locale: ${fixture.id}`);
  }
  if (!ids.size) throw new Error('No preview fixtures');
  return fixtures;
}

export function generatedSources(root) {
  const directory = path.join(root, 'ios/OpencodeLiveActivity');
  const files = fs.readdirSync(directory).filter((file) => file.endsWith('.swift')).sort();
  for (const required of ['OpencodeActivityAttributes.swift', 'ActivityDashboard.swift', 'OpencodeActivityTheme.swift', 'OpencodeLiveActivity.swift']) {
    if (!files.includes(required)) throw new Error(`Missing generated production source: ${required}. Run Expo prebuild with EXPO_IOS_LIVE_ACTIVITIES=1.`);
  }
  return files.map((file) => path.join(directory, file));
}

/** @param {{ sdk: string, arch: string, sources: string[], output?: string, moduleCache: string }} options */
export function swiftArguments({ sdk, arch, sources, output, moduleCache }) {
  if (!['arm64', 'x86_64'].includes(arch)) throw new Error(`Unsupported Simulator host architecture: ${arch}`);
  if (!sdk.trim()) throw new Error('Missing Apple Simulator SDK');
  const args = ['-parse-as-library', '-swift-version', '5', '-sdk', sdk,
    '-target', `${arch}-apple-ios17.0-simulator`, '-module-cache-path', moduleCache];
  return output
    ? ['--sdk', 'iphonesimulator', 'swiftc', ...args, '-emit-executable', '-module-name', 'OpencodeActivityPreview',
      ...sources, '-Xlinker', '-rpath', '-Xlinker', '/usr/lib/swift', '-o', output]
    : ['--sdk', 'iphonesimulator', 'swiftc', ...args, '-typecheck', '-application-extension', ...sources];
}

export function selectSimulator(runtimes, deviceList) {
  const available = runtimes.runtimes.filter((runtime) => runtime.isAvailable === true
    && runtime.identifier.startsWith('com.apple.CoreSimulator.SimRuntime.iOS-') && Number.parseInt(runtime.version, 10) >= 17);
  available.sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }));
  for (const runtime of available) {
    const devices = (deviceList.devices[runtime.identifier] || []).filter((device) => device.isAvailable === true && device.name.startsWith('iPhone'));
    const device = devices.find((item) => item.state === 'Shutdown') || devices[0];
    if (device) return { ...device, runtime: runtime.identifier, version: runtime.version };
  }
  throw new Error('No available iPhone Simulator with iOS 17+. Inspect simctl list runtimes/devices; no runtime is downloaded automatically.');
}

function execute(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024, ...options });
  const output = (result.stdout || '') + (result.stderr || '');
  if (output) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.error?.message || result.signal || result.status})`);
  return output;
}

export function waitForReady(child, marker, logPath, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    fs.writeFileSync(logPath, '');
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for rendered harness: ${marker}`)), timeout);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(undefined);
    };
    const received = (chunk) => {
      fs.appendFileSync(logPath, chunk);
      output = (output + chunk.toString()).slice(-2 * 1024 * 1024);
      if (output.split(/\r?\n/).includes(marker)) finish();
    };
    const failed = (error) => {
      fs.appendFileSync(logPath, `${error.message}\n`);
      finish(error);
    };
    const closed = (code) => {
      finish(new Error(`Harness console exited before rendering (${code}): ${marker}`));
      child.stdout.off('data', received);
      child.stderr.off('data', received);
      child.off('error', failed);
    };
    child.stdout.on('data', received);
    child.stderr.on('data', received);
    child.once('error', failed);
    child.once('close', closed);
  });
}

function launchConsole(args) {
  return spawn('xcrun', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

export function copyRenderedCapture(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Missing UIKit-rendered preview PNG: ${source}`);
  const png = fs.readFileSync(source);
  // Check the PNG envelope and nonempty dimensions, not visual/layout acceptance.
  if (png.length < 57 || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    || png.readUInt32BE(8) !== 13 || png.toString('ascii', 12, 16) !== 'IHDR'
    || png.readUInt32BE(16) === 0 || png.readUInt32BE(20) === 0
    || !png.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))) {
    throw new Error(`Invalid UIKit-rendered preview PNG: ${source}`);
  }
  fs.copyFileSync(source, destination);
}

export async function runPreview({ root = process.cwd(), exec = execute, launch = launchConsole, platform = process.platform } = {}) {
  if (platform !== 'darwin') throw new Error('Native preview requires macOS with Xcode and an installed iPhone Simulator; Linux tests do not compile Apple SDKs.');
  const output = path.join(root, 'ios-build/preview');
  fs.mkdirSync(path.join(output, 'logs'), { recursive: true });
  for (const name of ['evidence.json', 'README.txt']) fs.rmSync(path.join(output, name), { force: true });
  const sdk = exec('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']).trim();
  const arch = exec('uname', ['-m']).trim();
  const sources = generatedSources(root);
  const moduleCache = path.join(output, 'ModuleCache');
  exec('xcrun', swiftArguments({ sdk, arch, sources, moduleCache }));

  const app = path.join(output, 'OpencodeActivityPreview.app');
  fs.mkdirSync(app, { recursive: true });
  const fixtures = validateFixtures(previewFixtures());
  fs.writeFileSync(path.join(app, 'Fixtures.json'), JSON.stringify(fixtures, null, 2));
  fs.writeFileSync(path.join(app, 'Info.plist'), plist.build({
    CFBundleIdentifier: previewBundleIdentifier, CFBundleExecutable: 'OpencodeActivityPreview',
    CFBundleName: 'Activity Preview', CFBundleDisplayName: 'Activity Preview', CFBundlePackageType: 'APPL',
    CFBundleVersion: '1', CFBundleShortVersionString: '1.0', MinimumOSVersion: '17.0',
    CFBundleSupportedPlatforms: ['iPhoneSimulator'], DTPlatformName: 'iphonesimulator',
    LSRequiresIPhoneOS: true, UIDeviceFamily: [1], UILaunchScreen: {},
    UIApplicationSceneManifest: { UIApplicationSupportsMultipleScenes: false, UISceneConfigurations: {} },
    UISupportedInterfaceOrientations: ['UIInterfaceOrientationPortrait'],
  }));
  const appSources = [...sources.filter((file) => path.basename(file) !== 'OpencodeLiveActivity.swift'),
    path.join(root, 'tests/native/ios-live-activity/PreviewApp.swift')];
  exec('xcrun', swiftArguments({ sdk, arch, sources: appSources, output: path.join(app, 'OpencodeActivityPreview'), moduleCache }));
  // The relay consumer belongs to the containing app, not the WidgetKit target.
  // Check it independently even in preview-only runs; the archive's podspec
  // includes every module Swift source when building the full application.
  exec('xcrun', swiftArguments({ sdk, arch, moduleCache, sources: [
    path.join(root, 'modules/opencode-activity/ios/OpencodeActivityAttributes.swift'),
    path.join(root, 'modules/opencode-activity/ios/OpencodeActivityRemote.swift'),
  ] }));
  exec('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  const device = selectSimulator(
    JSON.parse(exec('xcrun', ['simctl', 'list', 'runtimes', '--json'])),
    JSON.parse(exec('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])),
  );
  fs.writeFileSync(path.join(output, 'simulator.json'), JSON.stringify({ sdk, arch, device }, null, 2));
  const screenshots = [];
  let runError;
  try {
    if (device.state !== 'Booted') exec('xcrun', ['simctl', 'boot', device.udid]);
    exec('xcrun', ['simctl', 'bootstatus', device.udid, '-b'], { timeout: 240_000 });
    exec('xcrun', ['simctl', 'install', device.udid, app]);
    const container = exec('xcrun', ['simctl', 'get_app_container', device.udid, previewBundleIdentifier, 'data']).trim();
    if (!path.isAbsolute(container) || !fs.existsSync(container) || !fs.statSync(container).isDirectory()) {
      throw new Error('Simulator did not return an existing absolute harness data-container path');
    }
    const capture = path.join(container, 'Documents/preview.png');
    for (const mode of previewModes) {
      for (const fixture of fixtures) {
        const id = `${fixture.id}-${mode.id}`;
        const screenshot = path.join(output, `${id}.png`);
        // A readiness marker must never allow a prior launch's PNG to count.
        fs.rmSync(capture, { force: true });
        fs.rmSync(screenshot, { force: true });
        const args = ['simctl', 'launch', '--console', '--terminate-running-process', device.udid, previewBundleIdentifier,
          '--scenario', fixture.id, '--appearance', mode.appearance, '--text-size', mode.textSize];
        const child = launch(args);
        let captureError;
        try {
          await waitForReady(child, `OPENCODE_PREVIEW_READY ${fixture.id} ${mode.appearance} ${mode.textSize}`, path.join(output, 'logs', `${id}.log`));
          if (child.exitCode !== null) throw new Error(`Harness exited before screenshot: ${id}`);
          copyRenderedCapture(capture, screenshot);
          // Let pending console-exit events run after the synchronous copy.
          await new Promise((resolve) => setImmediate(resolve));
          if (child.exitCode !== null) throw new Error(`Harness exited during screenshot: ${id}`);
          screenshots.push(`${id}.png`);
        } catch (error) {
          captureError = error;
          throw error;
        } finally {
          try { exec('xcrun', ['simctl', 'terminate', device.udid, previewBundleIdentifier]); }
          catch (error) {
            if (!captureError) throw error;
            console.warn(`Harness cleanup also failed: ${error.message}`);
          }
          finally { child.kill(); }
        }
      }
    }
    const scope = 'Standalone SwiftUI harness using production ActivityDashboard, captured from its UIKit-rendered window in an actual Simulator. Not a React Native app startup test, real Lock Screen/Dynamic Island hosting, or iPhone acceptance.';
    const captureMethod = { renderer: 'UIWindow.drawHierarchy(afterScreenUpdates: true)', source: 'Documents/preview.png', atomicWriteBeforeReady: true, systemFramebuffer: false };
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ scope, captureMethod, screenshots, fixtures, modes: previewModes }, null, 2));
    fs.writeFileSync(path.join(output, 'README.txt'), `${scope}\n\nApple Simulator SDK typecheck includes the production WidgetKit entrypoint.\nHarness app compilation excludes that entrypoint and uses PreviewApp.swift.\nCaptures are UIKit-rendered window PNGs, not system framebuffer screenshots. The app atomically writes Documents/preview.png before its readiness marker; the host copies that image from the Simulator app data container after checking its PNG envelope and dimensions. This avoids system launch-transition captures; it does not certify visual/layout acceptance.\n${fixtures.length} scenarios x ${previewModes.length} modes = ${screenshots.length} screenshots: light, dark and accessibility text.\nNormal cases use production English notification strings. French long-text and Hebrew RTL cases are synthetic stress fixtures, not claims of shipped translations.\n`);
    console.log(`PASS: SDK typecheck and ${screenshots.length} rendered SwiftUI harness screenshots. ${scope}`);
  } catch (error) {
    runError = error;
    try {
      const logs = exec('xcrun', ['simctl', 'spawn', device.udid, 'log', 'show', '--style', 'compact', '--last', '2m',
        '--predicate', 'process == "OpencodeActivityPreview"'], { timeout: 30_000 });
      fs.writeFileSync(path.join(output, 'logs/simulator.log'), logs);
    } catch (diagnosticError) {
      console.warn(`Simulator diagnostics unavailable: ${diagnosticError.message}`);
    }
    throw error;
  } finally {
    if (device.state !== 'Booted') {
      try { exec('xcrun', ['simctl', 'shutdown', device.udid]); }
      catch (error) {
        if (!runError) throw error;
        console.warn(`Simulator cleanup also failed: ${error.message}`);
      }
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runPreview().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
