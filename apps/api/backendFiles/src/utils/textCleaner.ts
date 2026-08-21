export const TEXT_ERROR_RATE = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', EMPTY: 'empty' } as const;
export type TextErrorRate = (typeof TEXT_ERROR_RATE)[keyof typeof TEXT_ERROR_RATE];

export function cleanFlatText(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[\*_~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function categorizeTranscriptQuality(text: string): TextErrorRate {
  const clean = cleanFlatText(text);
  if (!clean) return TEXT_ERROR_RATE.EMPTY;
  const chars = clean.length;
  const suspicious = (clean.match(/[?{}<>_=\\]/g) ?? []).length;
  const ratio = suspicious / Math.max(chars, 1);
  if (chars < 8 || ratio > 0.12) return TEXT_ERROR_RATE.HIGH;
  if (chars < 20 || ratio > 0.05) return TEXT_ERROR_RATE.MEDIUM;
  return TEXT_ERROR_RATE.LOW;
}

export function requireNonEmptyText(text: string, label = 'text'): string {
  const clean = cleanFlatText(text);
  if (!clean) throw new Error(`${label} is empty after cleaning`);
  return clean;
}
