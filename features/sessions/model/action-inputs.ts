import type { Dispatch, SetStateAction } from 'react';

import type { AgentOption } from '@/shared/contracts/model-options';
import type { FavoriteSession, TranscriptReadOptions } from '@/shared/contracts/domain';
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
  refreshMessages: (sessionId: string, silent?: boolean, options?: TranscriptReadOptions) => Promise<unknown>;
  refreshSessions: () => Promise<Session[]>;
};

export type SessionFavoriteInput = {
  connectionScopeRef: { current: string };
  favoriteSessions: FavoriteSession[];
  setFavoriteSessions: Dispatch<SetStateAction<FavoriteSession[]>>;
};

export type SessionActionsInput = SessionExecutionInput & SessionFavoriteInput;
