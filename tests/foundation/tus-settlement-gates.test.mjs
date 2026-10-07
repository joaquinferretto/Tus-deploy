import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  EvaluadorHabilitacion,
  HabilitacionBloqueadaError,
  PuertoMemoriaHabilitacion,
  crearEvidenciaHabilitacion,
  evaluarHabilitacion,
  requisitosDeCapacidad,
  requisitosNoRequeridos,
} from '../../apps/api/src/tus/readiness/index.ts'
import { crearHabilitacionPagosServicio } from '../../apps/api/src/tus/finance/servicios/habilitacion-pagos.ts'

// SETTLEMENT-GATES-01. The gate of the general marketplace (`settlement`):
//   core, always   legal, kyc, kyb, tax, mercadoPago, runtimeProvider
//   aws            only when the process runs with the AWS deployment profile
//   posPilot       only for an operation processed through the POS
//   groqMigration  never: the assistant cannot block charges, commissions or settlements
// The condition comes from the real deployment profile and from the flow of the operation, never
// from a manual switch. Everything is evaluated through the same evidence-based evaluator.
const root = join(import.meta.dirname, '..', '..')
const TENANT = 'tus-platform'
const SCOPE = 'argentina-stage-1'
const NOW = '2026-10-07T12:00:00.000Z'
const NUCLEO = ['legal', 'kyc', 'kyb', 'tax', 'mercadoPago', 'runtimeProvider']

const evidencia = (gates, profile, capability = 'settlement') =>
  gates.map((gate) =>
    crearEvidenciaHabilitacion({
      evidenceId: `ev-${capability}-${gate}`, tenantId: TENANT, capability, gate, owner: `${gate}-owner`, scope: SCOPE, evidenceType: 'approval', evidenceRef: `ref-${capability}-${gate}`,
      policyVersion: 'policy-1', issuedAt: '2026-10-01T00:00:00.000Z', expiresAt: null, revoked: false, source: 'authorized-external', profile, execution: 'live',
    })
  )

// The decision a real operation gets: the evaluator, with the profile the process runs with.
async function decidir(profile, gates, flow) {
  const evaluador = new EvaluadorHabilitacion(new PuertoMemoriaHabilitacion({ evidence: evidencia(gates, profile), now: NOW }))
  try {
    const decision = await evaluador.require({ tenantId: TENANT, actorId: 'system:test', correlationId: 'corr-1', capability: 'settlement', profile, scope: SCOPE, ...(flow ? { flow } : {}) })
    return { autorizada: decision.enabled && decision.disposition === 'authorized', faltan: [] }
  } catch (error) {
    assert.ok(error instanceof HabilitacionBloqueadaError)
    return { autorizada: false, faltan: error.decision.failedGates.map(({ gate, reason }) => `${gate}:${reason}`) }
  }
}

test('SETTLEMENT core: legal, kyc, kyb, tax, mercadoPago and runtimeProvider are always evaluated, each one blocks by itself', async () => {
  assert.deepEqual([...requisitosDeCapacidad('settlement', { profile: 'render-native' })], NUCLEO)
  assert.deepEqual(await decidir('render-native', []), { autorizada: false, faltan: NUCLEO.map((gate) => `${gate}:evidence_missing`) })
  for (const falta of NUCLEO) {
    const decision = await decidir('render-native', NUCLEO.filter((gate) => gate !== falta))
    assert.deepEqual(decision, { autorizada: false, faltan: [`${falta}:evidence_missing`] }, falta)
  }
})

test('SETTLEMENT aws: outside AWS (Hostinger runs with the render-native profile) no AWS evidence is asked and settlement can be authorized; on the AWS runtime it is required again by itself', async () => {
  // Hostinger, without any AWS evidence.
  assert.deepEqual(await decidir('render-native', NUCLEO), { autorizada: true, faltan: [] })
  assert.deepEqual(requisitosNoRequeridos('settlement', { profile: 'render-native' }), [{ gate: 'aws', reason: 'not_required_in_runtime' }, { gate: 'posPilot', reason: 'not_required_for_flow' }])
  // The same evidence on the AWS runtime: blocked until AWS has valid evidence.
  assert.deepEqual([...requisitosDeCapacidad('settlement', { profile: 'aws-terraform' })], [...NUCLEO, 'aws'])
  assert.deepEqual(await decidir('aws-terraform', NUCLEO), { autorizada: false, faltan: ['aws:evidence_missing'] })
  assert.deepEqual(await decidir('aws-terraform', [...NUCLEO, 'aws']), { autorizada: true, faltan: [] })
  assert.deepEqual(requisitosNoRequeridos('settlement', { profile: 'aws-terraform' }), [{ gate: 'posPilot', reason: 'not_required_for_flow' }])
  // Evidence that is not valid does not count there either.
  const vencida = [...evidencia(NUCLEO, 'aws-terraform'), { ...evidencia(['aws'], 'aws-terraform')[0], expiresAt: '2026-10-02T00:00:00.000Z' }]
  const decision = evaluarHabilitacion({ tenantId: TENANT, capability: 'settlement', scope: SCOPE, now: NOW, evidence: vencida, profile: 'aws-terraform' })
  assert.deepEqual([decision.enabled, decision.failedGates], [false, [{ gate: 'aws', reason: 'evidence_expired' }]])
  // The condition is the profile of the process: nothing else in the code decides it.
  const fuente = readFileSync(join(root, 'apps/api/src/tus/readiness/index.ts'), 'utf8')
  assert.match(fuente, /gate: 'aws', requerido: \(contexto\) => contexto\.profile === 'aws-terraform'/u)
  assert.doesNotMatch(fuente, /process\.env|env\[/u, 'no environment switch inside the readiness rules')
  assert.match(readFileSync(join(root, 'apps/api/src/tus/composition/index.ts'), 'utf8'), /PERFILES_HABILITACION\.find\(\(perfil\) => perfil === env\['TUS_DEPLOYMENT_PROFILE'\]\)/u, 'the profile is the deployment profile of the process')
})

test('SETTLEMENT posPilot: an ordinary payment (Web, WhatsApp, deposit, settlement through Mercado Pago) does not need the POS pilot; an operation through the POS does', async () => {
  assert.deepEqual(await decidir('render-native', NUCLEO), { autorizada: true, faltan: [] })
  assert.deepEqual([...requisitosDeCapacidad('settlement', { profile: 'render-native', flow: 'pos' })], [...NUCLEO, 'posPilot'])
  assert.deepEqual(await decidir('render-native', NUCLEO, 'pos'), { autorizada: false, faltan: ['posPilot:evidence_missing'] })
  assert.deepEqual(await decidir('render-native', [...NUCLEO, 'posPilot'], 'pos'), { autorizada: true, faltan: [] })
  assert.deepEqual(requisitosNoRequeridos('settlement', { profile: 'render-native', flow: 'pos' }), [{ gate: 'aws', reason: 'not_required_in_runtime' }])
  // Both conditions at once.
  assert.deepEqual(await decidir('aws-terraform', NUCLEO, 'pos'), { autorizada: false, faltan: ['aws:evidence_missing', 'posPilot:evidence_missing'] })
  // The POS itself keeps its own gate, where the pilot is always required.
  assert.deepEqual([...requisitosDeCapacidad('fleet')], ['legal', 'kyc', 'kyb', 'tax', 'posPilot', 'runtimeProvider'])
  assert.match(readFileSync(join(root, 'apps/api/src/tus/pos/index.ts'), 'utf8'), /capability: 'fleet'/u)
})

test('SETTLEMENT groq: the migration of Groq is not a requirement of settlement in any runtime or flow, so the assistant being down or not configured changes nothing; the assistant reports its own state apart', async () => {
  for (const contexto of [{}, { profile: 'render-native' }, { profile: 'aws-terraform' }, { profile: 'aws-terraform', flow: 'pos' }])
    assert.equal(requisitosDeCapacidad('settlement', contexto).includes('groqMigration'), false, JSON.stringify(contexto))
  assert.equal(requisitosNoRequeridos('settlement', { profile: 'render-native' }).some(({ gate }) => gate === 'groqMigration'), false, 'not listed at all, not even as "not required"')
  // No Groq evidence anywhere, no Groq configuration: settlement is authorized.
  assert.deepEqual(await decidir('render-native', NUCLEO), { autorizada: true, faltan: [] })
  // A revoked Groq record of settlement left from before does not block either.
  const conGroqRevocado = [...evidencia(NUCLEO, 'render-native'), { ...evidencia(['groqMigration'], 'render-native')[0], revoked: true }]
  assert.equal(evaluarHabilitacion({ tenantId: TENANT, capability: 'settlement', scope: SCOPE, now: NOW, evidence: conGroqRevocado, profile: 'render-native' }).enabled, true)
  // The readiness of the assistant's actions keeps it.
  // PROVIDER-ACTIONS-GATES-01: no capability that moves money or records a transaction asks for it.
  for (const capacidad of ['settlement', 'provider-actions', 'service-payments', 'release-jobs', 'fleet', 'publication'])
    assert.equal(requisitosDeCapacidad(capacidad, { profile: 'aws-terraform', flow: 'pos' }).includes('groqMigration'), false, capacidad)
  // Nothing of the model takes part in the decision of money.
  for (const archivo of ['apps/api/src/tus/readiness/index.ts', 'apps/api/src/tus/finance/servicios/habilitacion-pagos.ts'])
    assert.doesNotMatch(readFileSync(join(root, archivo), 'utf8'), /GROQ_|groq\.ts|ChatProvider/u, archivo)
})

test('SETTLEMENT in Admin: the status of payments reports settlement without AWS, POS or Groq as blockers on Hostinger, and with AWS as a blocker on the AWS runtime', async () => {
  const estado = async (profile, gates) => {
    const evaluador = new EvaluadorHabilitacion(new PuertoMemoriaHabilitacion({ evidence: evidencia(gates, profile), now: NOW }))
    return (await crearHabilitacionPagosServicio(evaluador, { tenantId: TENANT, profile }).estado()).settlement
  }
  assert.deepEqual(await estado('render-native', []), { capability: 'settlement', authorized: false, blockers: NUCLEO.map((gate) => `${gate}:evidence_missing`) })
  assert.deepEqual(await estado('render-native', NUCLEO), { capability: 'settlement', authorized: true, blockers: [] })
  assert.deepEqual(await estado('aws-terraform', NUCLEO), { capability: 'settlement', authorized: false, blockers: ['aws:evidence_missing'] })
  const pantalla = readFileSync(join(root, 'apps/web/src/components/admin/admin-evidencias.tsx'), 'utf8')
  assert.match(pantalla, /not_required_in_runtime: 'No requerido en este runtime'/u)
  assert.match(pantalla, /not_required_for_flow: 'No requerido para este flujo'/u)
  assert.match(pantalla, /posPilot: 'POS Pilot'/u)
  assert.doesNotMatch(pantalla, /groq/iu, 'Groq is not shown inside Marketplace / Settlement')
})

test('SETTLEMENT keeps the operational protections of a payment: provider identity, a valid collection account, and the commission policy are still decided in order', () => {
  const fuente = readFileSync(join(root, 'apps/api/src/tus/finance/servicios/configuracion.ts'), 'utf8')
  // The runtime policy (the one production composes), not the fixed one of isolated tests.
  const politica = fuente.slice(fuente.indexOf('export class PoliticaCobroPersistida'))
  const orden = ['PAYMENTS_DISABLED', 'PROVIDER_NOT_CONFIGURED', 'PSP_FEE_POLICY_UNDECIDED', 'PSP_FEE_POLICY_UNSUPPORTED', 'PROVIDER_IDENTITY_NOT_VERIFIED', 'PROVIDER_ACCOUNT_NOT_CONNECTED'].map((motivo) => politica.indexOf(`reason: '${motivo}'`))
  assert.ok(orden.every((posicion) => posicion > 0), 'every protection is still there')
  assert.deepEqual([...orden].sort((a, b) => a - b), orden, 'and in the same order')
})

// PROVIDER-ACTIONS-GATES-01. Payment intents, evidence, provider webhooks and deterministic
// WhatsApp actions: no model takes part, so Groq cannot hold them; AWS only on the AWS runtime.
test('PROVIDER-ACTIONS: its core is legal, kyc, kyb, tax, mercadoPago and runtimeProvider; aws is asked only on the AWS runtime and the migration of Groq never; every other protection is the same', async () => {
  const decidirAcciones = async (profile, gates) => {
    const evaluador = new EvaluadorHabilitacion(new PuertoMemoriaHabilitacion({ evidence: evidencia(gates, profile, 'provider-actions'), now: NOW }))
    try {
      await evaluador.require({ tenantId: TENANT, actorId: 'system:test', correlationId: 'corr-pa', capability: 'provider-actions', profile, scope: SCOPE })
      return []
    } catch (error) {
      return error.decision.failedGates.map(({ gate, reason }) => `${gate}:${reason}`)
    }
  }
  assert.deepEqual([...requisitosDeCapacidad('provider-actions', { profile: 'render-native' })], NUCLEO)
  assert.deepEqual([...requisitosDeCapacidad('provider-actions', { profile: 'aws-terraform' })], [...NUCLEO, 'aws'])
  assert.deepEqual(requisitosNoRequeridos('provider-actions', { profile: 'render-native' }), [{ gate: 'aws', reason: 'not_required_in_runtime' }])
  // Hostinger, without AWS or Groq evidence: authorized. Each requirement of the core still blocks.
  assert.deepEqual(await decidirAcciones('render-native', NUCLEO), [])
  for (const falta of NUCLEO) assert.deepEqual(await decidirAcciones('render-native', NUCLEO.filter((gate) => gate !== falta)), [`${falta}:evidence_missing`], falta)
  // On AWS the evidence is required again.
  assert.deepEqual(await decidirAcciones('aws-terraform', NUCLEO), ['aws:evidence_missing'])
  assert.deepEqual(await decidirAcciones('aws-terraform', [...NUCLEO, 'aws']), [])
  // The operations it guards did not change.
  const finanzas = readFileSync(join(root, 'apps/api/src/tus/finance/index.ts'), 'utf8')
  assert.equal(finanzas.match(/requerirHabilitacion\(input, 'provider-actions'\)/gu)?.length, 2, 'payment intents and evidence')
  assert.match(readFileSync(join(root, 'apps/api/src/tus/whatsapp/index.ts'), 'utf8'), /capability: 'provider-actions'/u)
  assert.match(readFileSync(join(root, 'apps/api/src/tus/integration/index.ts'), 'utf8'), /capability: 'provider-actions'/u)
})
