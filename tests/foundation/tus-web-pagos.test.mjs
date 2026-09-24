import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const output = execFileSync(
    process.execPath,
    [tsxCli, '--eval', `(async () => {\n${source}\n})()`],
    {
      cwd: root,
      encoding: 'utf8',
    }
  )
  return JSON.parse(output.trim())
}

test('WEB-09D Web client reads the server preview and never sends an amount', () => {
  const result = runTypeScriptScenario(`
    const { createTusWebClient } = (await import('./apps/web/src/lib/tus-client.ts')).default
    const calls = []
    const client = createTusWebClient({ request: async (input) => { calls.push(input); return {} } })
    const context = { tenantId: 'customer-tenant', actorId: 'customer-user', correlationId: 'corr', accessToken: 'token' }
    await client.paymentPreview(context, 'work/1')
    await client.createWorkPaymentIntent({ ...context, workId: 'work/1', idempotencyKey: 'tus:work-payment:work/1:abc' })
    await client.paymentAccount(context)
    await client.connectPaymentAccount(context)
    await client.disconnectPaymentAccount(context)
    console.log(JSON.stringify({ calls: calls.map(({ method, path, body, idempotencyKey }) => ({ method, path, body: body ?? null, idempotencyKey: idempotencyKey ?? null })) }))
  `)

  assert.deepEqual(result.calls, [
    {
      method: 'GET',
      path: '/tus/v1/work/work%2F1/payment-preview',
      body: null,
      idempotencyKey: null,
    },
    {
      method: 'POST',
      path: '/tus/v1/work/work%2F1/payment-intents',
      body: {},
      idempotencyKey: 'tus:work-payment:work/1:abc',
    },
    { method: 'GET', path: '/tus/v1/provider/payment-account', body: null, idempotencyKey: null },
    {
      method: 'POST',
      path: '/tus/v1/provider/payment-account/mercado-pago/connect',
      body: {},
      idempotencyKey: null,
    },
    {
      method: 'POST',
      path: '/tus/v1/provider/payment-account/disconnect',
      body: {},
      idempotencyKey: null,
    },
  ])
})

test('WEB-09D Web formats minor units exactly and keeps payment copy honest', () => {
  const result = runTypeScriptScenario(`
    const { formatMoney } = (await import('./apps/web/src/lib/tus-money.ts')).default
    console.log(JSON.stringify({ values: [formatMoney('10000000', 'ARS'), formatMoney('5', 'ARS'), formatMoney('9007199254740993', 'ARS'), formatMoney('1.5', 'ARS')] }))
  `)
  assert.deepEqual(result.values, [
    '$ 100.000,00',
    '$ 0,05',
    '$ 90.071.992.547.409,93',
    'importe no disponible (ARS)',
  ])

  const payment = readFileSync(
    join(root, 'apps/web/src/components/compromisos/pago-trabajo.tsx'),
    'utf8'
  )
  const account = readFileSync(
    join(root, 'apps/web/src/components/prestador/cuenta-cobro.tsx'),
    'utf8'
  )
  const customerWork = readFileSync(
    join(root, 'apps/web/src/components/compromisos/trabajo-cliente.tsx'),
    'utf8'
  )
  const provider = readFileSync(join(root, 'apps/web/src/app/tus/tus-prestador.tsx'), 'utf8')
  assert.match(payment, /Pago online no disponible todavía/u)
  assert.match(payment, /paymentAvailable/u)
  assert.match(payment, /intentKeyRef\.current \?\?=/u)
  assert.doesNotMatch(payment, /amountMinor:|parseFloat|Number\(preview|toFixed/u)
  assert.doesNotMatch(payment, /Pago aprobado por Mercado Pago/u)
  assert.match(account, /isMercadoPagoAuthorizationUrl/u)
  assert.doesNotMatch(account, /access_token|accessToken:|client_secret/u)
  assert.match(customerWork, /<PagoTrabajo/u)
  assert.match(provider, /<CuentaCobro/u)
  for (const source of [payment, account])
    assert.doesNotMatch(source, /NEXT_PUBLIC_[A-Z_]*(SECRET|TOKEN|KEY)/u)
})
