import { createContext, useContext, type Context } from 'react';

import type {
  ApprovalsContextValue,
  CapabilitiesContextValue,
  ChatContextValue,
  ConnectionContextValue,
  ConversationContextValue,
  CurrentSessionContextValue,
  DiagnosticsContextValue,
  McpContextValue,
  OnboardingContextValue,
  PreferencesContextValue,
  ProjectsContextValue,
  SessionLibraryContextValue,
  TerminalContextValue,
  WorkspaceFilesContextValue,
  UpdatesContextValue,
} from '@/providers/opencode-provider-types';

// Domain-scoped contexts for the single OpencodeProvider. Splitting the old
// 130-member context means a screen re-renders only when the domain it reads
// changes, and each consumer declares its real dependencies.

export const OnboardingContext = createContext<OnboardingContextValue | null>(null);
export const ConnectionContext = createContext<ConnectionContextValue | null>(null);
export const DiagnosticsContext = createContext<DiagnosticsContextValue | null>(null);
export const CapabilitiesContext = createContext<CapabilitiesContextValue | null>(null);
export const PreferencesContext = createContext<PreferencesContextValue | null>(null);
export const ProjectsContext = createContext<ProjectsContextValue | null>(null);
export const WorkspaceFilesContext = createContext<WorkspaceFilesContextValue | null>(null);
export const CurrentSessionContext = createContext<CurrentSessionContextValue | null>(null);
export const SessionLibraryContext = createContext<SessionLibraryContextValue | null>(null);
export const ChatContext = createContext<ChatContextValue | null>(null);
export const ApprovalsContext = createContext<ApprovalsContextValue | null>(null);
export const ConversationContext = createContext<ConversationContextValue | null>(null);
export const TerminalContext = createContext<TerminalContextValue | null>(null);
export const McpContext = createContext<McpContextValue | null>(null);
export const UpdatesContext = createContext<UpdatesContextValue | null>(null);

function useDomainValue<T>(context: Context<T | null>, name: string): T {
  const value = useContext(context);
  if (!value) {
    throw new Error(`${name} must be used inside OpencodeProvider.`);
  }
  return value;
}

export const useOnboarding = () => useDomainValue(OnboardingContext, 'useOnboarding');
export const useConnection = () => useDomainValue(ConnectionContext, 'useConnection');
export const useDiagnostics = () => useDomainValue(DiagnosticsContext, 'useDiagnostics');
export const useCapabilities = () => useDomainValue(CapabilitiesContext, 'useCapabilities');
export const usePreferences = () => useDomainValue(PreferencesContext, 'usePreferences');
export const useProjects = () => useDomainValue(ProjectsContext, 'useProjects');
export const useWorkspaceFiles = () => useDomainValue(WorkspaceFilesContext, 'useWorkspaceFiles');
export const useCurrentSession = () => useDomainValue(CurrentSessionContext, 'useCurrentSession');
export const useSessionLibrary = () => useDomainValue(SessionLibraryContext, 'useSessionLibrary');
export const useChat = () => useDomainValue(ChatContext, 'useChat');
export const useApprovals = () => useDomainValue(ApprovalsContext, 'useApprovals');
export const useConversation = () => useDomainValue(ConversationContext, 'useConversation');
export const useTerminal = () => useDomainValue(TerminalContext, 'useTerminal');
export const useMcp = () => useDomainValue(McpContext, 'useMcp');
export const useUpdates = () => useDomainValue(UpdatesContext, 'useUpdates');
