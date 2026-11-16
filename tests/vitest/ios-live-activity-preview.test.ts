import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, type ChildProcessByStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import plist from '@expo/plist';
import { afterEach, describe, it } from 'vitest';
import {
  copyRenderedCapture, generatedSources, previewBundleIdentifier, previewFixtures, previewModes,
  runPreview, selectSimulator, swiftArguments, validateFixtures, waitForReady,
} from '../../scripts/ci/ios-live-activity-preview.mjs';

const roots: string[] = [];
const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
const device = { udid: '39BD6089-11F3-4775-A8DC-C9D0FDE60DCE', name: 'iPhone 17 Pro', state: 'Shutdown', isAvailable: true };
const runtimes = { runtimes: [{ identifier: runtime, version: '26.5', isAvailable: true }] };
const devices = { devices: { [runtime]: [device] } };
const nativeFiles = ['OpencodeActivityAttributes.swift', 'ActivityDashboard.swift', 'OpencodeActivityTheme.swift', 'OpencodeLiveActivity.swift'];
const activityCopy = JSON.parse(fs.readFileSync(new URL('../../shared/i18n/locales/en/notifications.json', import.meta.url), 'utf8')).activity as Record<string, string>;
// A tiny transfer/validation fixture, never evidence of native rendering on Linux.
const fixturePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/gAAAABJRU5ErkJggg==', 'base64');

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-native-preview-'));
  roots.push(root);
  return root;
}

class ConsoleProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;

  kill() {
    this.killed = true;
    this.exitCode = 0;
    this.emit('close', 0);
    return true;
  }
}

function mockedNativeRun({ capture = (source: string) => fs.writeFileSync(source, fixturePng) }: {
  capture?: (source: string, index: number) => void;
} = {}) {
  const root = temporaryRoot();
  const container = path.join(root, 'Simulator App Data');
  const capturePath = path.join(container, 'Documents/preview.png');
  fs.mkdirSync(path.dirname(capturePath), { recursive: true });
  const generated = path.join(root, 'ios/OpencodeLiveActivity');
  fs.mkdirSync(generated, { recursive: true });
  for (const file of nativeFiles) fs.writeFileSync(path.join(generated, file), '// Synthetic command-planning fixture, not compiled by Linux tests.\n');
  const calls: { command: string; args: string[] }[] = [];
  const consoles: ConsoleProcess[] = [];
  const exec = (command: string, args: string[]) => {
    calls.push({ command, args });
    if (command === 'uname') return 'arm64\n';
    if (args.includes('--show-sdk-path')) return '/Applications/Xcode_26.6.app/SDKs/iPhoneSimulator26.5.sdk\n';
    if (args.includes('runtimes')) return JSON.stringify(runtimes);
    if (args.includes('devices')) return JSON.stringify(devices);
    if (args.includes('get_app_container')) return `${container}\n`;
    return '';
  };
  const launch = (args: string[]) => {
    calls.push({ command: 'xcrun-console', args });
    const child = new ConsoleProcess();
    consoles.push(child);
    const arg = (name: string) => args[args.indexOf(name) + 1];
    const index = consoles.length - 1;
    setImmediate(() => {
      capture(capturePath, index);
      child.stdout.write(`OPENCODE_PREVIEW_READY ${arg('--scenario')} ${arg('--appearance')} ${arg('--text-size')}\n`);
    });
    return child as unknown as ChildProcessByStdio<null, PassThrough, PassThrough>;
  };
  return { root, calls, consoles, exec, launch, capturePath };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('native Live Activity preview planning (no Apple SDK compilation on Linux)', () => {
  it('covers truthful states, partial/unknown progress, legacy fields, localization and RTL', () => {
    const fixtures = validateFixtures(previewFixtures(new Date('2026-11-01T12:00:00Z')));
    assert.deepEqual(fixtures.map((fixture: { id: string }) => fixture.id), [
      'thinking', 'reading', 'editing', 'searching', 'executing', 'delegating', 'needs-input',
      'reconnecting', 'paused', 'paused-insights', 'stale', 'finished', 'failed', 'french-long', 'hebrew-rtl',
    ]);
    const state = (id: string) => fixtures.find((fixture: { id: string }) => fixture.id === id)!.state;
    for (const key of ['agentCount', 'toolCount', 'completedSteps', 'totalSteps', 'filesChanged', 'progressLabel', 'agentsLabel', 'toolsLabel', 'filesLabel', 'updatedLabel', 'elapsedLabel']) {
      assert.equal(Object.hasOwn(state('thinking'), key), false, `Legacy fixture must omit ${key}`);
    }
    assert.equal(state('reading').completedSteps, 3);
    assert.equal(state('reading').totalSteps, 6);
    assert.equal(Object.hasOwn(state('executing'), 'totalSteps'), false, 'Unknown progress must not imply a percentage');
    assert.equal(state('paused').isPaused, true);
    assert.equal(state('paused').frozenAt, '2026-11-01T11:59:50Z');
    assert.equal(fixtures.find((fixture: { id: string }) => fixture.id === 'stale')!.isStale, true);
    assert.ok(state('finished').endedAt);
    assert.ok(state('failed').endedAt);
    assert.equal(fixtures.at(-1)!.direction, 'rtl');
    assert.equal(fixtures.at(-2)!.locale, 'fr');
    assert.doesNotMatch(JSON.stringify(fixtures), /https?:|password|token|secret|serverUrl|sessionTitle/);
    assert.deepEqual(previewModes.map((mode) => mode.id), ['light', 'dark', 'accessibility']);
    assert.equal(previewModes.at(-1)!.textSize, 'accessibility3');
  });

  it('uses production phase/chip copy and complete numeric labels without inventing unknown metrics', () => {
    const fixtures = previewFixtures();
    const label = (key: string, values: Record<string, number> = {}) => activityCopy[key].replace(/\{\{(\w+)\}\}/g, (_, field: string) => String(values[field]));
    for (const fixture of fixtures) {
      const { state } = fixture;
      for (const [metric, key] of [['agentCount', 'agentsLabel'], ['toolCount', 'toolsLabel'], ['filesChanged', 'filesLabel']] as const) {
        if (state[metric] === undefined) {
          assert.equal(Object.hasOwn(state, key), false, `${fixture.id}: omit labels for unknown ${metric}`);
        } else {
          const text = state[key];
          assert.ok(text, `${fixture.id}: missing ${key}`);
          assert.deepEqual(text.match(/\d+/g), [String(state[metric])], `${fixture.id}: ${key} must contain its count exactly once`);
          if (fixture.copySource === 'production-en') assert.equal(state[key], label(key, { count: state[metric] }));
        }
      }
      if (state.completedSteps === undefined) {
        assert.equal(Object.hasOwn(state, 'progressLabel'), false, `${fixture.id}: omit unknown progress`);
      } else {
        assert.ok(state.progressLabel, `${fixture.id}: missing progressLabel`);
        assert.ok(state.totalSteps !== undefined, `${fixture.id}: missing totalSteps`);
        assert.deepEqual(state.progressLabel.match(/\d+/g), [String(state.completedSteps), String(state.totalSteps)], `${fixture.id}: show both plan counts exactly once`);
        if (fixture.copySource === 'production-en') assert.equal(state.progressLabel, label('progressLabel', { completed: state.completedSteps, total: state.totalSteps }));
      }
      for (const value of Object.values(state)) if (typeof value === 'string') assert.doesNotMatch(value, /\{\{/);
      if (fixture.copySource === 'production-en') {
        assert.equal(state.body, activityCopy[state.phase], fixture.id);
        assert.equal(state.pausedLabel, activityCopy.updatesPaused);
        assert.equal(state.chip, ['finished', 'failed', 'stopped'].includes(state.phase) ? activityCopy[state.phase]
          : state.count > 1 ? label('tasks', { count: state.count }) : activityCopy.working);
        if (fixture.id !== 'thinking') {
          assert.equal(state.updatedLabel, activityCopy.updatedLabel);
          assert.equal(state.elapsedLabel, activityCopy.elapsedLabel);
        }
      } else {
        assert.equal(fixture.copySource, 'synthetic-stress');
        assert.ok(['french-long', 'hebrew-rtl'].includes(fixture.id));
      }
    }
  });

  it('retains the same known phase, progress, agents and tools in the paused-insights sample', () => {
    const fixtures = previewFixtures(new Date('2026-11-01T12:00:00Z'));
    const active = fixtures.find((fixture) => fixture.id === 'reading')!.state;
    const paused = fixtures.find((fixture) => fixture.id === 'paused-insights')!.state;
    assert.equal(paused.isPaused, true);
    assert.equal(paused.frozenAt, '2026-11-01T11:59:50Z');
    for (const key of ['phase', 'body', 'completedSteps', 'totalSteps', 'progressLabel', 'agentCount', 'agentsLabel', 'toolCount', 'toolsLabel', 'filesChanged', 'filesLabel'] as const) {
      assert.notEqual(active[key], undefined, key);
      assert.equal(paused[key], active[key], key);
    }
  });

  it('rejects inconsistent progress, invalid counters, duplicate scenarios and invalid dates', () => {
    const changed = (state: Record<string, unknown>) => [{ ...previewFixtures()[0], state: { ...previewFixtures()[0].state, ...state } }];
    for (const state of [{ totalSteps: 6 }, { completedSteps: 7, totalSteps: 6 }, { completedSteps: 0, totalSteps: 0 }]) {
      assert.throws(() => validateFixtures(changed(state)), /Invalid progress/);
    }
    for (const state of [{ agentCount: -1 }, { count: 1.5 }, { filesChanged: 10000 }]) {
      assert.throws(() => validateFixtures(changed(state)), /Invalid (agentCount|count|filesChanged)/);
    }
    assert.throws(() => validateFixtures(changed({ updatedAt: 'not a date' })), /Invalid preview date/);
    assert.throws(() => validateFixtures(changed({ phase: 'invented' })), /Invalid preview state/);
    assert.throws(() => validateFixtures([previewFixtures()[0], previewFixtures()[0]]), /duplicate/);
    assert.throws(() => validateFixtures([]), /No preview fixtures/);
  });

  it('includes all generated production sources and rejects a stale prebuild', () => {
    const { root } = mockedNativeRun();
    assert.deepEqual(generatedSources(root).map((file: string) => path.basename(file)), [...nativeFiles].sort());
    fs.rmSync(path.join(root, 'ios/OpencodeLiveActivity/ActivityDashboard.swift'));
    assert.throws(() => generatedSources(root), /Missing generated production source: ActivityDashboard.swift/);
  });

  it.each(['arm64', 'x86_64'])('SDK-typechecks WidgetKit and links a distinct %s Simulator harness', (arch) => {
    const common = { sdk: '/SDK/Simulator.sdk', arch, sources: ['Attributes.swift', 'Dashboard.swift', 'Widget.swift'], moduleCache: '/preview/ModuleCache' };
    const check = swiftArguments(common);
    assert.deepEqual(check.slice(0, 3), ['--sdk', 'iphonesimulator', 'swiftc']);
    assert.equal(check[check.indexOf('-target') + 1], `${arch}-apple-ios17.0-simulator`);
    assert.ok(check.includes('-typecheck'));
    assert.ok(check.includes('-application-extension'));
    assert.ok(check.includes('Widget.swift'));
    assert.equal(check.includes('-emit-executable'), false);
    const build = swiftArguments({ ...common, sources: ['Attributes.swift', 'Dashboard.swift', 'PreviewApp.swift'], output: '/Preview.app/Preview' });
    assert.ok(build.includes('-emit-executable'));
    assert.equal(build.includes('-application-extension'), false);
    assert.equal(build.includes('Widget.swift'), false);
    assert.equal(build.at(-1), '/Preview.app/Preview');
    assert.throws(() => swiftArguments({ ...common, arch: 'unverified' }), /Unsupported/);
    assert.throws(() => swiftArguments({ ...common, sdk: '' }), /Missing Apple/);
  });

  it('discovers an installed iOS runtime/device without downloading one or choosing an iPad', () => {
    const oldRuntime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-2';
    const newest = { identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0', version: '27.0', isAvailable: false };
    const all = { runtimes: [newest, { identifier: oldRuntime, version: '26.2', isAvailable: true }, ...runtimes.runtimes] };
    const list = { devices: { ...devices.devices, [oldRuntime]: [{ ...device, name: 'iPad Pro' }] } };
    assert.deepEqual(selectSimulator(all, list), { ...device, runtime, version: '26.5' });
    assert.throws(() => selectSimulator(all, { devices: {} }), /No available iPhone Simulator/);
    assert.throws(() => selectSimulator({ runtimes: [{ identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-16-4', version: '16.4', isAvailable: true }] }, devices), /No available/);
  });

  it('requires an exact rendered-window marker, preserves console output and rejects early exits', async () => {
    const root = temporaryRoot();
    const child = new ConsoleProcess();
    const log = path.join(root, 'console.log');
    const marker = 'OPENCODE_PREVIEW_READY reading dark large';
    let settled = false;
    const ready = waitForReady(child, marker, log).then(() => { settled = true; });
    child.stdout.write(`unrelated ${marker}\n`);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    child.stdout.write(marker.slice(0, 15));
    child.stdout.write(`${marker.slice(15)}\r\n`);
    await ready;
    child.stderr.write('post-render diagnostic\n');
    child.emit('close', 0);
    assert.match(fs.readFileSync(log, 'utf8'), /post-render diagnostic/);
    assert.equal(child.stdout.listenerCount('data'), 0);
    const crash = new ConsoleProcess();
    const rejected = waitForReady(crash, marker, path.join(root, 'crash.log'));
    crash.stderr.write('synthetic startup crash\n');
    crash.emit('close', 1);
    await assert.rejects(rejected, /exited before rendering/);
    assert.match(fs.readFileSync(path.join(root, 'crash.log'), 'utf8'), /synthetic startup crash/);
  });

  it('bounds readiness waiting and reports launch-tool errors rather than inventing readiness', async () => {
    const root = temporaryRoot();
    const timeout = new ConsoleProcess();
    await assert.rejects(waitForReady(timeout, 'READY', path.join(root, 'timeout.log'), 5), /Timed out/);
    timeout.emit('close', 1);
    const failed = new ConsoleProcess();
    const waiting = waitForReady(failed, 'READY', path.join(root, 'failed.log'));
    failed.emit('error', new Error('spawn xcrun failed'));
    await assert.rejects(waiting, /spawn xcrun failed/);
    failed.emit('close', 1);
  });

  it('copies the saved window PNG bytes and rejects missing, malformed or truncated captures', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'preview.png');
    const destination = path.join(root, 'reading-dark.png');
    assert.throws(() => copyRenderedCapture(source, destination), /Missing UIKit-rendered preview PNG/);
    const zeroWidth = Buffer.from(fixturePng);
    zeroWidth.writeUInt32BE(0, 16);
    const zeroHeight = Buffer.from(fixturePng);
    zeroHeight.writeUInt32BE(0, 20);
    const invalidHeader = Buffer.from(fixturePng);
    invalidHeader.write('NOPE', 12);
    for (const invalid of [Buffer.alloc(0), Buffer.from('not a PNG'), fixturePng.subarray(0, 8),
      fixturePng.subarray(0, -1), zeroWidth, zeroHeight, invalidHeader]) {
      fs.writeFileSync(source, invalid);
      assert.throws(() => copyRenderedCapture(source, destination), /Invalid UIKit-rendered preview PNG/);
      assert.equal(fs.existsSync(destination), false);
    }
    fs.writeFileSync(source, fixturePng);
    copyRenderedCapture(source, destination);
    assert.deepEqual(fs.readFileSync(destination), fixturePng);
  });

  it('plans actual SDK compilation, boot/install/launch/render capture, then cleans up the harness', async () => {
    const run = mockedNativeRun();
    await runPreview({ ...run, platform: 'darwin' });
    const compiler = run.calls.filter((call) => call.args.includes('swiftc'));
    assert.equal(compiler.length, 3);
    assert.ok(compiler[0].args.some((arg) => arg.endsWith('/OpencodeLiveActivity.swift')));
    assert.ok(compiler[1].args.some((arg) => arg.endsWith('/ActivityDashboard.swift')));
    assert.ok(compiler[1].args.some((arg) => arg.endsWith('/OpencodeActivityTheme.swift')));
    assert.equal(compiler[1].args.some((arg) => arg.endsWith('/OpencodeLiveActivity.swift')), false);
    assert.ok(compiler[1].args.at(-1)!.endsWith('.app/OpencodeActivityPreview'));
    assert.ok(compiler[2].args.includes('-typecheck'));
    assert.ok(compiler[2].args.some((arg) => arg.endsWith('/OpencodeActivityAttributes.swift')));
    assert.ok(compiler[2].args.some((arg) => arg.endsWith('/OpencodeActivityRemote.swift')));
    assert.equal(compiler[2].args.some((arg) => arg.endsWith('/OpencodeLiveActivity.swift')), false);
    assert.ok(run.calls.some((call) => call.args.join(' ') === `simctl bootstatus ${device.udid} -b`));
    assert.ok(run.calls.some((call) => call.args[1] === 'install'));
    assert.ok(run.calls.some((call) => call.args.join(' ') === `simctl get_app_container ${device.udid} ${previewBundleIdentifier} data`));
    assert.equal(run.calls.some((call) => call.args.includes('screenshot')), false, 'Do not capture the launch-transition framebuffer');
    const launches = run.calls.filter((call) => call.command === 'xcrun-console');
    assert.equal(launches.length, previewFixtures().length * previewModes.length);
    for (const call of launches) {
      assert.ok(call.args.includes('--console'));
      assert.ok(call.args.includes('--terminate-running-process'));
      assert.ok(call.args.includes(previewBundleIdentifier));
    }
    assert.equal(run.consoles.every((child) => child.killed), true);
    assert.equal(run.calls.at(-1)!.args[1], 'shutdown');
    const appInfo = plist.parse(fs.readFileSync(path.join(run.root, 'ios-build/preview/OpencodeActivityPreview.app/Info.plist'), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(appInfo.CFBundleSupportedPlatforms, ['iPhoneSimulator']);
    assert.equal(appInfo.CFBundleIdentifier, previewBundleIdentifier);
    const evidence = JSON.parse(fs.readFileSync(path.join(run.root, 'ios-build/preview/evidence.json'), 'utf8'));
    assert.equal(evidence.screenshots.length, launches.length);
    assert.equal(evidence.fixtures.length, 15);
    assert.equal(evidence.screenshots.length, 45);
    for (const screenshot of evidence.screenshots) {
      assert.deepEqual(fs.readFileSync(path.join(run.root, 'ios-build/preview', screenshot)), fixturePng);
    }
    assert.match(evidence.scope, /Not a React Native app startup test/);
    assert.match(evidence.scope, /UIKit-rendered window in an actual Simulator/);
    assert.deepEqual(evidence.captureMethod, {
      renderer: 'UIWindow.drawHierarchy(afterScreenUpdates: true)', source: 'Documents/preview.png',
      atomicWriteBeforeReady: true, systemFramebuffer: false,
    });
    const readme = fs.readFileSync(path.join(run.root, 'ios-build/preview/README.txt'), 'utf8');
    assert.match(readme, /Not a React Native/);
    assert.match(readme, /15 scenarios x 3 modes = 45 screenshots/);
    assert.match(readme, /UIKit-rendered window PNGs, not system framebuffer screenshots/);
    assert.match(readme, /does not certify visual\/layout acceptance/);
    assert.match(readme, /Hebrew RTL cases are synthetic stress fixtures, not claims of shipped translations/);
    assert.equal(run.calls.some((call) => call.command === 'pod' || call.args.includes('archive')), false);
  });

  it('never captures success evidence after the launched harness dies', async () => {
    const run = mockedNativeRun();
    const launch = (args: string[]) => {
      const child = run.launch(args);
      setImmediate(() => { run.consoles.at(-1)!.exitCode = 1; });
      return child;
    };
    await assert.rejects(runPreview({ ...run, launch, platform: 'darwin' }), /exited during screenshot/);
    assert.equal(fs.existsSync(path.join(run.root, 'ios-build/preview/evidence.json')), false);
    assert.equal(run.consoles[0].killed, true);
    assert.equal(run.calls.at(-1)!.args[1], 'shutdown');
  });

  it('removes stale captures before each launch and fails when readiness has no new PNG', async () => {
    const run = mockedNativeRun({ capture: (source, index) => {
      assert.equal(fs.existsSync(source), false, 'A prior capture must be removed before launch');
      if (index === 0) fs.writeFileSync(source, fixturePng);
    } });
    fs.writeFileSync(run.capturePath, fixturePng);
    await assert.rejects(runPreview({ ...run, platform: 'darwin' }), /Missing UIKit-rendered preview PNG/);
    assert.equal(fs.existsSync(path.join(run.root, 'ios-build/preview/thinking-light.png')), true);
    assert.equal(fs.existsSync(path.join(run.root, 'ios-build/preview/reading-light.png')), false);
    assert.equal(fs.existsSync(path.join(run.root, 'ios-build/preview/evidence.json')), false);
    assert.equal(run.consoles.every((child) => child.killed), true);
    assert.equal(run.calls.at(-1)!.args[1], 'shutdown');
  });

  it('rejects malformed captures even after an exact readiness marker', async () => {
    const run = mockedNativeRun({ capture: (source) => fs.writeFileSync(source, 'not a PNG') });
    const output = path.join(run.root, 'ios-build/preview');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'thinking-light.png'), fixturePng);
    fs.writeFileSync(path.join(output, 'evidence.json'), '{"stale": true}');
    fs.writeFileSync(path.join(output, 'README.txt'), 'Previous run succeeded');
    await assert.rejects(runPreview({ ...run, platform: 'darwin' }), /Invalid UIKit-rendered preview PNG/);
    for (const name of ['thinking-light.png', 'evidence.json', 'README.txt']) {
      assert.equal(fs.existsSync(path.join(output, name)), false, `Do not retain stale success artifact: ${name}`);
    }
    assert.equal(run.consoles[0].killed, true);
  });

  it.each(['', 'relative/container', '/missing/preview-container'])('rejects an invalid Simulator container path: %j', async (container) => {
    const run = mockedNativeRun();
    const exec = (command: string, args: string[]) => args.includes('get_app_container') ? container : run.exec(command, args);
    await assert.rejects(runPreview({ ...run, exec, platform: 'darwin' }), /existing absolute harness data-container path/);
    assert.equal(run.consoles.length, 0);
    assert.equal(fs.existsSync(path.join(run.root, 'ios-build/preview/evidence.json')), false);
    assert.equal(run.calls.at(-1)!.args[1], 'shutdown');
  });

  it('refuses Linux native execution and imports correctly through direct Node ESM', async () => {
    await assert.rejects(runPreview({ platform: 'linux' }), /requires macOS/);
    const helper = new URL('../../scripts/ci/ios-live-activity-preview.mjs', import.meta.url).href;
    const source = `import { previewFixtures, swiftArguments } from ${JSON.stringify(helper)}; console.log(JSON.stringify({ count: previewFixtures().length, args: swiftArguments({sdk:'/SDK', arch:'arm64', sources:[], moduleCache:'/cache'}) }));`;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }));
    assert.equal(result.count, previewFixtures().length);
    assert.ok(result.args.includes('-typecheck'));
    const swift = fs.readFileSync(new URL('../native/ios-live-activity/PreviewApp.swift', import.meta.url), 'utf8');
    assert.match(swift, /ActivityDashboard\(\s*state: selection\.fixture\.state,/);
    assert.match(swift, /ActivityDashboard\([\s\S]*?\)\s*\.padding\(12\)/);
    assert.equal((swift.match(/\.padding\(\)/g) || []).length, 1, 'Keep the outer page gutter at its default 16pt');
    assert.match(swift, /JSONDecoder\(\)/);
    assert.match(swift, /window\.drawHierarchy\(in: window\.bounds, afterScreenUpdates: true\)/);
    assert.match(swift, /let image = UIGraphicsImageRenderer/);
    assert.match(swift, /guard let png = image\.pngData\(\)/);
    assert.match(swift, /appendingPathComponent\("preview\.png"\)/);
    assert.match(swift, /removeItem\(at: previewCaptureURL\)/);
    const write = swift.indexOf('try png.write(to: previewCaptureURL, options: .atomic)');
    assert.ok(swift.indexOf('if rendered {') < write);
    assert.ok(write < swift.indexOf('FileHandle.standardOutput.write'));
    assert.doesNotMatch(swift, /Activity\.request|import ExpoModulesCore|struct ActivityDashboard/);
  });
});
