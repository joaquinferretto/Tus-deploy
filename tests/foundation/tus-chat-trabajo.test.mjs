import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { reviewMigrationChain } from '../../scripts/tus-migration-repair-lib.mjs'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

const SETUP = `
  const { InMemoryTrabajoStore, InMemoryTrabajoIdempotencyStore, InMemoryTrabajoOutboxStore, InMemoryTrabajoTransaction, ServicioTrabajo } = await import('./apps/api/src/tus/work/index.ts')
  const { ServicioMensajesTrabajo, AlmacenMensajesTrabajoEnMemoria } = await import('./apps/api/src/tus/work/mensajes.ts')
  let now = Date.parse('2026-09-28T15:00:00.000Z')
  const store = new InMemoryTrabajoStore()
  const work = new ServicioTrabajo(new InMemoryTrabajoTransaction({ work: store, idempotency: new InMemoryTrabajoIdempotencyStore(), outbox: new InMemoryTrabajoOutboxStore() }), () => now)
  const almacen = new AlmacenMensajesTrabajoEnMemoria()
  let seq = 0
  const chat = new ServicioMensajesTrabajo({ mensajes: almacen, trabajos: { buscarAccesible: (input) => store.findAccessible(input) }, now: () => now, newId: () => 'gen-' + (++seq) })
  const { work: trabajo } = await work.crearDesdeSolicitudEnTransaccion({ tenantId: 't-cli', actorId: 'a-cli', correlationId: 'c', solicitudId: 's-1', prestadorTenantId: 't-prov', prestadorId: 'm-prov', createdAt: '2026-09-28T14:00:00.000Z' })
  const cliente = { tenantId: 't-cli', actorId: 'a-cli' }
  const prestador = { tenantId: 't-prov', actorId: 'a-prov' }
  const tercero = { tenantId: 't-otro', actorId: 'a-otro' }
  const rechazado = { tenantId: 't-prov2', actorId: 'a-prov2' }
  const code = async (fn) => { try { await fn(); return 'none' } catch (error) { return error?.code ?? String(error) } }
`

test('CHAT: only the client and the chosen provider read and write; the role comes from the session', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const m1 = await chat.enviar(cliente, trabajo.trabajoId, { text: 'Hola, ¿cuándo podés venir? Mi dirección es Junín 1234, tel 3794 123456', clientMessageId: 'msg-cliente-0001' })
    now += 1000
    const m2 = await chat.enviar(prestador, trabajo.trabajoId, { text: 'Mañana 10 hs. Mi WhatsApp: +54 9 379 4000000', clientMessageId: 'msg-prestador-0001', authorRole: 'cliente' })
    const clientView = await chat.listar(cliente, trabajo.trabajoId)
    const providerView = await chat.listar(prestador, trabajo.trabajoId)
    const terceroLee = await code(() => chat.listar(tercero, trabajo.trabajoId))
    const terceroEscribe = await code(() => chat.enviar(tercero, trabajo.trabajoId, { text: 'hola' }))
    const rechazadoLee = await code(() => chat.listar(rechazado, trabajo.trabajoId))
    const inexistente = await code(() => chat.listar(cliente, 'trabajo-que-no-existe'))
    console.log(JSON.stringify({
      m1: [m1.created, m1.message.authorRole, m1.message.mine], m2: [m2.created, m2.message.authorRole],
      clientView: clientView.items.map((item) => [item.authorRole, item.mine, item.text.slice(0, 12)]),
      providerView: providerView.items.map((item) => [item.authorRole, item.mine]),
      terceroLee, terceroEscribe, rechazadoLee, inexistente,
      contactoGuardado: clientView.items[0].text.includes('3794 123456'),
    }))
  `)
  assert.deepEqual(result.m1, [true, 'cliente', true])
  assert.deepEqual(result.m2, [true, 'prestador'], 'the role in the body is ignored')
  assert.deepEqual(result.clientView, [['cliente', true, 'Hola, ¿cuánd'], ['prestador', false, 'Mañana 10 hs']])
  assert.deepEqual(result.providerView, [['cliente', false], ['prestador', true]])
  assert.equal(result.terceroLee, 'NOT_FOUND')
  assert.equal(result.terceroEscribe, 'NOT_FOUND')
  assert.equal(result.rechazadoLee, 'NOT_FOUND', 'a rejected provider never sees the chat')
  assert.equal(result.inexistente, 'NOT_FOUND')
  assert.equal(result.contactoGuardado, true, 'contact data is allowed in the private chat')
})

test('CHAT: text validation, control characters removed, retries never duplicate, reused ids from others are rejected', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const vacio = await code(() => chat.enviar(cliente, trabajo.trabajoId, { text: '   ' }))
    const largo = await code(() => chat.enviar(cliente, trabajo.trabajoId, { text: 'x'.repeat(2001) }))
    const noTexto = await code(() => chat.enviar(cliente, trabajo.trabajoId, { text: 123 }))
    const limite = await chat.enviar(cliente, trabajo.trabajoId, { text: 'y'.repeat(2000) })
    const limpio = await chat.enviar(cliente, trabajo.trabajoId, { text: 'hola\\u0000\\u0007 mundo\\r\\nsegunda línea' })
    const primero = await chat.enviar(cliente, trabajo.trabajoId, { text: 'reintento', clientMessageId: 'retry-0000-0001' })
    const reintento = await chat.enviar(cliente, trabajo.trabajoId, { text: 'reintento', clientMessageId: 'retry-0000-0001' })
    const robado = await code(() => chat.enviar(prestador, trabajo.trabajoId, { text: 'reintento', clientMessageId: 'retry-0000-0001' }))
    const total = (await chat.listar(cliente, trabajo.trabajoId)).items.length
    console.log(JSON.stringify({ vacio, largo, noTexto, limite: limite.created, limpio: limpio.message.text, primero: primero.created, reintento: [reintento.created, reintento.message.id === primero.message.id], robado, total }))
  `)
  assert.equal(result.vacio, 'INVALID_MESSAGE')
  assert.equal(result.largo, 'INVALID_MESSAGE')
  assert.equal(result.noTexto, 'INVALID_MESSAGE')
  assert.equal(result.limite, true)
  assert.equal(result.limpio, 'hola mundo\nsegunda línea')
  assert.equal(result.primero, true)
  assert.deepEqual(result.reintento, [false, true], 'a retry returns the same message')
  assert.equal(result.robado, 'CONFLICT')
  assert.equal(result.total, 3)
})

test('CHAT HTTP: 401 without session, 403 without permission, 404 for third parties, 201 then 200 on retry', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const { createRequire } = await import('node:module')
    const express = createRequire(process.cwd() + '/apps/api/package.json')('express')
    const { crearRouterMensajesTrabajo } = await import('./apps/api/src/tus/work/http-mensajes.ts')
    const perms = ['tus:marketplace:read', 'tus:marketplace:write']
    const tokens = { 'tok-cli': { tenantId: 't-cli', subjectId: 'a-cli', permissions: perms }, 'tok-prov': { tenantId: 't-prov', subjectId: 'a-prov', permissions: perms }, 'tok-otro': { tenantId: 't-otro', subjectId: 'a-otro', permissions: perms }, 'tok-ro': { tenantId: 't-cli', subjectId: 'a-cli', permissions: ['tus:marketplace:read'] } }
    const sessions = { resolve: async (token) => tokens[token] ? { ...tokens[token], sessionId: 's', roles: ['owner'], correlationId: 'c' } : null }
    const app = express(); app.use(express.json()); app.use(crearRouterMensajesTrabajo({ servicio: chat, sessions }))
    const server = app.listen(0); await new Promise((r) => server.once('listening', r))
    const url = 'http://127.0.0.1:' + server.address().port + '/tus/v1/trabajos/' + trabajo.trabajoId + '/mensajes'
    const h = (tok) => ({ authorization: 'Bearer ' + tok, 'x-correlation-id': 'corr', 'content-type': 'application/json' })
    const sinSesion = (await fetch(url)).status
    const post = (tok, body) => fetch(url, { method: 'POST', headers: h(tok), body: JSON.stringify(body) })
    const soloLectura = (await post('tok-ro', { text: 'hola' })).status
    const primero = await post('tok-cli', { text: 'hola prestador', clientMessageId: 'http-0000-0001' })
    const retry = await post('tok-cli', { text: 'hola prestador', clientMessageId: 'http-0000-0001' })
    const otro = (await fetch(url, { headers: h('tok-otro') })).status
    const lista = await (await fetch(url, { headers: h('tok-prov') })).json()
    const invalido = await post('tok-prov', { text: '' })
    server.close()
    console.log(JSON.stringify({ sinSesion, soloLectura, primero: primero.status, retry: retry.status, otro, lista: lista.items.map((i) => [i.authorRole, i.mine, i.text]), invalido: [invalido.status, (await invalido.json()).code] }))
  `)
  assert.equal(result.sinSesion, 401)
  assert.equal(result.soloLectura, 403)
  assert.equal(result.primero, 201)
  assert.equal(result.retry, 200)
  assert.equal(result.otro, 404)
  assert.deepEqual(result.lista, [['cliente', false, 'hola prestador']])
  assert.deepEqual(result.invalido, [422, 'INVALID_MESSAGE'])
})

test('CHAT migration is additive, append-only and bound to the work parties', async () => {
  const review = await reviewMigrationChain({ names: ['20261011100000_tus_mensajes_trabajo'] })
  assert.equal(review.accepted, true)
  const sql = await readFile(new URL('../../apps/api/prisma/migrations/20261011100000_tus_mensajes_trabajo/migration.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql, /^\s*(DELETE\s+FROM|TRUNCATE|DROP\b|ALTER TABLE[^;]*DROP)/imu)
  assert.match(sql, /"fk_mensajes_trabajo_trabajo" FOREIGN KEY \("tenant_id", "trabajo_id", "prestador_tenant_id"\)/u)
  assert.match(sql, /"ck_mensajes_trabajo_texto" CHECK \(length\(btrim\("texto"\)\) BETWEEN 1 AND 2000\)/u)
})
