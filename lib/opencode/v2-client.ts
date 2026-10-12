import { buildMcpOAuth } from './v2/mcp';
import type { OpencodeConnectionSettings, ScopedOpencodeClient } from './client/types';
import { buildV2Raw } from './v2/raw';
import { buildProviderAuth } from './v2/capabilities';
import { toFileDetail } from './v2/mappers';
import { syncSessionInstructions } from './v2/shared';
import type { PendingPrompt, PromptInput } from './prompt-inbox';
import type { SessionInboxUser } from '@opencode/client';

export function toPendingPrompt(item: SessionInboxUser): PendingPrompt {
  return { id: item.id, sessionId: item.sessionID, createdAt: item.time.created, text: item.payload.text, delivery: item.delivery, state: 'waiting', attachments: (item.payload.files ?? []).map((file) => { const detail = toFileDetail(file); return { uri: detail.url, mime: detail.mime, filename: detail.filename }; }) };
}

export function buildV2Client(settings: OpencodeConnectionSettings): ScopedOpencodeClient {
  const context = buildV2Raw(settings);
  const { api, directory } = context;
  return {
    api, context, mcpOAuth: buildMcpOAuth(context), __opencode: { contract: 'v2', directory }, ...buildProviderAuth(context),
    promptInbox: {
      list: async (sessionID) => (await api.session.inbox.list({ sessionID })).filter((item): item is SessionInboxUser => item.type === 'user').map(toPendingPrompt),
      submit: async (input: PromptInput, delivery) => {
        const { sessionID, agent, model } = input;
        if (agent) await api.session.switchAgent({ sessionID, agent });
        if (model) await api.session.switchModel({ sessionID, model: { id: model.modelID, providerID: model.providerID } });
        await syncSessionInstructions(api, sessionID, input.system);
        const text = input.parts.filter((part) => part.type === 'text').map((part) => part.text).join('\n\n');
        const files = input.parts.filter((part) => part.type === 'file').map((part) => ({ uri: part.url, name: part.filename || 'Attachment' }));
        return toPendingPrompt(await api.session.prompt({ sessionID, text, delivery, ...(files.length ? { files } : {}) }));
      },
    },
  };
}
