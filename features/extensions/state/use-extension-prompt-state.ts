import { useState } from 'react';

export function useExtensionPromptState() {

  const [mcpAuthPrompt, setMcpAuthPrompt] = useState<{ mcpName: string; url: string }>();
  return { mcpAuthPrompt, setMcpAuthPrompt };
}
