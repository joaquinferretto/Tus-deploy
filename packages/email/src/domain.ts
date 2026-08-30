export const EMAIL_CONTRACT_VERSION = '1.0.0' as const

export const EMAIL_STATUS = {
  QUEUED: 'queued',
  SENDING: 'sending',
  SENT: 'sent',
  RETRYABLE: 'retryable',
  FAILED: 'failed',
  SUPPRESSED: 'suppressed',
} as const

export type EmailStatus = (typeof EMAIL_STATUS)[keyof typeof EMAIL_STATUS]

export const EMAIL_TEMPLATE = {
  VERIFICATION: 'verification',
  RECOVERY: 'recovery',
  INVITATION: 'invitation',
  NOTIFICATION: 'notification',
} as const

export type EmailTemplate = (typeof EMAIL_TEMPLATE)[keyof typeof EMAIL_TEMPLATE]

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

export interface EmailMessage {
  emailId: string
  tenantId: string
  recipient: string
  template: EmailTemplate
  variables: Readonly<Record<string, string>>
  rendered: RenderedEmail
}

export interface EmailProviderResult {
  providerMessageId: string
}

export function validEmailMessage(message: EmailMessage): boolean {
  return Boolean(
    message.emailId.trim() &&
    message.tenantId.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.recipient) &&
    message.rendered.subject.trim() &&
    message.rendered.text.trim()
  )
}

export default { EMAIL_CONTRACT_VERSION, EMAIL_STATUS, EMAIL_TEMPLATE, validEmailMessage }
