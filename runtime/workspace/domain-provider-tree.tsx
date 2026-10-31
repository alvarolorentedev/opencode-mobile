import type { ReactNode } from 'react';

import { ApprovalsContext, CurrentSessionContext, SessionLibraryContext } from '@/features/sessions/context';
import { CapabilitiesContext } from '@/features/ai/context';
import { ChatContext } from '@/features/chat/context';
import { ConnectionContext, DiagnosticsContext } from '@/features/connections/context';
import { ConversationContext } from '@/features/voice/context';
import { ExtensionsContext, McpContext } from '@/features/extensions/context';
import { OnboardingContext } from '@/features/onboarding/context';
import { PreferencesContext } from '@/shared/preferences/context';
import { ProjectsContext, ProjectFilesContext } from '@/features/projects/context';
import { TerminalContext } from '@/features/terminal/context';
import { UpdatesContext } from '@/features/updates/context';
import type { useOpencodeProviderValues } from '@/runtime/composition/opencode-provider-values';
import type { useAppUpdates } from '@/features/updates/index';

type ProviderValues = ReturnType<typeof useOpencodeProviderValues>;
type AppUpdates = ReturnType<typeof useAppUpdates>;

type OpencodeProviderTreeProps = {
  children: ReactNode;
  updates: AppUpdates;
  values: ProviderValues;
};

// Keeps the provider's composition unit focused on orchestration while the
// context wiring stays in one place. The order is part of the contract:
// UpdatesContext remains the innermost provider.
export function OpencodeProviderTree({ children, updates, values }: OpencodeProviderTreeProps) {
  return (
    <OnboardingContext.Provider value={values.onboardingValue}>
      <ConnectionContext.Provider value={values.connectionValue}>
        <DiagnosticsContext.Provider value={values.diagnosticsValue}>
          <CapabilitiesContext.Provider value={values.capabilitiesValue}>
            <PreferencesContext.Provider value={values.preferencesValue}>
              <ProjectsContext.Provider value={values.projectsValue}>
                <ProjectFilesContext.Provider value={values.projectFilesValue}>
                  <CurrentSessionContext.Provider value={values.currentSessionValue}>
                    <SessionLibraryContext.Provider value={values.sessionLibraryValue}>
                      <ChatContext.Provider value={values.chatValue}>
                        <ApprovalsContext.Provider value={values.approvalsValue}>
                          <ConversationContext.Provider value={values.conversationValue}>
                            <TerminalContext.Provider value={values.terminalValue}>
                              <McpContext.Provider value={values.mcpValue}>
                                <ExtensionsContext.Provider value={values.extensionsValue}>
                                  <UpdatesContext.Provider value={updates}>{children}</UpdatesContext.Provider>
                                </ExtensionsContext.Provider>
                              </McpContext.Provider>
                            </TerminalContext.Provider>
                          </ConversationContext.Provider>
                        </ApprovalsContext.Provider>
                      </ChatContext.Provider>
                    </SessionLibraryContext.Provider>
                  </CurrentSessionContext.Provider>
                </ProjectFilesContext.Provider>
              </ProjectsContext.Provider>
            </PreferencesContext.Provider>
          </CapabilitiesContext.Provider>
        </DiagnosticsContext.Provider>
      </ConnectionContext.Provider>
    </OnboardingContext.Provider>
  );
}
