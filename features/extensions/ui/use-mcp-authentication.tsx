import { getErrorMessage } from '@/shared/utilities/error-message';
import { openOAuthBrowser } from '@/shared/platform/provider-oauth';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProviderConfigDialog, type ProviderOAuthStage } from '@/features/ai/index';
import type { McpContextValue } from '@/features/extensions/model/types';
import type { ProviderAuthMethod, ProviderAuthValues } from '@/shared/protocol/opencode/types';
import { Colors } from '@/shared/ui/theme/theme';

export function useMcpAuthentication(oauth: McpContextValue['mcpOAuth'], palette: typeof Colors.light) {
  const [name, setName] = useState<string>();
  const [owner, setOwner] = useState(oauth);
  const [methods, setMethods] = useState<ProviderAuthMethod[]>([]);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<'method' | 'configure'>('method');
  const [stage, setStage] = useState<ProviderOAuthStage>('idle');
  const [code, setCode] = useState('');
  const [url, setUrl] = useState<string>();
  const [instructions, setInstructions] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const activeName = useRef<string | undefined>(undefined);
  const cancel = useCallback(() => {
    revision.current++; const active = activeName.current; activeName.current = undefined;
    if (active) void oauth.cancel(active).catch(() => undefined);
    setName(undefined); setBusy(false); setStage('idle'); setError(undefined); setCode(''); setUrl(undefined); setInstructions(undefined);
  }, [oauth]);
  useEffect(() => () => { revision.current++; if (activeName.current) void oauth.cancel(activeName.current).catch(() => undefined); activeName.current = undefined; }, [oauth]);
  const open = async (server: string) => {
    cancel(); const id = ++revision.current;
    const available = await oauth.methods(server);
    if (id !== revision.current) return;
    if (!available.length) throw new Error('This MCP server does not offer OAuth.');
    activeName.current = server; setOwner(oauth); setName(server); setMethods(available); setIndex(0);
    setStep(available.length === 1 ? 'configure' : 'method'); setCode('');
  };
  const run = async (complete: boolean, values: ProviderAuthValues = {}) => {
    if (!name) return;
    const id = ++revision.current;
    setBusy(true); setError(undefined);
    try {
      if (complete) { await oauth.complete(name, code); if (id === revision.current) cancel(); return; }
      const result = await oauth.start(name, index, values);
      if (id !== revision.current) return;
      if (!result.url) { cancel(); return; }
      setUrl(result.url); setInstructions(result.instructions);
      setStage(result.method === 'auto' ? 'pending' : 'code');
      if (result.method === 'auto') {
        // Attach completion/error handlers before launching the browser.
        const wait = oauth.wait(name).then(() => { if (id === revision.current) cancel(); }, (failure: unknown) => { if (id === revision.current) { setError(getErrorMessage(failure)); setStage('idle'); } });
        await openOAuthBrowser(result.url); await wait;
      } else await openOAuthBrowser(result.url);
    } catch (failure) { if (id === revision.current) setError(getErrorMessage(failure)); }
    finally { if (id === revision.current) setBusy(false); }
  };
  const selected = methods[index];
  return {
    open,
    dialog: name && owner === oauth ? <ProviderConfigDialog key={`${name}:${index}`} providerLabel={name} providerDescription="MCP" palette={palette} methods={methods} selectedMethod={selected} selectedMethodIndex={index} step={step} onSelectMethod={(next) => { setIndex(next); setStep('configure'); }} onSubmit={(values) => { if (step === 'method') setStep('configure'); else void run(false, values); }} onBack={() => { if (stage !== 'idle') cancel(); else setStep('method'); }} onDismiss={cancel} onCancelOAuth={cancel} onCompleteOAuth={() => void run(true)} onOAuthCodeChange={setCode} oauthCode={code} oauthStage={stage} oauthUrl={url} oauthInstructions={instructions} oauthError={error} error={error} isConfiguringProvider={busy} /> : null,
  };
}
