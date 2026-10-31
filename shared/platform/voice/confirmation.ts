// Strict voice-confirmation grammar. This is intentionally not fuzzy: a
// confirmation may only proceed when the whole final utterance is one of the
// known phrases. Anything else is ambiguous and must be re-prompted.

export type ConfirmationIntent = 'yes' | 'retry' | 'edit' | 'cancel' | 'ambiguous' | 'none';

export const MAX_CONFIRMATION_READBACK_CHARS = 280;

type ConfirmationPhrases = Record<Exclude<ConfirmationIntent, 'ambiguous' | 'none'>, readonly string[]>;

const EN: ConfirmationPhrases = {
  yes: ['yes', 'yeah', 'yep', 'yup', 'correct', 'send', 'send it', 'confirm', 'right', 'thats right'],
  retry: ['no', 'nope', 'retry', 'try again', 'again', 'redo', 'wrong'],
  edit: ['edit', 'change it', 'let me edit', 'correct it'],
  cancel: ['cancel', 'stop', 'never mind', 'nevermind', 'discard', 'abort'],
};

const RU: ConfirmationPhrases = {
  yes: ['да', 'ага', 'верно', 'правильно', 'подтверждаю', 'отправить', 'отправь'],
  retry: ['нет', 'неверно', 'неправильно', 'повторить', 'повтори', 'ещё раз', 'еще раз', 'заново'],
  edit: ['редактировать', 'изменить', 'исправить'],
  cancel: ['отмена', 'отменить', 'стоп', 'не надо'],
};

const ES: ConfirmationPhrases = {
  yes: ['sí', 'si', 'correcto', 'confirmar', 'enviar', 'envía', 'envia', 'de acuerdo'],
  retry: ['no', 'reintentar', 'otra vez', 'repetir', 'de nuevo'],
  edit: ['editar', 'cambiar', 'corregir'],
  cancel: ['cancelar', 'detener', 'olvídalo', 'olvidalo', 'parar'],
};

const HI: ConfirmationPhrases = {
  yes: ['हाँ', 'हां', 'जी', 'सही', 'भेजें', 'पुष्टि', 'ठीक है'],
  retry: ['नहीं', 'नही', 'फिर से', 'दोबारा', 'पुनः प्रयास', 'दोहराएं'],
  edit: ['संपादित करें', 'बदलें', 'सुधारें'],
  cancel: ['रद्द करें', 'रद्द', 'बंद करें', 'रोकें'],
};

const DE: ConfirmationPhrases = {
  yes: ['ja', 'richtig', 'bestätigen', 'senden', 'abschicken', 'stimmt'],
  retry: ['nein', 'wiederholen', 'noch einmal', 'erneut', 'falsch'],
  edit: ['bearbeiten', 'ändern', 'korrigieren'],
  cancel: ['abbrechen', 'stopp', 'vergessen', 'anhalten'],
};

const FR: ConfirmationPhrases = {
  yes: ['oui', 'correct', 'confirmer', 'envoyer', 'exact', "c'est bon", 'cest bon'],
  retry: ['non', 'réessayer', 'reessayer', 'encore', 'répéter', 'repeter'],
  edit: ['modifier', 'éditer', 'editer', 'corriger'],
  cancel: ['annuler', 'stop', 'laisser tomber', 'arrêter', 'arreter'],
};

const ZH: ConfirmationPhrases = {
  yes: ['是', '是的', '对', '对的', '正确', '确认', '发送'],
  retry: ['不', '不是', '不对', '重试', '再说一次', '重新'],
  edit: ['编辑', '修改', '更正'],
  cancel: ['取消', '停止', '算了'],
};

const PT: ConfirmationPhrases = {
  yes: ['sim', 'correto', 'confirmar', 'enviar', 'certo'],
  retry: ['não', 'nao', 'repetir', 'tentar de novo', 'de novo', 'errado'],
  edit: ['editar', 'alterar', 'corrigir'],
  cancel: ['cancelar', 'parar', 'deixa', 'abortar'],
};

const JA: ConfirmationPhrases = {
  yes: ['はい', 'ええ', 'そう', '正しい', '確認', '送信'],
  retry: ['いいえ', '違う', 'ちがう', 'やり直す', 'もう一度', '再試行'],
  edit: ['編集', '修正', '変更'],
  cancel: ['キャンセル', '中止', 'やめて', '停止'],
};

const PHRASES: Record<string, ConfirmationPhrases> = {
  en: EN,
  ru: RU,
  es: ES,
  hi: HI,
  de: DE,
  fr: FR,
  zh: ZH,
  pt: PT,
  ja: JA,
};

function languageCode(locale?: string) {
  return (locale || 'en').trim().toLowerCase().split(/[-_]/)[0] || 'en';
}

function phraseSet(locale?: string) {
  return PHRASES[languageCode(locale)] || EN;
}

export function normalizeConfirmationText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/['’]/gu, '')
    .replace(/[.,!?;:…"'“”‘’()[\]{}<>\/\\|@#$%^&*+=~`_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Classify a final confirmation utterance. The selected locale is tried first,
 * then English. No substring matching is performed: "yes, but change it" is
 * ambiguous, never an affirmative.
 */
export function classifyConfirmation(value: string, locale?: string): ConfirmationIntent {
  const normalized = normalizeConfirmationText(value);
  if (!normalized) {
    return 'none';
  }

  const sets = [phraseSet(locale), EN];
  for (const intent of ['yes', 'retry', 'edit', 'cancel'] as const) {
    if (sets.some((set) => set[intent].includes(normalized))) {
      return intent;
    }
  }
  return 'ambiguous';
}

export function confirmationContextualStrings(locale?: string) {
  const selected = phraseSet(locale);
  return [...new Set([...Object.values(selected).flat(), ...Object.values(EN).flat()])];
}

export function isLongConfirmationCommand(command: string) {
  return command.replace(/\s+/gu, ' ').trim().length > MAX_CONFIRMATION_READBACK_CHARS;
}

export function compactConfirmationCommand(command: string) {
  return command.replace(/\s+/gu, ' ').trim();
}
