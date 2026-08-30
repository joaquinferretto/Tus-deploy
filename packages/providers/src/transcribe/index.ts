import { type BedrockActivationOptions, type BedrockLineage } from '../bedrock/index.ts'
import { createSpecializedAdapter, fakeLineage } from '../specialized.ts'

export interface TranscribeRequest {
  audio: Uint8Array
  mimeType: string
  model: string
  lineage: BedrockLineage
}

export interface TranscribeResult {
  text: string
  provider: 'fake' | 'bedrock'
  lineage: BedrockLineage
}

export type TranscribeTransport = (request: TranscribeRequest) => Promise<string>

export class DeterministicTranscribeFake {
  async transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
    if (request.audio.byteLength === 0) throw new Error('transcribe audio must not be empty')
    return {
      text: `fake transcript: ${request.audio.byteLength} bytes ${request.mimeType}`,
      provider: 'fake',
      lineage: fakeLineage(request),
    }
  }
}

export class BedrockTranscribeAdapter {
  private readonly invoke: (request: TranscribeRequest) => Promise<{
    output: string
    provider: 'bedrock'
    service: string
    lineage: BedrockLineage
  }>

  constructor(transport: TranscribeTransport | undefined, options: BedrockActivationOptions) {
    this.invoke = createSpecializedAdapter('transcribe', transport, options)
  }

  transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
    return this.invoke(request).then((response) => ({
      text: response.output,
      provider: response.provider,
      lineage: response.lineage,
    }))
  }
}

export { BedrockTranscribeAdapter as TranscribeAdapter }
export { DeterministicTranscribeFake as DeterministicTranscribe }
