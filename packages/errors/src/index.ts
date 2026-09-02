const SECRET_PATTERNS = [
  /(authorization\s*:\s*bearer\s+)[^\s,;]+/gi,
  /((?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,
]
const DATABASE_URL_PATTERN = /\b(?:postgres(?:ql)?|mongodb(?:\+srv)?|redis):\/\/[^\s,;]+/giu
const INTERNAL_PATH_PATTERN = /(?:[A-Za-z]:\\[^\s,;]+|\/(?:Users|home|workspace|app|src|var)\/[^\s,;]+)/gu

export interface RedactedError {
  name: string
  message: string
  code?: string
  retryable: boolean
}

export function redactText(value: string): string {
  const withSecrets = SECRET_PATTERNS.reduce((result, pattern) => result.replace(pattern, '$1[REDACTED]'), value)
  const withoutUrls = withSecrets.replace(DATABASE_URL_PATTERN, '[REDACTED_URL]')
  return withoutUrls.replace(INTERNAL_PATH_PATTERN, '[REDACTED_PATH]')
}

export function redactError(error: unknown, code?: string): RedactedError {
  const source = error instanceof Error ? error : new Error(String(error))
  const message = redactText(source.message)
  return {
    name: source.name,
    message,
    ...(code ? { code } : {}),
    retryable: false,
  }
}
