import { type BedrockActivationOptions, type BedrockLineage } from '../bedrock/index.ts'
import { createSpecializedAdapter, fakeLineage } from '../specialized.ts'

export interface PollyRequest {
  text: string
  voice: string
  format: 'wav' | 'mp3'
  model: string
  lineage: BedrockLineage
}

export interface PollyResult {
  audio: Uint8Array
  provider: 'fake' | 'bedrock'
  lineage: BedrockLineage
}

export type PollyTransport = (request: PollyRequest) => Promise<Uint8Array>

export class DeterministicPollyFake {
  async synthesize(request: PollyRequest): Promise<PollyResult> {
    if (!request.text.trim()) throw new Error('polly text is required')
    const audio = new TextEncoder().encode(`FAKE-POLLY-V1:${request.text.trim()}`)
    return { audio, provider: 'fake', lineage: fakeLineage(request) }
  }
}

export class BedrockPollyAdapter {
  private readonly invoke: (request: PollyRequest) => Promise<{
    output: Uint8Array
    provider: 'bedrock'
    service: string
    lineage: BedrockLineage
  }>

  constructor(transport: PollyTransport | undefined, options: BedrockActivationOptions) {
    this.invoke = createSpecializedAdapter('polly', transport, options)
  }

  synthesize(request: PollyRequest): Promise<PollyResult> {
    return this.invoke(request).then((response) => ({
      audio: response.output,
      provider: response.provider,
      lineage: response.lineage,
    }))
  }
}

export { BedrockPollyAdapter as PollyAdapter }
export { DeterministicPollyFake as DeterministicPolly }
