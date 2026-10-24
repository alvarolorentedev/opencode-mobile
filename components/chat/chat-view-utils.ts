export const STARTER_PROMPT_KEYS = [
  'chat:starter.prompts.polish',
  'chat:starter.prompts.review',
  'chat:starter.prompts.implement',
];

export function getModelVariantLabel(variantId: string | undefined, t: (key: string) => string) {
  if (!variantId) return t('chat:reasoning.default');
  return ['low', 'default', 'high', 'max'].includes(variantId) ? t(`chat:reasoning.${variantId}`) : variantId;
}

export function getAutoApproveIcon(autoApprove: boolean) {
  return autoApprove ? 'alert-outline' : 'shield-outline';
}
