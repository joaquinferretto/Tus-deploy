import type { EmailMessage, EmailProviderResult } from './domain.js'

export const EMAIL_ACTIVATION = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
} as const

export type EmailActivation = (typeof EMAIL_ACTIVATION)[keyof typeof EMAIL_ACTIVATION]

export interface EmailProviderPort {
  send(message: EmailMessage): Promise<EmailProviderResult>
}

export interface SesTransportPort {
  send(message: EmailMessage): Promise<EmailProviderResult>
}

export interface EmailActivationOptions {
  activation: EmailActivation
  configRef: string
}

export class EmailProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_UNAVAILABLE'

  constructor(reason = 'email provider is unavailable') {
    super(reason)
    this.name = 'EmailProviderUnavailableError'
  }
}

export function assertEmailConfig(options: EmailActivationOptions): void {
  if (!options.configRef.trim()) throw new Error('email provider config reference is required')
}

export default { EMAIL_ACTIVATION, EmailProviderUnavailableError, assertEmailConfig }
