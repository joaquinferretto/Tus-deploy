import { describe, expect, it } from 'vitest';
import { ProviderOrchestrator } from '../orchestrator';

describe('ProviderOrchestrator', () => {
  it('surfaces terminal attempt metadata when every key fails', async () => {
    const fetcher = async () => new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 }) as Response;
    const orchestrator = new ProviderOrchestrator({ apiKeys: ['one', 'two'], sttModel: 'whisper-large-v3-turbo', chatModel: 'llama-3.3-70b-versatile', ttsModel: 'canopylabs/orpheus-v1-english', ttsVoice: 'hannah', ttsResponseFormat: 'wav' }, fetcher as typeof fetch);
    await expect(orchestrator.chat({ sessionId: 's1', messages: [{ role: 'user', content: 'hello' }] })).rejects.toMatchObject({ code: 'AI_PROVIDER_CHAIN_FAILED' });
  });
});
