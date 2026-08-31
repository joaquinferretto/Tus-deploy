export interface WebApiUrlInput {
  canonicalUrl?: string
  legacyUrl?: string
  nodeEnv?: string
  localDefault?: string
}

export function resolveWebApiBaseUrl({
  canonicalUrl,
  legacyUrl,
  nodeEnv,
  localDefault,
}: WebApiUrlInput = {}): string {
  const canonical = trimConfiguredUrl(canonicalUrl)
  const legacy = trimConfiguredUrl(legacyUrl)

  if (canonical !== undefined && legacy !== undefined && normalizeUrl(canonical) !== normalizeUrl(legacy)) {
    throw new Error('NEXT_PUBLIC_API_URL and API_BASE_URL disagree; choose the canonical web API URL.')
  }

  const configured = canonical ?? legacy
  if (configured !== undefined) return normalizeUrl(configured)
  if (nodeEnv === 'production') {
    throw new Error('NEXT_PUBLIC_API_URL is required for the production web bundle.')
  }
  if (localDefault === undefined) {
    throw new Error('NEXT_PUBLIC_API_URL is required outside production; configure the local wrapper explicitly.')
  }
  return normalizeUrl(localDefault)
}

function trimConfiguredUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

function normalizeUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('The web API URL must be an absolute HTTP or HTTPS URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The web API URL must use HTTP or HTTPS.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('The web API URL must not contain credentials, query parameters, or fragments.')
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/u, '')}`
}
