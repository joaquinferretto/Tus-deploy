import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { IDENTITY_SETUP } from './fixtures/identidad.mjs'

const MP_ENV = `{ TUS_MERCADOPAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'sandbox', MERCADO_PAGO_CLIENT_ID: 'app-123', MERCADO_PAGO_CLIENT_SECRET: 'fictitious-client-secret-value', MERCADO_PAGO_WEBHOOK_SECRET: 'whsec', MERCADO_PAGO_OAUTH_REDIRECT_URI: 'https://api.tus.test/tus/v1/integrations/mercado-pago/oauth/callback', MERCADO_PAGO_NOTIFICATION_URL: 'https://api.tus.test/tus/v1/integrations/mercado-pago/webhooks', TUS_PAYMENT_CREDENTIALS_KEY: Buffer.alloc(32, 3).toString('base64'), TUS_WEB_BASE_URL: 'https://web.tus.test', TUS_PLATFORM_ADMIN_TENANT_ID: 'platform-tenant' }`

test('IDENTITY-NOSIS gates: an unverified provider cannot publish services, accept work, link Mercado Pago or receive money', () => {
  const result = runTypeScriptScenario(`${SERVICE_SETUP}${IDENTITY_SETUP}
    const { createTusApplication } = (await import('./apps/api/src/tus/composition/index.ts')).default
    const { crearModuloPagosServicio } = await import('./apps/api/src/tus/finance/servicios/composicion-pagos.ts')
    const { AlmacenConfiguracionPagosEnMemoria } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
    const { AlmacenCuentasCobroEnMemoria } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
    const app = createTusApplication({ identity })
    const prestador = ctx(1)
    const session = { tenantId: prestador.tenantId, subjectId: prestador.actorId, sessionId: 'session-1', correlationId: 'corr-gate', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:work:accept'] }
    await app.marketplace.store.merchant.save({ tenantId: prestador.tenantId, merchantId: 'provider-1', cohort: 'repairs-trades', locationId: 'location-1', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-1', status: 'approved', createdAt: '2026-09-23T09:00:00.000Z', updatedAt: '2026-09-23T09:00:00.000Z' })
    const draft = { ...listing('gate-listing', { published: false, workingHours: [{ dayOfWeek: 1, start: '09:00', end: '18:00' }] }), tenantId: prestador.tenantId }
    await app.marketplace.store.listings.save(draft)
    const published = { ...listing('gate-published', { workingHours: [{ dayOfWeek: 1, start: '09:00', end: '18:00' }] }), tenantId: prestador.tenantId }
    await app.marketplace.store.listings.save(published)
    const commitment = { ...commitmentFor('gate-commitment', published), merchantId: 'provider-1' }
    await app.marketplace.store.commitments.saveMany([commitment])
    const payments = crearModuloPagosServicio({ env: ${MP_ENV}, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas: new AlmacenCuentasCobroEnMemoria(), now: identityClock, identidadVerificada: (tenantId) => identity.identidadVerificada(tenantId) })
    await payments.configuracion.registrarConfiguracion({ actorId: 'platform-admin', correlationId: 'corr' }, { paymentsEnabled: true, reason: 'sandbox', expectedVersion: 0 })
    const accept = () => app.acceptServiceCommitment(session, { commitmentId: commitment.commitmentId, idempotencyKey: 'accept-gate', requestHash: 'h-accept-gate', createdAt: '2026-09-24T10:00:00.000Z' })
    const before = {
      publish: await codeOfId(() => app.marketplace.publishListing(session, draft.listingId)),
      accept: await codeOfId(accept),
      connect: await codeOfId(() => payments.cuentas.iniciarConexion(prestador)),
      money: (await payments.politica.disponibilidad({ prestadorTenantId: prestador.tenantId, prestadorId: 'provider-1', categoria: null })).reason,
      appConnect: await codeOfId(() => app.servicePayments.cuentas.iniciarConexion(prestador)),
    }
    // Review states keep every gate closed too.
    await submitIdentity(1, '30111223|PRUEBA DEMO|JUAN')
    await drain()
    const inReview = await codeOfId(() => app.marketplace.publishListing(session, draft.listingId))
    const v = await latest(1)
    await identity.decidir(platformAdmin, v.verificationId, { decision: 'approve', reason: 'Revisión manual con documento original' })
    const after = {
      publish: (await app.marketplace.publishListing(session, draft.listingId)).published,
      accept: (await accept()).work?.status ?? 'accepted',
      connect: new URL((await payments.cuentas.iniciarConexion(prestador)).authorizationUrl).hostname,
      money: (await payments.politica.disponibilidad({ prestadorTenantId: prestador.tenantId, prestadorId: 'provider-1', categoria: null })).reason,
    }
    // Another provider is still blocked: the gate is per tenant.
    const other = await codeOfId(() => payments.cuentas.iniciarConexion(ctx(2)))
    console.log(JSON.stringify({ before, inReview, after, other }))
  `)
  assert.deepEqual(result.before, {
    publish: 'PROVIDER_IDENTITY_NOT_VERIFIED',
    accept: 'PROVIDER_IDENTITY_NOT_VERIFIED',
    connect: 'PROVIDER_IDENTITY_NOT_VERIFIED',
    money: 'PROVIDER_IDENTITY_NOT_VERIFIED',
    // In-memory composition without payment configuration fails closed before the gate.
    appConnect: 'PROVIDER_NOT_CONFIGURED',
  })
  assert.equal(result.inReview, 'PROVIDER_IDENTITY_NOT_VERIFIED')
  assert.equal(result.after.publish, true)
  assert.ok(result.after.accept)
  assert.match(result.after.connect, /mercadopago/u)
  assert.equal(result.after.money, 'PROVIDER_ACCOUNT_NOT_CONNECTED')
  assert.equal(result.other, 'PROVIDER_IDENTITY_NOT_VERIFIED')
})

test('IDENTITY-NOSIS HTTP: provider sees only its own verification, uploads raw images, submit answers 202 queued; admin needs platform tenant + permission', () => {
  const result = runTypeScriptScenario(`${IDENTITY_SETUP}
    const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
    const { InMemoryTusCommitmentStore, InMemoryTusCompensationStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction, InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const { crearModuloPagosServicio } = await import('./apps/api/src/tus/finance/servicios/composicion-pagos.ts')
    const { AlmacenConfiguracionPagosEnMemoria } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
    const { AlmacenCuentasCobroEnMemoria } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const servicePayments = crearModuloPagosServicio({ env: { TUS_PLATFORM_ADMIN_TENANT_ID: 'platform-tenant' }, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas: new AlmacenCuentasCobroEnMemoria() })
    const commitments = new InMemoryTusCommitmentStore(); const compensations = new InMemoryTusCompensationStore(); const audits = new AlmacenReferenciasAuditoriaEnMemoria(); const idempotency = new InMemoryTusIdempotencyStore(); const outbox = new InMemoryTusOutboxStore()
    const application = new TusApplicationService({ commitments, compensations, audits, idempotency, outbox, transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, outbox, compensations }), servicePayments, identity })
    const sessions = new InMemoryTusSessionResolver()
    sessions.add('p1', { sessionId: 's1', subjectId: 'user-1', tenantId: 'prestador-1', roles: ['merchant'], permissions: ['tus:marketplace:write'] })
    sessions.add('p2', { sessionId: 's2', subjectId: 'user-2', tenantId: 'prestador-2', roles: ['merchant'], permissions: ['tus:marketplace:write'] })
    sessions.add('customer', { sessionId: 's3', subjectId: 'c', tenantId: 'customer-1', roles: ['customer'], permissions: ['tus:checkout'] })
    sessions.add('admin', { sessionId: 's4', subjectId: 'platform-admin', tenantId: 'platform-tenant', roles: ['admin'], permissions: ['tus:identity:admin'] })
    sessions.add('fake-admin', { sessionId: 's5', subjectId: 'x', tenantId: 'prestador-2', roles: ['admin'], permissions: ['tus:identity:admin', 'tus:*'] })
    sessions.add('payments-admin', { sessionId: 's6', subjectId: 'y', tenantId: 'platform-tenant', roles: ['admin'], permissions: ['tus:payments:admin'] })
    const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions }), tusRoutesEnabled: true }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const call = async (method, path, token, body, contentType = 'application/json') => {
      const response = await fetch(base + path, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'x-correlation-id': 'corr-http', 'content-type': contentType }, ...(body !== undefined ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}) })
      const buffer = Buffer.from(await response.arrayBuffer())
      let parsed = null; try { parsed = JSON.parse(buffer.toString('utf8')) } catch {}
      return { status: response.status, body: parsed, buffer, headers: Object.fromEntries(response.headers) }
    }
    const P = '/tus/v1/provider/identity-verification'
    try {
      const out = {}
      out.anonymous = (await call('GET', P)).status
      out.customer = (await call('GET', P, 'customer')).status
      out.consent = (await call('POST', '/tus/v1/prestador/verificacion-identidad/consent', 'p1', { accepted: true, consentVersion: 'identidad-prestador-v1' })).body.consentAccepted
      out.spoofed = (await call('POST', P + '/consent', 'p2', { accepted: true, consentVersion: 'identidad-prestador-v1', tenantId: 'prestador-1' })).status
      out.front = (await call('PUT', P + '/documents/front', 'p1', png('30111222|PRUEBA DEMO|JUAN'), 'image/png')).body.documents
      out.backOctet = (await call('PUT', P + '/documents/back', 'p1', png('30111222|PRUEBA DEMO|JUAN'), 'application/octet-stream')).body.documents
      out.svg = (await call('PUT', P + '/documents/front', 'p2', Buffer.concat([Buffer.from('<svg>'), Buffer.alloc(9000, 32)]), 'image/png')).body.code
      out.otherView = (await call('GET', P, 'p2')).body
      const submitted = await call('POST', P + '/submit', 'p1', {})
      out.submit = [submitted.status, submitted.body.status, submitted.body.message]
      out.searchesAfterSubmit = demo.searches.length
      out.ownView = (await call('GET', P, 'p1')).body.status
      out.cache = (await call('GET', P, 'p1')).headers['cache-control']
      await drain()
      const id = submitted.body.verificationId
      out.adminAuth = [
        (await call('GET', '/tus/v1/admin/identity-verifications', 'p1')).status,
        (await call('GET', '/tus/v1/admin/identity-verifications', 'fake-admin')).status,
        (await call('GET', '/tus/v1/admin/identity-verifications', 'payments-admin')).status,
        (await call('GET', '/tus/v1/admin/identity-verifications/' + id + '/documents/front', 'p1')).status,
      ]
      const list = await call('GET', '/tus/v1/admin/identity-verifications?status=verified', 'admin')
      out.list = list.body.verifications.map((item) => [item.status, item.documentNumberMasked])
      out.listLeaks = list.buffer.toString('utf8').includes('30111222')
      const image = await call('GET', '/tus/v1/admin/identity-verifications/' + id + '/documents/front', 'admin')
      out.image = [image.status, image.headers['content-type'], image.headers['cache-control'], image.headers['x-content-type-options'], image.buffer.subarray(1, 4).toString()]
      out.worker = (await call('GET', '/tus/v1/admin/identity-worker', 'admin')).body
      out.pause = (await call('POST', '/tus/v1/admin/identity-worker/pause', 'admin', {})).body.status
      out.badDecision = (await call('POST', '/tus/v1/admin/identity-verifications/' + id + '/decision', 'admin', { decision: 'approve' })).body.code
      out.missing = (await call('GET', '/tus/v1/admin/identity-verifications/nope', 'admin')).status
      console.log(JSON.stringify(out))
    } finally { server.close() }
  `)
  assert.equal(result.anonymous, 403)
  assert.equal(result.customer, 403)
  assert.equal(result.consent, true)
  assert.equal(result.spoofed, 403)
  assert.deepEqual(result.front, { front: true, back: false })
  assert.deepEqual(result.backOctet, { front: true, back: true })
  // Content is validated (magic bytes) before anything else, even without consent.
  assert.equal(result.svg, 'DOCUMENT_TYPE_NOT_ALLOWED')
  assert.equal(result.otherView.status, 'not_started')
  assert.equal(result.otherView.verificationId, null)
  assert.deepEqual(result.submit, [
    202,
    'queued',
    'Tu documentación está siendo verificada. Te avisaremos cuando finalice el proceso.',
  ])
  assert.equal(result.searchesAfterSubmit, 0)
  assert.equal(result.ownView, 'queued')
  assert.equal(result.cache, 'no-store')
  assert.deepEqual(result.adminAuth, [403, 403, 403, 403])
  assert.deepEqual(result.list, [['verified', '***222']])
  assert.equal(result.listLeaks, false)
  assert.deepEqual(result.image, [200, 'image/png', 'no-store', 'nosniff', 'PNG'])
  assert.equal(result.worker.max, 7)
  assert.equal(result.worker.used, 1)
  assert.equal(result.pause, 'paused')
  assert.equal(result.badDecision, 'REASON_REQUIRED')
  assert.equal(result.missing, 404)
})
