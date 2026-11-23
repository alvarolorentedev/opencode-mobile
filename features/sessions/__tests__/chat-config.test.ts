import { describe, expect, it } from 'vitest';

import type { AgentOption, ModelOption } from '@/shared/contracts/model-options';
import type { Session } from '@/shared/protocol/opencode/types';
import type { SessionMessageRecord } from '@/shared/presentation/format';

import { resolveNewSessionConfig, resolveSessionChatConfig } from '../model/chat-config';

const model = (providerID: string, modelID: string, variants: string[] = []): ModelOption => ({
  id: `${providerID}/${modelID}`,
  label: modelID,
  providerID,
  providerLabel: providerID,
  modelID,
  variants: variants.map((id) => ({ id })),
  supportsReasoning: variants.length > 0,
  supportsAttachments: false,
  inputModalities: ['text'],
  supportsToolCalls: true,
  contextLimit: 1,
  outputLimit: 1,
} as ModelOption);

const agent = (id: string, configured?: { providerID: string; modelID: string; variant?: string }): AgentOption => ({
  id, label: id, mode: 'primary', ...(configured ? { model: configured } : {}),
});

const session = (id: string, overrides: Partial<Session> = {}): Session => ({
  id, title: '', time: { created: 1, updated: 1 }, ...overrides,
});

const user = (id: string, overrides: Partial<SessionMessageRecord['info']> = {}): SessionMessageRecord => ({
  info: {
    id, sessionID: 's', role: 'user', time: { created: 1 },
    agent: 'plan', model: { providerID: 'openai', modelID: 'gpt-5' }, ...overrides,
  } as SessionMessageRecord['info'],
  parts: [],
});

describe('new session chat configuration', () => {
  it('inherits agent, model, and variant from the newest root session only', () => {
    expect(resolveNewSessionConfig({
      sessions: [
        session('child', { parentID: 'root', agent: 'general', model: { providerID: 'google', id: 'flash' } }),
        session('latest', { agent: 'plan', model: { providerID: 'openai', id: 'gpt-5', variant: 'high' } }),
      ],
      agents: [agent('build'), agent('plan')],
      models: [model('openai', 'gpt-5', ['high', 'low']), model('google', 'flash')],
      autoApprove: false,
    })).toEqual({ agent: 'plan', model: { providerID: 'openai', id: 'gpt-5', variant: 'high' } });
  });

  it('falls back to the agent model when the newest session has no model', () => {
    expect(resolveNewSessionConfig({
      sessions: [session('latest', { agent: 'plan' })],
      agents: [agent('plan', { providerID: 'openai', modelID: 'gpt-5', variant: 'low' })],
      models: [model('openai', 'gpt-5', ['low'])],
      autoApprove: false,
    })).toEqual({ agent: 'plan', model: { providerID: 'openai', id: 'gpt-5', variant: 'low' } });
  });

  it('keeps auto-approve and drops the inherited ruleset when it is on', () => {
    const permissions = [{ action: 'edit', resource: '*', effect: 'allow' as const }];
    expect(resolveNewSessionConfig({
      sessions: [session('latest', { permissions })],
      agents: [agent('build')],
      models: [model('openai', 'gpt-5')],
      recentModelIds: ['openai/gpt-5'],
      autoApprove: true,
    })).toEqual({ model: { providerID: 'openai', id: 'gpt-5' } });
  });

  it('inherits the ruleset when auto-approve is off', () => {
    const permissions = [{ action: 'edit', resource: '*', effect: 'ask' as const }];
    expect(resolveNewSessionConfig({
      sessions: [session('latest', { permissions })],
      agents: [agent('build')],
      models: [model('openai', 'gpt-5')],
      autoApprove: false,
    })).toEqual({ permissions });
  });

  it('uses the recent model when there is no previous session', () => {
    expect(resolveNewSessionConfig({
      sessions: [], agents: [agent('build')], models: [model('openai', 'gpt-5')],
      recentModelIds: ['openai/gpt-5'], autoApprove: false,
    })).toEqual({ model: { providerID: 'openai', id: 'gpt-5' } });
  });
});

describe('existing session chat configuration', () => {
  it('prefers the session over its newest user message', () => {
    expect(resolveSessionChatConfig(
      session('s', { agent: 'build', model: { providerID: 'openai', id: 'gpt-5' } }),
      [user('m')],
    )).toEqual({ agent: 'build', model: { providerID: 'openai', id: 'gpt-5' } });
  });

  it('falls back field by field to the newest user message', () => {
    expect(resolveSessionChatConfig(
      session('s', { agent: 'build' }),
      [user('older'), user('newest', { agent: 'plan', model: { providerID: 'google', modelID: 'flash' } })],
    )).toEqual({ agent: 'build', model: { providerID: 'google', id: 'flash' } });
  });

  it('keeps the session ruleset for the existing chat', () => {
    const permissions = [{ action: 'bash', resource: '*', effect: 'ask' as const }];
    expect(resolveSessionChatConfig(session('s', { permissions }), undefined)).toEqual({ permissions });
  });
});
