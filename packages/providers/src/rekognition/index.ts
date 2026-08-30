import { type BedrockActivationOptions, type BedrockLineage } from '../bedrock/index.ts'
import { createSpecializedAdapter, fakeLineage } from '../specialized.ts'

export interface RekognitionRequest {
  image: Uint8Array
  mimeType: string
  lineage: BedrockLineage
}

export interface RekognitionLabel {
  name: string
  confidence: number
}

export interface RekognitionResult {
  labels: readonly RekognitionLabel[]
  provider: 'fake' | 'bedrock'
  lineage: BedrockLineage
}

export type RekognitionTransport = (
  request: RekognitionRequest
) => Promise<readonly RekognitionLabel[]>

export class DeterministicRekognitionFake {
  async detectLabels(request: RekognitionRequest): Promise<RekognitionResult> {
    if (request.image.byteLength === 0) throw new Error('rekognition image must not be empty')
    return {
      labels: [{ name: 'fixture-object', confidence: 1 }],
      provider: 'fake',
      lineage: fakeLineage(request),
    }
  }
}

export class BedrockRekognitionAdapter {
  private readonly invoke: (request: RekognitionRequest) => Promise<{
    output: readonly RekognitionLabel[]
    provider: 'bedrock'
    service: string
    lineage: BedrockLineage
  }>

  constructor(transport: RekognitionTransport | undefined, options: BedrockActivationOptions) {
    this.invoke = createSpecializedAdapter('rekognition', transport, options)
  }

  detectLabels(request: RekognitionRequest): Promise<RekognitionResult> {
    return this.invoke(request).then((response) => ({
      labels: response.output,
      provider: response.provider,
      lineage: response.lineage,
    }))
  }
}

export { BedrockRekognitionAdapter as RekognitionAdapter }
export { DeterministicRekognitionFake as DeterministicRekognition }
