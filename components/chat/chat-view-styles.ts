import { StyleSheet } from 'react-native';

import { Fonts } from '@/constants/theme';

export const styles = StyleSheet.create({
  header: { elevation: 0 },
  headerTitle: { flexShrink: 1, fontFamily: Fonts.display, fontWeight: '700' },
  headerSessionAnchor: { alignItems: 'center', alignSelf: 'stretch', borderRadius: 10, flexDirection: 'row', gap: 8, minHeight: 30, paddingRight: 4 },
  headerSessionAnchorPressed: { opacity: 0.82 },
  changesChip: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 12, borderRadius: 999, minHeight: 44, maxWidth: '100%', paddingHorizontal: 18, paddingVertical: 10 },
  jumpToLatestWrap: { position: 'absolute', left: 0, right: 0, bottom: 12, alignItems: 'center', zIndex: 3 },
  scroll: { flex: 1 },
  content: { padding: 12, gap: 12, paddingBottom: 20 },
  transcriptItem: { marginBottom: 12 },
  transcriptItemFlat: { marginBottom: 4 },
  skeletonRow: { height: 14, borderRadius: 7, marginTop: 8 },
  skeletonUser: { alignSelf: 'flex-end' },
  skeletonAssistant: { alignSelf: 'flex-start' },
  noticeCard: { borderRadius: 20 },
  emptyCard: { borderRadius: 22 },
  emptyContent: { gap: 14 },
  emptyTitle: { fontFamily: Fonts.display, fontWeight: '700' },
  promptStack: { gap: 10 },
  promptCard: { borderWidth: 1, borderRadius: 18 },
  promptCardInner: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14 },
  composerTextArea: { backgroundColor: 'transparent', fontSize: 17, marginHorizontal: 8, paddingVertical: 0 },
  inputContentCompact: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, fontFamily: Fonts.sans },
  changesList: { paddingBottom: 12 },
  todoOverlay: { position: 'absolute', left: 12, right: 12, bottom: 12, zIndex: 2, borderRadius: 16, borderWidth: 1, overflow: 'hidden' }
});

// Slim overrides applied on top of `styles` when the slim-interface preference
// is on. Kept parallel to the base sheet so slim never changes the default UI.
export const slimStyles = StyleSheet.create({
  content: { padding: 8, gap: 8, paddingBottom: 14 },
  transcriptItem: { marginBottom: 6 },
  transcriptItemFlat: { marginBottom: 2 }
});

export const stylesClasses = {
  "composer": "px-2 pt-1.5 pb-1.5 gap-1.5 border-t",
  "conversationBanner": "border rounded-[18px] px-3.5 py-3 gap-2",
  "conversationBannerHeader": "flex-row justify-between gap-3 items-center",
  "attachmentRow": "flex-row flex-wrap gap-2 px-0.5",
  "shellBanner": "border rounded-[14px] px-3 py-2.25 gap-0.5",
  "voiceStatusRow": "px-0.5",
  "voiceStatusChip": "self-start",
  "composerCard": "rounded-[28px] px-2 pt-2 pb-1",
  "composerToolbar": "flex-row items-center gap-0",
  "composerActionButton": "m-0",
  "composerModelSummary": "flex-1 min-w-0",
  "composerPrimaryButton": "m-0 w-11 h-11 rounded-full self-center",
  "headerMain": "flex-1 min-w-0 self-stretch justify-center",
  "headerSessionTextWrap": "flex-1 min-w-0",
  "headerActions": "flex-row items-center shrink-0",
  "usageProvider": "border rounded-[14px] gap-2 p-3",
  "usageRow": "items-center flex-row gap-3 justify-between",
  "contextProgress": "rounded-full h-2",
  "usageModel": "gap-1 pl-2",
  "progressFabInline": "relative right-0 bottom-0",
  "screen": "flex-1",
  "chatArea": "flex-1 relative",
  "sendErrorCard": "mx-3 mb-3 rounded-[16px]",
  "sendErrorContent": "gap-2",
  "sendErrorActions": "flex-row justify-end gap-1",
  "changesChipRow": "flex-row items-center gap-2 px-3 py-2",
  "progressSpacer": "w-12",
  "changesChipCenter": "flex-1 items-center min-w-0",
  "scroll": "flex-1",
  "changesNotice": "p-4 gap-2",
  "sessionPickerItemRow": "flex-row items-center gap-3 min-h-field px-3.5 py-3",
  "todoHeader": "min-h-target flex-row justify-between items-center py-1",
  "todoSummary": "flex-1",
  "todoItemRow": "flex-row items-center gap-1 min-h-10",
  "todoStatusIcon": "m-0",
  "todoTextWrap": "flex-1",
  "transcriptContainer": "flex-1",
  "transcriptItem": "mb-3"
} as const;

export const slimStylesClasses = {
  "composer": "px-1.5 pt-1 pb-1 gap-1"
} as const;
