export type TerminalStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'exited' | 'error';
export type TerminalInstance = { id: string; generation: number; status: TerminalStatus; error?: string };
export type TerminalRenderer = { write: (text: string) => Promise<void> };
export type TerminalRuntime = {
  scope: number;
  instances: TerminalInstance[];
  registerRenderer: (ptyId: string, renderer: TerminalRenderer) => () => void;
  resize: (ptyId: string, cols: number, rows: number) => void;
};
