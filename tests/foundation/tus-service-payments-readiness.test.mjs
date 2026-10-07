import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { validarDecisionHabilitacion, validarEvidenciaHabilitacion } from '../../packages/contracts/src/index.ts'
import {
  EvaluadorHabilitacion,
  PuertoMemoriaHabilitacion,
  crearEvidenciaHabilitacion,
  evaluarHabilitacion,
  requisitosDeCapacidad,
} from '../../apps/api/src/tus/readiness/index.ts'
import { AlmacenConfiguracionPagosEnMemoria } from '../../apps/api/src/tus/finance/servicios/configuracion.ts'
import { AlmacenCuentasCobroEnMemoria } from '../../apps/api/src/tus/finance/servicios/cuentas-cobro.ts'
import { crearModuloPagosServicio } from '../../apps/api/src/tus/finance/servicios/composicion-pagos.ts'
import { crearHabilitacionPagosServicio } from '../../apps/api/src/tus/finance/servicios/habilitacion-pagos.ts'

// Service payments (deposit of a turno, deposit and balance of a request-born work) have their
// own readiness capability: `service-payments`. `settlement` is the gate of the
// general marketplace and never authorizes a service payment, nor the other way around.
const root = join(import.meta.dirname, '..', '..')
const TENANT = 'tus-platform'
const SCOPE = 'argentina-stage-1'
const PROFILE = 'render-native'
const NOW = '2026-10-02T12:00:00.000Z'
const SERVICE_PAYMENT_GATES = ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider']
// SETTLEMENT-GATES-01: the core of settlement. `aws` (only on the AWS runtime) and `posPilot` (only
// for an operation through the POS) are conditional; the migration of Groq is not part of it.
const SETTLEMENT_GATES = ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider']

function evidence(capability, gates, overrides = {}) {
  return gates.map((gate) =>
    crearEvidenciaHabilitacion({
      tenantId: TENANT,
      capability,
      gate,
      owner: 'owner-of-' + gate,
      scope: SCOPE,
      evidenceType: 'approval-record',
      evidenceRef: 'ref-' + capability + '-' + gate,
      evidenceId: 'evidence-' + capability + '-' + gate,
      policyVersion: 'tus-readiness-v1',
      issuedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: null,
      revoked: false,
      source: 'authorized-external',
      profile: PROFILE,
      ...overrides,
    }),
  )
}

const decide = (capability, records) => evaluarHabilitacion({ tenantId: TENANT, capability, scope: SCOPE, now: NOW, evidence: records })
const missing = (decision) => decision.failedGates.filter(({ reason }) => reason === 'evidence_missing').map(({ gate }) => gate)

test('service-payments asks for legal, kyc, kyb, tax, mercadoPago and runtimeProvider; settlement asks for the same core, plus aws only on the AWS runtime and posPilot only for a POS operation, and never for the migration of Groq', () => {
  assert.deepEqual([...requisitosDeCapacidad('service-payments')], SERVICE_PAYMENT_GATES)
  assert.deepEqual([...requisitosDeCapacidad('settlement')], SETTLEMENT_GATES)
  assert.deepEqual([...requisitosDeCapacidad('settlement', { profile: 'render-native' })], SETTLEMENT_GATES, 'not on AWS: aws is not asked')
  assert.deepEqual([...requisitosDeCapacidad('settlement', { profile: 'aws-terraform' })], [...SETTLEMENT_GATES, 'aws'], 'on AWS it is required again')
  assert.deepEqual([...requisitosDeCapacidad('settlement', { profile: 'render-native', flow: 'pos' })], [...SETTLEMENT_GATES, 'posPilot'], 'an operation through the POS needs the pilot')
  assert.equal(requisitosDeCapacidad('settlement', { profile: 'aws-terraform', flow: 'pos' }).includes('groqMigration'), false, 'the assistant never gates money')
  for (const gate of ['posPilot', 'aws', 'groqMigration'])
    assert.equal(requisitosDeCapacidad('service-payments').includes(gate), false, `${gate} is not a requirement of service payments`)
  // The other capabilities are untouched.
  assert.deepEqual([...requisitosDeCapacidad('publication')], ['legal', 'kyb', 'tax', 'runtimeProvider'])
  assert.deepEqual([...requisitosDeCapacidad('fleet')], ['legal', 'kyc', 'kyb', 'tax', 'posPilot', 'runtimeProvider'])
})

test('service-payments is authorized with its six records and without posPilot, aws or groqMigration; settlement, with the same six requirements under its own capability, is authorized too outside AWS and the POS', () => {
  const authorized = decide('service-payments', evidence('service-payments', SERVICE_PAYMENT_GATES))
  assert.equal(authorized.enabled, true)
  assert.equal(authorized.disposition, 'authorized')
  assert.deepEqual(authorized.failedGates, [])
  assert.doesNotThrow(() => validarDecisionHabilitacion(authorized))

  // SETTLEMENT-GATES-01: before, settlement still lacked posPilot, aws and groqMigration here.
  const settlement = decide('settlement', evidence('settlement', SERVICE_PAYMENT_GATES))
  assert.equal(settlement.enabled, true)
  assert.deepEqual(settlement.failedGates, [])
})

test('evidence is specific to its capability: settlement evidence does not authorize service payments and service-payments evidence does not authorize settlement', () => {
  const settlementOnly = evidence('settlement', SETTLEMENT_GATES)
  assert.equal(decide('settlement', settlementOnly).enabled, true)
  const servicePayments = decide('service-payments', settlementOnly)
  assert.equal(servicePayments.enabled, false)
  assert.deepEqual(missing(servicePayments), SERVICE_PAYMENT_GATES)

  const serviceOnly = evidence('service-payments', SERVICE_PAYMENT_GATES)
  assert.deepEqual(missing(decide('settlement', serviceOnly)), SETTLEMENT_GATES, 'evidence of another capability never counts')
})

test('service-payments is blocked when any one of its requirements has no evidence', () => {
  for (const absent of SERVICE_PAYMENT_GATES) {
    const decision = decide('service-payments', evidence('service-payments', SERVICE_PAYMENT_GATES.filter((gate) => gate !== absent)))
    assert.equal(decision.enabled, false, `${absent} is required`)
    assert.deepEqual(decision.failedGates, [{ gate: absent, reason: 'evidence_missing' }])
  }
})

test('service-payments evidence must be real: revoked, expired, future, deterministic, deferred, out-of-scope or foreign records do not authorize', () => {
  const todo = (overrides, gate = 'mercadoPago') => [
    ...evidence('service-payments', SERVICE_PAYMENT_GATES.filter((item) => item !== gate)),
    ...evidence('service-payments', [gate], overrides),
  ]
  const reasonOf = (records, gate = 'mercadoPago') => decide('service-payments', records).failedGates.find((item) => item.gate === gate)?.reason
  assert.equal(reasonOf(todo({ revoked: true })), 'evidence_revoked')
  assert.equal(reasonOf(todo({ expiresAt: '2026-10-01T00:00:00.000Z' })), 'evidence_expired')
  assert.equal(reasonOf(todo({ issuedAt: '2026-12-01T00:00:00.000Z' })), 'evidence_not_yet_valid')
  assert.equal(reasonOf(todo({ source: 'deterministic-test-only' })), 'deterministic_test_only')
  assert.equal(reasonOf(todo({ source: 'deferred', liveConformance: false })), 'evidence_deferred')
  assert.equal(reasonOf(todo({ scope: 'another-scope' })), 'evidence_out_of_scope')
  assert.equal(reasonOf(todo({ tenantId: 'another-tenant' })), 'evidence_missing')
  // Two current records for one requirement are a conflict, not a stronger approval.
  const duplicated = [...evidence('service-payments', SERVICE_PAYMENT_GATES), ...evidence('service-payments', ['legal'], { evidenceId: 'second', evidenceRef: 'second' })]
  assert.equal(reasonOf(duplicated, 'legal'), 'evidence_conflict')
})

test('the contract and its JSON schemas know the capability', () => {
  const [record] = evidence('service-payments', ['legal'])
  assert.equal(validarEvidenciaHabilitacion(record).capability, 'service-payments')
  assert.throws(() => validarEvidenciaHabilitacion({ ...record, capability: 'servicePayments' }), /capability is unsupported/u)
  for (const name of ['readiness-evidence', 'readiness-decision']) {
    const schema = JSON.parse(readFileSync(join(root, `packages/contracts/schemas/tus/${name}.v1.schema.json`), 'utf8'))
    assert.deepEqual(schema.properties.capability.enum, ['publication', 'provider-actions', 'settlement', 'service-payments', 'fleet', 'release-jobs'])
  }
})

// A production runtime with every Mercado Pago variable present, plus every flag somebody might
// hope turns the gate off.
const productionEnv = {
  TUS_MERCADOPAGO_ENABLED: 'true',
  MERCADO_PAGO_ENVIRONMENT: 'production',
  MERCADO_PAGO_CLIENT_ID: 'fictitious-client-id',
  MERCADO_PAGO_CLIENT_SECRET: 'fictitious-client-secret',
  MERCADO_PAGO_WEBHOOK_SECRET: 'fictitious-webhook-secret',
  MERCADO_PAGO_OAUTH_REDIRECT_URI: 'https://api.tus.test/tus/v1/integrations/mercado-pago/oauth/callback',
  MERCADO_PAGO_NOTIFICATION_URL: 'https://api.tus.test/tus/v1/integrations/mercado-pago/webhooks',
  TUS_PAYMENT_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64'),
  TUS_WEB_BASE_URL: 'https://web.tus.test',
  TUS_PLATFORM_ADMIN_TENANT_ID: TENANT,
  TUS_DEPLOYMENT_PROFILE: PROFILE,
  TUS_SERVICE_PAYMENTS_AUTHORIZED: 'true',
  TUS_SERVICE_PAYMENTS_ENABLED: 'true',
  TUS_PRODUCTION_AUTHORIZED: 'true',
  TUS_SETTLEMENT_ENABLED: 'true',
  TUS_PROVIDER_ACTIONS_ENABLED: 'true',
  TUS_READINESS_BYPASS: 'true',
}

async function runtime(records, { env = productionEnv, legacy } = {}) {
  const puerto = new PuertoMemoriaHabilitacion({ evidence: records, ...(legacy ? { legacy } : {}) })
  const gate = crearHabilitacionPagosServicio(new EvaluadorHabilitacion(puerto), { tenantId: TENANT, profile: PROFILE })
  const modulo = crearModuloPagosServicio({
    env,
    configuracion: new AlmacenConfiguracionPagosEnMemoria(),
    cuentas: new AlmacenCuentasCobroEnMemoria(),
    produccionAutorizada: gate.autorizada,
    habilitaciones: gate.estado,
  })
  await modulo.configuracion.registrarConfiguracion({ actorId: 'admin', correlationId: 'c' }, { paymentsEnabled: true, reason: 'test', expectedVersion: 0 })
  return {
    availability: await modulo.politica.disponibilidad({ prestadorTenantId: 'provider-tenant', prestadorId: 'provider-1', categoria: null }),
    status: await modulo.configuracion.estado(),
  }
}

// PAGOS-HABILITACION-TECNICA-01: the evidence is the readiness for the public launch. It is
// reported requirement by requirement and it no longer decides whether a payment can be charged.
test('production without evidence: the missing approvals are reported as public launch readiness and are not a blocker of the payment engine; no flag marks them as held', async () => {
  const { availability, status } = await runtime([])
  assert.deepEqual(availability, { available: false, reason: 'PROVIDER_ACCOUNT_NOT_CONNECTED' }, 'what is missing is a real control: nobody to collect for this provider')
  assert.equal(status.blockers.includes('PRODUCTION_READINESS_NOT_AUTHORIZED'), false)
  assert.equal(status.readiness.gate, 'service-payments')
  assert.equal(status.readiness.requiredNow, false)
  assert.deepEqual(status.publicLaunchReadiness, { capability: 'public-launch-readiness', ready: false, gates: SERVICE_PAYMENT_GATES.map((gate) => ({ gate, status: 'pending' })) })
  assert.deepEqual(status.readiness.servicePayments, { capability: 'service-payments', authorized: false, blockers: SERVICE_PAYMENT_GATES.map((gate) => `${gate}:evidence_missing`) })
  assert.deepEqual(status.readiness.settlement, { capability: 'settlement', authorized: false, blockers: SETTLEMENT_GATES.map((gate) => `${gate}:evidence_missing`) })
  assert.equal(JSON.stringify(status).includes('fictitious'), false, 'the status never carries a configured value')

  // A legacy "everything approved" boolean record cannot stand in for evidence either.
  const allTrue = { enabled: true, failedGates: [] }
  const withLegacy = await runtime([], { legacy: allTrue })
  assert.equal(withLegacy.availability.reason, 'PROVIDER_ACCOUNT_NOT_CONNECTED')
  assert.equal(withLegacy.status.readiness.servicePayments.authorized, false)
  assert.equal(withLegacy.status.publicLaunchReadiness.ready, false, 'and it never marks the public launch as ready')
})

test('production with the six service-payments records: the public launch readiness is complete, settlement is still its own gate, and the payment still depends on the provider', async () => {
  const { availability, status } = await runtime(evidence('service-payments', SERVICE_PAYMENT_GATES))
  // Past the readiness gate: what is missing now is a fact of the provider, not of the platform.
  assert.deepEqual(availability, { available: false, reason: 'PROVIDER_ACCOUNT_NOT_CONNECTED' })
  assert.equal(status.blockers.includes('PRODUCTION_READINESS_NOT_AUTHORIZED'), false)
  assert.deepEqual(status.readiness.servicePayments, { capability: 'service-payments', authorized: true, blockers: [] })
  assert.deepEqual(status.publicLaunchReadiness, { capability: 'public-launch-readiness', ready: true, gates: SERVICE_PAYMENT_GATES.map((gate) => ({ gate, status: 'current' })) })
  assert.equal(status.readiness.settlement.authorized, false, 'settlement is still blocked')
  assert.deepEqual(status.readiness.settlement.blockers, SETTLEMENT_GATES.map((gate) => `${gate}:evidence_missing`))
})

test('production with settlement fully evidenced but no service-payments evidence: the public launch readiness stays incomplete; settlement evidence never counts for it', async () => {
  const { availability, status } = await runtime(evidence('settlement', SETTLEMENT_GATES))
  assert.equal(availability.reason, 'PROVIDER_ACCOUNT_NOT_CONNECTED')
  assert.equal(status.readiness.settlement.authorized, true)
  assert.equal(status.readiness.servicePayments.authorized, false)
  assert.equal(status.publicLaunchReadiness.ready, false)
  assert.equal(status.blockers.includes('PRODUCTION_READINESS_NOT_AUTHORIZED'), false)
})

test('sandbox: the gate is reported but does not block, because no real money moves', async () => {
  const { availability, status } = await runtime([], { env: { ...productionEnv, MERCADO_PAGO_ENVIRONMENT: 'sandbox' } })
  assert.equal(availability.reason, 'PROVIDER_ACCOUNT_NOT_CONNECTED')
  assert.equal(status.readiness.requiredNow, false)
  assert.equal(status.readiness.servicePayments.authorized, false)
  assert.equal(status.blockers.includes('PRODUCTION_READINESS_NOT_AUTHORIZED'), false)
})

test('a failing evaluation is "not authorized", never an open gate', async () => {
  const roto = { listEvidence: () => { throw new Error('database unavailable') } }
  const gate = crearHabilitacionPagosServicio(new EvaluadorHabilitacion(roto), { tenantId: TENANT, profile: PROFILE })
  assert.equal(await gate.autorizada(), false)
  assert.deepEqual((await gate.estado()).servicePayments, { capability: 'service-payments', authorized: false, blockers: ['READINESS_EVALUATION_FAILED'] })
  // Without a platform tenant there is no context to evaluate against.
  const sinTenant = crearHabilitacionPagosServicio(new EvaluadorHabilitacion(new PuertoMemoriaHabilitacion()), { tenantId: '', profile: PROFILE })
  assert.deepEqual((await sinTenant.estado()).servicePayments.blockers, ['readiness_context_missing'])
})

test('the runtime composes service payments against service-payments, reads no flag for it, and the status stays behind the platform-admin check', () => {
  const composition = readFileSync(join(root, 'apps/api/src/tus/composition/index.ts'), 'utf8')
  assert.match(composition, /const tenantPlataforma = env\['TUS_PLATFORM_ADMIN_TENANT_ID'\]\?\.trim\(\) \|\| 'tus-platform'/u)
  assert.match(composition, /crearHabilitacionPagosServicio\(evaluadorHabilitacion, \{ tenantId: tenantPlataforma, profile: perfilPagos \}\)/u)
  // The registry writes for the very tenant, profile and scope the decision is evaluated for.
  assert.match(composition, /new ServicioEvidenciasHabilitacion\(new AlmacenAdminEvidenciasPrisma\([^)]*\), \{ tenantId: tenantPlataforma, profile: perfilPagos, scope: ALCANCE_PAGOS_SERVICIO \}\)/u)
  assert.match(composition, /produccionAutorizada: habilitacionPagos\.autorizada, habilitaciones: habilitacionPagos\.estado/u)
  assert.doesNotMatch(composition, /actorId: 'system:service-payments'[^\n]*capability: 'settlement'/u, 'service payments are no longer evaluated against settlement')

  const gate = readFileSync(join(root, 'apps/api/src/tus/finance/servicios/habilitacion-pagos.ts'), 'utf8')
  assert.doesNotMatch(gate.replace(/\/\/.*$/gmu, ''), /process\.env|env\[/u, 'the gate takes no input from the environment')

  const router = readFileSync(join(root, 'apps/api/src/tus/http/router.ts'), 'utf8')
  const status = router.slice(router.indexOf("router.get(['/tus/v1/admin/payments/status']"))
  assert.match(status.slice(0, 400), /if \(!isPlatformPaymentsAdmin\(context, application\)\) \{\s+sendError\(response, 403, 'FORBIDDEN'/u)
  // The marketplace keeps its own gate.
  assert.match(readFileSync(join(root, 'apps/api/src/tus/catalog/index.ts'), 'utf8'), /capability: 'settlement'/u)
})
