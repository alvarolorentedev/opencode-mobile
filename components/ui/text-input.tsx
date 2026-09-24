import type { ComponentProps } from 'react';
import { TextInput as PaperTextInput, useTheme } from 'react-native-paper';

type PaperTextInputProps = ComponentProps<typeof PaperTextInput>;

export function TextInput({ cursorColor, selectionColor, ...rest }: PaperTextInputProps) {
  const { colors } = useTheme();
  return (
    <PaperTextInput
      cursorColor={cursorColor ?? colors.primary}
      selectionColor={selectionColor ?? colors.primary}
      {...rest}
    />
  );
}
