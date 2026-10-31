export const WIDGET_STATUSES = ['idle', 'busy', 'retry'] as const;

export type WidgetSessionStatus = (typeof WIDGET_STATUSES)[number];

export type WidgetSessionEntry = {
  id: string;
  title: string;
  status: WidgetSessionStatus;
  link: string;
  preview?: string;
  replyAt?: number;
};

export type WidgetSnapshot = {
  updatedAt: number;
  sessions: WidgetSessionEntry[];
  connectionScope?: string;
  showPreviews?: boolean;
  language?: string;
  attention?: WidgetAttention;
  plan?: WidgetPlan;
};

export type WidgetAttentionEntry = WidgetSessionEntry & { permissions: number; questions: number; excerpt?: string };

export type WidgetAttention = { updatedAt: number; rows: WidgetAttentionEntry[]; total: number };

export type WidgetPlan = {
  updatedAt: number;
  session: WidgetSessionEntry;
  completed: number;
  total: number;
  steps: { index: number; status: string; content?: string }[];
};
