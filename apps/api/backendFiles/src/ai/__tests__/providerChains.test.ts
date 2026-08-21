import { describe, expect, it } from 'vitest';
import { CHAT_PROVIDER_CHAIN, STT_PROVIDER_CHAIN } from '../providerChains';

describe('provider chains', () => {
  it('uses only two Groq steps in fallback order', () => {
    expect(STT_PROVIDER_CHAIN.map((s) => s.id)).toEqual(['groq1', 'groq2']);
    expect(CHAT_PROVIDER_CHAIN.map((s) => s.id)).toEqual(['groq1', 'groq2']);
    expect([...STT_PROVIDER_CHAIN, ...CHAT_PROVIDER_CHAIN].every((s) => s.provider === 'groq')).toBe(true);
  });
});
