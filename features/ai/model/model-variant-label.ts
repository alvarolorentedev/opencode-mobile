

export function getModelVariantLabel(variantId: string | undefined, t: (key: string) => string) {
  if (!variantId) return t('chat:reasoning.default');
  return ['low', 'default', 'high', 'max'].includes(variantId) ? t(`chat:reasoning.${variantId}`) : variantId;
}
