export type TerminalFrame = { text: string } | { cursor: number };

// OpenCode cursors count UTF-16 characters, not UTF-8 bytes.
export function createTerminalDecoder() {
  const decoder = new TextDecoder();
  return async (data: string | Blob | ArrayBuffer): Promise<TerminalFrame | undefined> => {
    if (typeof data === 'string') return { text: decoder.decode() + data };
    const bytes = new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data);
    if (bytes[0] !== 0) return { text: decoder.decode(bytes, { stream: true }) };
    try {
      const cursor: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(1))).cursor;
      if (typeof cursor === 'number' && Number.isSafeInteger(cursor) && cursor >= 0) return { cursor };
    } catch {
      // Protocol metadata must never become terminal output.
    }
    return undefined;
  };
}

export const MAX_TERMINAL_PENDING_BYTES = 2 * 1024 * 1024;

export function createTerminalOutputQueue({
  write, onText, onCursor, onError,
}: {
  write: (text: string) => Promise<void>;
  onText: (length: number) => void;
  onCursor: (cursor: number) => void;
  onError: (error: Error) => void;
}) {
  const decode = createTerminalDecoder();
  const encoder = new TextEncoder();
  const frames: { data: string | Blob | ArrayBuffer; bytes: number }[] = [];
  let pendingBytes = 0, stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;

  async function process() {
    let text = '', bytes = 0;
    async function flush() {
      for (let offset = 0; offset < text.length && !stopped;) {
        let end = Math.min(offset + 64 * 1024, text.length);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
        const chunk = text.slice(offset, end);
        await write(chunk);
        if (!stopped) onText(chunk.length);
        offset = end;
      }
      pendingBytes -= bytes;
      text = ''; bytes = 0;
    }
    try {
      while (frames.length && !stopped) {
        const frame = frames.shift()!;
        const value = await decode(frame.data);
        if (stopped) return;
        if (value && 'cursor' in value) {
          await flush();
          if (!stopped) onCursor(value.cursor);
          pendingBytes -= frame.bytes;
        } else {
          text += value && 'text' in value ? value.text : '';
          bytes += frame.bytes;
        }
        // Bound individual bridge messages, while keeping frames ordered.
        if (text.length >= 64 * 1024 || !frames.length) await flush();
      }
    } catch (error) {
      stop();
      onError(error instanceof Error ? error : new Error('Terminal output failed.'));
    }
  }
  function start() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!running && !stopped) running = process().finally(() => {
      running = undefined;
      if (frames.length && !stopped) start();
    });
  }
  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    frames.length = 0;
    pendingBytes = 0;
  }
  return {
    push(data: string | Blob | ArrayBuffer) {
      if (stopped) return;
      const bytes = typeof data === 'string' ? encoder.encode(data).byteLength : data instanceof Blob ? data.size : data.byteLength;
      if (pendingBytes + bytes > MAX_TERMINAL_PENDING_BYTES) {
        stop();
        onError(new Error('Terminal output exceeded the pending buffer. Reconnect to recover.'));
        return;
      }
      pendingBytes += bytes;
      frames.push({ data, bytes });
      if (!timer && !running) timer = setTimeout(start, 16);
    },
    async drain() {
      start();
      while (running) await running;
    },
    stop,
  };
}
