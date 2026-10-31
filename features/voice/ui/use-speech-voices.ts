import { useEffect, useState } from 'react';

import { getSpeechVoiceOptions, type SpeechVoiceOption } from '@/shared/platform/voice/speech-output';

export function useSpeechVoices() {
  const [voices, setVoices] = useState<SpeechVoiceOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void getSpeechVoiceOptions().then((options) => {
      if (active) setVoices(options);
    }).catch(() => {
      // The automatic system voice remains available if enumeration fails.
    }).finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);
  return { voices, isLoading };
}
