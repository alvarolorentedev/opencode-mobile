// Pure V2 -> V1 protocol mappers. This module intentionally has no runtime
// imports so it can be transpiled and exercised by node tests without an
// OpenCode server (`tests/v2-mappers.test.mjs`).
import type { ModelInfo, Project, SessionInfo } from '@opencode/client';

export const INPUT_MODALITIES = ['text', 'audio', 'image', 'video', 'pdf'] as const;

export function projectToV1(project: Project): Record<string, unknown> {
  return {
    id: project.id,
    worktree: project.canonical,
    vcs: project.vcs,
    time: { created: project.time.created, initialized: project.time.updated },
  };
}

export function sessionToV1(session: SessionInfo): Record<string, unknown> {
  return {
    id: session.id,
    title: session.title ?? '',
    directory: session.location?.directory,
    time: { created: session.time.created, updated: session.time.updated },
    parentID: session.parentID,
    revert: session.revert,
    share: undefined,
    model: session.model,
    tokens: session.tokens,
    cost: session.cost,
    agent: session.agent,
  };
}

// V2 has no explicit reasoning capability flag. The catalog expresses reasoning
// support through provider compatibility fields and model variants/settings
// (variants are commonly reasoning effort presets), so detect those.
function containsReasoningSetting(value: unknown, depth = 0): boolean {
  if (depth > 3 || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => (/reasoning/i.test(key) && nested !== false) || containsReasoningSetting(nested, depth + 1));
}

function modelSupportsReasoning(model: ModelInfo): boolean {
  if (model.compatibility?.reasoningField || model.compatibility?.requireReasoning === true) return true;
  const candidates: unknown[] = [model.settings, (model as Record<string, unknown>).body];
  for (const variant of model.variants ?? []) {
    candidates.push(variant.settings, (variant as Record<string, unknown>).body);
  }
  return candidates.some((candidate) => containsReasoningSetting(candidate));
}

export function modelToV1(model: ModelInfo): Record<string, unknown> {
  const costs = Array.isArray(model.cost) ? model.cost : [];
  const base = costs.find((entry) => !entry.tier) ?? costs[0];
  const tiers = costs
    .filter((entry) => entry.tier)
    .map((entry) => ({
      input: entry.input,
      output: entry.output,
      cache: { read: entry.cache?.read ?? 0, write: entry.cache?.write ?? 0 },
      tier: entry.tier,
    }));

  return {
    id: model.id,
    name: model.name,
    providerID: model.providerID,
    capabilities: {
      reasoning: modelSupportsReasoning(model),
      attachment: model.capabilities.input.some((modality) => modality !== 'text'),
      input: Object.fromEntries(INPUT_MODALITIES.map((modality) => [modality, model.capabilities.input.includes(modality)])),
      toolcall: model.capabilities.tools,
    },
    limit: { context: model.limit.context, output: model.limit.output },
    cost: {
      input: base?.input ?? 0,
      output: base?.output ?? 0,
      cache: { read: base?.cache?.read ?? 0, write: base?.cache?.write ?? 0 },
      ...(tiers.length > 0 ? { tiers } : {}),
    },
    status: model.status,
  };
}
