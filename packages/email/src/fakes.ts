import type { EmailMessage, EmailProviderResult } from './domain.js'
import { EmailProviderUnavailableError, type EmailProviderPort } from './ports.js'

export class DeterministicEmailProvider implements EmailProviderPort {
  readonly sent: EmailMessage[] = []
  failNext = 0
  available = true

  async send(message: EmailMessage): Promise<EmailProviderResult> {
    if (!this.available)
      throw new EmailProviderUnavailableError('deterministic email provider outage')
    if (this.failNext > 0) {
      this.failNext -= 1
      throw new EmailProviderUnavailableError('deterministic email provider failure')
    }
    this.sent.push(cloneMessage(message))
    return { providerMessageId: `fake-email-${this.sent.length}` }
  }
}

function cloneMessage(message: EmailMessage): EmailMessage {
  return {
    ...message,
    variables: { ...message.variables },
    rendered: { ...message.rendered },
  }
}

export default { DeterministicEmailProvider }
