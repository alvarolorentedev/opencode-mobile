import type { Config as SdkConfig } from '@opencode-ai/sdk/client';

export type {
  Agent,
  Command,
  Config,
  File,
  FileContent,
  FileDiff,
  FileNode,
  FormatterStatus,
  LspStatus,
  McpStatus,
  Message,
  Model,
  Part,
  Permission,
  Project,
  Provider,
  ProviderAuthMethod,
  Session,
  SessionStatus,
  Todo,
  ToolPart,
  VcsInfo,
} from '@opencode-ai/sdk/client';

export type PermissionConfig = NonNullable<SdkConfig['permission']>;

export default {};
