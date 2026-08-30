import { type BedrockActivationOptions, type BedrockLineage } from '../bedrock/index.ts'
import { createSpecializedAdapter, fakeLineage } from '../specialized.ts'

export interface TranslateRequest {
  text: string
  sourceLanguage: string
  targetLanguage: string
  lineage: BedrockLineage
}

export interface TranslateResult {
  translatedText: string
  provider: 'fake' | 'bedrock'
  lineage: BedrockLineage
}

export type TranslateTransport = (request: TranslateRequest) => Promise<string>

export class DeterministicTranslateFake {
  async translate(request: TranslateRequest): Promise<TranslateResult> {
    if (!request.text.trim()) throw new Error('translate text is required')
    return {
      translatedText: `[${request.targetLanguage}] ${request.text.trim()}`,
      provider: 'fake',
      lineage: fakeLineage(request),
    }
  }
}

export class BedrockTranslateAdapter {
  private readonly invoke: (request: TranslateRequest) => Promise<{
    output: string
    provider: 'bedrock'
    service: string
    lineage: BedrockLineage
  }>

  constructor(transport: TranslateTransport | undefined, options: BedrockActivationOptions) {
    this.invoke = createSpecializedAdapter('translate', transport, options)
  }

  translate(request: TranslateRequest): Promise<TranslateResult> {
    return this.invoke(request).then((response) => ({
      translatedText: response.output,
      provider: response.provider,
      lineage: response.lineage,
    }))
  }
}

export { BedrockTranslateAdapter as TranslateAdapter }
export { DeterministicTranslateFake as DeterministicTranslate }
