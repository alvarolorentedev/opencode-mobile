import { useMemo } from 'react';

import { getConnectionScope, getConnectionUiScope } from '@/shared/contracts/connection-scope';
import type { ConnectionContextValue } from '@/features/connections/index';
import type { ConnectionState, ProjectPathsByConnection, SessionDeepLinkTarget } from '@/shared/contracts/domain';
import type { SharedInput } from '@/features/sharing/index';
import { projectClosedValues } from '@/runtime/workspace/workspace-projection';
import type { WorkspaceTarget } from '@/shared/contracts/workspace';
import type { WorkspaceValues } from '@/runtime/workspace/workspace-types';

export type WorkspaceValueOverrides = {
  voiceSetupTest?: ReturnType<typeof import('@/features/voice/index').useVoiceSetupTest>;
  isHydrated: boolean;
  onboardingCompleted: boolean;
  onboardingActive: boolean;
  connectionProfiles: ConnectionContextValue['connectionProfiles'];
  connectSetup: ConnectionContextValue['connectSetup'];
  servicesValue: ConnectionContextValue['services'];
  sharedInput: SharedInput;
  projectPathsByConnection: ProjectPathsByConnection;
  retry: (id: string) => Promise<ConnectionState>;
  activate: (target: WorkspaceTarget) => Promise<void>;
  switchConnection: ConnectionContextValue['switchConnection'];
  openSession: (target: SessionDeepLinkTarget, signal?: AbortSignal) => Promise<{ ok: boolean; error?: string }>;
  openSessionInProject: (projectPath: string, sessionId: string, connectionScope: string) => Promise<void>;
};

// App-scope overrides are layered over a runtime's memoized domain values.
// Each domain is memoized separately so a transcript update cannot invalidate
// the connection, project, or onboarding contexts.
export function useWorkspaceValues(
  values: WorkspaceValues | undefined,
  overrides: WorkspaceValueOverrides,
): WorkspaceValues | undefined {
  const {
    voiceSetupTest,
    isHydrated,
    onboardingCompleted,
    onboardingActive,
    connectionProfiles,
    connectSetup,
    servicesValue,
    sharedInput,
    projectPathsByConnection,
    retry,
    activate,
    switchConnection,
    openSession,
    openSessionInProject,
  } = overrides;
  const settings = values?.connectionValue.settings;
  const connectionId = useMemo(
    () => (settings ? getConnectionUiScope(settings) : ''),
    [settings],
  );
  const connectionScope = useMemo(
    () => (settings ? getConnectionScope(settings) : ''),
    [settings],
  );
  const openedProjectPaths = projectPathsByConnection[connectionScope];
  const baseValues = useMemo(() => {
    if (!values) return undefined;
    const path = values.projectsValue.activeProjectPath;
    // The opened-project list is the source of truth. A retained runtime may
    // still hold the last closed project's state while its drafts stay alive.
    return openedProjectPaths && path && !openedProjectPaths.includes(path)
      ? projectClosedValues(values)
      : values;
  }, [values, openedProjectPaths]);

  const baseOnboarding = baseValues?.onboardingValue;
  const onboardingValue = useMemo(() => (baseOnboarding ? {
    ...baseOnboarding,
    isHydrated,
    onboardingCompleted,
    onboardingActive,
  } : undefined), [baseOnboarding, isHydrated, onboardingCompleted, onboardingActive]);

  const baseConnection = baseValues?.connectionValue;
  const connectionValue = useMemo(() => (baseConnection ? {
    ...baseConnection,
    connect: () => retry(connectionId),
    switchConnection,
    connectionProfiles,
    connectSetup,
    services: servicesValue,
  } : undefined), [baseConnection, connectionId, retry, switchConnection, connectionProfiles, connectSetup, servicesValue]);

  const baseProjects = baseValues?.projectsValue;
  const projectsValue = useMemo(() => (baseProjects ? {
    ...baseProjects,
    selectProject: (projectPath: string) => {
      void activate({ connectionId, projectPath });
    },
  } : undefined), [baseProjects, connectionId, activate]);

  const baseCurrentSession = baseValues?.currentSessionValue;
  const currentSessionValue = useMemo(() => (baseCurrentSession ? {
    ...baseCurrentSession,
    openDeepLinkSession: openSession,
  } : undefined), [baseCurrentSession, openSession]);

  const baseSessionLibrary = baseValues?.sessionLibraryValue;
  const sessionLibraryValue = useMemo(() => (baseSessionLibrary ? {
    ...baseSessionLibrary,
    openSessionInProject: (projectPath: string, sessionId: string, targetConnectionScope?: string) => (
      openSessionInProject(projectPath, sessionId, targetConnectionScope ?? connectionScope)
    ),
  } : undefined), [baseSessionLibrary, connectionScope, openSessionInProject]);

  const baseChat = baseValues?.chatValue;
  const chatValue = useMemo(() => (baseChat ? {
    ...baseChat,
    sharedInput,
  } : undefined), [baseChat, sharedInput]);

  const baseConversation = baseValues?.conversationValue;
  const conversationValue = useMemo(() => baseConversation && voiceSetupTest ? {
    ...baseConversation,
    toggleConversationMode: () => voiceSetupTest.runConversation(baseConversation.toggleConversationMode),
  } : baseConversation, [baseConversation, voiceSetupTest]);

  return useMemo(() => {
    if (!baseValues || !onboardingValue || !connectionValue || !projectsValue || !currentSessionValue || !sessionLibraryValue || !chatValue) {
      return undefined;
    }
    return {
      ...baseValues,
      onboardingValue,
      connectionValue,
      projectsValue,
      currentSessionValue,
      sessionLibraryValue,
      chatValue,
      conversationValue: conversationValue!,
    };
  }, [baseValues, onboardingValue, connectionValue, projectsValue, currentSessionValue, sessionLibraryValue, chatValue, conversationValue]);
}
