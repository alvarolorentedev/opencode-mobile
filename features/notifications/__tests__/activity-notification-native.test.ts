import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const native = (file: string) => fs.readFileSync(new URL(`../../../modules/opencode-activity/ios/${file}`, import.meta.url), 'utf8');

describe('native activity lifecycle metadata boundary', () => {
  it('keeps opaque work identities in the app record and native defaults, not the ActivityKit payload', () => {
    const controller = native('OpencodeActivityController.swift');
    expect(native('OpencodeActivityModule.swift')).toContain('@Field var workKeys: [String] = []');
    expect(native('OpencodeActivityAttributes.swift')).not.toContain('workKeys');
    expect(native('OpencodeActivityAttributes.swift')).not.toContain('OpencodeActivityCycle');
    expect(controller).toContain('JSONDecoder().decode(OpencodeActivityCycle.self, from: data)');
    expect(controller).toContain('JSONEncoder().encode(value)');
    expect(controller).toContain('UserDefaults.standard.set(data, forKey: cycleKey)');
    expect(controller).toContain('let generation = reconcileCycle(record.workKeys)');
    expect(controller).toContain('UUID().uuidString');
    expect(controller).not.toContain('Data(record.key.utf8)');
  });

  it('retains cycle metadata on dismissal, clears it on terminal/stop and preserves freshness/budget guards', () => {
    const controller = native('OpencodeActivityController.swift');
    const observation = controller.slice(controller.indexOf('private func observe('), controller.indexOf('private func forget('));
    expect(observation).toContain('forKey: self.dismissalKey');
    expect(observation).not.toContain('clearCycle()');
    expect(controller.slice(controller.indexOf('func stop()'), controller.indexOf('private func suspend()'))).toContain('self.clearCycle()');
    expect(controller).toMatch(/if terminal \{\s+clearCycle\(\)/);
    expect(controller).toContain('!suspended && revision == submittedRevision');
    expect(controller).toContain('guard foreground, fresh(revision) else { return false }');
    expect(controller).toContain('return encoded.count <= 3500');
    expect(controller).toContain('pushType: nil');
  });

  it('invalidates transient inactive work without forcing pause IPC, then flushes on actual background', () => {
    const controller = native('OpencodeActivityController.swift');
    const inactive = controller.slice(controller.indexOf('forName: UIApplication.willResignActiveNotification'),
      controller.indexOf('forName: UIApplication.didEnterBackgroundNotification'));
    expect(inactive).toContain('self?.invalidateFreshness()');
    expect(inactive).not.toMatch(/suspend\(\)|pauseCurrent\(\)|beginBackgroundTask/);
    const invalidation = controller.slice(controller.indexOf('private func invalidateFreshness()'), controller.indexOf('private func suspend()'));
    expect(invalidation).toContain('suspended = true');
    expect(invalidation).toContain('revision += 1');
    const background = controller.slice(controller.indexOf('private func suspend()'), controller.indexOf('private func endBackgroundTask()'));
    expect(background).toContain('guard !backgrounded else { return }');
    expect(background).not.toContain('guard !suspended');
    expect(background).toContain('invalidateFreshness()');
    expect(background).toContain('beginBackgroundTask');
    expect(background).toContain('await self.pauseCurrent()');
    expect(background).toContain('self.endBackgroundTask()');
    expect(controller).toContain('if backgrounded { await pauseCurrent() }');
    const resume = controller.slice(controller.indexOf('forName: UIApplication.didBecomeActiveNotification'), controller.indexOf('private func enqueue('));
    expect(resume).toContain('self?.suspended = false');
    expect(resume).not.toContain('isPaused = false');
  });

  it('adopts old content with optional bounded metrics and keeps all translated labels inside the byte budget', () => {
    const attributes = native('OpencodeActivityAttributes.swift');
    const module = native('OpencodeActivityModule.swift');
    const controller = native('OpencodeActivityController.swift');
    for (const field of ['completedSteps', 'totalSteps', 'agentCount', 'toolCount', 'filesChanged']) {
      expect(attributes).toContain(`var ${field}: Int?`);
      expect(module).toContain(`@Field var ${field}: Int?`);
      expect(controller).toContain(`${field}: record.${field}`);
    }
    for (const field of ['progressLabel', 'agentsLabel', 'toolsLabel', 'filesLabel', 'updatedLabel', 'elapsedLabel']) {
      expect(attributes).toContain(`var ${field}: String?`);
      expect(module).toContain(`@Field var ${field}: String?`);
      expect(controller).toContain(`${field}: record.${field}`);
    }
    expect(controller).toContain('(1...9999).contains(total), (0...total).contains(completed)');
    expect(controller).toContain('[record.agentCount, record.toolCount, record.filesChanged]');
    expect(controller).toContain('labels.allSatisfy({ !$0.isEmpty && $0.count <= 80 })');
    expect(controller).toContain('[record.body, record.chip, record.pausedLabel, record.link] + labels');
    expect(controller).toContain('JSONEncoder().encode(content(record, phase:');
    expect(controller).toContain('return encoded.count <= 3500');
    for (const phase of ['reading', 'editing', 'searching', 'executing', 'delegating']) {
      expect(controller).toContain(`"${phase}"`);
    }
  });

  it('keeps the last safe phase primary, freshness secondary, and terminal elapsed/progress honest', () => {
    const dashboard = native('LiveActivity/ActivityDashboard.swift');
    const widget = native('LiveActivity/OpencodeLiveActivity.swift');
    expect(dashboard).toContain('struct ActivityDashboard: View');
    expect(dashboard).toContain('let state: OpencodeActivityAttributes.ContentState');
    expect(dashboard).toContain('let startedAt: Date');
    expect(dashboard).toContain('let isStale: Bool');
    expect(dashboard).toContain('Text(verbatim: state.body)');
    expect(dashboard).not.toMatch(/\?\s*state.pausedLabel\s*:\s*state.body/);
    expect(dashboard).toContain('!state.isTerminal && (state.isPaused || isStale)');
    expect(dashboard).toContain('if paused {');
    expect(dashboard).toContain('Text(verbatim: state.pausedLabel)');
    expect(dashboard).toContain('Text(state.updatedAt, style: .time)');
    expect(dashboard).toContain('if let progress = state.planProgress, let label = state.progressLabel');
    expect(dashboard).toContain('(1...9999).contains(total), (0...total).contains(completed) else { return nil }');
    expect(dashboard).toContain('state.endedAt ?? state.frozenAt ?? state.updatedAt');
    expect(dashboard).toContain('state.updatedAt.addingTimeInterval(60)');
    expect(dashboard).not.toMatch(/repeatForever|symbolEffect|TimelineView|ProgressView\(\)/);
    expect(dashboard).toContain('.transaction { $0.animation = nil }');
    expect(dashboard).toContain('dynamicTypeSize.isAccessibilitySize');
    expect(dashboard).toContain('.accessibilityElement(children: .combine)');
    expect(dashboard).not.toMatch(/minimumScaleFactor|\.font\(\.system\(size:/);
    expect(widget.match(/ActivityDashboard\(state: context.state/g)).toHaveLength(2);
    expect(widget).not.toMatch(/Button\(|AppIntent|Link\(/);
  });

  it('renders complete localized count labels once without adding duplicate metric or plan counts', () => {
    const dashboard = native('LiveActivity/ActivityDashboard.swift');
    const progress = dashboard.slice(dashboard.indexOf('@ViewBuilder private var planProgress:'), dashboard.indexOf('@ViewBuilder private var freshness:'));
    expect(progress.match(/Text\(verbatim: label\)/g)).toHaveLength(1);
    expect(progress).not.toMatch(/progress\.(completed|total)\.formatted|Text\(verbatim:.*\\\(/);
    expect(progress).toContain('ProgressView(value: Double(progress.completed), total: Double(progress.total))');
    const metric = dashboard.slice(dashboard.indexOf('@ViewBuilder private func metric('), dashboard.indexOf('struct ActivityPhaseIcon'));
    expect(metric).toContain('if let count, (0...9999).contains(count), let label');
    expect(metric).toContain('Image(systemName: symbol).accessibilityHidden(true)');
    expect(metric.match(/Text\(verbatim: label\)/g)).toHaveLength(1);
    expect(metric).not.toContain('count.formatted()');
  });

  it('preserves the native freeze timestamp when paused content becomes immediately stale', () => {
    const dashboard = native('LiveActivity/ActivityDashboard.swift');
    const elapsed = dashboard.slice(dashboard.indexOf('struct ActivityElapsed'), dashboard.indexOf('extension OpencodeActivityAttributes.ContentState'));
    expect(elapsed).toContain('if state.isPaused || state.isTerminal || isStale');
    expect(elapsed).toContain('let end = state.endedAt ?? state.frozenAt ?? state.updatedAt');
    expect(elapsed).not.toMatch(/isStale\s*\?|\?\s*state.updatedAt\s*:/);
    const controller = native('OpencodeActivityController.swift');
    const pause = controller.slice(controller.indexOf('private func pauseCurrent()'), controller.indexOf('private func dismissRetained()'));
    expect(pause).toContain('state.frozenAt = expired ? state.updatedAt : Date()');
    expect(pause).toContain('ActivityContent(state: state, staleDate: Date())');
  });

  it('uses only verified plan fractions in compact Island and shows terminal status instead of zero tasks', () => {
    const widget = native('LiveActivity/OpencodeLiveActivity.swift');
    const compact = widget.slice(widget.indexOf('} compactTrailing: {'), widget.indexOf('} minimal: {'));
    expect(compact).toMatch(/if context.state.isTerminal \{\s+ActivityPhaseIcon\(state: context.state\)/);
    expect(compact).toContain('else if let progress = context.state.planProgress, let label = context.state.progressLabel');
    expect(compact).toContain('\\(progress.completed.formatted())/\\(progress.total.formatted())');
    expect(compact).toContain('.accessibilityLabel(Text(verbatim: label))');
    expect(compact).not.toMatch(/percent|ProgressView\(\)/);
  });

  it('fits the 160pt ActivityKit surface by dropping secondary content before phase and freshness', () => {
    const dashboard = native('LiveActivity/ActivityDashboard.swift');
    const widget = native('LiveActivity/OpencodeLiveActivity.swift');
    const body = dashboard.slice(dashboard.indexOf('var body: some View'), dashboard.indexOf('private var full:'));
    expect(body).toContain('ViewThatFits(in: .vertical)');
    expect(body).toContain('if !dynamicTypeSize.isAccessibilitySize');
    expect(body).toMatch(/full\.fixedSize\(horizontal: false, vertical: true\)[\s\S]*compact\.fixedSize\(horizontal: false, vertical: true\)[\s\S]*essential\.fixedSize\(horizontal: false, vertical: true\)/);
    expect(body).toContain('.frame(maxWidth: .infinity, maxHeight: 136, alignment: .topLeading)');
    const compact = dashboard.slice(dashboard.indexOf('private var compact:'), dashboard.indexOf('private var essential:'));
    expect(compact).toContain('phaseHeading');
    expect(compact).toContain('freshness');
    expect(compact).not.toMatch(/metrics|elapsed|state.chip|OpenCode/);
    const essential = dashboard.slice(dashboard.indexOf('private var essential:'), dashboard.indexOf('@ViewBuilder private var planProgress:'));
    expect(essential).toContain('Text(verbatim: state.body)');
    expect(essential).toContain('.font(.headline).fixedSize(horizontal: false, vertical: true)');
    expect(essential).toContain('if paused');
    expect(essential).toContain('Image(systemName: "pause.circle")');
    expect(essential).toContain('Text(state.updatedAt, style: .time)');
    expect(essential).toContain('.accessibilityLabel(Text(verbatim: state.pausedLabel))');
    expect(essential).not.toMatch(/\bmetrics\s*\}|\belapsed\s*\}|\bplanProgress\s*\n|state.chip|Text\(verbatim: "OpenCode"\)/);
    expect(dashboard).not.toMatch(/minimumScaleFactor|lineLimit|\.clipped\(|\.frame\(height:/);
    expect(widget).toContain('.padding(12)');
    expect(widget).toContain('.padding(.vertical, 12)');
  });
});
