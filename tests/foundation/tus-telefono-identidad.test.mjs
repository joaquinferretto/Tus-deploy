import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SERVICE_SETUP, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { WHATSAPP_SETUP } from './fixtures/whatsapp.mjs'

// Phone-first identity: a challenge created by TUS, sent BY THE USER from WhatsApp
// ("VERIFICAR TUS <code>"), verified by the signed Meta webhook against the sender's wa_id and
// answered with fixed text. No outbound OTP, no LLM, no dependency on the confirmation delivery.

const PHONE = `
  const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  const { AlmacenTelefonosEnMemoria } = await import('./apps/api/src/auth-security/phone/almacenes.ts')
  const { crearServicioTelefono } = await import('./apps/api/src/auth-security/phone/composicion.ts')
  const { RESPUESTAS_VERIFICACION } = await import('./apps/api/src/auth-security/phone/servicio.ts')
  const { ErrorMetaWhatsapp } = await import('./apps/api/src/tus/asistente/meta.ts')
  const idStore = new InMemoryIdentityStore()
  const auth = { ...createAuthService({ store: idStore, now: waClock }), store: idStore }
  const waStore2 = new AlmacenAsistenteEnMemoria()
  const almacenTel = new AlmacenTelefonosEnMemoria(idStore, waStore2.enlaceTelefonos())
  const tel = crearServicioTelefono({ auth, telefonos: almacenTel, env: { TUS_WHATSAPP_PUBLIC_NUMBER: '+54 9 379 400-0000' }, now: waClock })
  // The model is DOWN (every call throws) and counted: verification must never touch it.
  let llmCalls = 0
  const chatCaido = new ChatGuionado(() => { llmCalls += 1; throw new Error('groq down') })
  const waTx2 = new TransaccionAsistenteEnMemoria(waStore2)
  const meta = new FakeWhatsappProvider()
  const waTel = crearModuloWhatsapp({ env: waEnv, transaction: waTx2, accounts: accountResolver, application: tusApp, knowledgeIndex, whatsapp: meta, chat: chatCaido, embeddings, transcriptor: null, now: waClock, verificadorTelefono: tel })
  const worker = waTel.crearWorker({ owner: 'wa-worker-tel' })
  async function enviar(payload) {
    await waTel.ingreso.procesar(parsearWebhookMeta(payload, PHONE_ID), 'corr-' + Math.random())
    for (let i = 0; i < 5; i += 1) { const r = await worker.procesarSiguiente(); if (r.outcome === 'idle') break }
  }
  const PASSWORD = 'una frase larga y segura 2026'
  async function registrar(email, phone) {
    const outcome = await auth.service.registerAccount({ email, password: PASSWORD, displayName: 'Persona ' + email })
    const challenge = await tel.iniciarRegistro(outcome.created.account.id, phone)
    return { accountId: outcome.created.account.id, challenge }
  }
  const telefonoDe = async (accountId) => (await almacenTel.estado(accountId))
  const respuestasA = (waId) => meta.sent.filter((item) => item.to === waId).map((item) => item.message.text)
`

const VINCULADO = ['✅ ¡Listo! Este WhatsApp quedó vinculado a tu cuenta TUS.', '', 'Ya podés buscar profesionales, consultar tus turnos, verificar pagos y usar TUS directamente desde acá.'].join(String.fromCharCode(10))

test('PHONE normalization: Argentina (+54 / +549 / 0 / 15 / Corrientes 379), international, noise, ambiguous and invalid', () => {
  const r = runTypeScriptScenario(`
    const { normalizarTelefono, telefonoDesdeWaId, enmascararTelefono, enlaceVerificacionWhatsapp } = await import('./packages/contracts/src/tus-telefono.ts')
    const n = (value) => { const x = normalizarTelefono(value); return x.ok ? x.e164 : 'X:' + x.motivo }
    console.log(JSON.stringify({
      corrientes: ['3794 123456', '379 412-3456', '(0379) 15 412-3456', '0379154123456', '+54 9 379 412 3456', '+54 379 4123456', '5493794123456', '0054 9 379 4123456', '+54-9-379-412-3456'].map(n),
      caba: ['11 5555 1234', '011 15 5555-1234', '+54 9 11 5555 1234'].map(n),
      internacional: ['+1 (415) 555-2671', '+34 612 34 56 78', '+598 94 123 456'].map(n),
      invalidos: ['', '   ', 'abc', '379-412', '+54 9 379 41', '12345678901234567890', '+0 123', '0000000000', '379<script>'].map(n),
      areaCuatro: [n('2315 15 151515'), n('(03772) 15 42-1234')],
      waId: [telefonoDesdeWaId('5493794123456'), telefonoDesdeWaId('543794123456'), telefonoDesdeWaId('14155552671'), telefonoDesdeWaId('+549'), telefonoDesdeWaId(5493794123456)],
      mask: enmascararTelefono('+5493794123456'),
      link: enlaceVerificacionWhatsapp('+54 9 379 400-0000', '7K4M9QXR'),
    }))
  `)
  assert.deepEqual(r.corrientes, Array(9).fill('+5493794123456'))
  assert.deepEqual(r.caba, ['+5491155551234', '+5491155551234', '+5491155551234'])
  assert.deepEqual(r.internacional, ['+14155552671', '+34612345678', '+59894123456'])
  for (const value of r.invalidos) assert.match(value, /^X:/u)
  // 4-digit area codes: the local 15 is found in its only valid position.
  assert.deepEqual(r.areaCuatro, ['+5492315151515', '+5493772421234'])
  assert.deepEqual(r.waId, ['+5493794123456', '+5493794123456', '+14155552671', null, null])
  assert.equal(r.mask, '+549379•••3456')
  assert.equal(r.link, 'https://wa.me/5493794000000?text=VERIFICAR%20TUS%207K4M9QXR')
})

test('PHONE challenge: 8 symbols of a look-alike-free alphabet from crypto, stored as hash, parsed from the message tolerantly', () => {
  const r = runTypeScriptScenario(`
    const { generarCodigoDesafio, hashDesafio, extraerCodigo, esMensajeVerificacion, ALFABETO_DESAFIO } = await import('./apps/api/src/auth-security/phone/desafio.ts')
    const codes = Array.from({ length: 3000 }, () => generarCodigoDesafio())
    console.log(JSON.stringify({
      shape: codes.every((c) => c.length === 8 && [...c].every((ch) => ALFABETO_DESAFIO.includes(ch))),
      unique: new Set(codes).size,
      noLookAlikes: !/[01OIL]/u.test(ALFABETO_DESAFIO),
      hash: [hashDesafio('7K4M9QXR').length, hashDesafio('7K4M9QXR') === hashDesafio('7K4M9QXR'), hashDesafio('7K4M9QXR') !== hashDesafio('7K4M9QXS')],
      parse: ['VERIFICAR TUS 7K4M9QXR', 'verificar tus 7k4m-9qxr', '  Verificar  TUS: 7K4M 9QXR  ', 'VERIFICAR TUS ABC', 'VERIFICAR TUS 7K4M9QX0', 'hola VERIFICAR TUS 7K4M9QXR', 'VERIFICARTUS 7K4M9QXR'].map(extraerCodigo),
      prefix: ['VERIFICAR TUS ABC', 'verificar tus', 'Quiero verificar tus datos', 'hola'].map(esMensajeVerificacion),
    }))
  `)
  assert.equal(r.shape, true)
  assert.equal(r.unique, 3000)
  assert.equal(r.noLookAlikes, true)
  assert.deepEqual(r.hash, [64, true, true])
  assert.deepEqual(r.parse, ['7K4M9QXR', '7K4M9QXR', '7K4M9QXR', null, null, null, null])
  assert.deepEqual(r.prefix, [true, true, false, false])
})

test('PHONE WhatsApp flow: the right sender verifies, fixed confirmation, code never stored, LLM never called (even down), sign-in by phone without verified email', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${PHONE}
    const { accountId, challenge } = await registrar('juana@example.com', '+5493794123456')
    const antes = await auth.service.signIn({ email: '379 412-3456', password: PASSWORD })
    const pendiente = await tel.estado(challenge.challengeId, { pollSecret: challenge.pollSecret })
    await enviar(inbound('5493794123456', challenge.message))
    const despues = await tel.estado(challenge.challengeId, { pollSecret: challenge.pollSecret })
    const identidad = await telefonoDe(accountId)
    const cuenta = await idStore.getAccount(accountId)
    const porTelefono = await auth.service.signIn({ email: '(0379) 15 412-3456', password: PASSWORD })
    const porEmail = await auth.service.signIn({ email: 'juana@example.com', password: PASSWORD })
    const conversacion = JSON.stringify(await waStore2.repositorios().mensajes.ultimos((await waStore2.repositorios().conversaciones.activaDeContacto((await waStore2.repositorios().contactos.buscarPorWaId('5493794123456')).contactId)).conversationId, 20))
    console.log(JSON.stringify({
      challenge: { url: challenge.whatsappUrl, message: challenge.message.replace(/[A-Z0-9]{8}$/u, 'CODE'), mask: challenge.phoneMasked, purpose: challenge.purpose },
      antes: antes.ok, pendiente: pendiente.status, despues: despues.status,
      identidad: [identidad.phoneNumber, typeof identidad.phoneVerifiedAt, identidad.phonePending],
      email: cuenta.emailVerifiedAt, porTelefono: porTelefono.ok, porEmail: porEmail.ok,
      respuestas: respuestasA('5493794123456'), llmCalls,
      codigoGuardado: conversacion.includes(challenge.code), textoRedactado: conversacion.includes('VERIFICAR TUS ********'),
      eventos: auth.audit.events.filter((e) => e.kind.startsWith('phone.')).map((e) => e.kind), auditoria: JSON.stringify(auth.audit.events),
    }))
  `)
  assert.match(r.challenge.url, /^https:\/\/wa\.me\/5493794000000\?text=VERIFICAR%20TUS%20[A-Z0-9]{8}$/u)
  assert.equal(r.challenge.message, 'VERIFICAR TUS CODE')
  assert.equal(r.challenge.mask, '+549379•••3456')
  assert.equal(r.challenge.purpose, 'verificar_telefono')
  assert.equal(r.antes, false, 'no session before any verification')
  assert.equal(r.pendiente, 'pending')
  assert.equal(r.despues, 'verified')
  assert.deepEqual(r.identidad, ['+5493794123456', 'number', null])
  assert.equal(r.email, null, 'the email stays unverified; both states coexist')
  assert.equal(r.porTelefono, true)
  assert.equal(r.porEmail, true, 'email + password also works once the phone is verified')
  assert.deepEqual(r.respuestas, [VINCULADO])
  assert.equal(r.llmCalls, 0)
  assert.equal(r.codigoGuardado, false)
  assert.equal(r.textoRedactado, true)
  assert.deepEqual(r.eventos, ['phone.challenge_created', 'phone.verified'])
  assert.doesNotMatch(r.auditoria, /\+5493794123456|5493794123456/u, 'audit carries masked numbers only')
})

test('PHONE WhatsApp adversarial: other sender, expired, consumed, duplicate webhook, malformed code, Meta send failure', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${PHONE}
    const out = {}
    // 1. Code sent from ANOTHER phone: rejected, identity untouched, fixed answer to that phone.
    const a = await registrar('a@example.com', '+5493794111111')
    await enviar(inbound('5493794999999', a.challenge.message))
    out.otroTelefono = [(await telefonoDe(a.accountId)).phoneNumber, respuestasA('5493794999999')]
    // Five wrong senders kill the code; then even the right phone cannot use it.
    for (let i = 0; i < 4; i += 1) await enviar(inbound('5493794999999', a.challenge.message))
    await enviar(inbound('5493794111111', a.challenge.message))
    out.muertoPorIntentos = [(await telefonoDe(a.accountId)).phoneNumber, (await tel.estado(a.challenge.challengeId, { accountId: a.accountId })).status]
    // 2. Expired (10 minutes).
    const b = await registrar('b@example.com', '+5493794222222')
    waAdvance(11 * 60 * 1000)
    await enviar(inbound('5493794222222', b.challenge.message))
    out.vencido = [(await telefonoDe(b.accountId)).phoneNumber, (await tel.estado(b.challenge.challengeId, { accountId: b.accountId })).status]
    // 3. Duplicate webhook (same wamid) after success: nothing twice.
    const c = await registrar('c@example.com', '+5493794333333')
    const payload = inbound('5493794333333', c.challenge.message)
    await enviar(payload)
    await enviar(payload)
    await enviar(payload)
    out.duplicado = [(await telefonoDe(c.accountId)).phoneNumber, respuestasA('5493794333333').length, auth.audit.events.filter((e) => e.kind === 'phone.verified').length]
    // 4. The consumed code sent again (NEW message): not reusable.
    await enviar(inbound('5493794333333', c.challenge.message))
    out.consumido = respuestasA('5493794333333')
    // 5. Malformed code with the auth prefix: fixed answer, never the LLM.
    await enviar(inbound('5493794444444', 'VERIFICAR TUS ABC'))
    out.malformado = respuestasA('5493794444444')
    // 6. Meta fails when answering: the phone stays verified and the failure is recorded.
    const d = await registrar('d@example.com', '+5493794555555')
    meta.fallarProximo(new ErrorMetaWhatsapp('WHATSAPP_RATE_LIMITED', 'Meta down'))
    await enviar(inbound('5493794555555', d.challenge.message))
    const desafioD = await almacenTel.desafio(d.challenge.challengeId)
    out.metaCaido = [(await telefonoDe(d.accountId)).phoneNumber, (await tel.estado(d.challenge.challengeId, { pollSecret: d.challenge.pollSecret })).status, desafioD.confirmationSentAt, desafioD.confirmationError, auth.audit.events.some((e) => e.kind === 'phone.confirmation_failed')]
    out.confirmacionOk = (await almacenTel.desafio(c.challenge.challengeId)).confirmationSentAt !== null
    out.llmCalls = llmCalls
    console.log(JSON.stringify(out))
  `)
  const invalido = 'No pudimos verificar ese código. Volvé a TUS y generá una nueva verificación.'
  assert.deepEqual(r.otroTelefono, [null, [invalido]])
  assert.deepEqual(r.muertoPorIntentos, [null, 'failed'])
  assert.deepEqual(r.vencido, [null, 'expired'])
  assert.deepEqual(r.duplicado, ['+5493794333333', 1, 1])
  assert.deepEqual(r.consumido, [VINCULADO, invalido])
  assert.deepEqual(r.malformado, [invalido])
  assert.deepEqual(r.metaCaido, ['+5493794555555', 'verified', null, 'WHATSAPP_RATE_LIMITED', true])
  assert.equal(r.confirmacionOk, true)
  assert.equal(r.llmCalls, 0, 'no verification message ever reached the model')
})

test('PHONE webhook HTTP: an unsigned or badly signed "VERIFICAR TUS" message verifies nothing', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${PHONE}
    const { createTusHttpRouter } = await import('./apps/api/src/tus/http/router.ts')
    const { createApp } = (await import('./apps/api/src/server.ts')).default
    const server = createApp({ tusRouter: createTusHttpRouter({ application: tusApp, sessions: new InMemoryTusSessionResolver(), whatsapp: waTel }), tusRoutesEnabled: true }).listen(0)
    const base = 'http://127.0.0.1:' + server.address().port + '/tus/v1/integrations/whatsapp/webhook'
    const post = async (body, signature) => (await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) }, body })).status
    try {
      const { accountId, challenge } = await registrar('http@example.com', '+5493794666666')
      const raw = JSON.stringify(inbound('5493794666666', challenge.message))
      const sinFirma = await post(raw)
      const firmaMala = await post(raw, firmarPayloadMeta(raw, 'another-secret'))
      const intacto = (await telefonoDe(accountId)).phoneNumber
      const valido = await post(raw, firmarPayloadMeta(raw, APP_SECRET))
      console.log(JSON.stringify({ sinFirma, firmaMala, intacto, valido, verificado: (await telefonoDe(accountId)).phoneNumber }))
    } finally { server.close() }
  `)
  assert.equal(r.sinFirma, 401)
  assert.equal(r.firmaMala, 401)
  assert.equal(r.intacto, null)
  assert.equal(r.valido, 200)
  assert.equal(r.verificado, '+5493794666666')
})

test('PHONE change and uniqueness: old number stays until the new one is proved from ITS WhatsApp; a number of another person is refused; the freed number can be verified again', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${PHONE}
    const out = {}
    const juan = await registrar('juan@example.com', '+5493794100001')
    await enviar(inbound('5493794100001', juan.challenge.message))
    const cambio = await tel.iniciar(juan.accountId, { telefono: '379 410-0002' })
    out.pendiente = [cambio.purpose, (await telefonoDe(juan.accountId)).phoneNumber, (await telefonoDe(juan.accountId)).phonePending]
    // The new code sent from the OLD phone: refused.
    await enviar(inbound('5493794100001', cambio.message))
    out.desdeViejo = (await telefonoDe(juan.accountId)).phoneNumber
    const cambio2 = await tel.iniciar(juan.accountId, { telefono: '379 410-0002' })
    out.reemplazado = (await tel.estado(cambio.challengeId, { accountId: juan.accountId })).status
    await enviar(inbound('5493794100002', cambio2.message))
    out.desdeNuevo = [(await telefonoDe(juan.accountId)).phoneNumber, (await telefonoDe(juan.accountId)).phonePending]
    out.mismoNumero = (await tel.iniciar(juan.accountId, { telefono: '+54 9 379 410 0002' })).code
    // Another person tries Juan's number: same answer on creation, refused on verification.
    const ana = await registrar('ana@example.com', '+5493794200000')
    const intento = await tel.iniciar(ana.accountId, { telefono: '+5493794100002' })
    await enviar(inbound('5493794100002', intento.message))
    out.ajeno = [intento.ok, (await telefonoDe(ana.accountId)).phoneNumber, (await tel.estado(intento.challengeId, { accountId: ana.accountId })).status]
    // Juan's OLD number is free now: Ana can verify it.
    const libre = await tel.iniciar(ana.accountId, { telefono: '+5493794100001' })
    await enviar(inbound('5493794100001', libre.message))
    out.libre = (await telefonoDe(ana.accountId)).phoneNumber
    out.eventos = auth.audit.events.filter((e) => e.kind === 'phone.changed').length
    // Someone else's challenge id is not readable.
    out.ajenoEstado = await tel.estado(cambio2.challengeId, { accountId: ana.accountId })
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.pendiente, ['cambiar_telefono', '+5493794100001', '+5493794100002'])
  assert.equal(r.desdeViejo, '+5493794100001')
  assert.equal(r.reemplazado, 'failed', 'a new challenge replaces the previous one')
  assert.deepEqual(r.desdeNuevo, ['+5493794100002', null])
  assert.equal(r.mismoNumero, 'ALREADY_VERIFIED')
  assert.deepEqual(r.ajeno, [true, null, 'failed'])
  assert.equal(r.libre, '+5493794100001')
  assert.equal(r.eventos, 1, 'only Juan changed an existing identity phone')
  assert.equal(r.ajenoEstado, null)
})

test('PHONE password recovery through WhatsApp: same answer for unknown phones, token handed over once, reset works, wrong phone / expired / replay refused', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${PHONE}
    const out = {}
    const p = await registrar('reset@example.com', '+5493794300000')
    await enviar(inbound('5493794300000', p.challenge.message))
    const session = await auth.service.signIn({ email: 'reset@example.com', password: PASSWORD })
    const real = await tel.iniciarRecuperacion({ telefono: '379 430-0000' })
    const fake = await tel.iniciarRecuperacion({ telefono: '379 430-9999' })
    out.misma = JSON.stringify(Object.keys(real).sort()) === JSON.stringify(Object.keys(fake).sort())
    out.fakePoll = await tel.estado(fake.challengeId, { pollSecret: fake.pollSecret })
    out.realPoll = await tel.estado(real.challengeId, { pollSecret: real.pollSecret })
    out.malSecreto = await tel.estado(real.challengeId, { pollSecret: 'otro' })
    await enviar(inbound('5493794999999', real.message))
    out.otroTelefono = (await tel.estado(real.challengeId, { pollSecret: real.pollSecret })).status
    await enviar(inbound('5493794300000', real.message))
    const listo = await tel.estado(real.challengeId, { pollSecret: real.pollSecret })
    const otraVez = await tel.estado(real.challengeId, { pollSecret: real.pollSecret })
    out.token = [listo.status, typeof listo.recoveryToken, otraVez.status, otraVez.recoveryToken ?? null]
    out.respuesta = respuestasA('5493794300000').at(-1)
    const reset = await auth.service.completePasswordRecovery({ token: listo.recoveryToken, newPassword: 'otra frase larga y segura 2026' })
    const reuse = await auth.service.completePasswordRecovery({ token: listo.recoveryToken, newPassword: 'tercera frase larga y segura 2026' })
    out.reset = [reset.ok, reuse.ok]
    out.viejaSesion = (await idStore.findSessionByAccessTokenDigest(session.session ? auth.service['dependencies'].tokens.digest(session.session.accessToken) : '')).revokedAt !== null
    out.login = [(await auth.service.signIn({ email: '3794300000', password: PASSWORD })).ok, (await auth.service.signIn({ email: '3794300000', password: 'otra frase larga y segura 2026' })).ok]
    // Replay of the used recovery code and an expired one.
    await enviar(inbound('5493794300000', real.message))
    const vieja = await tel.iniciarRecuperacion({ telefono: '379 430-0000' })
    waAdvance(11 * 60 * 1000)
    await enviar(inbound('5493794300000', vieja.message))
    out.vencida = (await tel.estado(vieja.challengeId, { pollSecret: vieja.pollSecret })).status
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.misma, true)
  assert.deepEqual(r.fakePoll, { status: 'pending', purpose: null, phoneMasked: null })
  assert.deepEqual(r.realPoll, { status: 'pending', purpose: null, phoneMasked: null }, 'a real pending recovery looks like a fake one')
  assert.deepEqual(r.malSecreto, { status: 'pending', purpose: null, phoneMasked: null })
  assert.equal(r.otroTelefono, 'pending')
  assert.deepEqual(r.token, ['verified', 'string', 'verified', null])
  assert.equal(r.respuesta, '✅ Confirmamos tu número. Volvé a TUS para elegir tu nueva contraseña.')
  assert.deepEqual(r.reset, [true, false])
  assert.equal(r.viejaSesion, true, 'a reset revokes the sessions (current policy)')
  assert.deepEqual(r.login, [false, true])
  assert.equal(r.vencida, 'pending', 'an expired recovery never verifies and never reveals itself')
})

test('PHONE limits, enumeration and admin: rate limited challenges, fake challenge for a registered email, admin sets pending only and can free a number', () => {
  const r = runTypeScriptScenario(`${SERVICE_SETUP}${WHATSAPP_SETUP}${PHONE}
    const out = {}
    const x = await registrar('limite@example.com', '+5493794400000')
    const intentos = []
    for (let i = 0; i < 7; i += 1) { const res = await tel.iniciar(x.accountId, { telefono: '+54937945' + String(i).padStart(5, '0') }); intentos.push(res.ok ? 'ok' : res.code) }
    out.limite = intentos
    out.invalido = await tel.iniciar(x.accountId, { telefono: '12' })
    // Sign-up with an already registered email + phone: a code of identical shape that verifies nothing.
    const falso = tel.ficticio('+5493794500000', 'verificar_telefono')
    const real = (await registrar('real@example.com', '+5493794500001')).challenge
    out.forma = JSON.stringify(Object.keys(falso).sort()) === JSON.stringify(Object.keys(real).sort())
    await enviar(inbound('5493794500000', falso.message))
    out.falsoVerifica = await almacenTel.cuentaPorTelefono('+5493794500000')
    // Admin: pending only (never verified), audited; can free a verified number.
    const y = await registrar('admin-target@example.com', '+5493794600000')
    await enviar(inbound('5493794600000', y.challenge.message))
    const pend = await tel.fijarPendientePorAdmin('admin-1', y.accountId, '379 460-0001')
    out.adminPendiente = [pend.ok, (await telefonoDe(y.accountId)).phoneNumber, (await telefonoDe(y.accountId)).phonePending]
    await tel.quitarVerificadoPorAdmin('admin-1', y.accountId)
    out.adminQuitado = [(await telefonoDe(y.accountId)).phoneNumber, (await telefonoDe(y.accountId)).phoneVerifiedAt]
    out.adminAudit = auth.audit.events.filter((e) => e.kind.startsWith('phone.admin')).map((e) => [e.kind, e.actorId])
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.limite, ['ok', 'ok', 'ok', 'ok', 'ok', 'RATE_LIMITED', 'RATE_LIMITED'])
  assert.deepEqual(r.invalido, { ok: false, code: 'INVALID_PHONE', motivo: 'longitud' })
  assert.equal(r.forma, true)
  assert.equal(r.falsoVerifica, null)
  assert.deepEqual(r.adminPendiente, [true, '+5493794600000', '+5493794600001'])
  assert.deepEqual(r.adminQuitado, [null, null])
  assert.deepEqual(r.adminAudit, [['phone.admin_pending_set', 'admin-1'], ['phone.admin_cleared', 'admin-1']])
})
