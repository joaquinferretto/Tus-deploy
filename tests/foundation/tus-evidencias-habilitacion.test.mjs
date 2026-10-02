import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  EvaluadorHabilitacion,
  crearEvidenciaHabilitacion,
  evaluarHabilitacion,
  requisitosDeCapacidad,
} from '../../apps/api/src/tus/readiness/index.ts'
import {
  AlmacenAdminEvidenciasEnMemoria,
  ErrorEvidenciaHabilitacion,
  ServicioEvidenciasHabilitacion,
  pareceDatoSensible,
} from '../../apps/api/src/tus/readiness/evidencias-admin.ts'
import { crearHabilitacionPagosServicio } from '../../apps/api/src/tus/finance/servicios/habilitacion-pagos.ts'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Administrative registry of readiness evidence: the only writer of `evidencias_habilitacion`.
// A platform administrator records a REFERENCE to a real, owner-held document for one
// requirement of one capability; the registry never stores the document, a credential, a
// provider payload or personal data, and tenant, actor, scope, source and status are never the
// request's to decide.
const TENANT = 'platform-tenant'
const PROFILE = 'render-native'
const SCOPE = 'argentina-stage-1'
const SERVICE_PAYMENT_GATES = ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider']
const SETTLEMENT_GATES = ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'posPilot', 'aws', 'groqMigration', 'runtimeProvider']
const admin = { actorId: 'platform-admin', correlationId: 'corr-admin' }

function registry(nowIso = '2026-10-02T12:00:00.000Z') {
  const store = new AlmacenAdminEvidenciasEnMemoria()
  let now = Date.parse(nowIso)
  const service = new ServicioEvidenciasHabilitacion(store, { tenantId: TENANT, profile: PROFILE, scope: SCOPE }, () => now)
  // The evaluator production composes, reading exactly what the registry wrote.
  const gates = crearHabilitacionPagosServicio(new EvaluadorHabilitacion({ listEvidence: (tenantId, capability) => store.registros.filter((item) => item.tenantId === tenantId && item.capability === capability) }), { tenantId: TENANT, profile: PROFILE })
  return { store, service, gates, advance: (ms) => { now += ms } }
}

const valid = (overrides = {}) => ({ capability: 'service-payments', gate: 'legal', owner: 'Legal y Compliance', evidenceType: 'Acta de aprobación', evidenceRef: 'ACTA-LEGAL-2026-014', policyVersion: 'tus-readiness-v1', ...overrides })

async function failure(operation) {
  try {
    await operation()
    return null
  } catch (error) {
    assert.ok(error instanceof ErrorEvidenciaHabilitacion, String(error))
    return { status: error.status, code: error.code, fields: error.fields, text: JSON.stringify({ message: error.message, fields: error.fields }) }
  }
}

test('a registered record is the server\'s: tenant, scope, profile, source and status are fixed, and the request only names the requirement and its reference', async () => {
  const { store, service } = registry()
  const view = await service.registrar(admin, valid({ expiresAt: '2027-10-02T00:00:00.000Z' }))
  assert.deepEqual(
    { ...view, evidenceId: 'id' },
    { evidenceId: 'id', capability: 'service-payments', gate: 'legal', owner: 'Legal y Compliance', scope: SCOPE, evidenceType: 'Acta de aprobación', evidenceRef: 'ACTA-LEGAL-2026-014', policyVersion: 'tus-readiness-v1', issuedAt: '2026-10-02T12:00:00.000Z', expiresAt: '2027-10-02T00:00:00.000Z', revoked: false, status: 'current', recordedAt: '2026-10-02T12:00:00.000Z', updatedAt: '2026-10-02T12:00:00.000Z' },
  )
  const [stored] = store.registros
  assert.deepEqual([stored.tenantId, stored.scope, stored.profile, stored.source, stored.revoked, stored.execution, stored.liveConformance], [TENANT, SCOPE, PROFILE, 'authorized-external', false, 'live', true])
  // Audited with who and what, and nothing else.
  assert.deepEqual(store.auditoria.map((event) => [event.eventType, event.tenantId, event.actorId, event.correlationId, event.metadata.capability, event.metadata.gate, event.metadata.evidenceRef]), [['readiness.evidence_registered', TENANT, 'platform-admin', 'corr-admin', 'service-payments', 'legal', 'ACTA-LEGAL-2026-014']])
})

test('the request never decides tenant, actor, roles, scope, source, status or identifiers', async () => {
  const { store, service } = registry()
  const forbidden = { tenantId: 'another-tenant', actorId: 'somebody', subjectId: 'somebody', roles: ['admin'], permissions: ['tus:payments:admin'], scope: 'global', source: 'authorized-external', revoked: false, profile: 'aws-terraform', status: 'current', approved: true, authorized: true, evidenceId: 'chosen-id', evidenceClass: 'authorized-external', liveConformance: true, createdAt: '2020-01-01T00:00:00.000Z', owner_id: 'x' }
  for (const [field, value] of Object.entries(forbidden)) {
    const result = await failure(() => service.registrar(admin, valid({ [field]: value })))
    assert.deepEqual([result?.status, result?.code, result?.fields], [400, 'UNTRUSTED_EVIDENCE_FIELDS', [field]], field)
  }
  const revoke = await failure(() => service.revocar(admin, 'any', { reason: 'motivo válido', tenantId: 'another-tenant' }))
  assert.deepEqual([revoke?.status, revoke?.code, revoke?.fields], [400, 'UNTRUSTED_EVIDENCE_FIELDS', ['tenantId']])
  assert.equal(store.registros.length, 0)
  assert.equal(store.auditoria.length, 0)
})

test('only the capabilities of the platform tenant and their own requirements can be recorded', async () => {
  const { store, service } = registry()
  for (const capability of ['publication', 'provider-actions', 'fleet', 'release-jobs', 'servicePayments', '', null, 7])
    assert.deepEqual((await failure(() => service.registrar(admin, valid({ capability }))))?.fields, ['capability'], String(capability))
  // posPilot, aws and groqMigration are requirements of settlement, never of service payments.
  for (const gate of ['posPilot', 'aws', 'groqMigration', 'unknown', '']) {
    const result = await failure(() => service.registrar(admin, valid({ gate })))
    assert.deepEqual([result?.status, result?.fields], [400, ['gate']], gate)
  }
  assert.equal(store.registros.length, 0)
  await service.registrar(admin, valid({ capability: 'settlement', gate: 'posPilot', evidenceRef: 'PILOTO-POS-2026-01' }))
  const listed = await service.listar()
  assert.deepEqual(listed.capabilities.map((item) => [item.capability, [...item.requiredGates], item.evidence.length]), [['service-payments', SERVICE_PAYMENT_GATES, 0], ['settlement', SETTLEMENT_GATES, 1]])
})

test('values that look like a credential, a provider payload or personal data are refused, named by field and never echoed', async () => {
  const { store, service } = registry()
  // Built from pieces so no literal credential shape lives in the repository.
  const samples = [
    ['APP', 'USR'].join('_') + '-6297451388273' + '-102030-abcdef',
    'TEST' + '-8825710043' + '-access',
    'Bea' + 'rer abc123def456',
    'ey' + 'JhbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'c2lnbmF0dXJl',
    'client' + '_secret' + '=valor-de-prueba',
    'pass' + 'word: valor',
    'https://usuario:' + 'clave@docs.tus.test/acta',
    'https://docs.tus.test/acta?to' + 'ken=abc',
    '{"id":123,"status":"approved","payer":{"id":9}}',
    'a1b2c3d4e5f6'.repeat(4),
    'Zm9vYmFyYmF6' + 'cXV4cXV1eGNvcmdl' + 'Z3JhdWx0Z2FycGx5d2FsZG8',
    'persona' + '@' + 'example.com',
    '20-' + '30123456' + '-3',
    'DNI ' + '30123456',
  ]
  for (const sample of samples) {
    assert.equal(pareceDatoSensible(sample), true, 'sample ' + samples.indexOf(sample))
    for (const field of ['owner', 'evidenceType', 'evidenceRef', 'policyVersion']) {
      const result = await failure(() => service.registrar(admin, valid({ [field]: sample })))
      assert.deepEqual([result?.status, result?.code, result?.fields], [422, 'SENSITIVE_EVIDENCE_VALUE', [field]], field + ' ' + samples.indexOf(sample))
      assert.equal(result.text.includes(sample), false, 'the refused value is not echoed')
    }
  }
  // The reason of a revocation is checked the same way.
  const reason = await failure(() => service.revocar(admin, 'any', { reason: samples[0] }))
  assert.deepEqual([reason?.status, reason?.code, reason?.fields], [422, 'SENSITIVE_EVIDENCE_VALUE', ['reason']])
  assert.equal(store.registros.length, 0)
  assert.equal(store.auditoria.length, 0)

  // Ordinary references to a document are accepted.
  for (const reference of ['ACTA-DIRECTORIO-2026-014', 'https://docs.tus.test/legal/terminos-prestadores-v3', 'Dictamen fiscal 2026/07 - Estudio contable', 'Expediente 4521/2026'])
    assert.equal(pareceDatoSensible(reference), false, reference)
})

test('text and dates are validated: one line of 3 to 200 characters, issued not in the future, expiry in the future', async () => {
  const { service } = registry()
  for (const [field, value] of [['owner', ''], ['owner', 'ab'], ['evidenceRef', 'x'.repeat(201)], ['evidenceType', 'dos\nlineas'], ['policyVersion', 42], ['evidenceRef', undefined]])
    assert.deepEqual((await failure(() => service.registrar(admin, valid({ [field]: value }))))?.fields, [field], field)
  assert.deepEqual((await failure(() => service.registrar(admin, valid({ issuedAt: '2026-10-03T00:00:00.000Z' }))))?.fields, ['issuedAt'])
  assert.deepEqual((await failure(() => service.registrar(admin, valid({ issuedAt: 'ayer' }))))?.fields, ['issuedAt'])
  assert.deepEqual((await failure(() => service.registrar(admin, valid({ expiresAt: '2026-10-01T00:00:00.000Z' }))))?.fields, ['expiresAt'])
  const view = await service.registrar(admin, valid({ issuedAt: '2026-09-15T10:00:00.000Z', expiresAt: null }))
  assert.deepEqual([view.issuedAt, view.expiresAt, view.status], ['2026-09-15T10:00:00.000Z', null, 'current'])
})

test('one current record per requirement; a reference is never reused; revoking blocks the capability and a new record renews it', async () => {
  const { store, service, gates } = registry()
  const ids = {}
  for (const gate of SERVICE_PAYMENT_GATES) ids[gate] = (await service.registrar(admin, valid({ gate, evidenceRef: 'REF-' + gate + '-1' }))).evidenceId
  assert.equal(await gates.autorizada(), true, 'the six records authorize service payments')
  assert.equal((await gates.estado()).settlement.authorized, false, 'and never settlement')

  assert.equal((await failure(() => service.registrar(admin, valid({ gate: 'tax', evidenceRef: 'REF-tax-2' }))))?.code, 'EVIDENCE_ALREADY_CURRENT')
  assert.equal((await failure(() => service.registrar(admin, valid({ gate: 'tax', evidenceRef: 'REF-tax-1' }))))?.code, 'EVIDENCE_REFERENCE_ALREADY_USED')

  const revoked = await service.revocar({ actorId: 'platform-admin', correlationId: 'corr-revoke' }, ids.tax, { reason: 'Dictamen reemplazado' })
  assert.deepEqual([revoked.revoked, revoked.status], [true, 'revoked'])
  assert.deepEqual((await gates.estado()).servicePayments, { capability: 'service-payments', authorized: false, blockers: ['tax:evidence_revoked'] })
  assert.equal((await failure(() => service.revocar(admin, ids.tax, { reason: 'otra vez' })))?.status, 404, 'already revoked')
  assert.equal((await failure(() => service.revocar(admin, 'evidencia-inexistente', { reason: 'no existe' })))?.status, 404)
  assert.equal((await failure(() => service.revocar(admin, ids.legal, {})))?.fields[0], 'reason', 'a revocation needs its reason')
  assert.equal((await failure(() => service.registrar(admin, valid({ gate: 'tax', evidenceRef: 'REF-tax-1' }))))?.code, 'EVIDENCE_REFERENCE_ALREADY_USED', 'a revoked reference is not reused')

  await service.registrar(admin, valid({ gate: 'tax', evidenceRef: 'REF-tax-2' }))
  assert.equal(await gates.autorizada(), true, 'a new current record renews the requirement; the revoked one stays as history')

  // An expired record blocks, and a new one renews it too.
  const { service: timed, gates: timedGates } = registry()
  for (const gate of SERVICE_PAYMENT_GATES) await timed.registrar(admin, valid({ gate, evidenceRef: 'REF-' + gate + '-1', ...(gate === 'legal' ? { expiresAt: '2026-10-03T12:00:00.000Z' } : {}) }))
  assert.equal(await timedGates.autorizada(), true)
  const expiredNow = '2026-10-04T12:00:00.000Z'
  const decision = evaluarHabilitacion({ tenantId: TENANT, capability: 'service-payments', scope: SCOPE, now: expiredNow, evidence: (await timed.listar()).capabilities[0].evidence.map((item) => crearEvidenciaHabilitacion({ ...item, tenantId: TENANT, source: 'authorized-external', profile: PROFILE })) })
  assert.deepEqual(decision.failedGates, [{ gate: 'legal', reason: 'evidence_expired' }])

  assert.deepEqual(store.auditoria.map((event) => event.eventType).filter((type) => type === 'readiness.evidence_revoked').length, 1)
  const revocation = store.auditoria.find((event) => event.eventType === 'readiness.evidence_revoked')
  assert.deepEqual([revocation.actorId, revocation.correlationId, revocation.metadata.gate, revocation.metadata.reason], ['platform-admin', 'corr-revoke', 'tax', 'Dictamen reemplazado'])
})

test('a record of another tenant cannot be revoked from the registry of the platform tenant', async () => {
  const store = new AlmacenAdminEvidenciasEnMemoria()
  const other = new ServicioEvidenciasHabilitacion(store, { tenantId: 'another-tenant', profile: PROFILE, scope: SCOPE })
  const platform = new ServicioEvidenciasHabilitacion(store, { tenantId: TENANT, profile: PROFILE, scope: SCOPE })
  const foreign = await other.registrar(admin, valid())
  assert.equal((await failure(() => platform.revocar(admin, foreign.evidenceId, { reason: 'no es mía' })))?.status, 404)
  assert.equal((await platform.listar()).capabilities[0].evidence.length, 0)
  assert.equal(store.registros[0].revoked, false)
})

test('renewal in the evaluator, for service-payments only: history (revoked, expired) does not block one current record; anything else beside it still does; settlement keeps its nine requirements and its original rule', () => {
  const now = '2026-10-02T12:00:00.000Z'
  const record = (gate, overrides = {}, capability = 'service-payments') => crearEvidenciaHabilitacion({ tenantId: TENANT, capability, gate, owner: 'owner', scope: SCOPE, evidenceType: 'approval-record', evidenceRef: 'ref-' + gate, evidenceId: 'id-' + gate, policyVersion: 'v1', issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: null, revoked: false, source: 'authorized-external', profile: PROFILE, ...overrides })
  const others = SERVICE_PAYMENT_GATES.filter((gate) => gate !== 'legal').map((gate) => record(gate))
  const reasonOf = (legal) => evaluarHabilitacion({ tenantId: TENANT, capability: 'service-payments', scope: SCOPE, now, evidence: [...others, ...legal] }).failedGates.find((item) => item.gate === 'legal')?.reason ?? 'authorized'
  const old = (overrides) => record('legal', { evidenceId: 'old', evidenceRef: 'old', ...overrides })
  assert.equal(reasonOf([old({ revoked: true })]), 'evidence_revoked')
  assert.equal(reasonOf([old({ expiresAt: '2026-06-01T00:00:00.000Z' })]), 'evidence_expired')
  assert.equal(reasonOf([old({ revoked: true }), record('legal')]), 'authorized')
  assert.equal(reasonOf([old({ expiresAt: '2026-06-01T00:00:00.000Z' }), record('legal')]), 'authorized')
  assert.equal(reasonOf([old({ revoked: true }), old({ evidenceId: 'older', evidenceRef: 'older', expiresAt: '2026-06-01T00:00:00.000Z' }), record('legal')]), 'authorized')
  // Not history: these still block, even next to a current record.
  assert.equal(reasonOf([old({ source: 'deterministic-test-only' }), record('legal')]), 'deterministic_test_only')
  assert.equal(reasonOf([old({ source: 'deferred', liveConformance: false }), record('legal')]), 'evidence_deferred')
  assert.equal(reasonOf([old({ issuedAt: '2026-12-01T00:00:00.000Z' }), record('legal')]), 'evidence_not_yet_valid')
  assert.equal(reasonOf([old({}), record('legal')]), 'evidence_conflict')
  assert.equal(reasonOf([old({ revoked: true }), old({ evidenceId: 'b', evidenceRef: 'b' }), record('legal')]), 'evidence_conflict')

  // Settlement is untouched: a revoked or expired record of a gate blocks it, even next to a current one.
  const settlementReason = (legal) => evaluarHabilitacion({ tenantId: TENANT, capability: 'settlement', scope: SCOPE, now, evidence: [...SETTLEMENT_GATES.filter((gate) => gate !== 'legal').map((gate) => record(gate, {}, 'settlement')), ...legal] }).failedGates.find((item) => item.gate === 'legal')?.reason ?? 'authorized'
  assert.equal(settlementReason([record('legal', {}, 'settlement')]), 'authorized')
  assert.equal(settlementReason([record('legal', { evidenceId: 'old', evidenceRef: 'old', revoked: true }, 'settlement'), record('legal', {}, 'settlement')]), 'evidence_revoked')
  assert.equal(settlementReason([record('legal', { evidenceId: 'old', evidenceRef: 'old', expiresAt: '2026-06-01T00:00:00.000Z' }, 'settlement'), record('legal', {}, 'settlement')]), 'evidence_expired')

  assert.deepEqual([...requisitosDeCapacidad('settlement')], SETTLEMENT_GATES)
  assert.deepEqual([...requisitosDeCapacidad('service-payments')], SERVICE_PAYMENT_GATES)
})

test('HTTP: the registry is behind the platform administration (permission + MFA-elevated session + allowlist + platform tenant); authority in the request is refused; the status follows the records', () => {
  const r = runTypeScriptScenario(`
    const { TusApplicationService } = await import('./apps/api/src/tus/application/tus-application-service.ts')
    const { InMemoryTusCommitmentStore, InMemoryTusCompensationStore, AlmacenReferenciasAuditoriaEnMemoria, InMemoryTusIdempotencyStore, InMemoryTusOutboxStore, InMemoryTusTransaction, InMemoryTusSessionResolver } = await import('./apps/api/src/tus/adapters/in-memory.ts')
    const { AlmacenConfiguracionPagosEnMemoria } = await import('./apps/api/src/tus/finance/servicios/configuracion.ts')
    const { AlmacenCuentasCobroEnMemoria } = await import('./apps/api/src/tus/finance/servicios/cuentas-cobro.ts')
    const { crearModuloPagosServicio } = await import('./apps/api/src/tus/finance/servicios/composicion-pagos.ts')
    const { crearHabilitacionPagosServicio } = await import('./apps/api/src/tus/finance/servicios/habilitacion-pagos.ts')
    const { EvaluadorHabilitacion } = await import('./apps/api/src/tus/readiness/index.ts')
    const { AlmacenAdminEvidenciasEnMemoria, ServicioEvidenciasHabilitacion } = await import('./apps/api/src/tus/readiness/evidencias-admin.ts')
    const { MfaAdminSessionResolver } = await import('./apps/api/src/auth-security/mfa/admin-gate.ts')
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { createApp } = (await import('./apps/api/src/server.ts')).default

    const TENANT = 'platform-tenant'
    const env = { TUS_MERCADOPAGO_ENABLED: 'true', MERCADO_PAGO_ENVIRONMENT: 'production', MERCADO_PAGO_CLIENT_ID: 'fictitious-id', MERCADO_PAGO_CLIENT_SECRET: 'fictitious-value', MERCADO_PAGO_WEBHOOK_SECRET: 'fictitious-value', MERCADO_PAGO_OAUTH_REDIRECT_URI: 'https://api.tus.test/cb', MERCADO_PAGO_NOTIFICATION_URL: 'https://api.tus.test/wh', TUS_PAYMENT_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64'), TUS_WEB_BASE_URL: 'https://web.tus.test', TUS_PLATFORM_ADMIN_TENANT_ID: TENANT }
    const store = new AlmacenAdminEvidenciasEnMemoria()
    const gates = crearHabilitacionPagosServicio(new EvaluadorHabilitacion({ listEvidence: (tenantId, capability) => store.registros.filter((item) => item.tenantId === tenantId && item.capability === capability) }), { tenantId: TENANT, profile: 'render-native' })
    const payments = crearModuloPagosServicio({ env, configuracion: new AlmacenConfiguracionPagosEnMemoria(), cuentas: new AlmacenCuentasCobroEnMemoria(), produccionAutorizada: gates.autorizada, habilitaciones: gates.estado })
    const readinessEvidence = new ServicioEvidenciasHabilitacion(store, { tenantId: TENANT, profile: 'render-native', scope: 'argentina-stage-1' })
    const commitments = new InMemoryTusCommitmentStore(); const compensations = new InMemoryTusCompensationStore(); const audits = new AlmacenReferenciasAuditoriaEnMemoria(); const idempotency = new InMemoryTusIdempotencyStore(); const outbox = new InMemoryTusOutboxStore()
    const application = new TusApplicationService({ commitments, compensations, audits, idempotency, outbox, transaction: new InMemoryTusTransaction({ commitments, audits, idempotency, outbox, compensations }), servicePayments: payments, readinessEvidence })

    // Sessions as production resolves them: the admin permission survives only on an
    // MFA-elevated session of an account that is still allowlisted.
    const inner = new InMemoryTusSessionResolver()
    const adminPermissions = ['tus:payments:admin', 'tus:identity:admin']
    inner.add('admin-mfa', { sessionId: 's-mfa', subjectId: 'acc-admin', tenantId: TENANT, roles: ['owner'], permissions: adminPermissions })
    inner.add('admin-sin-mfa', { sessionId: 's-plain', subjectId: 'acc-admin', tenantId: TENANT, roles: ['owner'], permissions: adminPermissions })
    inner.add('admin-otro-tenant', { sessionId: 's-other', subjectId: 'acc-other', tenantId: 'another-tenant', roles: ['owner'], permissions: adminPermissions })
    inner.add('admin-quitado', { sessionId: 's-removed', subjectId: 'acc-removed', tenantId: TENANT, roles: ['owner'], permissions: adminPermissions })
    inner.add('cliente', { sessionId: 's-c', subjectId: 'acc-client', tenantId: 'client-tenant', roles: ['owner'], permissions: ['tus:checkout', 'tus:work:read'] })
    inner.add('prestador', { sessionId: 's-p', subjectId: 'acc-provider', tenantId: 'provider-tenant', roles: ['owner', 'merchant'], permissions: ['tus:marketplace:write', 'tus:finance:write', 'tus:work:write'] })
    const elevadas = new Set(['s-mfa', 's-other', 's-removed'])
    const cuentas = { 'acc-admin': 'admin@tus.test', 'acc-other': 'other@tus.test', 'acc-removed': 'removed@tus.test' }
    const sessions = new MfaAdminSessionResolver(inner, { isElevated: async (subject) => elevadas.has(subject.sessionId) }, { getAccount: async (id) => (cuentas[id] ? { email: cuentas[id], normalizedEmail: cuentas[id], emailVerifiedAt: 1, status: 'active' } : undefined) }, () => ['admin@tus.test', 'other@tus.test'])

    const server = createApp({ tusRouter: createTusHttpRouter({ application, sessions }), tusRoutesEnabled: true }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    const call = async (method, path, token, body, headers = {}) => { const response = await fetch(base + path, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'x-correlation-id': 'corr-http', 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); const text = await response.text(); let parsed = null; try { parsed = JSON.parse(text) } catch {} return { status: response.status, body: parsed, text } }
    const RUTA = '/tus/v1/admin/payments/readiness/evidence'
    const valida = (gate, extra = {}) => ({ capability: 'service-payments', gate, owner: 'Responsable del requisito', evidenceType: 'Acta de aprobación', evidenceRef: 'ACTA-' + gate + '-2026-01', policyVersion: 'tus-readiness-v1', ...extra })
    const out = {}
    try {
      // 1. Who may read and write.
      out.acceso = []
      for (const token of [null, 'cliente', 'prestador', 'admin-sin-mfa', 'admin-otro-tenant', 'admin-quitado']) {
        const leer = await call('GET', RUTA, token)
        const escribir = await call('POST', RUTA, token, valida('legal'))
        const revocar = await call('POST', RUTA + '/cualquiera/revoke', token, { reason: 'motivo válido' })
        out.acceso.push([token, leer.status, escribir.status, escribir.body?.code, revocar.status])
      }
      const sinCorrelacion = await fetch(base + RUTA, { method: 'POST', headers: { authorization: 'Bearer admin-mfa', 'content-type': 'application/json' }, body: JSON.stringify(valida('legal')) })
      out.sinCorrelacion = sinCorrelacion.status
      out.nadaEscrito = [store.registros.length, store.auditoria.length]

      // 2. Authority in the request.
      const otroTenant = await call('POST', RUTA, 'admin-mfa', valida('legal', { tenantId: 'another-tenant' }))
      const otroActor = await call('POST', RUTA, 'admin-mfa', valida('legal', { actorId: 'somebody-else' }))
      const cabecera = await call('POST', RUTA, 'admin-mfa', valida('legal'), { 'x-tenant-id': 'another-tenant' })
      const roles = await call('POST', RUTA, 'admin-mfa', valida('legal', { roles: ['superadmin'] }))
      const propioTenant = await call('POST', RUTA, 'admin-mfa', valida('legal', { tenantId: TENANT }))
      const estado = await call('POST', RUTA, 'admin-mfa', valida('legal', { revoked: false, source: 'authorized-external', scope: 'global', status: 'current' }))
      const otraCapacidad = await call('POST', RUTA, 'admin-mfa', valida('legal', { capability: 'fleet' }))
      const requisitoAjeno = await call('POST', RUTA, 'admin-mfa', valida('posPilot'))
      out.autoridad = [[otroTenant.status, otroTenant.body.code], [otroActor.status, otroActor.body.code], [cabecera.status, cabecera.body.code], [roles.status, roles.body.code], [propioTenant.status, propioTenant.body.code, propioTenant.body.fields], [estado.status, estado.body.code, estado.body.fields], [otraCapacidad.status, otraCapacidad.body.fields], [requisitoAjeno.status, requisitoAjeno.body.fields]]

      // 3. A secret is refused and never echoed.
      const secreto = ['APP', 'USR'].join('_') + '-6297451388273-102030-abcdef'
      const conSecreto = await call('POST', RUTA, 'admin-mfa', valida('legal', { evidenceRef: secreto }))
      out.secreto = [conSecreto.status, conSecreto.body.code, conSecreto.body.fields, conSecreto.text.includes(secreto)]
      out.sigueVacio = [store.registros.length, store.auditoria.length]

      // 4. The status before, the six records, the status after.
      const antes = await call('GET', '/tus/v1/admin/payments/status', 'admin-mfa')
      out.antes = [antes.body.readiness.gate, antes.body.readiness.servicePayments.authorized, antes.body.readiness.servicePayments.blockers.length, antes.body.readiness.settlement.blockers.length, antes.body.blockers.includes('PRODUCTION_READINESS_NOT_AUTHORIZED')]
      const ids = {}
      for (const gate of ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider']) {
        const creada = await call('POST', RUTA, 'admin-mfa', valida(gate))
        ids[gate] = creada.body.evidence?.evidenceId
        out['creada_' + gate] = [creada.status, creada.body.evidence?.status, creada.body.evidence?.scope, Object.keys(creada.body.evidence ?? {}).some((key) => ['tenantId', 'source', 'profile', 'actorId'].includes(key))]
      }
      const despues = await call('GET', '/tus/v1/admin/payments/status', 'admin-mfa')
      out.despues = [despues.body.readiness.servicePayments, despues.body.readiness.settlement.authorized, despues.body.readiness.settlement.blockers.length, despues.body.blockers.includes('PRODUCTION_READINESS_NOT_AUTHORIZED')]
      out.guardado = [store.registros.length, [...new Set(store.registros.map((item) => item.tenantId + '|' + item.scope + '|' + item.source + '|' + item.profile))], [...new Set(store.auditoria.map((event) => event.actorId + '|' + event.correlationId + '|' + event.eventType))]]
      const lista = await call('GET', RUTA, 'admin-mfa')
      out.lista = [lista.status, lista.body.capabilities.map((item) => [item.capability, item.requiredGates.length, item.evidence.length])]
      const duplicada = await call('POST', RUTA, 'admin-mfa', valida('legal', { evidenceRef: 'ACTA-legal-2026-02' }))
      out.duplicada = [duplicada.status, duplicada.body.code]

      // 5. Revoking, with the same authority.
      const revocarAjeno = await call('POST', RUTA + '/' + ids.tax + '/revoke', 'admin-sin-mfa', { reason: 'Dictamen reemplazado' })
      const revocarConAutoridad = await call('POST', RUTA + '/' + ids.tax + '/revoke', 'admin-mfa', { reason: 'Dictamen reemplazado', revoked: true })
      const revocada = await call('POST', RUTA + '/' + ids.tax + '/revoke', 'admin-mfa', { reason: 'Dictamen reemplazado' })
      const final = await call('GET', '/tus/v1/admin/payments/status', 'admin-mfa')
      out.revocacion = [revocarAjeno.status, [revocarConAutoridad.status, revocarConAutoridad.body.code], [revocada.status, revocada.body.evidence.status], final.body.readiness.servicePayments, final.body.blockers.includes('PRODUCTION_READINESS_NOT_AUTHORIZED')]
    } finally { await new Promise((resolve) => server.close(resolve)) }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.acceso, [
    [null, 403, 403, 'FORBIDDEN', 403],
    ['cliente', 403, 403, 'FORBIDDEN', 403],
    ['prestador', 403, 403, 'FORBIDDEN', 403],
    ['admin-sin-mfa', 403, 403, 'FORBIDDEN', 403],
    ['admin-otro-tenant', 403, 403, 'FORBIDDEN', 403],
    ['admin-quitado', 403, 403, 'FORBIDDEN', 403],
  ], 'no session, a client, a provider, an admin without MFA, an admin of another tenant and a de-listed admin are all refused')
  assert.equal(r.sinCorrelacion, 403)
  assert.deepEqual(r.nadaEscrito, [0, 0])
  assert.deepEqual(r.autoridad, [
    [403, 'FORBIDDEN'], [403, 'FORBIDDEN'], [403, 'FORBIDDEN'], [403, 'FORBIDDEN'],
    [400, 'UNTRUSTED_EVIDENCE_FIELDS', ['tenantId']],
    [400, 'UNTRUSTED_EVIDENCE_FIELDS', ['revoked', 'scope', 'source', 'status']],
    [400, ['capability']],
    [400, ['gate']],
  ], 'tenant, actor, roles, scope, source and status in the request are refused; so are a capability outside the platform tenant and a requirement of another capability')
  assert.deepEqual(r.secreto, [422, 'SENSITIVE_EVIDENCE_VALUE', ['evidenceRef'], false])
  assert.deepEqual(r.sigueVacio, [0, 0])
  assert.deepEqual(r.antes, ['service-payments', false, 6, 9, true])
  for (const gate of ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider'])
    assert.deepEqual(r['creada_' + gate], [201, 'current', 'argentina-stage-1', false], gate)
  assert.deepEqual(r.despues, [{ capability: 'service-payments', authorized: true, blockers: [] }, false, 9, false], 'six real records open service payments; settlement stays blocked on its nine')
  assert.deepEqual(r.guardado, [6, ['platform-tenant|argentina-stage-1|authorized-external|render-native'], ['acc-admin|corr-http|readiness.evidence_registered']], 'tenant, scope, source and profile are the server\'s; the actor is the session\'s')
  assert.deepEqual(r.lista, [200, [['service-payments', 6, 6], ['settlement', 9, 0]]])
  assert.deepEqual(r.duplicada, [409, 'EVIDENCE_ALREADY_CURRENT'])
  assert.deepEqual(r.revocacion, [403, [400, 'UNTRUSTED_EVIDENCE_FIELDS'], [200, 'revoked'], { capability: 'service-payments', authorized: false, blockers: ['tax:evidence_revoked'] }, true])
})

const pgUrl = process.env.TUS_PERFIL_TURNOS_PG_URL
test('PostgreSQL: the registry writes evidencias_habilitacion and its audit in one transaction, and the persisted evaluator reads exactly those records', { skip: !pgUrl && 'TUS_PERFIL_TURNOS_PG_URL not set (disposable PostgreSQL 16 only)', timeout: 120000 }, () => {
  const r = runTypeScriptScenario(`
    const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
    const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(pgUrl ?? '')}, errorFormat: 'minimal' })
    const { AlmacenAdminEvidenciasPrisma } = await import('./apps/api/src/tus/adapters/prisma-evidencias-habilitacion.ts')
    const { AlmacenPrismaEvidenciaHabilitacion } = await import('./apps/api/src/tus/adapters/prisma.ts')
    const { ServicioEvidenciasHabilitacion } = await import('./apps/api/src/tus/readiness/evidencias-admin.ts')
    const { EvaluadorHabilitacion } = await import('./apps/api/src/tus/readiness/index.ts')
    const { crearHabilitacionPagosServicio } = await import('./apps/api/src/tus/finance/servicios/habilitacion-pagos.ts')
    const run = 'ev' + Date.now().toString(36) + Math.floor(Math.random() * 1000)
    const tenant = run + '-plataforma'
    const service = new ServicioEvidenciasHabilitacion(new AlmacenAdminEvidenciasPrisma(prisma), { tenantId: tenant, profile: 'render-native', scope: 'argentina-stage-1' })
    const gates = crearHabilitacionPagosServicio(new EvaluadorHabilitacion(new AlmacenPrismaEvidenciaHabilitacion(prisma)), { tenantId: tenant, profile: 'render-native' })
    const admin = { actorId: run + '-admin', correlationId: run + '-corr' }
    const codeOf = async (op) => { try { await op(); return 'none' } catch (e) { return e?.code ?? String(e) } }
    const valida = (gate, ref) => ({ capability: 'service-payments', gate, owner: 'Responsable', evidenceType: 'Acta de aprobación', evidenceRef: ref ?? 'ACTA-' + gate + '-1', policyVersion: 'tus-readiness-v1' })
    const out = {}
    try {
      out.antes = (await gates.estado()).servicePayments.blockers.length
      const ids = {}
      for (const gate of ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider']) ids[gate] = (await service.registrar(admin, valida(gate))).evidenceId
      out.autorizada = [await gates.autorizada(), (await gates.estado()).settlement.authorized]
      const filas = await prisma.evidenciaHabilitacion.findMany({ where: { tenantId: tenant } })
      out.filas = [filas.length, [...new Set(filas.map((f) => [f.capability, f.scope, f.source, f.profile, f.execution, f.evidenceClass, f.liveConformance, f.revoked].join('|')))]]
      out.auditoria = (await prisma.auditEvent.findMany({ where: { tenantId: tenant }, orderBy: { occurredAt: 'asc' } })).map((e) => [e.eventType, e.actorId === admin.actorId, e.correlationId === admin.correlationId, e.outcome]).slice(0, 1)
      out.duplicadas = [await codeOf(() => service.registrar(admin, valida('tax', 'ACTA-tax-2'))), await codeOf(() => service.registrar(admin, valida('tax')))]
      // Two registrations racing for one requirement of another capability: one current record.
      const carrera = await Promise.all(['A', 'B', 'C'].map((letra) => codeOf(() => service.registrar(admin, { ...valida('legal', 'CARRERA-' + letra), capability: 'settlement' }))))
      out.carrera = [carrera.filter((c) => c === 'none').length, await prisma.evidenciaHabilitacion.count({ where: { tenantId: tenant, capability: 'settlement', gate: 'legal', revoked: false } }), carrera.filter((c) => c !== 'none').every((c) => c === 'EVIDENCE_ALREADY_CURRENT')]
      const revocada = await service.revocar(admin, ids.tax, { reason: 'Dictamen reemplazado' })
      out.revocada = [revocada.status, (await gates.estado()).servicePayments.blockers, await codeOf(() => service.revocar(admin, ids.tax, { reason: 'otra vez' }))]
      await service.registrar(admin, valida('tax', 'ACTA-tax-2'))
      out.renovada = await gates.autorizada()
      const eventos = await prisma.auditEvent.findMany({ where: { tenantId: tenant } })
      out.eventos = [eventos.filter((e) => e.eventType === 'readiness.evidence_registered').length, eventos.filter((e) => e.eventType === 'readiness.evidence_revoked').map((e) => [e.metadata.gate, e.metadata.reason])]
      out.lista = (await service.listar()).capabilities.map((item) => [item.capability, item.evidence.map((e) => e.gate + ':' + e.status).sort()])
    } finally { await prisma.$disconnect() }
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.antes, 6)
  assert.deepEqual(r.autorizada, [true, false])
  assert.deepEqual(r.filas, [6, ['service-payments|argentina-stage-1|authorized-external|render-native|live|authorized-external|true|false']])
  assert.deepEqual(r.auditoria, [['readiness.evidence_registered', true, true, 'success']])
  assert.deepEqual(r.duplicadas, ['EVIDENCE_ALREADY_CURRENT', 'EVIDENCE_REFERENCE_ALREADY_USED'])
  assert.deepEqual(r.carrera, [1, 1, true], 'concurrent registrations leave one current record')
  assert.deepEqual(r.revocada, ['revoked', ['tax:evidence_revoked'], 'NOT_FOUND'])
  assert.equal(r.renovada, true)
  assert.deepEqual(r.eventos, [8, [['tax', 'Dictamen reemplazado']]])
  assert.deepEqual(r.lista, [
    ['service-payments', ['kyb:current', 'kyc:current', 'legal:current', 'mercadoPago:current', 'runtimeProvider:current', 'tax:current', 'tax:revoked']],
    ['settlement', ['legal:current']],
  ])
})
