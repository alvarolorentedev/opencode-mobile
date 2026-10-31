import type { ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { View } from 'react-native';

import { TextField } from '@/shared/ui/text-field';

function Field(args: ComponentProps<typeof TextField>) {
  const [value, setValue] = useState(args.value ?? '');
  return (
    <View style={{ width: 360 }}>
      <TextField {...args} value={value} onChangeText={setValue} />
    </View>
  );
}

const meta = {
  title: 'Controls/Text input',
  component: TextField,
  parameters: { layout: 'centered' },
  args: {
    label: 'Server URL',
    placeholder: 'https://opencode.example.com',
  },
  render: (args) => <Field {...args} />,
} satisfies Meta<typeof TextField>;

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
    invalid: true,
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
