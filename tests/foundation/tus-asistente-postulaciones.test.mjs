import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// El asistente (WhatsApp) usa las postulaciones con las MISMAS reglas que la Web:
// el prestador descubre solicitudes públicas (sin PII) y se postula con confirmación; el cliente
// ve solo sus postulantes y elige con confirmación. Las tools pasan por validarYEjecutar (schema
// estricto, audiencia, confirmación) y DominioAsistenteTus, nunca por la base.
const SETUP = `
  const { createInMemoryAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
  const { crearServicioSolicitudes } = await import('./apps/api/src/tus/solicitudes/composicion.ts')
  const { DominioAsistenteTus } = await import('./apps/api/src/tus/asistente/dominio.ts')
  const tools = await import('./apps/api/src/tus/asistente/herramientas.ts')
  let now = Date.parse('2026-09-28T13:00:00.000Z')
  const clock = () => now
  let seq = 0
  const newId = () => 'id-' + String(++seq).padStart(8, '0')
  const merchants = new Map()
  const application = {
    marketplace: { store: { merchant: { find: async (t) => merchants.get(t) ?? null }, listings: { forTenant: async () => [] } } },
    identity: { identidadVerificada: async () => false },
  }
  const directorio = crearServicioDirectorio({ application, contarCompletados: async () => 0, now: clock, newId })
  const auth = createInMemoryAuthService({ now: clock })
  const solicitudes = crearServicioSolicitudes({ cuentas: auth.store, destinos: directorio, now: clock, newId })
  const domain = new DominioAsistenteTus(application, clock, { directorio, solicitudes })
  const ctx = (tenantId, subjectId = 'actor-' + tenantId) => ({ tenantId, subjectId, sessionId: 's', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'], correlationId: 'c' })
  const actor = (context, isProvider) => ({ contactId: 'contact', conversationId: 'conv', context, isProvider })
  const all = new Set(tools.HERRAMIENTAS.map((tool) => tool.name))
  const call = (name, args, who, confirmed) => tools.validarYEjecutar({ name, rawArguments: JSON.stringify(args), actor: who, domain, allowed: all, timeoutMs: 2000, ...(confirmed ? { confirmed: { idempotencyKey: 'k-' + name } } : {}) })
  async function prestador(tenantId, perfil) {
    merchants.set(tenantId, { merchantId: 'm-' + tenantId, status: 'approved' })
    return directorio.guardarPerfil(ctx(tenantId), { zone: 'Centro', ...perfil })
  }
  const registered = await auth.register({ email: 'laura@example.com', password: 'Contrasena-Segura-2026', displayName: 'Laura Martínez' })
  await auth.verifyEmail({ token: registered.verificationToken })
  const laura = registered.account
  const lauraCtx = ctx(laura.tenantId, laura.id)
  const valida = { category: 'plomeria', title: 'Pierde agua la canilla de la cocina', description: 'Gotea todo el día.', zone: 'Camba Cuá', budgetMax: 25000, urgency: 'hoy_manana' }
`

test('ASISTENTE postulaciones: provider discovers public requests without PII and applies only after confirmation', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await prestador('t-ana', { displayName: 'Ana Gómez', profession: 'electricidad' })
    const { solicitud } = await solicitudes.publicar(laura.id, valida)
    const ana = actor(ctx('t-ana'), true)
    const list = await call('search_open_requests', { profession: null, zone: 'Camba Cuá' }, ana)
    const otherZone = await call('search_open_requests', { profession: null, zone: 'Centro' }, ana)
    const preview = await call('apply_to_request', { requestId: solicitud.id, message: 'Puedo ir mañana.' }, ana)
    const beforeConfirm = (await solicitudes.postulantes(laura.id, solicitud.id)).items.length
    const applied = await call('apply_to_request', { requestId: solicitud.id, message: 'Puedo ir mañana.' }, ana, true)
    const again = await call('apply_to_request', { requestId: solicitud.id, message: null }, ana, true)
    const client = await call('search_open_requests', { profession: null, zone: null }, actor(lauraCtx, false))
    const unlinked = await call('apply_to_request', { requestId: solicitud.id, message: null }, actor(null, false), true)
    const forged = await call('search_open_requests', { profession: null, zone: null, tenantId: 't-otro' }, ana)
    console.log(JSON.stringify({ list, otherZone, preview, beforeConfirm, applied, again, client, unlinked, forged }))
  `)
  assert.equal(result.list.ok, true)
  assert.equal(result.list.data.requests.length, 1)
  assert.deepEqual(Object.keys(result.list.data.requests[0]).sort(), ['approximateArea', 'budgetMax', 'createdAt', 'description', 'profession', 'requestId', 'requesterName', 'title', 'urgency'])
  assert.equal(result.list.data.requests[0].requesterName, 'Laura M.')
  assert.doesNotMatch(JSON.stringify(result.list), /laura@example\.com|Martínez|lat|lng|cuentaId|tenant/u)
  assert.equal(result.otherZone.data.requests.length, 0)
  assert.equal(result.preview.confirmationRequired, true)
  assert.match(result.preview.summary, /Puedo ir mañana\.[\s\S]*El cliente decide/u)
  assert.equal(result.beforeConfirm, 0, 'nothing happens before the confirmation')
  assert.equal(result.applied.ok, true)
  assert.equal(result.applied.data.application.status, 'pendiente')
  assert.deepEqual(result.again, { ok: false, error: 'ALREADY_APPLIED' })
  assert.deepEqual(result.client, { ok: false, error: 'PROVIDER_REQUIRED' })
  assert.deepEqual(result.unlinked, { ok: false, error: 'LINK_REQUIRED' })
  assert.deepEqual(result.forged, { ok: false, error: 'INVALID_ARGUMENTS' }, 'strict schema rejects authority fields')
})

test('ASISTENTE postulaciones: client lists only own applicants and chooses one after confirmation', () => {
  const result = runTypeScriptScenario(`${SETUP}
    await prestador('t-ana', { displayName: 'Ana Gómez', profession: 'electricidad' })
    await prestador('t-carlos', { displayName: 'Carlos Méndez', profession: 'plomeria' })
    const { solicitud } = await solicitudes.publicar(laura.id, valida)
    const ana = await solicitudes.postular({ tenantId: 't-ana', cuentaId: 'actor-t-ana' }, solicitud.id, {})
    await solicitudes.postular({ tenantId: 't-carlos', cuentaId: 'actor-t-carlos' }, solicitud.id, { message: 'Soy plomero.' })
    const client = actor(lauraCtx, false)
    const mine = await call('list_my_open_requests', {}, client)
    const applicants = await call('list_request_applicants', { requestId: solicitud.id }, client)
    const stranger = await call('list_request_applicants', { requestId: solicitud.id }, actor(ctx('t-intrusa', 'intrusa'), false))
    const preview = await call('choose_applicant', { requestId: solicitud.id, applicationId: ana.postulacion.id }, client)
    const stillOpen = (await solicitudes.listarPublicas()).some((item) => item.id === solicitud.id)
    const chosen = await call('choose_applicant', { requestId: solicitud.id, applicationId: ana.postulacion.id }, client, true)
    const twice = await call('choose_applicant', { requestId: solicitud.id, applicationId: ana.postulacion.id }, client, true)
    const closed = !(await solicitudes.listarPublicas()).some((item) => item.id === solicitud.id)
    console.log(JSON.stringify({ mine, applicants, stranger, preview, stillOpen, chosen, twice, closed }))
  `)
  assert.equal(result.mine.data.requests[0].status, 'abierta')
  assert.deepEqual(result.applicants.data.applicants.map((item) => item.providerName), ['Ana Gómez', 'Carlos Méndez'])
  assert.doesNotMatch(JSON.stringify(result.applicants), /t-ana|t-carlos|tenantId|prestadorId/u)
  assert.deepEqual(result.stranger, { ok: false, error: 'NOT_FOUND' }, 'another account never sees the applicants')
  assert.equal(result.preview.confirmationRequired, true)
  assert.equal(result.stillOpen, true)
  assert.equal(result.chosen.ok, true)
  assert.deepEqual(result.chosen.data.result, { requestId: result.chosen.data.result.requestId, assignment: 'aceptada', providerName: 'Ana Gómez' })
  // Confirming the same choice twice is idempotent: same request, same provider, no second work.
  assert.deepEqual(result.twice.data.result, result.chosen.data.result)
  assert.equal(result.closed, true)
})

test('ASISTENTE postulaciones: intents route to the right tools per role and need a linked account', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const names = (text, isProvider) => tools.seleccionarHerramientas(tools.detectarIntencion(text), actor(ctx('t-x'), isProvider)).map((tool) => tool.name)
    console.log(JSON.stringify({
      providerIntent: tools.detectarIntencion('Mostrame trabajos de electricidad disponibles cerca mío'),
      clientIntent: tools.detectarIntencion('¿Quién se postuló a mi pedido?'),
      provider: names('Mostrame trabajos de electricidad disponibles cerca mío', true),
      client: names('¿Quién se postuló a mi pedido?', false),
      private: tools.intencionPrivada('postulaciones'),
      unlinked: tools.seleccionarHerramientas('postulaciones', actor(null, false)).map((tool) => tool.name),
    }))
  `)
  assert.equal(result.providerIntent, 'postulaciones')
  assert.equal(result.clientIntent, 'postulaciones')
  assert.ok(result.provider.includes('search_open_requests') && result.provider.includes('apply_to_request'))
  assert.deepEqual(result.client, ['list_my_open_requests', 'list_request_applicants', 'choose_applicant'])
  assert.equal(result.private, true)
  assert.deepEqual(result.unlinked, [])
})
