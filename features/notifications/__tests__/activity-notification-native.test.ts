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
});
