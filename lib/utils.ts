import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import tokens from '@/constants/ui-tokens.json';
const merge = extendTailwindMerge({ extend: { theme: { text: Object.keys(tokens.typography) } } });
export function cn(...inputs: ClassValue[]) { return merge(clsx(inputs)); }
