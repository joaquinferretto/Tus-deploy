import type { EmailMessage, EmailProviderResult } from './domain.js'
import {
  assertEmailConfig,
  EmailProviderUnavailableError,
  EMAIL_ACTIVATION,
  type EmailActivationOptions,
  type EmailProviderPort,
  type SesTransportPort,
} from './ports.js'

export class SesEmailProvider implements EmailProviderPort {
  readonly configRef: string

  constructor(
    private readonly transport: SesTransportPort,
    private readonly options: EmailActivationOptions
  ) {
    assertEmailConfig(options)
    this.configRef = options.configRef
  }

  async send(message: EmailMessage): Promise<EmailProviderResult> {
    if (this.options.activation !== EMAIL_ACTIVATION.ENABLED)
      throw new EmailProviderUnavailableError('SES activation gate is disabled')
    return this.transport.send(message)
  }
}

export default { SesEmailProvider }
