"use no memo";

// The widget serializer calls these functions outside React, so compiler hooks cannot run.
import { FlexWidget, TextWidget, type ColorProp } from 'react-native-android-widget';

import { i18n } from '@/lib/i18n';
import { formatTimestamp } from '@/lib/opencode/format';
import type { WidgetSnapshot } from '@/providers/widget-snapshot';

export const SESSION_WIDGET_NAME = 'SessionWidget';
export const ATTENTION_WIDGET_NAME = 'AttentionWidget';
export const PLAN_WIDGET_NAME = 'PlanWidget';
export const WIDGET_NAMES = [SESSION_WIDGET_NAME, ATTENTION_WIDGET_NAME, PLAN_WIDGET_NAME] as const;
export type WidgetKind = 'replies' | 'attention' | 'plan';
type WidgetScheme = 'light' | 'dark';
const PALETTE: Record<WidgetScheme, { surface: ColorProp; text: ColorProp; muted: ColorProp; accent: ColorProp }> = {
  light: { surface: '#FCFDFC', text: '#172126', muted: '#667874', accent: '#0F8A6C' },
  dark: { surface: '#16201D', text: '#EAF3EF', muted: '#9AADA8', accent: '#7AE7C0' },
};
export function widgetKind(name: string): WidgetKind {
  return name === ATTENTION_WIDGET_NAME ? 'attention' : name === PLAN_WIDGET_NAME ? 'plan' : 'replies';
}
export function widgetRowLimit(height: number) {
  return Math.max(1, Math.min(3, Math.floor((height - 64) / 62)));
}

// RemoteViews trees only: state, API reads and persistence stay in the provider.
export function SessionWidget({ snapshot, scheme, kind = 'replies', height = 300 }: {
  snapshot?: WidgetSnapshot; scheme: WidgetScheme; kind?: WidgetKind; height?: number;
}) {
  const palette = PALETTE[scheme];
  const t = snapshot?.language ? i18n.getFixedT(snapshot.language) : i18n.t.bind(i18n);
  const limit = widgetRowLimit(height);
  const plan = snapshot?.plan;
  const rows = kind === 'attention' ? snapshot?.attention?.rows ?? [] : snapshot?.sessions ?? [];
  const updatedAt = kind === 'attention' ? snapshot?.attention?.updatedAt : kind === 'plan' ? plan?.updatedAt : snapshot?.updatedAt;
  const title = t(`share:widgets.${kind}`);
  const lines = height < 180 ? 1 : 2;
  const rootLink = kind === 'plan' ? plan?.session.link : undefined;
  return (
    <FlexWidget clickAction={rootLink ? 'OPEN_URI' : 'OPEN_APP'} clickActionData={rootLink ? { uri: rootLink } : undefined}
      accessibilityLabel={title} style={{ height: 'match_parent', width: 'match_parent', flexDirection: 'column',
        justifyContent: 'space-between', padding: 10, backgroundColor: palette.surface, borderRadius: 16 }}>
      <TextWidget text={title} maxLines={1} truncate="END" style={{ fontSize: 12, fontWeight: '600', color: palette.muted }} />
      {kind === 'plan' ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
          {plan ? <FlexWidget style={{ width: 'match_parent', flexDirection: 'column' }}>
            <TextWidget text={plan.session.title} maxLines={1} truncate="END" style={{ fontSize: 14, color: palette.text }} />
            <TextWidget text={plan.total ? (plan.completed === plan.total ? t('share:widgets.completed') : t('share:widgets.progress', { completed: plan.completed, total: plan.total })) : t('share:widgets.noPlan')}
              maxLines={1} style={{ fontSize: 11, color: palette.accent }} />
            {plan.steps.slice(0, Math.max(1, limit - 1)).map((step) => (
              <TextWidget key={step.index}
                text={`${step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '→' : step.status === 'cancelled' ? '×' : '○'} ${(snapshot?.showPreviews !== false && step.content) || t('share:widgets.step', { index: step.index })}`}
                maxLines={1} truncate="END" style={{ fontSize: 12, color: palette.text }} />
            ))}
          </FlexWidget> : <TextWidget text={t('share:widgets.chooseChat')} style={{ fontSize: 13, color: palette.text }} />}
        </FlexWidget>
      ) : rows.length ? rows.slice(0, limit).map((row) => {
        const attention = kind === 'attention' && 'permissions' in row && 'questions' in row ? row : undefined;
        const excerpt = snapshot?.showPreviews === false ? undefined : attention && 'excerpt' in attention ? String(attention.excerpt || '') : row.preview;
        const status = attention ? t('share:widgets.requests', { permissions: attention.permissions, questions: attention.questions })
          : row.status !== 'idle' ? t(row.status === 'retry' ? 'notifications:activity.retrying' : 'notifications:activity.working') : '';
        return <FlexWidget key={row.id} clickAction="OPEN_URI" clickActionData={{ uri: row.link }}
          accessibilityLabel={[row.title, status, excerpt].filter(Boolean).join('. ')}
          style={{ width: 'match_parent', flexDirection: 'column', paddingVertical: 3 }}>
          <TextWidget text={row.title} maxLines={1} truncate="END" style={{ fontSize: 14, color: palette.text }} />
          {status ? <TextWidget text={status} maxLines={1} truncate="END" style={{ fontSize: 10, color: palette.accent }} /> : null}
          <TextWidget text={excerpt || t(snapshot?.showPreviews === false ? 'share:widgets.hidden' : 'share:widgets.noReply')}
            maxLines={lines} truncate="END" style={{ fontSize: 12, color: palette.muted }} />
        </FlexWidget>;
      }) : <TextWidget text={t(kind === 'attention' ? (snapshot?.attention ? 'share:widgets.noActions' : 'share:widgets.openApp') : 'share:widgets.noReply')}
        style={{ fontSize: 13, color: palette.text }} />}
      {kind === 'attention' && (snapshot?.attention?.total ?? 0) > Math.min(rows.length, limit) ?
        <TextWidget text={t('share:widgets.moreChats', { count: snapshot!.attention!.total - Math.min(rows.length, limit) })}
          style={{ fontSize: 10, color: palette.muted }} /> : null}
      {updatedAt ? <TextWidget text={t('share:widgets.updated', { time: formatTimestamp(updatedAt, snapshot?.language) })}
        maxLines={1} truncate="END" style={{ fontSize: 9, color: palette.muted }} /> : null}
    </FlexWidget>
  );
}
