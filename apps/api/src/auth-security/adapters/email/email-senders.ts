import type { EmailSender, SecurityNotificationKind } from '../../ports/security.js'

// Email delivery for authentication. The provider is chosen by configuration
// (EMAIL_PROVIDER=resend + RESEND_API_KEY + EMAIL_FROM + TUS_WEB_BASE_URL); without it the sender
// is "unavailable": auth keeps working, delivery fails and is audited by the caller.

export class EmailDeliveryError extends Error {
  constructor(readonly reason: string) {
    super(`email delivery failed: ${reason}`)
    this.name = 'EmailDeliveryError'
  }
}

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

// Shared look of every TUS email (also used by the notices of other modules).
export function emailLayout(title: string, paragraphs: string[], action?: { label: string; url: string }): { text: string; html: string } {
  return layout(title, paragraphs, action)
}

function layout(title: string, paragraphs: string[], action?: { label: string; url: string }): { text: string; html: string } {
  const text = [title, '', ...paragraphs, ...(action ? ['', `${action.label}: ${action.url}`] : []), '', 'TUS · tusservicios.shop'].join('\n')
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#1f1d1a;max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
${paragraphs.map((p) => `<p style="line-height:1.5">${escapeHtml(p)}</p>`).join('\n')}
${action ? `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#1f1d1a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">${escapeHtml(action.label)}</a></p><p style="font-size:12px;color:#6b6760">Si el botón no funciona, copiá este enlace: ${escapeHtml(action.url)}</p>` : ''}
<p style="font-size:12px;color:#6b6760">TUS · tusservicios.shop</p></body></html>`
  return { text, html }
}

const NOTIFICATION_TEXT: Record<SecurityNotificationKind, { subject: string; body: string }> = {
  password_changed: { subject: 'Cambiaste tu contraseña de TUS', body: 'La contraseña de tu cuenta se cambió y cerramos las sesiones abiertas.' },
  password_reset: { subject: 'Restableciste tu contraseña de TUS', body: 'La contraseña de tu cuenta se restableció con un enlace de recuperación y cerramos las sesiones abiertas.' },
  mfa_enabled: { subject: 'Activaste el segundo factor en TUS', body: 'Tu cuenta ahora pide un código de la app autenticadora para administrar la plataforma.' },
  mfa_disabled: { subject: 'Desactivaste el segundo factor en TUS', body: 'Tu cuenta ya no tiene segundo factor y perdió el acceso de administración hasta volver a configurarlo.' },
  recovery_codes_regenerated: { subject: 'Generaste códigos de recuperación nuevos en TUS', body: 'Los códigos de recuperación anteriores ya no sirven.' },
  registration_attempt: { subject: 'Alguien intentó registrarse con tu email en TUS', body: 'Tu email ya tiene una cuenta en TUS. Si fuiste vos, iniciá sesión o usá "Olvidé mi contraseña".' },
}

// Builds the messages; the transport only delivers them.
export class TemplatedEmailSender implements EmailSender {
  constructor(
    private readonly transport: EmailTransport,
    private readonly webBaseUrl: string
  ) {}

  private link(path: string, token: string): string {
    return `${this.webBaseUrl.replace(/\/+$/u, '')}${path}?token=${encodeURIComponent(token)}`
  }

  async sendVerification(input: { email: string; token: string }): Promise<void> {
    const url = this.link('/verificar-email', input.token)
    await this.transport.send({
      to: input.email,
      subject: 'Confirmá tu email en TUS',
      ...layout('Confirmá tu email', ['Para activar tu cuenta de TUS, confirmá que este email es tuyo. El enlace vence en 24 horas y sirve una sola vez.', 'Si no creaste una cuenta, ignorá este mensaje.'], { label: 'Confirmar email', url }),
    })
  }

  async sendRecovery(input: { email: string; token: string }): Promise<void> {
    const url = this.link('/restablecer-contrasena', input.token)
    await this.transport.send({
      to: input.email,
      subject: 'Restablecé tu contraseña de TUS',
      ...layout('Restablecé tu contraseña', ['Recibimos un pedido para restablecer la contraseña de tu cuenta. El enlace vence en 1 hora y sirve una sola vez.', 'Si no lo pediste, ignorá este mensaje: tu contraseña no cambia.'], { label: 'Elegir una contraseña nueva', url }),
    })
  }

  async sendSecurityNotification(input: { email: string; kind: SecurityNotificationKind }): Promise<void> {
    const content = NOTIFICATION_TEXT[input.kind]
    await this.transport.send({
      to: input.email,
      subject: content.subject,
      ...layout(content.subject, [content.body, 'Si no fuiste vos, restablecé tu contraseña de inmediato y escribinos a soporte.']),
    })
  }
}

// Resend (https://resend.com) over its HTTPS API: no SDK, no extra dependency.
export class ResendEmailTransport implements EmailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 8000
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch(() => null)
    if (!response) throw new EmailDeliveryError('provider_unreachable')
    if (!response.ok) throw new EmailDeliveryError(`provider_status_${response.status}`)
  }
}

export class UnavailableEmailTransport implements EmailTransport {
  async send(): Promise<void> {
    throw new EmailDeliveryError('provider_not_configured')
  }
}

export interface EmailSettings {
  provider: 'resend' | 'unavailable'
  sender: EmailSender
}

// The configured transport, or null when email delivery is not configured. Never logs the key.
export function createEmailTransportFromEnv(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): EmailTransport | null {
  const apiKey = env['RESEND_API_KEY']?.trim()
  const from = env['EMAIL_FROM']?.trim()
  return env['EMAIL_PROVIDER']?.trim() === 'resend' && apiKey && from ? new ResendEmailTransport(apiKey, from, fetchImpl) : null
}

// Production selection. Never logs the key.
export function createEmailSenderFromEnv(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): EmailSettings {
  const webBaseUrl = env['TUS_WEB_BASE_URL']?.trim() || 'https://tusservicios.shop'
  const transport = createEmailTransportFromEnv(env, fetchImpl)
  if (transport) {
    return { provider: 'resend', sender: new TemplatedEmailSender(transport, webBaseUrl) }
  }
  return { provider: 'unavailable', sender: new TemplatedEmailSender(new UnavailableEmailTransport(), webBaseUrl) }
}
