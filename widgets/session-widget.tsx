import { FlexWidget, TextWidget, type ColorProp } from 'react-native-android-widget';

import { i18n } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/opencode/format';
import type { WidgetSessionStatus, WidgetSnapshot } from '@/providers/widget-snapshot';

// Android home-screen widget tree. This is a RemoteViews description consumed by
// `react-native-android-widget`, not a React Native component tree: it must stay
// free of hooks, state, and app imports beyond pure constants/helpers. It cannot
// live under `app/` because Expo Router treats every file there as a route.
export const SESSION_WIDGET_NAME = 'SessionWidget';

type WidgetScheme = 'light' | 'dark';

// Mirrors the app palette in constants/theme.ts as literals so the widget lib's
// `#...` color types are satisfied without a cast.
const PALETTE: Record<WidgetScheme, { surface: ColorProp; text: ColorProp; muted: ColorProp; icon: ColorProp }> = {
  light: { surface: '#FCFDFC', text: '#172126', muted: '#667874', icon: '#8B989B' },
  dark: { surface: '#16201D', text: '#EAF3EF', muted: '#9AADA8', icon: '#839793' },
};

const STATUS_COLORS: Record<WidgetSessionStatus, Record<WidgetScheme, ColorProp>> = {
  idle: { light: '#8B989B', dark: '#839793' },
  busy: { light: '#0F8A6C', dark: '#7AE7C0' },
  retry: { light: '#A56A0D', dark: '#E6B35A' },
};

function statusLabel(status: WidgetSessionStatus) {
  if (status === 'busy') return i18n.t('notifications:activity.working');
  if (status === 'retry') return i18n.t('notifications:activity.retrying');
  return '';
}

export function SessionWidget({ snapshot, scheme }: { snapshot?: WidgetSnapshot; scheme: WidgetScheme }) {
  const palette = PALETTE[scheme];
  const sessions = snapshot?.sessions ?? [];
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={i18n.t('chat:library.title')}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 12,
        backgroundColor: palette.surface,
        borderRadius: 16,
      }}
    >
      <TextWidget
        text={i18n.t('chat:library.activeSessions')}
        style={{ fontSize: 12, fontWeight: '600', color: palette.muted }}
      />
      {sessions.length === 0
        ? (
          <TextWidget
            text={i18n.t('chat:library.noChats')}
            style={{ fontSize: 13, color: palette.text }}
          />
        )
        : sessions.map((session) => (
          <FlexWidget
            key={session.id}
            clickAction="OPEN_URI"
            clickActionData={{ uri: session.link }}
            accessibilityLabel={i18n.t('chat:library.open', { title: session.title })}
            style={{
              width: 'match_parent',
              flexDirection: 'column',
              paddingVertical: 4,
            }}
          >
            <TextWidget
              text={session.title}
              maxLines={1}
              truncate="END"
              style={{ width: 'match_parent', fontSize: 14, color: palette.text }}
            />
            {session.status === 'idle'
              ? null
              : (
                <TextWidget
                  text={statusLabel(session.status)}
                  style={{ fontSize: 11, color: STATUS_COLORS[session.status][scheme] }}
                />
              )}
          </FlexWidget>
        ))}
      {sessions.length === 0 || !snapshot
        ? null
        : (
          <TextWidget
            text={formatRelativeTime(snapshot.updatedAt)}
            style={{ fontSize: 10, color: palette.icon }}
          />
        )}
    </FlexWidget>
  );
}
