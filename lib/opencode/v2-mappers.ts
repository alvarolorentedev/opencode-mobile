// Native protocol records projected into app-owned presentation models. This module intentionally has no runtime
// imports so it can be transpiled and exercised by node tests without an
// OpenCode server (`tests/v2-mappers.test.mjs`).
import type { ModelInfo, Project, SessionInfo } from '@opencode/client';
import type { Project as ProjectView, Session, Model } from './types';

export const INPUT_MODALITIES = ['text', 'audio', 'image', 'video', 'pdf'] as const;

export function toProjectView(project: Project): ProjectView {
  return {
    id: project.id,
    worktree: project.canonical,
    vcs: project.vcs,
    ...(project.name ? { name: project.name } : {}),
    ...(project.sandboxes ? { sandboxes: project.sandboxes } : {}),
    time: { created: project.time.created, initialized: project.time.updated },
  };
}

export function toSessionView(session: SessionInfo): Session {
  return {
    id: session.id,
    title: session.title ?? '',
    directory: session.location?.directory,
    time: { ...session.time },
    projectID: session.projectID,
    parentID: session.parentID,
    revert: session.revert,
    share: undefined,
    model: session.model,
    tokens: session.tokens,
    cost: session.cost,
    agent: session.agent,
    metadata: session.metadata,
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

export function toModelOptionRecord(model: ModelInfo): Model {
  const costs = Array.isArray(model.cost) ? model.cost : [];
  const base = costs.find((entry) => !entry.tier) ?? costs[0];
  const tiers = costs
    .filter((entry) => entry.tier)
    .map((entry) => ({
      input: entry.input / 1_000_000,
      output: entry.output / 1_000_000,
      cache: { read: (entry.cache?.read ?? 0) / 1_000_000, write: (entry.cache?.write ?? 0) / 1_000_000 },
      tier: entry.tier!,
    }));

  return {
    id: model.id,
    name: model.name,
    providerID: model.providerID,
    variants: (model.variants ?? []).map(({ id }) => ({ id })),
    capabilities: {
      reasoning: modelSupportsReasoning(model),
      attachment: model.capabilities.input.some((modality) => modality !== 'text'),
      input: Object.fromEntries(INPUT_MODALITIES.map((modality) => [modality, model.capabilities.input.includes(modality)])) as Model['capabilities']['input'],
      toolcall: model.capabilities.tools,
    },
    limit: { context: model.limit.context, output: model.limit.output },
    cost: {
      input: (base?.input ?? 0) / 1_000_000,
      output: (base?.output ?? 0) / 1_000_000,
      cache: { read: (base?.cache?.read ?? 0) / 1_000_000, write: (base?.cache?.write ?? 0) / 1_000_000 },
      ...(tiers.length > 0 ? { tiers } : {}),
    },
    status: model.status,
  };
}
