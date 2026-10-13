import { getFormatLocale } from '@/lib/i18n';

export function formatTimestamp(value: number, locale = getFormatLocale()) {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(value);
    }
  } catch {
    // Fall back below.
  }

  return new Date(value).toLocaleString();
}

export function formatRelativeTime(value: number) {
  const diffMs = value - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);

  if (Math.abs(diffMinutes) < 1) {
    return 'just now';
  }

  if (Math.abs(diffMinutes) < 60) {
    return formatRelative(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatRelative(diffHours, 'hour');
  }

  const diffDays = Math.round(diffHours / 24);
  return formatRelative(diffDays, 'day');
}

function formatRelative(value: number, unit: 'minute' | 'hour' | 'day') {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function') {
      return new Intl.RelativeTimeFormat(getFormatLocale(), { numeric: 'auto' }).format(value, unit);
    }
  } catch {
    // Fall back below.
  }

  if (value === 0) {
    return 'just now';
  }

  const absolute = Math.abs(value);
  const suffix = absolute === 1 ? unit : `${unit}s`;
  return value < 0 ? `${absolute} ${suffix} ago` : `in ${absolute} ${suffix}`;
}
