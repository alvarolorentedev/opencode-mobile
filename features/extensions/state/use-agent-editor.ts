import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCapabilities } from '@/features/ai/context';
import { useExtensions } from '@/features/extensions/context';
import { agentSchema, type AgentDraft } from '@/features/extensions/model/extension-schemas';
import { readPermissionRules, writePermissionRules, type PermissionRule } from '@/shared/protocol/opencode/extensions/permission-draft';
import type { ExtensionAgentRow, ExtensionScope } from '@/shared/protocol/opencode/extensions/types';

export function useAgentEditor({ row, readOnly, scope, onClose, save, initialSection, initialPermissionsOpen }: {
  row?: ExtensionAgentRow; readOnly: boolean; scope: ExtensionScope; onClose: () => void; save: (action: () => Promise<void>) => void;
  initialSection: string; initialPermissionsOpen: boolean;
}) {
  const { extensions } = useExtensions();
  const { availableModels, configuredProviders } = useCapabilities();
  const [section, setSection] = useState(initialSection);
  const [advancedError, setAdvancedError] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(initialPermissionsOpen);
  const form = useForm<AgentDraft>({ resolver: zodResolver(agentSchema), defaultValues: {
    id: row?.id ?? '', description: row?.description ?? '', mode: row ? row.mode ?? 'all' : 'subagent', model: row?.model ?? '',
    permissions: row?.permissionsText ?? '', instructions: row?.instructions ?? '', advancedFrontmatter: row?.advancedFrontmatter ?? '', format: row?.origin === 'config' ? 'jsonc' : 'markdown',
  }, mode: 'onSubmit', reValidateMode: 'onChange' });
  const [mode, model, permissions, format] = useWatch({ control: form.control, name: ['mode', 'model', 'permissions', 'format'] });
  const values = { mode, model, permissions, format };
  const busy = Boolean(extensions.busy);
  const disabled = busy || readOnly;
  const modelParts = values.model.split('#');
  const models = availableModels.filter((model) => configuredProviders.some((provider) => provider.id === model.providerID));
  const selected = models.find((model) => model.id === values.model) ?? models.find((model) => `${model.providerID}/${model.modelID}` === modelParts[0]);
  const complexModel = Boolean(row?.modelComplex);
  const permissionFormat = row?.permissionsFormat ?? (format === 'jsonc' ? 'json' : 'yaml');
  const rules = row?.permissionsKey === 'permission' ? undefined : readPermissionRules(values.permissions, permissionFormat);
  const setModel = (value: string) => form.setValue('model', value, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  function submit() {
    if (rules?.some((rule) => !rule.action.trim() || !rule.resource.trim())) {
      form.setError('permissions', { message: 'common:validation.required' }); setSection('setup'); setPermissionsOpen(true); return;
    }
    form.clearErrors('permissions');
    void form.handleSubmit((draft) => save(async () => { await extensions.saveAgent(scope, draft, row); onClose(); }), (errors) => {
      setSection(errors.instructions ? 'instructions' : 'setup');
      setAdvancedError(Boolean(errors.advancedFrontmatter || errors.model));
    })();
  }
  const setRules = (next: PermissionRule[]) => form.setValue('permissions', writePermissionRules(next, permissionFormat), { shouldDirty: true });
  const setFormat = (next: AgentDraft['format']) => {
    if (rules) form.setValue('permissions', writePermissionRules(rules, next === 'jsonc' ? 'json' : 'yaml'), { shouldDirty: true });
    form.setValue('format', next, { shouldDirty: true });
  };
  return { setFormat, form, values, busy, disabled, models, selected, modelParts, complexModel, rules, setRules, setModel, section, setSection, advancedError, permissionsOpen, submit, error: extensions.error };
}
