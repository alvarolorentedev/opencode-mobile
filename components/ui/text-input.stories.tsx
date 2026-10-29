import type { ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { View } from 'react-native';

import { TextInput } from './text-input';

function Field(args: ComponentProps<typeof TextInput>) {
  const [value, setValue] = useState(args.value ?? '');
  return (
    <View style={{ width: 360 }}>
      <TextInput {...args} value={value} onChangeText={setValue} />
    </View>
  );
}

const meta = {
  title: 'Controls/Text input',
  component: TextInput,
  parameters: { layout: 'centered' },
  args: {
    label: 'Server URL',
    mode: 'outlined',
    placeholder: 'https://opencode.example.com',
  },
  render: (args) => <Field {...args} />,
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHelperText: Story = {
  args: {
    label: 'Project path',
    value: '/work/opencode-mobile',
  },
};

export const Error: Story = {
  args: {
    label: 'Password',
    error: true,
    value: 'incorrect',
  },
};

export const Secure: Story = {
  args: {
    label: 'Password',
    secureTextEntry: true,
    value: 'correct horse battery staple',
  },
};

export const Multiline: Story = {
  args: {
    label: 'Instructions',
    multiline: true,
    numberOfLines: 4,
    value: 'Review the failing test before changing the provider.',
  },
};

export const Disabled: Story = {
  args: {
    label: 'Connection name',
    disabled: true,
    value: 'Work laptop',
  },
};
