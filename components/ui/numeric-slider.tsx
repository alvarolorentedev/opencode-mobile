import Slider from '@react-native-community/slider';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { ControlSize } from '@/constants/design-tokens';
import { Colors } from '@/constants/theme';

type Palette = typeof Colors.light;

export function NumericSlider({
  label,
  maximum,
  minimum,
  onValueChange,
  palette,
  step,
  value,
  valueLabel,
}: {
  label: string;
  maximum: number;
  minimum: number;
  onValueChange: (value: number) => void;
  palette: Palette;
  step: number;
  value: number;
  valueLabel: string;
}) {
  // The package's web build does not expose range semantics or arrow keys.
  // Pass the DOM attributes through the View it renders, matching the previous
  // slider contract used by the E2E suite and keyboard users.
  const webProps = Platform.OS === 'web'
    ? {
        'aria-valuemax': maximum,
        'aria-valuemin': minimum,
        'aria-valuenow': value,
        'aria-valuetext': valueLabel,
        onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          let next: number | undefined;
          if (event.key === 'Home') next = minimum;
          else if (event.key === 'End') next = maximum;
          else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = value + step;
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = value - step;
          if (next === undefined) return;
          event.preventDefault();
          onValueChange(Number(Math.max(minimum, Math.min(maximum, next)).toFixed(2)));
        },
        tabIndex: 0 as const,
      }
    : {};

  return (
    <View style={styles.numericSlider}>
      <View style={styles.numericSliderHeader}>
        <Text style={{ color: palette.text, flex: 1 }}>{label}</Text>
        <Text style={{ color: palette.muted }}>{valueLabel}</Text>
      </View>
      <Slider
        {...webProps}
        accessibilityLabel={label}
        accessibilityValue={{ max: maximum, min: minimum, now: value, text: valueLabel }}
        maximumTrackTintColor={palette.border}
        maximumValue={maximum}
        minimumTrackTintColor={palette.tint}
        minimumValue={minimum}
        onValueChange={onValueChange}
        step={step}
        style={styles.slider}
        thumbTintColor={palette.tint}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  numericSlider: { gap: 4 },
  numericSliderHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  slider: { height: ControlSize.target, marginHorizontal: 4 },
});
