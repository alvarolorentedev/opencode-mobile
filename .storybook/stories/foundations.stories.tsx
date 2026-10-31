import { usePalette } from '@/hooks/use-palette';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ACCENT_COLORS } from '@/constants/appearance';
import { ControlSize, Shape, Spacing } from '@/constants/design-tokens';
import { Fonts, getColors } from '@/constants/theme';

function Section({ children, title }: { children: ReactNode; title: string }) {
  const palette = usePalette();
  return (
    <View style={styles.section}>
      <Text style={[styles.heading, { color: palette.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function Foundations() {
  const palette = usePalette();
  const scheme = useColorScheme();
  const roles = ['background', 'surface', 'surfaceAlt', 'text', 'muted', 'border', 'tint', 'accent', 'success', 'warning', 'danger'] as const;
  return (
    <View style={styles.page}>
      <Section title="Semantic colors (active appearance)">
        <View style={styles.swatches}>
          {roles.map((role) => (
            <View key={role} style={styles.swatch}>
              <View style={[styles.chip, { backgroundColor: palette[role], borderColor: palette.border }]} />
              <Text style={[styles.label, { color: palette.text }]}>{role}</Text>
              <Text style={[styles.value, { color: palette.muted }]}>{palette[role]}</Text>
            </View>
          ))}
        </View>
      </Section>
      <Section title="Accent presets">
        <View style={styles.swatches}>
          {ACCENT_COLORS.map((accent) => {
            const accentPalette = getColors(scheme, accent);
            return (
              <View key={accent} style={styles.swatch}>
                <View style={[styles.chip, { backgroundColor: accentPalette.tint, borderColor: accentPalette.border }]} />
                <Text style={[styles.label, { color: accentPalette.text }]}>{accent}</Text>
              </View>
            );
          })}
        </View>
      </Section>
      <Section title="Spacing">
        <View style={styles.spacing}>
          {Object.entries(Spacing).map(([name, value]) => (
            <View key={name} style={styles.spacingRow}>
              <View style={[styles.spacingBar, { width: value * 4, backgroundColor: palette.tint }]} />
              <Text style={[styles.label, { color: palette.text }]}>{name} · {value}</Text>
            </View>
          ))}
        </View>
      </Section>
      <Section title="Shape and control sizes">
        <Text style={[styles.body, { color: palette.text }]}>
          control {Shape.control} · group {Shape.group} · sheet {Shape.sheet}{'\n'}
          target {ControlSize.target} · field {ControlSize.field} · row {ControlSize.row}{'\n'}
          content width {ControlSize.contentWidth}
        </Text>
        <View style={styles.radii}>
          {Object.entries(Shape).map(([name, value]) => (
            <View key={name} style={[styles.radius, { borderRadius: value, borderColor: palette.border }]}>
              <Text style={[styles.label, { color: palette.text }]}>{name}</Text>
            </View>
          ))}
        </View>
      </Section>
      <Section title="Typography">
        <Text style={[styles.display, { color: palette.text }]}>Display · {Fonts.display}</Text>
        <Text style={[styles.body, { color: palette.text }]}>Body · platform font</Text>
        <Text style={[styles.mono, { color: palette.muted }]}>Mono · {Fonts.mono}</Text>
      </Section>
    </View>
  );
}

const meta = {
  title: 'Foundations/Design tokens',
  component: Foundations,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Foundations>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};

const styles = StyleSheet.create({
  page: { gap: Spacing.xl, maxWidth: ControlSize.contentWidth, width: '100%' },
  section: { gap: Spacing.md },
  heading: { fontSize: 18, fontWeight: '700' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  swatch: { width: 132, gap: Spacing.xs },
  chip: { height: 48, borderRadius: Shape.control, borderWidth: 1 },
  label: { fontSize: 13, fontWeight: '600' },
  value: { fontSize: 12 },
  spacing: { gap: Spacing.sm },
  spacingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  spacingBar: { height: 16, borderRadius: 4 },
  radii: { flexDirection: 'row', gap: Spacing.md },
  radius: { width: 88, height: 56, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  display: { fontFamily: Fonts.display, fontSize: 24, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24 },
  mono: { fontFamily: Fonts.mono, fontSize: 14 },
});
