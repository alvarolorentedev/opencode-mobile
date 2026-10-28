// Shared speech-output contract. Kept dependency-free so provider selectors,
// tests, and both the system and on-device engines can import it without
// pulling in a native module.

export type SpeechPlayback =
  | { engine: 'system'; voice?: string }
  | { engine: 'local'; packId: string; speakerId: number };

export type SpeechFallbackReason =
  | 'unsupported'
  | 'missing'
  | 'not-ready'
  | 'language-mismatch'
  | 'init-failed';

export type SpeechCues = {
  codeBlock?: string;
  table?: string;
};

export type SpeakTextOptions = {
  text: string;
  language?: string;
  rate?: number;
  playback?: SpeechPlayback;
  cues?: SpeechCues;
  onStart?: () => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
  onEngineFallback?: (reason: SpeechFallbackReason) => void;
};

export type SpeechVoiceOption = {
  id: string;
  label: string;
  language: string;
  quality: 'default' | 'enhanced';
};
