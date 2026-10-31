import type { Pty } from '@/shared/protocol/opencode/types';

import type { TerminalRuntime, TerminalStatus } from '@/features/terminal/model/terminal-types';

export type TerminalContextValue = {
  terminals: Pty[];
  activeTerminalId?: string;
  terminalRuntime: TerminalRuntime;
  terminalConnection: TerminalStatus;
  refreshTerminals: () => Promise<void>;
  createTerminal: () => Promise<Pty>;
  openTerminal: (ptyId: string) => Promise<void>;
  sendTerminalInput: (ptyId: string, input: string, generation: number, scope: number) => void;
  closeTerminal: (ptyId: string) => Promise<void>;
};
