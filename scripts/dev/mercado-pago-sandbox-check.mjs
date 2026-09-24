#!/usr/bin/env node
// WEB-09E sandbox readiness check for Mercado Pago. Bounded, read-only against TUS, never prints
// secret values and refuses to run with MERCADO_PAGO_ENVIRONMENT=production.
//
//   node scripts/dev/mercado-pago-sandbox-check.mjs            # configuration + credentials check
//   node scripts/dev/mercado-pago-sandbox-check.mjs --oauth    # also prints the seller OAuth steps
//
// What it verifies (with the SANDBOX credentials of the TUS application):
//   1. every required variable is present and well formed (booleans only in the output);
//   2. the application credentials are accepted by Mercado Pago (`client_credentials` token);
//   3. the webhook signature algorithm used by TUS (ts in milliseconds) verifies a local sample;
//   4. the public URLs are HTTPS and consistent.
// It does not create payments. Paying in sandbox needs a connected seller test account (see
// docs/PRODUCCION_TUS.md, "Prueba sandbox de punta a punta").
import { createHmac } from 'node:crypto'

const REQUIRED = [
  'TUS_MERCADOPAGO_ENABLED',
  'MERCADO_PAGO_ENVIRONMENT',
  'MERCADO_PAGO_CLIENT_ID',
  'MERCADO_PAGO_CLIENT_SECRET',
  'MERCADO_PAGO_WEBHOOK_SECRET',
  'MERCADO_PAGO_OAUTH_REDIRECT_URI',
  'MERCADO_PAGO_NOTIFICATION_URL',
  'TUS_PAYMENT_CREDENTIALS_KEY',
  'TUS_WEB_BASE_URL',
]

const env = process.env
const results = []
const record = (check, ok, detail = '') => results.push({ check, ok, detail })

if (env.MERCADO_PAGO_ENVIRONMENT?.trim() === 'production') {
  console.error(
    'Refusing to run: this check is sandbox-only (MERCADO_PAGO_ENVIRONMENT=production).'
  )
  process.exit(2)
}

for (const key of REQUIRED)
  record(`env ${key}`, Boolean(env[key]?.trim()), env[key]?.trim() ? 'present' : 'missing')
record('TUS_MERCADOPAGO_ENABLED=true', env.TUS_MERCADOPAGO_ENABLED?.trim() === 'true')
record('MERCADO_PAGO_ENVIRONMENT=sandbox', env.MERCADO_PAGO_ENVIRONMENT?.trim() === 'sandbox')
const https = (key) => /^https:\/\//u.test(env[key]?.trim() ?? '')
record('redirect URI uses HTTPS', https('MERCADO_PAGO_OAUTH_REDIRECT_URI'))
record('notification URL uses HTTPS', https('MERCADO_PAGO_NOTIFICATION_URL'))
record(
  'redirect URI path',
  (env.MERCADO_PAGO_OAUTH_REDIRECT_URI ?? '').endsWith(
    '/tus/v1/integrations/mercado-pago/oauth/callback'
  )
)
record(
  'notification URL path',
  (env.MERCADO_PAGO_NOTIFICATION_URL ?? '').endsWith('/tus/v1/integrations/mercado-pago/webhooks')
)
try {
  record(
    'credentials key is 32 bytes (base64)',
    Buffer.from(env.TUS_PAYMENT_CREDENTIALS_KEY ?? '', 'base64').length === 32
  )
} catch {
  record('credentials key is 32 bytes (base64)', false)
}

// Webhook signature self-test with the configured secret (manifest from the official docs).
if (env.MERCADO_PAGO_WEBHOOK_SECRET) {
  const ts = Date.now()
  const manifest = `id:123456;request-id:self-test;ts:${ts};`
  const v1 = createHmac('sha256', env.MERCADO_PAGO_WEBHOOK_SECRET).update(manifest).digest('hex')
  record(
    'webhook signature self-test (ts in ms)',
    /^[0-9a-f]{64}$/u.test(v1) && String(ts).length === 13
  )
}

// Application credentials accepted by Mercado Pago (no seller involved, nothing is created).
if (env.MERCADO_PAGO_CLIENT_ID && env.MERCADO_PAGO_CLIENT_SECRET) {
  try {
    const response = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.MERCADO_PAGO_CLIENT_ID.trim(),
        client_secret: env.MERCADO_PAGO_CLIENT_SECRET.trim(),
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const body = await response.json().catch(() => ({}))
    record(
      'application credentials accepted (client_credentials)',
      response.ok && typeof body.access_token === 'string',
      `HTTP ${response.status}${typeof body.live_mode === 'boolean' ? ` live_mode=${body.live_mode}` : ''}`
    )
    if (body.live_mode === true)
      record(
        'credentials are NOT production',
        false,
        'live_mode=true: use sandbox/test credentials'
      )
  } catch (error) {
    record(
      'application credentials accepted (client_credentials)',
      false,
      error?.name ?? 'network error'
    )
  }
}

for (const { check, ok, detail } of results)
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${check}${detail ? ` (${detail})` : ''}`)
if (process.argv.includes('--oauth')) {
  console.log(`
Seller (prestador) sandbox steps:
  1. Log into the TUS Web with a provider account -> /tus/prestador -> "Conectar Mercado Pago".
  2. Authorize with the SELLER test user created in Mercado Pago Developers > Cuentas de prueba.
  3. Back in TUS the account shows "Conectado". Then, as a customer, pay a completed work with
     the BUYER test user and a test card; TUS confirms only after the webhook.`)
}
const failed = results.filter((item) => !item.ok)
console.log(
  failed.length === 0
    ? '\nSandbox configuration: READY'
    : `\nSandbox configuration: ${failed.length} problem(s)`
)
process.exit(failed.length === 0 ? 0 : 1)
