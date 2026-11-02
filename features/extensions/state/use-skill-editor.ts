import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useExtensions } from '@/features/extensions/context';
import { skillSchema, type SkillDraft } from '@/features/extensions/model/extension-schemas';
import { parseSkillDocument, updateSkillDocument } from '@/shared/protocol/opencode/extensions/skills';
import type { ExtensionSkillRow, ExtensionScope } from '@/shared/protocol/opencode/extensions/types';
import { slugifySkillId } from '@/shared/contracts/skill-id';
import { getErrorMessage } from '@/shared/utilities/error-message';

function initialSkill(row?: ExtensionSkillRow) {
  if (row?.content) { try { return { ...parseSkillDocument(row.content), sourceMode: false }; } catch { /* Keep malformed content available for repair in the source editor. */ } }
  return { name: row?.name ?? '', description: row?.description ?? '', instructions: row?.content ?? '', autoinvoke: true, sourceMode: Boolean(row) };
}

export function useSkillEditor({ row, scope, onClose, save, initialSection }: { row?: ExtensionSkillRow; scope: ExtensionScope; onClose: () => void; save: (action: () => Promise<void>) => void; initialSection: string }) {
  const { t } = useTranslation();
  const { extensions } = useExtensions();
  const [initial] = useState(() => initialSkill(row));
  const [sourceMode, setSourceMode] = useState(initial.sourceMode);
  const [source, setSource] = useState(row?.content ?? '');
  const [error, setError] = useState<string>();
  const [section, setSection] = useState(initialSection);
  const form = useForm<SkillDraft>({ resolver: zodResolver(skillSchema), defaultValues: { id: row?.id ?? '', name: initial.name, description: initial.description, instructions: initial.instructions, autoinvoke: initial.autoinvoke }, mode: 'onSubmit', reValidateMode: 'onChange' });
  const writable = row ? row.editable : Boolean(extensions.snapshot?.[scope].safety.writable);
  const busy = Boolean(extensions.busy);
  const disabled = busy || !writable;
  const [name, autoinvoke] = useWatch({ control: form.control, name: ['name', 'autoinvoke'] });
  const values = { name, autoinvoke };
  function persist(draft: SkillDraft) {
    const id = row?.id ?? (draft.id.trim() || slugifySkillId(draft.name));
    try {
      const content = row ? sourceMode ? source : updateSkillDocument(source, { ...draft, id }) : undefined;
      if (content !== undefined) { const parsed = parseSkillDocument(content); if (!parsed.instructions.trim()) throw new Error(t('common:validation.required')); }
      save(async () => {
        if (row && content !== undefined) await extensions.updateSkill(scope, row, content);
        else await extensions.createSkill(scope, { ...draft, id });
        onClose();
      });
    } catch (failure) { setError(getErrorMessage(failure).startsWith('common:') ? t(getErrorMessage(failure)) : getErrorMessage(failure)); setSection('instructions'); }
  }
  function submit() {
    setError(undefined);
    if (sourceMode) { persist(form.getValues()); return; }
    void form.handleSubmit(persist, (errors) => setSection(errors.instructions ? 'instructions' : 'setup'))();
  }
  function changeSourceMode() {
    try {
      if (sourceMode) { const parsed = parseSkillDocument(source); form.reset({ id: row!.id, name: parsed.name, description: parsed.description, instructions: parsed.instructions, autoinvoke: parsed.autoinvoke }); }
      else setSource(updateSkillDocument(source, { ...form.getValues(), id: row!.id }));
      setSourceMode(!sourceMode); setError(undefined); setSection('instructions');
    } catch (failure) { setError(getErrorMessage(failure).startsWith('common:') ? t(getErrorMessage(failure)) : getErrorMessage(failure)); }
  }
  return { form, values, writable, busy, disabled, sourceMode, source, setSource, section, setSection, error: error || extensions.error, submit, changeSourceMode };
}
