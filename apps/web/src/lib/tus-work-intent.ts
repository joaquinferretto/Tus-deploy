import { createStableIdempotencyKey } from './tus-client'

export type WorkIntent = { idempotencyKey: string; requestHash: string }

export async function createWorkIntent(
  action: string,
  payload: Record<string, unknown>
): Promise<WorkIntent> {
  const intentId = createIntentId()
  const requestHash = await hashWorkRequest(action, payload)
  return {
    idempotencyKey: createStableIdempotencyKey('work', intentId),
    requestHash,
  }
}

function createIntentId(): string {
  if (!globalThis.crypto?.randomUUID)
    throw new Error('Secure browser cryptography is required to submit work actions.')
  return globalThis.crypto.randomUUID()
}

async function hashWorkRequest(action: string, payload: Record<string, unknown>): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error('Secure browser cryptography is required to submit work actions.')
  const input = new TextEncoder().encode(JSON.stringify({ action, payload }))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
