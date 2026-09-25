import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

const SETUP = `${SERVICE_SETUP}${WHATSAPP_SETUP}`

test('WHATSAPP webhook HTTP: handshake only with the verify token; X-Hub-Signature-256 over raw bytes; forged, modified or unsigned bodies never write or reply', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const server = createApp({ tusRouter: createTusHttpRouter({ application: tusApp, sessions: new InMemoryTusSessionResolver(), whatsapp: wa }), tusRoutesEnabled: true }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port + '/tus/v1/integrations/whatsapp/webhook'
    const get = async (query) => { const r = await fetch(base + query); return [r.status, await r.text()] }
    const post = async (body, signature) => { const r = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) }, body }); return r.status }
    try {
      const out = {}
      out.handshakeOk = await get('?hub.mode=subscribe&hub.verify_token=' + VERIFY_TOKEN + '&hub.challenge=1158201444')
      out.handshakeBadToken = (await get('?hub.mode=subscribe&hub.verify_token=wrong-token-value-00&hub.challenge=1158201444'))[0]
      out.handshakeBadMode = (await get('?hub.mode=unsubscribe&hub.verify_token=' + VERIFY_TOKEN + '&hub.challenge=1'))[0]
      out.handshakeMissing = (await get(''))[0]
      // Unicode and spacing on purpose: the signature is computed over these exact bytes.
      const raw = JSON.stringify(inbound('5491155550001', 'Hola, ¿cómo funciona TUS?  ñandú'), null, 1)
      out.valid = await post(raw, firmarPayloadMeta(raw, APP_SECRET))
      out.replay = await post(raw, firmarPayloadMeta(raw, APP_SECRET))
      out.invalidSignature = await post(raw, firmarPayloadMeta(raw, 'another-secret'))
      const tampered = raw.replace('Hola', 'Chau')
      out.bodyModified = await post(tampered, firmarPayloadMeta(raw, APP_SECRET))
      const raw2 = JSON.stringify(inbound('5491155550002', 'otro'))
      out.missingSignature = await post(raw2)
      out.malformedSignature = await post(raw2, 'sha1=abc')
      out.reserialized = await post(JSON.stringify(JSON.parse(raw)), firmarPayloadMeta(raw, APP_SECRET))
      out.notJson = await post('not json', firmarPayloadMeta('not json', APP_SECRET))
      const messages = [...waStore.state.mensajes.values()]
      out.messages = messages.map((m) => [m.text, m.status])
      out.contacts = waStore.state.contactos.size
      out.queued = [...waStore.state.cola.values()].length
      out.sentBeforeWorker = fakeWa.sent.length
      out.chatCallsBeforeWorker = chat.calls.length
      console.log(JSON.stringify(out))
    } finally { server.close() }
  `)
  assert.deepEqual(result.handshakeOk, [200, '1158201444'])
  assert.equal(result.handshakeBadToken, 403)
  assert.equal(result.handshakeBadMode, 403)
  assert.equal(result.handshakeMissing, 403)
  assert.equal(result.valid, 200)
  assert.equal(result.replay, 200, 'replays are acknowledged')
  assert.equal(result.invalidSignature, 401)
  assert.equal(result.bodyModified, 401)
  assert.equal(result.missingSignature, 401)
  assert.equal(result.malformedSignature, 401)
  assert.equal(
    result.reserialized,
    401,
    'a re-serialized body does not match the raw-byte signature'
  )
  assert.equal(result.notJson, 400)
  // Only the one authentic message was stored, once; the webhook never called Groq or Meta.
  assert.deepEqual(result.messages, [['Hola, ¿cómo funciona TUS?  ñandú', 'received']])
  assert.equal(result.contacts, 1)
  assert.equal(result.queued, 1)
  assert.equal(result.sentBeforeWorker, 0)
  assert.equal(result.chatCallsBeforeWorker, 0)
})

test('WHATSAPP ingest: out-of-order statuses never regress, other numbers ignored, flood rate-limited and blocked, quick messages coalesce into one answered turn', () => {
  const result = runTypeScriptScenario(`${SETUP}
    script = ({ messages }) => ({ content: 'Respuesta única a: ' + messages[messages.length - 1].content.replaceAll('\\n', ' / ') })
    // Two quick messages: one queued job, one turn, one answer.
    await deliver(inbound('5491155550010', 'Hola'))
    await deliver(inbound('5491155550010', 'Necesito un electricista'))
    const jobs = [...waStore.state.cola.values()].length
    const outcomes = []
    for (let i = 0; i < 3; i += 1) outcomes.push((await waWorker.procesarSiguiente()).outcome)
    const answers = fakeWa.textos()
    const out = fakeWa.sent[0]
    // Statuses: delivered, then an older 'sent', then read, then an older failed.
    const base = waNow
    await deliver(statusPayload(out.wamid, 'delivered', base + 2000))
    await deliver(statusPayload(out.wamid, 'sent', base + 1000))
    const afterOld = [...waStore.state.mensajes.values()].find((m) => m.wamid === out.wamid).status
    await deliver(statusPayload(out.wamid, 'read', base + 3000))
    await deliver(statusPayload(out.wamid, 'failed', base + 2500))
    const final = [...waStore.state.mensajes.values()].find((m) => m.wamid === out.wamid).status
    // Events for another business number are ignored.
    const foreign = inbound('5491155550011', 'hola'); foreign.entry[0].changes[0].value.metadata.phone_number_id = '999'
    const foreignResult = await deliver(foreign)
    // Flood: 12/min accepted, then rate limited; 60/min blocks the contact.
    const results = []
    for (let i = 0; i < 61; i += 1) results.push(await deliver(inbound('5491155550012', 'spam ' + i)))
    const contact = await contactOf('5491155550012')
    const statuses = [...waStore.state.mensajes.values()].filter((m) => m.contactId === contact.contactId).map((m) => m.status)
    console.log(JSON.stringify({ jobs, outcomes, answers, afterOld, final, foreignResult, received: statuses.filter((s) => s === 'received').length, limited: statuses.filter((s) => s === 'rate_limited').length, blocked: Boolean(contact.blockedUntil), audit: waStore.state.auditoria.some((e) => e.action === 'whatsapp.contact_blocked'), auditLeak: JSON.stringify(waStore.state.auditoria).includes('5491155550012') }))
  `)
  assert.equal(result.jobs, 1)
  assert.deepEqual(result.outcomes, ['processed', 'idle', 'idle'])
  assert.deepEqual(result.answers, ['Respuesta única a: Hola / Necesito un electricista'])
  assert.equal(result.afterOld, 'delivered')
  assert.equal(result.final, 'read')
  assert.equal(result.foreignResult.accepted, 0)
  assert.equal(result.received, 12)
  assert.equal(result.limited, 49)
  assert.equal(result.blocked, true)
  assert.equal(result.audit, true)
  assert.equal(result.auditLeak, false, 'audit stores masked wa_id only')
})
