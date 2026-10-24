export function withAlpha(color: string, alpha: number) {
  const channel = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  if (/^#[0-9a-f]{6}$/i.test(color)) return `${color}${channel}`;
  if (/^#[0-9a-f]{8}$/i.test(color)) return `${color.slice(0, 7)}${channel}`;
  return color;
}
