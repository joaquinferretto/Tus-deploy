import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { ClienteMetaPlantillas, componentesDe, configuracionDesdeEnv, definicionesDeTus, diferencias, planificar, redactar, sincronizar } from '../../scripts/meta/plantillas-lib.mjs'

// Administration of the WhatsApp templates from scripts (scripts/meta). Meta is a stand-in at the
// `fetch` boundary: nothing here reaches graph.facebook.com.
const root = join(import.meta.dirname, '../..')
const TOKEN = 'EAAficticioTokenDePrueba1234567890'

function meta(remotas) {
  const pedidos = []
  const fetch = async (url, init) => {
    pedidos.push({ method: init.method, url: String(url), auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : null })
    const u = new URL(url)
    if (init.method === 'GET') return { ok: true, status: 200, json: async () => ({ data: remotas }) }
    if (u.pathname.endsWith('/message_templates')) return { ok: true, status: 200, json: async () => ({ id: 'nueva-1', status: 'PENDING', category: 'UTILITY' }) }
    if (u.pathname.endsWith('/bloqueada')) return { ok: false, status: 400, json: async () => ({ error: { code: 100, message: `Invalid parameter access_token=${TOKEN}`, error_user_msg: 'No se puede editar' } }) }
    return { ok: true, status: 200, json: async () => ({ success: true }) }
  }
  return { pedidos, cliente: new ClienteMetaPlantillas({ token: TOKEN, wabaId: '123456789', version: 'v25.0', fetch }) }
}
const remota = (definicion, extra = {}) => ({ id: 'id-' + definicion.name, name: definicion.name, language: definicion.language, category: definicion.category, status: 'APPROVED', components: componentesDe(definicion), ...extra })

test('META plantillas: the definitions of TUS (the reminders with their exact texts, variables and buttons, and a provider pair that never mentions the deposit) become the components Meta stores', async () => {
  const definiciones = await definicionesDeTus(root)
  const por = (nombre) => definiciones.find((d) => d.name === nombre)
  assert.deepEqual(['turno_solicitud_recibida', 'servicio_urgente_disponible', 'continuar_atencion_tus', 'turno_recordatorio_24h', 'turno_recordatorio_2h', 'turno_recordatorio_24h_prestador', 'turno_recordatorio_2h_prestador'].filter((n) => !por(n)), [])
  assert.equal(por('turno_recordatorio_24h').body, 'Hola, {{1}}. Te recordamos que mañana tenés un turno de {{2}} el {{3}} a las {{4}} con {{5}}. Como se informó al reservar, desde este momento la seña no es reembolsable si cancelás el turno.')
  assert.equal(por('turno_recordatorio_2h').body, 'Hola, {{1}}. Te recordamos que tu turno de {{2}} es hoy a las {{3}} con {{4}}. Si cancelás ahora, la seña abonada no es reembolsable.')
  assert.equal(por('continuar_atencion_tus').body, 'Hola, {{1}}. Queremos continuar con tu solicitud en TUS. Respondé este mensaje y seguimos con la atención por acá.')
  for (const nombre of ['turno_recordatorio_24h', 'turno_recordatorio_2h', 'turno_recordatorio_24h_prestador', 'turno_recordatorio_2h_prestador']) {
    const d = por(nombre)
    assert.equal(d.category, 'UTILITY')
    assert.equal(d.language, 'es_AR')
    assert.deepEqual(d.buttons, ['Confirmar asistencia', 'No puedo asistir'])
    // Every variable of the body has its parameter, in order.
    assert.deepEqual([...d.body.matchAll(/\{\{(\d+)\}\}/gu)].map((m) => Number(m[1])), d.parameters.map((_, i) => i + 1), nombre)
    assert.equal(nombre.endsWith('_prestador'), !/seña|reembols/iu.test(d.body), `${nombre}: only the client is told about the deposit`)
  }
  assert.deepEqual(componentesDe(por('turno_recordatorio_24h')), [
    { type: 'BODY', text: por('turno_recordatorio_24h').body, example: { body_text: [['Joaquin', 'Masaje', '9 de octubre', '15:00', 'Flor Perez']] } },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar asistencia' }, { type: 'QUICK_REPLY', text: 'No puedo asistir' }] },
  ])
  assert.deepEqual(componentesDe(por('continuar_atencion_tus'))[1], { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Continuar atención' }] })
})

test('META plantillas plan: a template is usable only if it exists, is approved, matches and is enabled in TUS; a missing one is created, a different one is updated (which sends it to review again), one in review cannot be edited and the report says what to do', async () => {
  const definiciones = (await definicionesDeTus(root)).filter((d) => ['turno_recordatorio_24h', 'turno_recordatorio_2h', 'turno_solicitud_recibida', 'continuar_atencion_tus', 'servicio_urgente_disponible'].includes(d.name))
  const d = Object.fromEntries(definiciones.map((x) => [x.name, x]))
  const remotas = [
    remota(d.turno_recordatorio_24h),
    remota(d.turno_solicitud_recibida, { status: 'PENDING' }),
    remota(d.continuar_atencion_tus, { components: [{ type: 'BODY', text: 'Hola, {{1}}. Texto viejo.' }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Continuar atención' }] }] }),
    remota(d.servicio_urgente_disponible, { status: 'PENDING', components: [{ type: 'BODY', text: 'otro' }] }),
  ]
  const plan = Object.fromEntries(planificar(definiciones, remotas, new Set(['turno_recordatorio_24h', 'turno_solicitud_recibida'])).map((item) => [item.nombre, item]))
  assert.deepEqual([plan.turno_recordatorio_24h.accion, plan.turno_recordatorio_24h.utilizable, plan.turno_recordatorio_24h.id], ['nada', true, 'id-turno_recordatorio_24h'])
  // Exists and enabled in TUS, but Meta has not approved it: not usable.
  assert.deepEqual([plan.turno_solicitud_recibida.accion, plan.turno_solicitud_recibida.estado, plan.turno_solicitud_recibida.utilizable], ['nada', 'PENDING', false])
  assert.deepEqual([plan.turno_recordatorio_2h.accion, plan.turno_recordatorio_2h.utilizable, plan.turno_recordatorio_2h.diferencias], ['crear', false, ['no existe en Meta']])
  assert.equal(plan.continuar_atencion_tus.accion, 'actualizar')
  assert.match(plan.continuar_atencion_tus.nota, /revisión de Meta/u)
  assert.deepEqual(plan.continuar_atencion_tus.diferencias, ['cuerpo distinto'])
  // Approved but not in WHATSAPP_APPROVED_TEMPLATES would say so; here it differs, so never usable.
  assert.equal(plan.continuar_atencion_tus.utilizable, false)
  assert.equal(plan.servicio_urgente_disponible.accion, 'no_editable')
  assert.match(plan.servicio_urgente_disponible.nota, /no permite editar una plantilla en revisión[\s\S]*versión nueva/u)
  // Approved and equal, but not enabled in TUS.
  const sinHabilitar = planificar([d.turno_recordatorio_24h], [remota(d.turno_recordatorio_24h)], new Set())[0]
  assert.deepEqual([sinHabilitar.utilizable, /WHATSAPP_APPROVED_TEMPLATES/u.test(sinHabilitar.nota)], [false, true])
  // The same name in another language is not the template of TUS.
  const otroIdioma = planificar([d.turno_recordatorio_24h], [remota(d.turno_recordatorio_24h, { language: 'es' })], new Set(['turno_recordatorio_24h']))[0]
  assert.deepEqual([otroIdioma.accion, otroIdioma.utilizable, otroIdioma.otrosIdiomas], ['crear', false, ['es']])
  assert.deepEqual(diferencias(d.turno_recordatorio_24h, remota(d.turno_recordatorio_24h, { category: 'MARKETING' })), ['categoría: Meta MARKETING, TUS UTILITY'])
})

test('META plantillas sincronizador: dry-run by default (it only reads); applying needs the names and touches only those; it never deletes; an error of Meta is reported without the token', async () => {
  const definiciones = await definicionesDeTus(root)
  const d = Object.fromEntries(definiciones.map((x) => [x.name, x]))
  const remotas = [remota(d.continuar_atencion_tus, { components: [{ type: 'BODY', text: 'viejo' }] }), remota(d.turno_solicitud_recibida, { id: 'bloqueada', components: [{ type: 'BODY', text: 'viejo' }] })]
  const habilitadas = new Set()

  const seco = meta(remotas)
  const enSeco = await sincronizar({ cliente: seco.cliente, definiciones, habilitadas })
  assert.deepEqual(seco.pedidos.map((p) => p.method), ['GET'], 'dry-run only reads')
  assert.ok(enSeco.resultados.some((item) => item.accion === 'crear') && enSeco.resultados.every((item) => item.aplicado === false))

  const real = meta(remotas)
  const aplicado = await sincronizar({ cliente: real.cliente, definiciones, habilitadas, solo: ['turno_recordatorio_24h', 'continuar_atencion_tus', 'turno_solicitud_recibida', 'no_existe_en_tus'], aplicar: true })
  assert.deepEqual(real.pedidos.map((p) => `${p.method} ${new URL(p.url).pathname}`).sort(), ['GET /v25.0/123456789/message_templates', 'POST /v25.0/123456789/message_templates', 'POST /v25.0/bloqueada', 'POST /v25.0/id-continuar_atencion_tus'], 'only the named templates, created or edited; nothing else is touched')
  assert.ok(real.pedidos.every((p) => p.method !== 'DELETE'))
  const creada = real.pedidos.find((p) => p.method === 'POST' && p.url.endsWith('/message_templates')).body
  assert.deepEqual([creada.name, creada.language, creada.category, creada.components.length], ['turno_recordatorio_24h', 'es_AR', 'UTILITY', 2])
  assert.deepEqual(Object.keys(real.pedidos.find((p) => p.url.endsWith('/id-continuar_atencion_tus')).body), ['components'], 'an edit sends the components only (name and language cannot change)')
  const por = Object.fromEntries(aplicado.resultados.map((item) => [item.nombre, item]))
  assert.deepEqual([por.turno_recordatorio_24h.aplicado, por.turno_recordatorio_24h.estadoNuevo, por.turno_recordatorio_24h.id], [true, 'PENDING', 'nueva-1'])
  assert.equal(por.continuar_atencion_tus.aplicado, true)
  assert.equal(por.turno_solicitud_recibida.aplicado, false)
  assert.match(por.turno_solicitud_recibida.error, /100: Invalid parameter access_token=\[oculto\] — No se puede editar/u)
  assert.ok(!JSON.stringify(aplicado).includes(TOKEN), 'the token never reaches the report')
  assert.deepEqual(aplicado.desconocidas, ['no_existe_en_tus'])
  assert.ok(real.pedidos.every((p) => p.auth === `Bearer ${TOKEN}`))
})

test('META plantillas configuración y comandos: the scripts read the configuration the API already uses, show nothing secret, refuse to run without it and refuse --aplicar without names; no credential is written in them', () => {
  const config = configuracionDesdeEnv({ WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_WABA_ID: '123456789', WHATSAPP_APPROVED_TEMPLATES: ' turno_recordatorio_24h, turno_recordatorio_2h ' })
  assert.deepEqual(config.visible, { wabaId: '…6789', version: 'v25.0', token: 'presente', habilitadas: ['turno_recordatorio_24h', 'turno_recordatorio_2h'] })
  assert.ok(!JSON.stringify(config.visible).includes(TOKEN))
  assert.deepEqual(configuracionDesdeEnv({}).faltan, ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_WABA_ID'])
  assert.equal(redactar(`Bearer ${TOKEN} y ${TOKEN}`), 'Bearer [oculto] y [oculto]')
  const limpio = { ...process.env, WHATSAPP_ACCESS_TOKEN: '', WHATSAPP_WABA_ID: '' }
  for (const script of ['listar-plantillas.mjs', 'sincronizar-plantillas.mjs']) {
    const sinConfig = spawnSync(process.execPath, [join(root, 'scripts/meta', script)], { encoding: 'utf8', env: limpio, timeout: 60_000 })
    assert.equal(sinConfig.status, 2, script)
    assert.match(sinConfig.stderr, /Falta configuración: WHATSAPP_ACCESS_TOKEN, WHATSAPP_WABA_ID\. No se consultó Meta\./u)
    const fuente = readFileSync(join(root, 'scripts/meta', script), 'utf8')
    assert.doesNotMatch(fuente + readFileSync(join(root, 'scripts/meta/plantillas-lib.mjs'), 'utf8'), /EAA[A-Za-z0-9]{20,}|access_token\s*[:=]\s*['"][^'"\s]+/u)
  }
  const sinNombres = spawnSync(process.execPath, [join(root, 'scripts/meta/sincronizar-plantillas.mjs'), '--aplicar'], { encoding: 'utf8', env: { ...process.env, WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_WABA_ID: '123456789' }, timeout: 60_000 })
  assert.equal(sinNombres.status, 2)
  assert.match(sinNombres.stderr, /--aplicar exige nombrar las plantillas con --solo/u)
})
