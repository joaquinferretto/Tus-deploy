import { type BedrockActivationOptions, type BedrockLineage } from '../bedrock/index.ts'
import { createSpecializedAdapter, fakeLineage } from '../specialized.ts'

export interface TextractRequest {
  document: Uint8Array
  mimeType: string
  lineage: BedrockLineage
}

export interface TextractResult {
  text: string
  provider: 'fake' | 'bedrock'
  lineage: BedrockLineage
}

export type TextractTransport = (request: TextractRequest) => Promise<{ text: string }>

export class DeterministicTextractFake {
  async analyze(request: TextractRequest): Promise<TextractResult> {
    if (request.document.byteLength === 0) throw new Error('textract document must not be empty')
    return {
      text: `fake document text: ${request.document.byteLength} bytes`,
      provider: 'fake',
      lineage: fakeLineage(request),
    }
  }
}

export class BedrockTextractAdapter {
  private readonly invoke: (request: TextractRequest) => Promise<{
    output: { text: string }
    provider: 'bedrock'
    service: string
    lineage: BedrockLineage
  }>

  constructor(transport: TextractTransport | undefined, options: BedrockActivationOptions) {
    this.invoke = createSpecializedAdapter('textract', transport, options)
  }

  analyze(request: TextractRequest): Promise<TextractResult> {
    return this.invoke(request).then((response) => ({
      text: response.output.text,
      provider: response.provider,
      lineage: response.lineage,
    }))
  }
}

export { BedrockTextractAdapter as TextractAdapter }
export { DeterministicTextractFake as DeterministicTextract }
