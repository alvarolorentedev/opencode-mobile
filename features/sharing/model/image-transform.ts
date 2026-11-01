export const MIN_IMAGE_SCALE = 1;
export const MAX_IMAGE_SCALE = 4;
export const DOUBLE_TAP_IMAGE_SCALE = 2.5;

export function clampImageScale(scale: number) {
  'worklet';
  if (!Number.isFinite(scale)) return MIN_IMAGE_SCALE;
  return Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, scale));
}

export function clampImageTranslation(value: number, scale: number, size: number) {
  'worklet';
  const limit = Math.max(0, ((clampImageScale(scale) - MIN_IMAGE_SCALE) * size) / 2);
  return Math.min(limit, Math.max(-limit, value));
}

export function toggleImageScale(scale: number) {
  'worklet';
  return scale > MIN_IMAGE_SCALE + 0.01 ? MIN_IMAGE_SCALE : DOUBLE_TAP_IMAGE_SCALE;
}
