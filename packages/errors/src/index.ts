const SECRET_PATTERNS = [
  /(authorization\s*:\s*bearer\s+)[^\s,;]+/gi,
  /((?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,
]

export interface RedactedError {
  name: string
  message: string
  code?: string
  retryable: boolean
}

export function redactText(value: string): string {
  return SECRET_PATTERNS.reduce((result, pattern) => result.replace(pattern, '$1[REDACTED]'), value)
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
