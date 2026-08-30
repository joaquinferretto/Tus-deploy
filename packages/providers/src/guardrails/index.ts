import {
  type BedrockActivationOptions,
  type BedrockLineage,
  ProviderAdapterError,
} from '../bedrock/index.ts'
import { createSpecializedAdapter, fakeLineage } from '../specialized.ts'

export interface GuardrailsRequest {
  content: string
  lineage: BedrockLineage
}

export interface GuardrailsResult {
  decision: 'allow' | 'deny' | 'escalate'
  category: string
}

export type GuardrailsTransport = (request: GuardrailsRequest) => Promise<GuardrailsResult>

export class DeterministicGuardrailsFake {
  async evaluate(
    request: GuardrailsRequest
  ): Promise<GuardrailsResult & { provider: 'fake'; lineage: BedrockLineage }> {
    if (!request.content.trim()) throw new ProviderAdapterError('guardrails content is required')
    const normalized = request.content.toLowerCase()
    const decision =
      normalized.includes('jailbreak') || normalized.includes('ignore previous') ? 'deny' : 'allow'
    return {
      decision,
      category: decision === 'deny' ? 'prompt_injection' : 'safe',
      provider: 'fake',
      lineage: fakeLineage(request),
    }
  }
}

export class BedrockGuardrailsAdapter {
  private readonly invoke: (request: GuardrailsRequest) => Promise<{
    output: GuardrailsResult
    provider: 'bedrock'
    service: string
    lineage: BedrockLineage
  }>

  constructor(transport: GuardrailsTransport | undefined, options: BedrockActivationOptions) {
    this.invoke = createSpecializedAdapter('guardrails', transport, options)
  }

  evaluate(
    request: GuardrailsRequest
  ): Promise<GuardrailsResult & { provider: 'bedrock'; lineage: BedrockLineage }> {
    return this.invoke(request).then((response) => ({
      ...response.output,
      provider: response.provider,
      lineage: response.lineage,
    }))
  }
}
