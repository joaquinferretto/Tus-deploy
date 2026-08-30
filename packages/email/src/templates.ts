import { EMAIL_TEMPLATE, type EmailTemplate, type RenderedEmail } from './domain.js'

type TemplateVariables = Readonly<Record<string, string>>

export function renderEmailTemplate(
  template: EmailTemplate,
  variables: TemplateVariables
): RenderedEmail {
  switch (template) {
    case EMAIL_TEMPLATE.VERIFICATION:
      return renderAction('Verify your email', variables, 'Verify email')
    case EMAIL_TEMPLATE.RECOVERY:
      return renderAction('Reset your password', variables, 'Reset password')
    case EMAIL_TEMPLATE.INVITATION:
      return renderAction('You are invited', variables, 'Accept invitation')
    case EMAIL_TEMPLATE.NOTIFICATION: {
      const title = required(variables, 'title')
      const body = required(variables, 'body')
      return { subject: title, text: body, html: `<p>${escapeHtml(body)}</p>` }
    }
  }
}

function renderAction(
  subject: string,
  variables: TemplateVariables,
  action: string
): RenderedEmail {
  const url = required(variables, 'actionUrl')
  const text = `${action}: ${url}`
  return {
    subject,
    text,
    html: `<p>${escapeHtml(action)}: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
  }
}

function required(variables: TemplateVariables, name: string): string {
  const value = variables[name]
  if (!value?.trim()) throw new Error(`email template variable is required: ${name}`)
  return value
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>\"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character
  )
}

export default { renderEmailTemplate }
