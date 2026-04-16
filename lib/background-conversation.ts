import { NativeEventEmitter, NativeModules, Platform, type EmitterSubscription } from 'react-native';

type BackgroundConversationConfig = {
  serverUrl: string;
  username: string;
  password: string;
  directory: string;
  sessionId: string;
  agent: string;
  model?: {
    providerID: string;
    modelID: string;
  };
  system?: string;
  speechLocale?: string;
  speechRate: number;
  speechVoiceId?: string;
  assistantReplyBaselineId?: string;
  preferOnDeviceRecognition?: boolean;
  resumeListeningAfterReply: boolean;
  workingSoundEnabled: boolean;
  workingSoundVariant: 'soft' | 'glass';
  workingSoundVolume: number;
};

export type BackgroundConversationPhase =
  | 'off'
  | 'listening'
  | 'submitting'
  | 'waiting'
  | 'speaking';

export type BackgroundConversationStatus = {
  active: boolean;
  phase: BackgroundConversationPhase;
  sessionId?: string;
  level: number;
  statusLabel?: string;
  feedback?: string;
};

export type BackgroundConversationEvent =
  | {
      type: 'status';
      active: boolean;
      phase: BackgroundConversationPhase;
      sessionId?: string;
      level?: number;
      statusLabel?: string;
      feedback?: string;
    }
  | {
      type: 'transcript';
      status: 'partial' | 'final';
      text: string;
      sessionId?: string;
    }
  | {
      type: 'assistant';
      status: 'started' | 'finished';
      text?: string;
      messageId?: string;
      sessionId?: string;
    }
  | {
      type: 'error';
      code?: string;
      message: string;
      sessionId?: string;
    };

type BackgroundConversationModuleShape = {
  start: (config: BackgroundConversationConfig) => Promise<boolean>;
  stop: () => Promise<void>;
  getStatus: () => Promise<BackgroundConversationStatus>;
  addListener?: (eventName: string) => void;
  removeListeners?: (count: number) => void;
};

const EVENT_NAME = 'BackgroundConversationEvent';

let emitter: NativeEventEmitter | null = null;

function getNativeModule(): BackgroundConversationModuleShape | null {
  if (Platform.OS !== 'android') {
    return null;
  }

  return (NativeModules.BackgroundConversation as BackgroundConversationModuleShape | undefined) ?? null;
}

export function isBackgroundConversationSupported() {
  return getNativeModule() !== null;
}

function getEventEmitter() {
  const module = getNativeModule();
  if (!module) {
    return null;
  }

  if (!emitter) {
    emitter = new NativeEventEmitter(module as never);
  }

  return emitter;
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

export async function getBackgroundConversationStatus(): Promise<BackgroundConversationStatus> {
  const module = getNativeModule();
  if (!module) {
    return {
      active: false,
      level: 0,
      phase: 'off',
    };
  }

  return module.getStatus();
}

export function subscribeToBackgroundConversationEvents(
  listener: (event: BackgroundConversationEvent) => void,
): EmitterSubscription | undefined {
  const eventEmitter = getEventEmitter();
  if (!eventEmitter) {
    return undefined;
  }

  return eventEmitter.addListener(EVENT_NAME, listener);
}
