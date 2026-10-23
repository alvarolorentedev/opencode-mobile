import { useMemo } from 'react';

import { getConnectionScope, getConnectionUiScope } from '@/lib/connection-scope';
import type { ConnectionContextValue, ConnectionState, ProjectPathsByConnection, SessionDeepLinkTarget } from '@/providers/opencode-provider-types';
import type { SharedInput } from '@/providers/use-share-state';
import type { WorkspaceTarget, WorkspaceValues } from '@/providers/workspace-types';

export type WorkspaceValueOverrides = {
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
    isHydrated,
    onboardingCompleted,
    onboardingActive,
    connectionProfiles,
    connectSetup,
    servicesValue,
    sharedInput,
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

  const baseOnboarding = values?.onboardingValue;
  const onboardingValue = useMemo(() => (baseOnboarding ? {
    ...baseOnboarding,
    isHydrated,
    onboardingCompleted,
    onboardingActive,
  } : undefined), [baseOnboarding, isHydrated, onboardingCompleted, onboardingActive]);

  const baseConnection = values?.connectionValue;
  const connectionValue = useMemo(() => (baseConnection ? {
    ...baseConnection,
    connect: () => retry(connectionId),
    switchConnection,
    connectionProfiles,
    connectSetup,
    services: servicesValue,
  } : undefined), [baseConnection, connectionId, retry, switchConnection, connectionProfiles, connectSetup, servicesValue]);

  const baseProjects = values?.projectsValue;
  const projectsValue = useMemo(() => (baseProjects ? {
    ...baseProjects,
    selectProject: (projectPath: string) => {
      void activate({ connectionId, projectPath });
    },
  } : undefined), [baseProjects, connectionId, activate]);

  const baseCurrentSession = values?.currentSessionValue;
  const currentSessionValue = useMemo(() => (baseCurrentSession ? {
    ...baseCurrentSession,
    openDeepLinkSession: openSession,
  } : undefined), [baseCurrentSession, openSession]);

  const baseSessionLibrary = values?.sessionLibraryValue;
  const sessionLibraryValue = useMemo(() => (baseSessionLibrary ? {
    ...baseSessionLibrary,
    openSessionInProject: (projectPath: string, sessionId: string, targetConnectionScope?: string) => (
      openSessionInProject(projectPath, sessionId, targetConnectionScope ?? connectionScope)
    ),
  } : undefined), [baseSessionLibrary, connectionScope, openSessionInProject]);

  const baseChat = values?.chatValue;
  const chatValue = useMemo(() => (baseChat ? {
    ...baseChat,
    sharedInput,
  } : undefined), [baseChat, sharedInput]);

  return useMemo(() => {
    if (!values || !onboardingValue || !connectionValue || !projectsValue || !currentSessionValue || !sessionLibraryValue || !chatValue) {
      return undefined;
    }
    return {
      ...values,
      onboardingValue,
      connectionValue,
      projectsValue,
      currentSessionValue,
      sessionLibraryValue,
      chatValue,
    };
  }, [values, onboardingValue, connectionValue, projectsValue, currentSessionValue, sessionLibraryValue, chatValue]);
}
