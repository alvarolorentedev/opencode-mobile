import { ActivityIndicator, type DimensionValue, StyleSheet, View } from 'react-native';
import {
  Button,
  Card,
  List,
  Text,
  TextInput,
} from 'react-native-paper';

import type { Colors } from '@/constants/theme';
import type { BellowsBudgetInfo, BellowsModel } from '@/lib/bellows/client';

type Palette = typeof Colors.light;

type BellowsSectionProps = {
  bellowsServerUrl: string;
  bellowsApiKey: string;
  bellowsError: string | null;
  budgetInfo: BellowsBudgetInfo | null;
  isBellowsLoading: boolean;
  models: BellowsModel[];
  onRefresh: () => void;
  palette: Palette;
  updateSettings: (patch: { bellowsServerUrl?: string; bellowsApiKey?: string }) => void;
};

export function BellowsSection({
  bellowsServerUrl,
  bellowsApiKey,
  bellowsError,
  budgetInfo,
  isBellowsLoading,
  models,
  onRefresh,
  palette,
  updateSettings,
}: BellowsSectionProps) {
  const remaining = budgetInfo
    ? budgetInfo.max_budget != null
      ? Math.max(0, budgetInfo.max_budget - budgetInfo.current_spend)
      : null
    : null;

  const spendPercent = budgetInfo?.max_budget
    ? Math.min(100, (budgetInfo.current_spend / budgetInfo.max_budget) * 100)
    : 0;

  return (
    <Card mode="contained" style={[styles.card, { backgroundColor: palette.surface }]}>
      <Card.Content style={styles.section}>
        <Text variant="titleLarge" style={[styles.title, { color: palette.text }]}>Bellows API</Text>

        <TextInput
          mode="outlined"
          label="Bellows Server URL"
          value={bellowsServerUrl}
          onChangeText={(value) => updateSettings({ bellowsServerUrl: value })}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://your-bellows:4000"
        />
        <TextInput
          mode="outlined"
          label="API Key"
          value={bellowsApiKey}
          onChangeText={(value) => updateSettings({ bellowsApiKey: value })}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="sk-..."
        />

        <Button mode="contained" loading={isBellowsLoading} onPress={onRefresh}>
          Test Connection
        </Button>

        {/* Error display */}
        {bellowsError ? (
          <Text variant="bodySmall" style={{ color: palette.danger }}>
            {bellowsError}
          </Text>
        ) : null}

        {/* Budget display */}
        {budgetInfo ? (
          <View style={[styles.budgetCard, { backgroundColor: palette.background, borderColor: palette.border }]}>
            <Text variant="labelLarge" style={{ color: palette.text }}>Budget</Text>
            <View style={styles.budgetRow}>
              <Text variant="bodyMedium" style={{ color: palette.muted }}>Spent</Text>
              <Text variant="bodyMedium" style={{ color: palette.text }}>${budgetInfo.current_spend.toFixed(4)}</Text>
            </View>
            <View style={styles.budgetRow}>
              <Text variant="bodyMedium" style={{ color: palette.muted }}>Limit</Text>
              <Text variant="bodyMedium" style={{ color: palette.text }}>
                {budgetInfo.max_budget != null ? `$${budgetInfo.max_budget.toFixed(2)}` : 'Unlimited'}
              </Text>
            </View>
            {remaining != null ? (
              <View style={styles.budgetRow}>
                <Text variant="bodyMedium" style={{ color: palette.muted }}>Remaining</Text>
                <Text variant="bodyMedium" style={{ color: palette.text }}>${remaining.toFixed(4)}</Text>
              </View>
            ) : null}
            {budgetInfo.max_budget != null ? (
              <View style={[styles.progressBarBackground, { backgroundColor: palette.border }]}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${spendPercent}%` as DimensionValue,
                      backgroundColor: palette.tint,
                    },
                  ]}
                />
              </View>
            ) : null}
          </View>
        ) : isBellowsLoading ? (
          <ActivityIndicator color={palette.tint} />
        ) : null}

        {/* Model listing */}
        {models.length > 0 ? (
          <View style={styles.modelsContainer}>
            <Text variant="labelLarge" style={{ color: palette.text }}>Available Models</Text>
            <List.Section style={styles.modelList}>
              {models.map((model) => (
                <List.Item
                  key={model.id}
                  title={model.id}
                  titleStyle={{ color: palette.text }}
                  style={styles.modelItem}
                />
              ))}
            </List.Section>
          </View>
        ) : null}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16 },
  section: { gap: 14 },
  title: { fontWeight: '600' },
  budgetCard: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressBarBackground: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 4 },
  progressBarFill: { height: '100%', borderRadius: 4 },
  modelsContainer: { gap: 8 },
  modelList: { marginVertical: 0 },
  modelItem: { paddingLeft: 0, paddingVertical: 4 },
});
