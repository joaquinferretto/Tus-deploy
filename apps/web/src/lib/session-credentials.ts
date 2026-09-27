// The Web never holds the session token: the API keeps it in an HttpOnly cookie (JavaScript,
// and therefore an XSS, cannot read it) and the Web session only carries this marker.
// Every API call sends the cookie (`credentials: 'include'`); a real Bearer token is only sent
// when one exists (sessions created before the cookie migration, until they expire).
export const COOKIE_SESSION_MARKER = 'cookie-session'

export function authorizationHeader(accessToken: string | undefined): Record<string, string> {
  return accessToken && accessToken !== COOKIE_SESSION_MARKER ? { Authorization: `Bearer ${accessToken}` } : {}
}

// fetch that always sends the HttpOnly session cookie to the API.
export const fetchWithSession: typeof fetch = (input, init) => fetch(input, { ...init, credentials: 'include' })
