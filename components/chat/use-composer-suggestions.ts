import { useEffect, useMemo, useState } from 'react';

import type { Command, Reference, Skill } from '@/lib/opencode/types';
import { findComposerTrigger } from '@/lib/opencode/composer';
import type { AgentOption } from '@/providers/opencode-model-selection';
import type { ComposerSuggestion, ComposerSuggestionGroup } from './composer-suggestion-types';

type ComposerSuggestionsInput = {
  draft: string;
  selection: { start: number; end: number };
  enabled: boolean;
  commands: Command[];
  agents: AgentOption[];
  skills: Skill[];
  references: Reference[];
  searchFiles: (query: string) => Promise<string[]>;
};

function includesQuery(values: (string | undefined)[], query: string) {
  const normalized = query.toLocaleLowerCase();
  return values.some((value) => value?.toLocaleLowerCase().includes(normalized));
}

function uniqueSuggestions(items: ComposerSuggestion[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

export function useComposerSuggestions({
  draft,
  selection,
  enabled,
  commands,
  agents,
  skills,
  references,
  searchFiles,
}: ComposerSuggestionsInput) {
  const cursor = selection.end;
  const trigger = useMemo(() => (enabled ? findComposerTrigger(draft, cursor) : undefined), [cursor, draft, enabled]);
  const [fileState, setFileState] = useState<{ query: string; files: string[]; searching: boolean; error?: string }>({
    query: '',
    files: [],
    searching: false,
  });

  const fileQuery = trigger?.kind === 'context' ? trigger.query.trim() : '';
  useEffect(() => {
    if (!enabled || trigger?.kind !== 'context' || fileQuery.length < 2) return;
    let canceled = false;
    const timeout = setTimeout(() => {
      setFileState({ query: fileQuery, files: [], searching: true });
      void searchFiles(fileQuery)
        .then((results) => {
          if (!canceled) setFileState({ query: fileQuery, files: results.slice(0, 20), searching: false });
        })
        .catch((reason) => {
          if (!canceled) {
            setFileState({
              query: fileQuery,
              files: [],
              searching: false,
              error: reason instanceof Error ? reason.message : 'Could not search project files.',
            });
          }
        });
    }, 200);
    return () => {
      canceled = true;
      clearTimeout(timeout);
    };
  }, [enabled, fileQuery, searchFiles, trigger?.kind]);

  const activeFileState = fileQuery.length >= 2 && fileState.query === fileQuery
    ? fileState
    : { query: fileQuery, files: [], searching: fileQuery.length >= 2, error: undefined };
  const files = activeFileState.files;
  const searching = activeFileState.searching;
  const error = activeFileState.error;

  const groups = useMemo<ComposerSuggestionGroup[]>(() => {
    if (!trigger) return [];
    const query = trigger.query.trim();

    if (trigger.kind === 'command') {
      const items = commands
        .filter((command) => includesQuery([command.name, command.description], query))
        .sort((left, right) => Number(!left.name.startsWith(query)) - Number(!right.name.startsWith(query)))
        .slice(0, 8)
        .map((command) => ({
          key: `command:${command.name}`,
          kind: 'command' as const,
          label: `/${command.name}`,
          description: command.description,
          insert: `/${command.name} `,
        }));
      return items.length ? [{ kind: 'command', items }] : [];
    }

    const result: ComposerSuggestionGroup[] = [];
    const agentItems = uniqueSuggestions(agents
      .filter((agent) => includesQuery([agent.id, agent.label, agent.description], query))
      .slice(0, 8)
      .map((agent) => ({
        key: `agent:${agent.id}`,
        kind: 'agent' as const,
        label: `@${agent.id}`,
        description: agent.description,
        insert: `@${agent.id} `,
        context: { kind: 'agent' as const, name: agent.id, token: `@${agent.id}` },
      })));
    if (agentItems.length) result.push({ kind: 'agent', items: agentItems });

    const skillItems = uniqueSuggestions(skills
      .filter((skill) => includesQuery([skill.name, skill.id, skill.description], query))
      .slice(0, 8)
      .map((skill) => ({
        key: `skill:${skill.id}`,
        kind: 'skill' as const,
        label: `@${skill.name}`,
        description: skill.description,
        insert: `@${skill.name} `,
        context: { kind: 'skill' as const, id: skill.id, name: skill.name, token: `@${skill.name}` },
      })));
    if (skillItems.length) result.push({ kind: 'skill', items: skillItems });

    if (query.length >= 2) {
      const fileItems = files.map((path) => ({
        key: `file:${path}`,
        kind: 'file' as const,
        label: `@${path}`,
        insert: `@${path} `,
        context: { kind: 'file' as const, path, token: `@${path}` },
      }));
      if (fileItems.length) result.push({ kind: 'file', items: fileItems });
    }

    const referenceItems = references
      .filter((reference) => includesQuery([reference.name, reference.path, reference.description], query))
      .slice(0, 8)
      .map((reference) => ({
        key: `reference:${reference.name}`,
        kind: 'reference' as const,
        label: `@${reference.name}`,
        description: reference.description || reference.path,
        insert: `@${reference.name} `,
        context: { kind: 'file' as const, path: reference.path, token: `@${reference.name}` },
      }));
    if (referenceItems.length) result.push({ kind: 'reference', items: referenceItems });

    return result;
  }, [agents, commands, files, references, skills, trigger]);

  return { trigger, groups, searching, error };
}
