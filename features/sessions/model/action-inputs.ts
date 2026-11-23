import type { AgentOption } from '@/shared/contracts/model-options';
import type { TranscriptReadOptions } from '@/shared/contracts/transcript-read';
import type { ChatPreferences } from '@/shared/preferences/opencode-preferences';
import type { ScopedOpencodeClient } from '@/shared/protocol/opencode/client';
import type { Command, Config, Session } from '@/shared/protocol/opencode/types';

export type SessionExecutionInput = {
  client: ScopedOpencodeClient;
  isCurrentClient: (candidate: object) => boolean;
  commands: Command[];
  availableAgents: AgentOption[];
  currentConfig?: Config;
  chatPreferences: Pick<ChatPreferences, 'mode'>;
  sessions: Session[];
  refreshMessages: (sessionId: string, silent?: boolean, options?: TranscriptReadOptions) => Promise<unknown>;
  refreshSessions: () => Promise<Session[]>;
};
