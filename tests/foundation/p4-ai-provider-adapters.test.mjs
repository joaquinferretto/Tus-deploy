import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BedrockActivationGate,
  BedrockProviderUnavailableError,
  DeterministicBedrockFake,
} from '../../packages/providers/src/bedrock/index.ts'
import {
  BedrockGuardrailsAdapter,
  DeterministicGuardrailsFake,
} from '../../packages/providers/src/guardrails/index.ts'
import {
  BedrockTranscribeAdapter,
  DeterministicTranscribeFake,
} from '../../packages/providers/src/transcribe/index.ts'
import {
  BedrockPollyAdapter,
  DeterministicPollyFake,
} from '../../packages/providers/src/polly/index.ts'
import {
  BedrockTextractAdapter,
  DeterministicTextractFake,
} from '../../packages/providers/src/textract/index.ts'
import {
  BedrockRekognitionAdapter,
  DeterministicRekognitionFake,
} from '../../packages/providers/src/rekognition/index.ts'
import {
  BedrockTranslateAdapter,
  DeterministicTranslateFake,
} from '../../packages/providers/src/translate/index.ts'

const lineage = {
  tenantId: 'tenant-a',
  actorId: 'actor-a',
  correlationId: 'corr-a',
  rootMessageId: 'message-a',
  source: 'p4.15-test',
}

const enabled = {
  credits: true,
  credentials: true,
  region: true,
  quota: true,
  ownerApproval: true,
  liveConformance: true,
}

const gated = (missing) => ({ ...enabled, [missing]: false })

test('Bedrock activation requires credits, credentials, region, quota, owner approval, and conformance', () => {
  for (const missing of [
    'credits',
    'credentials',
    'region',
    'quota',
    'ownerApproval',
    'liveConformance',
  ]) {
    const gate = new BedrockActivationGate({
      configRef: 'secret-store:bedrock',
      region: 'us-east-1',
      requirements: gated(missing),
    })
    assert.equal(gate.active, false)
    assert.equal(gate.missingRequirements.includes(missing), true)
    assert.throws(() => gate.assertActive(), BedrockProviderUnavailableError)
  }

  const noRegion = new BedrockActivationGate({
    configRef: 'secret-store:bedrock',
    region: '',
    requirements: enabled,
  })
  assert.equal(noRegion.missingRequirements.includes('region'), true)
})

test('deterministic Bedrock and specialized fakes are repeatable and provider-free', async () => {
  const fake = new DeterministicBedrockFake()
  assert.deepEqual(
    await fake.invoke({
      service: 'bedrock',
      operation: 'converse',
      payload: { prompt: 'safe' },
      lineage,
    }),
    await fake.invoke({
      service: 'bedrock',
      operation: 'converse',
      payload: { prompt: 'safe' },
      lineage,
    })
  )
  assert.equal(
    (await fake.invoke({ service: 'bedrock', operation: 'converse', payload: {}, lineage }))
      .provider,
    'fake'
  )

  assert.equal(
    (await new DeterministicGuardrailsFake().evaluate({ content: 'safe', lineage })).decision,
    'allow'
  )
  assert.equal(
    (
      await new DeterministicTranscribeFake().transcribe({
        audio: new Uint8Array([1, 2]),
        mimeType: 'audio/wav',
        model: 'fake',
        lineage,
      })
    ).provider,
    'fake'
  )
  assert.equal(
    (
      await new DeterministicPollyFake().synthesize({
        text: 'hello',
        voice: 'neutral',
        format: 'wav',
        model: 'fake',
        lineage,
      })
    ).audio.byteLength > 0,
    true
  )
  assert.equal(
    (
      await new DeterministicTextractFake().analyze({
        document: new Uint8Array([1]),
        mimeType: 'application/pdf',
        lineage,
      })
    ).provider,
    'fake'
  )
  assert.equal(
    (
      await new DeterministicRekognitionFake().detectLabels({
        image: new Uint8Array([1]),
        mimeType: 'image/png',
        lineage,
      })
    ).labels.length > 0,
    true
  )
  assert.equal(
    (
      await new DeterministicTranslateFake().translate({
        text: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        lineage,
      })
    ).translatedText,
    '[es] hello'
  )
})

test('specialized Bedrock adapters are injected and deny missing activation without live I/O', async () => {
  const options = { configRef: 'secret-store:bedrock', region: 'us-east-1', requirements: enabled }
  const transcribe = new BedrockTranscribeAdapter(async () => 'provider transcript', options)
  assert.equal(
    (
      await transcribe.transcribe({
        audio: new Uint8Array([1]),
        mimeType: 'audio/wav',
        model: 'model',
        lineage,
      })
    ).provider,
    'bedrock'
  )

  const polly = new BedrockPollyAdapter(async () => new Uint8Array([7]), options)
  assert.equal(
    (
      await polly.synthesize({
        text: 'hello',
        voice: 'neutral',
        format: 'wav',
        model: 'model',
        lineage,
      })
    ).provider,
    'bedrock'
  )

  const textract = new BedrockTextractAdapter(async () => ({ text: 'document text' }), options)
  assert.equal(
    (
      await textract.analyze({
        document: new Uint8Array([1]),
        mimeType: 'application/pdf',
        lineage,
      })
    ).text,
    'document text'
  )

  const rekognition = new BedrockRekognitionAdapter(
    async () => [{ name: 'safe', confidence: 0.99 }],
    options
  )
  assert.equal(
    (await rekognition.detectLabels({ image: new Uint8Array([1]), mimeType: 'image/png', lineage }))
      .labels[0].name,
    'safe'
  )

  const translate = new BedrockTranslateAdapter(async () => 'hola', options)
  assert.equal(
    (
      await translate.translate({
        text: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        lineage,
      })
    ).translatedText,
    'hola'
  )

  const guardrails = new BedrockGuardrailsAdapter(
    async () => ({ decision: 'allow', category: 'safe' }),
    options
  )
  assert.equal((await guardrails.evaluate({ content: 'safe', lineage })).decision, 'allow')

  const gatedAdapter = new BedrockTranslateAdapter(async () => 'unused', {
    ...options,
    requirements: gated('credits'),
  })
  await assert.rejects(
    () =>
      gatedAdapter.translate({
        text: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        lineage,
      }),
    BedrockProviderUnavailableError
  )
})

test('specialized provider failures are sanitized', async () => {
  const options = { configRef: 'secret-store:bedrock', region: 'us-east-1', requirements: enabled }
  const adapter = new BedrockTranslateAdapter(async () => {
    throw new Error('token=hidden prompt=private')
  }, options)
  await assert.rejects(
    () => adapter.translate({ text: 'hello', sourceLanguage: 'en', targetLanguage: 'es', lineage }),
    (error) =>
      error.name === 'ProviderAdapterError' &&
      error.message === 'Bedrock translate provider request failed'
  )
})
