import { NativeModules, Platform } from 'react-native';

type BackgroundConversationConfig = {
  serverUrl: string;
  username: string;
  password: string;
  directory: string;
  sessionId: string;
  speechLocale?: string;
  speechRate: number;
  speechVoiceId?: string;
  assistantReplyBaselineId?: string;
};

type BackgroundConversationModuleShape = {
  start: (config: BackgroundConversationConfig) => Promise<boolean>;
  stop: () => Promise<void>;
};

function getNativeModule(): BackgroundConversationModuleShape | null {
  if (Platform.OS !== 'android') {
    return null;
  }

  return (NativeModules.BackgroundConversation as BackgroundConversationModuleShape | undefined) ?? null;
}

export function isBackgroundConversationSupported() {
  return getNativeModule() !== null;
}

export async function startBackgroundConversation(config: BackgroundConversationConfig) {
  const module = getNativeModule();
  if (!module) {
    return false;
  }

  return module.start(config);
}

export async function stopBackgroundConversation() {
  const module = getNativeModule();
  if (!module) {
    return;
  }

  await module.stop();
}
