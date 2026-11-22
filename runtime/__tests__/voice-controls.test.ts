import { expect, it, vi } from 'vitest';

import { createVoiceControls } from '@/runtime/core/voice-controls';

function controls() {
  return {
    toggle: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    clearFeedback: vi.fn(),
    confirmation: { cancel: vi.fn(), confirm: vi.fn(), edit: vi.fn(), retry: vi.fn() },
  };
}

it('waits for the previous microphone owner before allowing the new workspace to start', async () => {
  const voice = createVoiceControls();
  const first = controls();
  const second = controls();
  let release!: () => void;
  first.pause.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));

  const detach = voice.attach('a', 'project-a', first);
  const pause = voice.pause('a');
  detach();
  voice.attach('b', 'project-b', second);
  const start = voice.toggle('project-b');
  await Promise.resolve();
  expect(first.pause).toHaveBeenCalledOnce();
  expect(second.toggle).not.toHaveBeenCalled();
  expect(voice.read('project-a')).toBeUndefined();

  release();
  await Promise.all([pause, start]);
  expect(second.toggle).toHaveBeenCalledOnce();
  await voice.pause('a');
  expect(second.pause).not.toHaveBeenCalled();
});
