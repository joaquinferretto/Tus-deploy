import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// WHATSAPP-LEIDO-01. The blue ticks and "escribiendo…" do not wait for the queue of the
// assistant: a message left for the assistant is marked as read the moment its webhook is
// ingested. A conversation an operator owns is read by a person, never by the backend. If Meta
// refuses the typing indicator, the read alone is still sent.

test('WHATSAPP leído: a message for the assistant is marked read (with typing) at ingest, before any worker runs; once per message; not in a conversation an operator took', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}
    const out = {}
    const tick = () => new Promise((resolve) => setTimeout(resolve, 20))
    const w = '5491155590001'
    await deliver(inbound(w, 'hola', { wamid: 'wamid.leido-1' }))
    await tick()
    out.alIngresar = [...fakeWa.reads]
    out.sinRespuestaTodavia = fakeWa.sent.length
    // The same webhook again (Meta retries): nothing new.
    await deliver(inbound(w, 'hola', { wamid: 'wamid.leido-1' }))
    await tick()
    out.repetido = fakeWa.reads.filter((x) => x === 'wamid.leido-1').length
    // The worker still answers, and refreshes "typing" when it starts.
    for (let i = 0; i < 5; i += 1) if ((await waWorker.procesarSiguiente()).outcome === 'idle') break
    out.respondio = fakeWa.sent.length > 0
    // An operator took the conversation: the backend does not mark its messages as read.
    await wa.soporte.tomar((await conversationOf(w)).conversationId, { actorId: 'admin-1', correlationId: 'c' })
    const antes = fakeWa.reads.length
    await deliver(inbound(w, 'sigo acá', { wamid: 'wamid.leido-2' }))
    await tick()
    out.conOperador = fakeWa.reads.slice(antes)
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.alIngresar, ['wamid.leido-1'], 'read at ingest, with no worker involved')
  assert.equal(r.sinRespuestaTodavia, 0, 'the answer itself still comes from the worker')
  assert.equal(r.repetido, 1, 'a redelivered webhook does not mark it again')
  assert.equal(r.respondio, true)
  assert.deepEqual(r.conOperador, [], 'a conversation an operator owns is read by a person')
})

test('WHATSAPP leído: when Meta refuses the typing indicator the read alone is sent; a failure of both never throws', () => {
  const r = runTypeScriptScenario(`
    const { MetaWhatsappCloudProvider } = await import('./apps/api/src/tus/asistente/meta.ts')
    const llamadas = []
    let respuestas = []
    const fetchFalso = async (url, init) => { llamadas.push(JSON.parse(init.body)); const status = respuestas.shift() ?? 200; return new Response(JSON.stringify(status === 200 ? { success: true } : { error: { code: 100, message: 'x' } }), { status, headers: { 'content-type': 'application/json' } }) }
    const meta = new MetaWhatsappCloudProvider({ accessToken: 'fictitious', phoneNumberId: '123', graphApiVersion: 'v25.0' }, fetchFalso)
    const out = {}
    await meta.markReadTyping('wamid.a')
    out.normal = llamadas.splice(0)
    respuestas = [400]
    await meta.markReadTyping('wamid.b')
    out.sinTyping = llamadas.splice(0)
    respuestas = [400, 500]
    out.nuncaFalla = await meta.markReadTyping('wamid.c').then(() => 'ok', () => 'threw')
    out.intentos = llamadas.length
    console.log(JSON.stringify(out))
  `)
  const leido = (id) => ({ messaging_product: 'whatsapp', status: 'read', message_id: id })
  assert.deepEqual(r.normal, [{ ...leido('wamid.a'), typing_indicator: { type: 'text' } }], 'one request: read + typing')
  assert.deepEqual(r.sinTyping, [{ ...leido('wamid.b'), typing_indicator: { type: 'text' } }, leido('wamid.b')], 'typing refused: the read alone')
  assert.equal(r.nuncaFalla, 'ok')
  assert.equal(r.intentos, 2)
})
