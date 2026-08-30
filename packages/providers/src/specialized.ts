import {
  BedrockActivationGate,
  type BedrockActivationOptions,
  type BedrockLineage,
  ProviderAdapterError,
} from './bedrock/index.ts'

export interface SpecializedResponse<T> {
  output: T
  provider: 'bedrock'
  service: string
  lineage: BedrockLineage
}

export function createSpecializedAdapter<TRequest, TOutput>(
  service: string,
  transport: ((request: TRequest) => Promise<TOutput>) | undefined,
  options: BedrockActivationOptions
): (request: TRequest) => Promise<SpecializedResponse<TOutput>> {
  const gate = new BedrockActivationGate(options)
  return async (request: TRequest): Promise<SpecializedResponse<TOutput>> => {
    gate.assertActive()
    if (!transport) throw new ProviderAdapterError(`${service} provider transport is unavailable`)
    try {
      const output = await transport(request)
      return {
        output,
        provider: 'bedrock',
        service,
        lineage: extractLineage(request),
      }
    } catch {
      throw new ProviderAdapterError(`Bedrock ${service} provider request failed`)
    }
  }
}

export function extractLineage(request: unknown): BedrockLineage {
  if (typeof request !== 'object' || request === null || !('lineage' in request))
    throw new ProviderAdapterError('provider request lineage is required')
  const lineage = (request as { lineage: unknown }).lineage
  if (typeof lineage !== 'object' || lineage === null)
    throw new ProviderAdapterError('provider request lineage is required')
  return { ...(lineage as BedrockLineage) }
}

export function fakeLineage(request: unknown): BedrockLineage {
  return extractLineage(request)
}
