import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AUDIO_ACTIVATION,
  AudioContractError,
  DeterministicAudioFake,
  GroqProviderUnavailableError,
  GroqSpeechAdapter,
} from '../../packages/providers/src/groq/index.ts'

const lineage = {
  tenantId: 'tenant-a',
  actorId: 'actor-a',
  correlationId: 'corr-a',
  rootMessageId: 'message-a',
  source: 'p4.7-test',
}

const retention = {
  expiresAt: 160,
  encrypted: true,
  keyRef: 'local-audio-key',
  algorithm: 'deterministic-local-envelope.v1',
}

test('deterministic TypeScript audio fake preserves typed lineage and retention', async () => {
  const fake = new DeterministicAudioFake({ now: 100, retention })
  const stt = await fake.transcribe({
    audio: new TextEncoder().encode('wav-data'),
    mimeType: 'audio/wav',
    model: 'fake-stt.v1',
    lineage,
  })
  const tts = await fake.synthesize({
    text: 'hello',
    responseFormat: 'wav',
    voice: 'neutral',
    model: 'fake-tts.v1',
    lineage,
  })

  assert.equal(stt.text, 'fake transcript: 8 bytes audio/wav')
  assert.equal(stt.lineage.tenantId, 'tenant-a')
  assert.deepEqual(tts.retention, retention)
  assert.equal(tts.usage.outputBytes, tts.audio.byteLength)
})

test('Groq adapter is activation-gated, injected, and sanitizes provider failures', async () => {
  const adapter = new GroqSpeechAdapter(
    {
      stt: async () => 'groq transcript',
      tts: async () => new TextEncoder().encode('groq-audio'),
    },
    { activation: AUDIO_ACTIVATION.ENABLED, configRef: 'secret-store:groq' }
  )

  assert.equal(
    (
      await adapter.transcribe({
        audio: new Uint8Array([1]),
        mimeType: 'audio/wav',
        model: 'whisper',
        lineage,
      })
    ).provider,
    'groq'
  )
  assert.equal(
    (
      await adapter.synthesize({
        text: 'hello',
        responseFormat: 'wav',
        voice: 'neutral',
        model: 'playai',
        lineage,
      })
    ).provider,
    'groq'
  )

  const gated = new GroqSpeechAdapter(
    { stt: async () => 'unused', tts: async () => new Uint8Array([1]) },
    {
      activation: AUDIO_ACTIVATION.DISABLED,
      configRef: 'secret-store:groq',
    }
  )
  await assert.rejects(
    () =>
      gated.transcribe({
        audio: new Uint8Array([1]),
        mimeType: 'audio/wav',
        model: 'whisper',
        lineage,
      }),
    GroqProviderUnavailableError
  )

  const failing = new GroqSpeechAdapter(
    {
      stt: async () => {
        throw new Error('token=hidden audio=private')
      },
      tts: async () => new Uint8Array([1]),
    },
    { activation: AUDIO_ACTIVATION.ENABLED, configRef: 'secret-store:groq' }
  )
  await assert.rejects(
    () =>
      failing.transcribe({
        audio: new Uint8Array([1]),
        mimeType: 'audio/wav',
        model: 'whisper',
        lineage,
      }),
    (error) =>
      error.name === 'AudioProviderError' && error.message === 'Groq STT provider request failed'
  )
})

test('TypeScript audio boundary rejects empty media without echoing payload', async () => {
  const fake = new DeterministicAudioFake({ retention })
  await assert.rejects(
    () =>
      fake.transcribe({ audio: new Uint8Array(), mimeType: 'audio/wav', model: 'fake', lineage }),
    AudioContractError
  )
})
