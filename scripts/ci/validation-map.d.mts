export type ValidationMode = 'none' | 'smoke' | 'affected' | 'full';

export interface ValidationSelection {
  mode: ValidationMode;
  specs: string[];
  storybook: boolean;
  reason: string;
}

export const SPECS: Record<string, string>;

export function classifyValidation(
  files: string[],
  options?: { event?: string },
): ValidationSelection;
