import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { View } from 'react-native';
import { ModelPicker } from './model-picker';
import type { ModelOption } from '@/shared/contracts/model-options';

const models: ModelOption[] = [{ id: 'openai/gpt-4.1-mini', providerID: 'openai', modelID: 'gpt-4.1-mini', label: 'GPT-4.1 mini', providerLabel: 'OpenAI', variants: [{ id: 'fast' }], supportsReasoning: false, supportsAttachments: true, supportsToolCalls: true, inputModalities: ['text'] }];
function Example({ empty = false, unavailable = false, disabled = false }: { empty?: boolean; unavailable?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState<string | undefined>(unavailable ? 'custom/unavailable-model' : undefined);
  return <View style={{ width: 390, maxWidth: '100%' }}><ModelPicker models={empty ? [] : models} selectedModelId={value} fallbackLabel={value} disabled={disabled}
    onSelect={(model) => setValue(model.id)} inheritChoice={{ label: 'Inherit model', description: 'Let OpenCode choose the model.', selected: !value, onSelect: () => setValue(undefined) }} /></View>;
}
const meta = { title: 'AI/Model picker', component: Example } satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Inherited: Story = {};
export const EmptyCatalog: Story = { args: { empty: true } };
export const UnavailableSelection: Story = { args: { unavailable: true } };
export const Disabled: Story = { args: { disabled: true } };
