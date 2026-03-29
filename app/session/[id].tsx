import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { useOpencode } from '@/providers/opencode-provider';

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentSessionId, openSession } = useOpencode();

  useEffect(() => {
    if (id && currentSessionId !== id) {
      void openSession(id);
    }
  }, [currentSessionId, id, openSession]);

  if (!id || (currentSessionId && currentSessionId === id)) {
    return <Redirect href="/(tabs)" />;
  }

  return null;
}
