import type { OpenCodeClient } from '@opencode/client';
import type { LegacyClient } from '../compat/v1/client';
import type { V2Context } from '../v2/shared';
import Constants from 'expo-constants';

import type { ConnectMetadata } from '@/lib/connect';
import type { ProviderAuthValues } from '@/lib/opencode/types';
import type { PromptInboxApi } from '@/lib/opencode/prompt-inbox';

export type ServerContract = 'v1' | 'v2';

export type PendingPermissionRequest = { id: string; sessionID: string; permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown>; tool?: { messageID: string; callID: string } };

// Provider-derived wrapper that carries the requesting session's title so a
// subagent/nested approval can show provenance in the active chat. The base
// request shape is unchanged; the extra field is display-only.
export type PendingPermission = PendingPermissionRequest & { sourceTitle?: string };
export type PendingQuestion = PendingQuestionRequest & { sourceTitle?: string };

// A server-persisted "always allow" rule (V2 `permission.saved`). Display-only
// projection of the raw record.
export type SavedPermissionRule = {
  id: string;
  action: string;
  resource: string;
  createdAt?: number;
};

type PendingQuestionOption = {
  label: string;
  description?: string;
  /** Stable value submitted to the server. V1 uses the label; V2 forms carry an explicit value. */
  value?: string;
};

type PendingQuestionWhen = {
  key: string;
  op: 'eq' | 'neq';
  value: string | number | boolean;
};

export type PendingQuestionPrompt = {
  header: string;
  question: string;
  options: PendingQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
  /** V2 form field key, used to resolve `when` conditions. */
  key?: string;
  /** V2 form field type. V1 questions omit this and render as a single/multi choice. */
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external';
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  url?: string;
  when?: PendingQuestionWhen[];
};

export type PendingQuestionRequest = {
  id: string;
  sessionID: string;
  title?: string;
  questions: PendingQuestionPrompt[];
};

export type PendingQuestionAnswer = string[];

export type OpencodeConnectionSettings = {
  serverUrl: string;
  username: string;
  password: string;
  directory: string;
  // Per-connection custom request headers (gateway/service-token credentials).
  // Runtime only: persistence stores them in SecureStore, never AsyncStorage.
  headers?: Record<string, string>;
  connect?: ConnectMetadata;
};

// In the web E2E build the Playwright fixture sets this before app scripts run.
// It is a runtime default only; saved connection settings still take priority.
const runtimeE2EServerUrl = process.env.EXPO_PUBLIC_E2E_MODE === '1'
  ? (globalThis as typeof globalThis & { __OPENCODE_E2E_SERVER_URL__?: string }).__OPENCODE_E2E_SERVER_URL__
  : undefined;

export const defaultConnectionSettings: OpencodeConnectionSettings = {
  serverUrl: String(runtimeE2EServerUrl || process.env.EXPO_PUBLIC_E2E_SERVER_URL || Constants.expoConfig?.extra?.e2eServerUrl || 'http://127.0.0.1:4096'),
  username: '',
  password: '',
  directory: '',
};

export type NormalizedServerUrl = {
  displayUrl: string;
  origin: string;
  pathPrefix: string;
  valid: boolean;
};

export type ClientMetadata = {
  directory?: string;
  contract: ServerContract;
};

// A stored provider credential (V2 only). One integration can hold several
// labeled accounts; exactly one is `active` and used for requests.
export type ProviderAccountInfo = {
  id: string;
  providerId: string;
  label: string;
  method: 'key' | 'oauth';
  active: boolean;
};

// Provider account management. Present only on the V2 contract; undefined on V1,
// whose auth model is a single credential per provider.
export type ProviderAccountsApi = {
  list: () => Promise<ProviderAccountInfo[]>;
  add: (providerId: string, values: ProviderAuthValues, label?: string) => Promise<void>;
  activate: (credentialId: string) => Promise<void>;
  remove: (credentialId: string) => Promise<void>;
};

// Authoritative completion for automatic OAuth. `auto` sign-in finishes on the
// server (the provider redirects to the server's callback, not the app), so the
// app waits on the attempt status instead of guessing from the provider list.
export type ProviderOAuthApi = {
  start: (providerId: string, method: number, values?: ProviderAuthValues) => Promise<import('../v2/capabilities').Authorization>;
  complete: (providerId: string, code: string) => Promise<void>;
  wait: (providerId: string, timeoutMs?: number) => Promise<void>;
  cancel: (providerId: string) => Promise<void>;
};

export type NativeOpencodeApi = Pick<OpenCodeClient, 'server' | 'location' | 'project' | 'session' | 'message' | 'config' | 'provider' | 'model' | 'agent' | 'integration' | 'credential' | 'permission' | 'form' | 'event' | 'file' | 'vcs' | 'worktree' | 'mcp' | 'pty' | 'command' | 'skill' | 'reference'>;

export type ScopedOpencodeClient = {
  api?: NativeOpencodeApi;
  context?: V2Context;
  compatibility?: LegacyClient;
  __opencode: ClientMetadata;
  mcpOAuth?: ProviderOAuthApi & { methods: (name: string) => Promise<import('../types').ProviderAuthMethod[]> };
  accounts?: ProviderAccountsApi;
  providerOAuth?: ProviderOAuthApi;
  promptInbox?: PromptInboxApi;
};
