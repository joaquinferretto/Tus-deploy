import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { GENERAL_SETUP } from './fixtures/asistente-general.mjs'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ASISTENTE-AYUDA-01. The assistant is not a rigid state machine: a question, a problem or "no
// funciona" INTERRUPTS whatever step was waiting (a name and document, a time, a choice), is
// answered from the real state of the account and the canonical knowledge base, and the flow that
// was in progress is kept and resumed. A step never reads a question as its answer.
// Clock of the fixture: Tuesday 2026-10-06, 09:00 in Argentina.

// The WhatsApp pipeline with the identity lookup (name + document) and the phone identity module.
const SETUP = `${GENERAL_SETUP}
  const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  const { AlmacenTelefonosEnMemoria } = await import('./apps/api/src/auth-security/phone/almacenes.ts')
  const { crearServicioTelefono } = await import('./apps/api/src/auth-security/phone/composicion.ts')
  const idStore = new InMemoryIdentityStore()
  const auth = { ...createAuthService({ store: idStore, now: waClock }), store: idStore }
  const almacenTel = new AlmacenTelefonosEnMemoria(idStore, waStore.enlaceTelefonos())
  const tel = crearServicioTelefono({ auth, telefonos: almacenTel, env: { TUS_WHATSAPP_PUBLIC_NUMBER: '+54 9 379 400-0000' }, now: waClock })
  // Lookup by full name + document: one known person; everybody else is "not found".
  const personas = new Map()
  const identidades = { buscarPorDocumento: async (tipo, numero) => personas.get(numero) ?? null }
  const resolver = { ...accountResolver, contextoDeCuenta: async (accountId, correlationId) => { const account = accounts.get(accountId); return account && account.status === 'active' ? { subjectId: accountId, sessionId: 'identificada:' + accountId, tenantId: account.tenantId, correlationId, roles: account.roles, permissions: ['tus:read'] } : null } }
  const armar = (chatDelModulo) => crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: resolver, domain: dominio, knowledgeIndex, whatsapp: fakeWa, chat: chatDelModulo, embeddings, transcriptor: null, now: waClock, metric: (name, fields) => metrics.push({ name, ...fields }), verificadorTelefono: tel, identidades })
  let mod = armar(null)
  let colaAyuda = mod.crearWorker({ owner: 'ayuda' })
  const conModelo = () => { mod = armar(chat); colaAyuda = mod.crearWorker({ owner: 'ayuda-modelo' }) }
  const salidas = (waId) => fakeWa.sent.filter((item) => item.to === waId).map((item) => item.message)
  async function enviar(waId, texto) {
    await mod.ingreso.procesar(parsearWebhookMeta(inbound(waId, texto), PHONE_ID), 'corr-ayuda')
    for (let i = 0; i < 6; i += 1) if ((await colaAyuda.procesarSiguiente()).outcome === 'idle') break
    waAdvance(6000)
    return salidas(waId).at(-1)
  }
  let cuentas = 0
  async function cuenta(telefonoVerificado) {
    cuentas += 1
    const out = await auth.service.registerAccount({ email: 'persona' + cuentas + '@example.com', password: 'una frase larga y segura 2026', displayName: 'Persona Secreta ' + cuentas })
    const id = out.created.account.id
    const guardada = await idStore.getAccount(id)
    accounts.set(id, { tenantId: guardada.tenantId, status: 'active', roles: ['owner'] })
    if (telefonoVerificado) await almacenTel.fijarVerificado(id, telefonoVerificado, waClock())
    return id
  }
  // A conversation left at "necesito tu nombre completo y DNI" for Juan Pérez, Thursday 8 at 09:00.
  async function hastaIdentidad(waId) {
    await enviar(waId, 'Necesito un plomero para el jueves')
    return enviar(waId, 'Juan a las 9')
  }
  const ver = (m) => [m.type, m.text, m.label ?? null, m.url ?? null]
  const reserva = async (waId) => { const b = (await conversationOf(waId)).state.booking; return b ? [b.providerName, b.profession, b.step, b.startsAt === iso('2026-10-08', '09:00')] : null }
`

const PIDE_DATOS = 'Perfecto: Juan Pérez, el jueves 8 a las 09:00.\nEl servicio cuesta $200 y la seña es de $100.\nPara registrar la solicitud necesito tu nombre completo y DNI.'
const SIGUE = 'Cuando lo resuelvas, escribime y seguimos con tu turno de Plomería con Juan Pérez, el jueves 8 a las 09:00: queda guardado.'
const SIN_VERIFICAR = 'Este número todavía no figura verificado en una cuenta TUS. Iniciá sesión en la Web, entrá a Mi perfil, cargá este número y tocá "Verificar mi número": se abre WhatsApp con un mensaje listo para enviar desde acá. Eso verifica el teléfono y vincula este WhatsApp.'
const PERFIL = 'https://web.tus.test/mi-perfil'
// After the answer, the guide of the Help Center about THAT topic (never the generic /ayuda).
const guia = (slug) => `Guía paso a paso: https://web.tus.test/ayuda/${slug}`
const VINCULAR = 'https://web.tus.test/mi-perfil?accion=vincular-whatsapp'

// The conversation of the screenshot, as a permanent regression.
test('AYUDA regresión de la captura: waiting for name + DNI -> data not found -> "Pero cómo verifico mi número" is a QUESTION, answered from the real state; the DNI is never asked again and the turno stays pending', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const W = '5493794600001'
    out.pide = (await hastaIdentidad(W)).text
    out.noEncontrada = ver(await enviar(W, 'Juan Ignacio Flores, 44321092'))
    out.reservaTrasFallo = await reserva(W)
    const pregunta = await enviar(W, 'Pero cómo verifico mi número')
    out.pregunta = ver(pregunta)
    out.reservaTrasPregunta = await reserva(W)
    out.intencion = metrics.filter((m) => m.name === 'assistant.help').map((m) => [m.topic, m.interrupted])
    out.consultas = dom.consultas.length
    // The document was never stored in the conversation.
    out.sinDocumento = !(await waStore.repositorios().mensajes.ultimos((await conversationOf(W)).conversationId, 30)).some((m) => /44321092/u.test(m.text ?? ''))
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.pide, PIDE_DATOS)
  assert.equal(r.noEncontrada[0], 'cta_url')
  assert.equal(r.noEncontrada[1], 'No pude validar esos datos con una cuenta TUS. Revisá que sean el mismo nombre y DNI con los que te registraste. Si todavía no tenés cuenta, registrate desde acá y verificá tu teléfono en Mi perfil. Tu solicitud queda guardada: cuando termines, escribime y seguimos.', 'not found: what to check and the next step, without saying which datum failed')
  assert.equal(r.noEncontrada[2], 'Registrarme')
  assert.match(r.noEncontrada[3], /^https:\/\/web\.tus\.test\/registro\?returnTo=/u, 'the real registration page, back to this very turno')
  assert.deepEqual(r.reservaTrasFallo, ['Juan Pérez', 'plomeria', 'identity', true], 'the turno is kept')
  assert.deepEqual(r.pregunta, ['cta_url', `${SIN_VERIFICAR}\n\n${SIGUE}\n\n${guia('verificar-celular')}`, 'Ir a Mi perfil', PERFIL], 'the question is answered: real state, what to do, the real page, what comes next, and the guide about it')
  assert.doesNotMatch(r.pregunta[1], /nombre completo y DNI/u, 'the DNI is NOT asked again')
  assert.deepEqual(r.reservaTrasPregunta, ['Juan Pérez', 'plomeria', 'identity', true], 'asking did not consume the step: service, professional, day and time are intact')
  assert.deepEqual(r.intencion, [['phone_verification', 'identidad']])
  assert.equal(r.sinDocumento, true)
})

test('AYUDA interrupciones: a question interrupts ANY step — identity, a time being chosen, an option, a day in doubt — and the flow is still there afterwards', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    // Waiting for name + DNI.
    let w = '5493794600010'
    await hastaIdentidad(w)
    out.registro = ver(await enviar(w, '¿cómo me registro?'))
    out.paraQue = (await enviar(w, 'no entiendo, para qué?')).text
    out.login = ver(await enviar(w, 'no me deja entrar'))
    out.clave = ver(await enviar(w, 'me olvidé la contraseña'))
    out.sesion = (await enviar(w, 'inicié sesión pero acá no me reconoce, por qué?')).text
    out.reserva = await reserva(w)
    // ...and the step still works: the data, when it finally comes, is read as the data.
    out.datos = (await enviar(w, 'Juan Ignacio Flores, 44321092')).text.split('. ')[0]
    // Waiting for a time ("¿A qué hora con María?").
    w = nuevoContacto()
    await enviar(w, 'Necesito un plomero para el jueves')
    out.hora = (await enviar(w, 'María')).text
    out.sena = (await enviar(w, '¿qué significa seña?')).text
    out.trasSena = (await conversationOf(w)).state.offers.esperaHora
    out.horaElegida = (await enviar(w, '11')).text.split('\\n')[0]
    // Options shown, nothing chosen yet.
    w = nuevoContacto()
    await enviar(w, 'Necesito un electricista')
    out.cambiarNumero = ver(await enviar(w, '¿cómo cambio mi número?'))
    out.cancelar = ver(await enviar(w, '¿cómo cancelo un turno?'))
    out.reprogramar = (await enviar(w, 'como reprogramo un turno')).text
    out.misTurnos = ver(await enviar(w, 'donde veo mis turnos?'))
    out.opcionesIntactas = (await conversationOf(w)).state.offers.items.length
    out.elige = (await enviar(w, '1 a las 16')).text.split('\\n')[0]
    // A payment question with no payment at hand.
    w = nuevoContacto()
    out.rechazo = (await enviar(w, '¿qué pasa si Mercado Pago lo rechazó?')).text
    out.comprobante = (await enviar(w, '¿dónde mando el comprobante?')).text
    out.porQueSena = (await enviar(w, '¿por qué tengo que pagar seña?')).text
    // These are NOT help: the backend resolves them itself with its tools.
    w = nuevoContacto()
    const antes = metrics.filter((m) => m.name === 'assistant.help').length
    out.busqueda = (await enviar(w, 'no encuentro electricistas, cómo hago?')).text.split('\\n')[0]
    out.dias = (await enviar(w, '¿por qué no hay turnos?')).text
    out.quienAntes = (await enviar(w, 'quién puede antes?')).text.split('\\n')[0]
    out.noSonAyuda = metrics.filter((m) => m.name === 'assistant.help').length - antes
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.registro[1], `Este número todavía no figura verificado en una cuenta TUS. Si todavía no tenés cuenta, registrate con tu email. Después verificá tu teléfono en Mi perfil.\n\n${SIGUE}\n\n${guia('registro')}`)
  assert.equal(r.registro[2], 'Registrarme')
  assert.match(r.registro[3], /^https:\/\/web\.tus\.test\/registro\?returnTo=%2Ftrabajadores%2Fperfil-juan/u, 'registering comes back to this turno')
  assert.match(r.paraQue, /^Te pido nombre completo y DNI para encontrar tu cuenta TUS: /u, '"¿para qué?" explains why the data is asked')
  assert.deepEqual(r.login.slice(2), ['Iniciar sesión', 'https://web.tus.test/sign-in'])
  assert.deepEqual(r.clave.slice(2), ['Recuperar contraseña', 'https://web.tus.test/olvide-contrasena'])
  assert.match(r.sesion, /^Tu sesión de la Web y este WhatsApp son accesos distintos/u, 'a Web session is never assumed')
  assert.deepEqual(r.reserva, ['Juan Pérez', 'plomeria', 'identity', true], 'five questions later the turno is still waiting')
  for (const texto of [r.registro[1], r.paraQue, r.login[1], r.clave[1], r.sesion]) {
    assert.match(texto, /seguimos con tu turno de Plomería con Juan Pérez, el jueves 8 a las 09:00/u, 'each answer says what the conversation goes back to')
    assert.doesNotMatch(texto, /^Para registrar la solicitud necesito|necesito tu nombre completo y DNI\.$/u)
  }
  assert.equal(new Set([r.registro[1], r.paraQue, r.login[1], r.clave[1], r.sesion]).size, 5, 'different questions, different answers')
  assert.equal(r.datos, 'No pude validar esos datos con una cuenta TUS', 'the step still reads real data as data')
  assert.equal(r.hora, '¿A qué hora con María Gómez? Tiene: 09:45, 11:00, 14:00.')
  assert.match(r.sena, /La seña es un pago por adelantado de la mitad del precio del servicio/u, 'from the knowledge base')
  assert.match(r.sena, /Seguimos con tu turno de Plomería con María Gómez/u)
  assert.equal(r.trasSena, true, 'the time is still being waited for')
  assert.equal(r.horaElegida, 'Perfecto: María Gómez, el jueves 8 a las 11:00.', 'and the answer to it is still understood')
  assert.match(r.cambiarNumero[1], /Mi perfil/u)
  assert.deepEqual(r.cambiarNumero.slice(2), ['Ir a Mi perfil', PERFIL])
  assert.equal(r.cancelar[1], 'Un turno se cancela desde Mis turnos: "Retirar solicitud" si todavía está pendiente, "Cancelar turno" si ya fue aceptado.\n\nSeguimos con tu turno de Electricidad cuando quieras.\n\n' + guia('turnos'))
  assert.deepEqual(r.cancelar.slice(2), ['Ver mis turnos', 'https://web.tus.test/mis-turnos'])
  assert.match(r.reprogramar, /^Hoy un turno no se reprograma: se cancela desde Mis turnos y se pide uno nuevo/u, 'a feature TUS does not have is said, with the real alternative')
  assert.deepEqual(r.misTurnos.slice(2), ['Ver mis turnos', 'https://web.tus.test/mis-turnos'])
  assert.equal(r.opcionesIntactas, 2, 'the options shown are still the options')
  assert.equal(r.elige, 'Perfecto: Laura Gómez, el jueves 8 a las 16:00.')
  assert.match(r.rechazo, /Un pago rechazado o cancelado no confirma el turno/u)
  assert.match(r.comprobante, /el comprobante no confirma por sí solo que el pago esté acreditado/u, 'a receipt never certifies a payment')
  assert.match(r.porQueSena, /La seña es un pago por adelantado/u, 'an explanation, not the payment-link flow')
  assert.equal(r.busqueda, 'Hay disponibilidad de Electricidad el jueves 8:', 'a service asked for is searched, not explained')
  assert.equal(r.dias, 'Esta semana hay disponibilidad de Electricidad el jueves 8. ¿Te muestro los horarios de ese día?', '"¿por qué no hay turnos?" reads the real calendar')
  assert.match(r.quienAntes, /^La primera disponibilidad/u)
  assert.equal(r.noSonAyuda, 0)
})

test('AYUDA estado real: "¿cómo verifico mi número?" changes with what the backend knows — not verified, verified but not linked, challenge pending, code expired or used, linked, conflict', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const PREGUNTA = '¿cómo verifico mi número?'
    // Not verified in any account.
    out.sinCuenta = ver(await enviar('5493794610001', PREGUNTA))
    // Verified, WhatsApp not linked.
    const b = await cuenta('+5493794610002')
    out.verificado = ver(await enviar('5493794610002', PREGUNTA))
    out.porQueVincular = (await enviar('5493794610002', 'por qué me vuelve a pedir vincular?')).text
    out.registrarse = (await enviar('5493794610002', 'cómo me registro?')).text
    // A link challenge waiting.
    const desafio = await tel.iniciarVinculo(b)
    out.pendiente = (await enviar('5493794610002', PREGUNTA)).text
    out.listoSinEnviar = (await enviar('5493794610002', 'no me funciona el código')).text
    // The code expires (10 minutes).
    waAdvance(11 * 60 * 1000)
    out.vencido = ver(await enviar('5493794610002', 'el código venció, qué hago'))
    out.vencidoInvalido = (await enviar('5493794610002', desafio.message)).text
    // A new code, sent: linked. The same question now says so.
    const nuevo = await tel.iniciarVinculo(b)
    await enviar('5493794610002', nuevo.message)
    out.vinculado = ver(await enviar('5493794610002', PREGUNTA))
    out.usado = (await enviar('5493794610002', 'me dice código inválido')).text
    // Conflict: the account of this number is linked to another WhatsApp.
    const c = await cuenta('+5493794610003')
    await enviar('5493794619999', 'hola')
    const ajeno = await contactOf('5493794619999')
    await waTx.ejecutar((repos) => repos.contactos.actualizar({ ...ajeno, linkedAccountId: c, linkedTenantId: accounts.get(c).tenantId, linkedAt: new Date(waClock()).toISOString(), version: ajeno.version + 1 }, ajeno.version))
    out.conflicto = (await enviar('5493794610003', PREGUNTA)).text
    // The state port: only states, for the sender's own number.
    out.estados = [await tel.estadoDesafio('5493794610001'), await tel.estadoDesafio('5493794610002'), await tel.estadoDesafio('no-es-numero')]
    const todo = fakeWa.sent.map((item) => item.message.text ?? '').join('\\n')
    out.fugas = [todo.includes(b), todo.includes(c), /persona\\d+@example\\.com/u.test(todo), /Persona Secreta/u.test(todo)]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.sinCuenta, ['cta_url', `${SIN_VERIFICAR}\n\n${guia('verificar-celular')}`, 'Ir a Mi perfil', PERFIL])
  assert.deepEqual(r.verificado, ['cta_url', 'No necesitás verificarlo otra vez. Tu número ya está verificado; lo que falta es vincular este WhatsApp con tu cuenta TUS. Entrá a Mi perfil, tocá "Vincular este WhatsApp" y enviá desde acá el mensaje que te muestra.\n\n' + guia('vincular-whatsapp'), 'Vincular WhatsApp', VINCULAR], 'verifying and linking are told apart: the guide is the one of the step that is really missing')
  assert.match(r.porQueVincular, /Son dos pasos distintos: verificar confirma que el teléfono es de tu cuenta; vincular conecta este WhatsApp con esa cuenta\./u, 'the cause is explained, not a button repeated')
  assert.match(r.registrarse, /^No hace falta que te registres de nuevo: este número ya es el teléfono verificado de una cuenta TUS\./u)
  assert.match(r.pendiente, /^Hay una verificación en curso para este número: falta enviar desde este WhatsApp el mensaje "VERIFICAR TUS"/u)
  assert.match(r.listoSinEnviar, /^Todavía no me llegó el código de este número\./u)
  assert.equal(r.vencido[1], 'El último código que generaste venció (dura 10 minutos). Tu número ya está verificado; lo que falta es vincular este WhatsApp con tu cuenta TUS. Generá uno nuevo: entrá a Mi perfil, tocá "Vincular este WhatsApp" y enviá desde acá el mensaje que te muestra.\n\n' + guia('vincular-whatsapp'), 'the real cause, and where to get a new one')
  assert.deepEqual(r.vencido.slice(2), ['Vincular WhatsApp', VINCULAR])
  assert.equal(r.vencidoInvalido, 'No pudimos verificar ese código. Volvé a TUS y generá una nueva verificación.', 'an expired code still verifies nothing')
  assert.deepEqual(r.vinculado, ['text', 'Tu número ya está verificado y este WhatsApp ya está vinculado a tu cuenta TUS.', null, null])
  assert.equal(r.usado, 'Tu número ya está verificado y este WhatsApp ya está vinculado a tu cuenta TUS.')
  assert.match(r.conflicto, /^Este número figura asociado a otra vinculación de WhatsApp/u)
  assert.deepEqual(r.estados, ['ninguno', 'usado', 'ninguno'])
  assert.deepEqual(r.fugas, [false, false, false, false], 'no account id, email or name in any answer')
  for (const texto of [r.sinCuenta[1], r.verificado[1], r.pendiente, r.vencido[1], r.vinculado[1], r.conflicto]) assert.doesNotMatch(texto, /verificá (?:tu |este )?WhatsApp/iu, '"verificar WhatsApp" is never said: the phone is verified, the WhatsApp is linked')
})

test('AYUDA reanudación: "listo" is never believed — the backend re-reads the state; once the WhatsApp is really linked the request resumes exactly where it was', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const W = '5493794620001'
    const id = await cuenta('+5493794620001')
    await hastaIdentidad(W)
    out.pregunta = (await enviar(W, 'cómo verifico mi número?')).text.split('\\n')[0]
    // "Listo" without having done anything: the real state is told, nothing is assumed.
    out.listoFalso = (await enviar(W, 'listo')).text.split('\\n')[0]
    out.yaLoHice = (await enviar(W, 'ya lo hice')).text.split('\\n')[0]
    out.despues = (await enviar(W, '¿y después?')).text.split('\\n')[0]
    out.frustrado = (await enviar(W, 'otra vez me pide lo mismo, no funciona')).text.split('\\n')[0]
    out.reservas = dom.reservas.length
    out.reserva = await reserva(W)
    // Now it is really done: the challenge is sent from this WhatsApp.
    const desafio = await tel.iniciarVinculo(id)
    out.vinculo = (await enviar(W, desafio.message)).text.split('\\n')[0]
    const retoma = await enviar(W, 'listo')
    out.retoma = [retoma.type, retoma.text.split('\\n').slice(0, 9)]
    out.sinReservaAun = dom.reservas.length
    await enviar(W, 'sí')
    out.pedida = dom.reservas.map((x) => [x.subjectId === id, x.providerId, x.oficioId, x.inicio === iso('2026-10-08', '09:00')])
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.pregunta, 'No necesitás verificarlo otra vez. Tu número ya está verificado; lo que falta es vincular este WhatsApp con tu cuenta TUS. Entrá a Mi perfil, tocá "Vincular este WhatsApp" y enviá desde acá el mensaje que te muestra.')
  assert.match(r.listoFalso, /^Todavía no figura el vínculo\./u, '"listo" is checked against the backend')
  assert.match(r.yaLoHice, /^Todavía no figura el vínculo\./u)
  assert.match(r.despues, /^Lo que sigue es vincular este WhatsApp:/u, '"¿y después?" is the next step, not the whole explanation again')
  assert.match(r.frustrado, /Son dos pasos distintos/u, 'frustration gets a diagnosis of which step is missing, not the same instruction')
  assert.equal(new Set([r.pregunta, r.despues, r.frustrado]).size, 3)
  assert.equal(r.reservas, 0)
  assert.deepEqual(r.reserva, ['Juan Pérez', 'plomeria', 'identity', true])
  assert.equal(r.vinculo, '✅ ¡Listo! Este WhatsApp quedó vinculado a tu cuenta TUS.')
  assert.equal(r.retoma[0], 'buttons')
  assert.deepEqual(r.retoma[1], ['Perfecto, ya te reconozco desde este WhatsApp. Seguíamos con tu turno de Plomería con Juan Pérez.', '', 'Vas a solicitar:', 'Prestador: Juan Pérez', 'Servicio: Plomería', 'Fecha: jueves 8 de octubre', 'Horario: 09:00', 'Precio: $200', 'Seña: $100 (se abona cuando el prestador acepte)'], 'the same professional, service, day, time and price: nothing was started again')
  assert.equal(r.sinReservaAun, 0, 'resuming shows the card; nothing is requested without the confirmation')
  assert.deepEqual(r.pedida, [[true, 'perfil-juan', 'plomeria', true]], 'requested as the account that was really linked')
})

test('AYUDA semántica: when the fixed patterns do not recognise a problem, the model names the topic (a label only) and the backend answers; the model never writes the state', () => {
  const r = runTypeScriptScenario(`${SETUP}
    conModelo()
    const out = {}
    const W = '5493794630001'
    script = () => { throw new Error('the model must not be called for a message the backend reads') }
    await hastaIdentidad(W)
    // A way of saying it no pattern knows: the model is asked WHAT it is about.
    const vistos = []
    script = (input) => { vistos.push(input.messages.at(-1).content); return { content: '{"help":"phone_verification"}' } }
    out.semantica = (await enviar(W, 'che esto del celu qué onda')).text.split('\\n')[0]
    out.modeloVio = vistos.length
    // The model answers "null": the message is read by the step, as before.
    script = () => ({ content: '{"help":null}' })
    out.noEsAyuda = (await enviar(W, 'bueno te paso mis datos entonces')).text
    // A label that is not a topic, prose, or a model that fails: never trusted, the step goes on.
    script = () => ({ content: 'Tu teléfono ya está verificado, no te preocupes.' })
    out.prosa = (await enviar(W, 'mmm bueno a ver che dale')).text
    script = () => { throw new Error('model down') }
    out.caido = (await enviar(W, 'eeh no sé')).text
    // Real data never goes to the model: a document is read by the backend.
    let llamadas = 0
    script = () => { llamadas += 1; return { content: '{"help":"registration"}' } }
    out.datos = (await enviar(W, 'Juan Ignacio Flores 44321092')).text.split('. ')[0]
    out.llamadasConDatos = llamadas
    out.reserva = await reserva(W)
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.semantica, SIN_VERIFICAR, 'the label came from the model; the answer is the backend\'s, from the real state')
  assert.equal(r.modeloVio, 1)
  assert.equal(r.noEsAyuda, 'Para registrar la solicitud necesito tu nombre completo y DNI. Por ejemplo: "Juan Pérez, 12345678".', 'not help: the step reads the message, as before')
  assert.doesNotMatch(r.prosa, /ya está verificado, no te preocupes/u, 'the model\'s claim about the state never reaches the person')
  assert.match(r.caido, /nombre completo y DNI/u, 'a model that fails changes nothing')
  assert.notEqual(r.prosa, r.noEsAyuda, 'the same request for data is not sent twice in a row')
  assert.equal(r.datos, 'No pude validar esos datos con una cuenta TUS')
  assert.equal(r.llamadasConDatos, 0, 'a message with a document is never sent to the model')
  assert.deepEqual(r.reserva, ['Juan Pérez', 'plomeria', 'identity', true])
})

test('AYUDA tools del modelo: get_tus_help and diagnose_user_issue give the model REAL states (never account data), the real page and the documents', () => {
  const r = runTypeScriptScenario(`${SETUP}
    conModelo()
    const out = {}
    const { HERRAMIENTAS, seleccionarHerramientas } = await import('./apps/api/src/tus/asistente/herramientas.ts')
    const actor = { contactId: 'c', conversationId: 'v', context: null, isProvider: false }
    out.nombres = HERRAMIENTAS.map((t) => t.name).filter((n) => ['get_tus_help', 'diagnose_user_issue'].includes(n))
    out.ofrecidas = ['buscar', 'reserva', 'pago', 'identidad', 'otro'].map((i) => seleccionarHerramientas(i, actor).filter((t) => ['get_tus_help', 'diagnose_user_issue'].includes(t.name)).length)
    const W = '5493794640001'
    const id = await cuenta('+5493794640001')
    // Options are on the table (no step is consuming messages): a vague problem reaches the model.
    script = () => { throw new Error('the model must not be called for a search the backend reads') }
    await enviar(W, 'Necesito un plomero')
    const VAGO = 'che, tengo un drama con la app'
    // The model asks for the diagnosis; what it gets back is the tool message.
    let diagnostico = null
    script = (input) => {
      const tool = input.messages.find((m) => m.role === 'tool')
      if (tool) { diagnostico = JSON.parse(tool.content); return { content: 'Te falta vincular este WhatsApp.' } }
      return { toolCalls: [llamada('diagnose_user_issue', {})] }
    }
    out.respuestaDelModelo = (await enviar(W, VAGO)).text
    out.diagnostico = diagnostico
    const crudo = JSON.stringify(diagnostico)
    out.fugas = [crudo.includes(id), /persona\\d+@example/u.test(crudo), /Persona Secreta/u.test(crudo), /5493794640001|3794640001/u.test(crudo)]
    // get_tus_help on WhatsApp: the backend writes the answer (state + page), not the model.
    script = (input) => input.messages.some((m) => m.role === 'tool') ? { content: 'Inventado: andá a /ajustes/telefono' } : { toolCalls: [llamada('get_tus_help', { topic: 'whatsapp_linking', question: 'cómo vinculo' })] }
    const ayuda = await enviar(W, VAGO)
    out.ayuda = ver(ayuda)
    // An unknown topic is rejected by the schema.
    const { validarYEjecutar } = await import('./apps/api/src/tus/asistente/herramientas.ts')
    out.temaInvalido = (await validarYEjecutar({ name: 'get_tus_help', rawArguments: JSON.stringify({ topic: 'hackear', question: 'x' }), actor, domain: dominio, allowed: new Set(['get_tus_help']), timeoutMs: 1000 })).error
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.nombres.sort(), ['diagnose_user_issue', 'get_tus_help'])
  assert.deepEqual(r.ofrecidas, [2, 2, 2, 2, 2], 'offered wherever a problem may come up')
  assert.deepEqual([r.diagnostico.channel, r.diagnostico.signedIn, r.diagnostico.role, r.diagnostico.whatsappLink, r.diagnostico.phoneVerified, r.diagnostico.linkingCode, r.diagnostico.pendingPayments], ['whatsapp', false, 'visitor', 'verificado_sin_vinculo', true, 'ninguno', null])
  assert.deepEqual(r.diagnostico.pendingFlow, { servicio: 'Plomería', profesional: null, cuando: null, espera: 'eleccion' }, 'what the conversation was doing is part of the diagnosis')
  assert.equal(r.respuestaDelModelo, 'Te falta vincular este WhatsApp.', 'the model explains from the states the backend gave it')
  assert.deepEqual(r.fugas, [false, false, false, false], 'states only: no id, email, name or phone number')
  assert.equal(r.ayuda[0], 'cta_url')
  assert.match(r.ayuda[1], /^Tu número ya está verificado; lo que falta es vincular este WhatsApp con tu cuenta TUS\./u)
  assert.doesNotMatch(r.ayuda[1], /ajustes/u, 'a route the model made up never reaches the person')
  assert.deepEqual(r.ayuda.slice(2), ['Vincular WhatsApp', VINCULAR])
  assert.equal(r.temaInvalido, 'INVALID_ARGUMENTS')
})

test('AYUDA rutas y conocimiento: every page the assistant points to exists in the Web; the knowledge base describes the CURRENT flows', () => {
  const { RUTAS } = runTypeScriptScenario(`
    const { RUTAS_TUS } = await import('./apps/api/src/tus/asistente/asistencia.ts')
    console.log(JSON.stringify({ RUTAS: RUTAS_TUS }))
  `)
  const app = join(root, 'apps/web/src/app')
  const paginas = []
  const recorrer = (dir, ruta) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) recorrer(join(dir, entry.name), /^\(.*\)$/u.test(entry.name) ? ruta : `${ruta}/${entry.name}`)
      else if (entry.name === 'page.tsx') paginas.push(ruta || '/')
    }
  }
  recorrer(app, '')
  for (const [nombre, ruta] of Object.entries(RUTAS)) assert.ok(paginas.includes(ruta.split('?')[0]), `${nombre}: ${ruta} is not a real page of the Web`)
  // The linking deep link is the one Mi perfil really understands.
  assert.match(readFileSync(join(root, 'apps/web/src/app/mi-perfil/page.tsx'), 'utf8') + readdirSync(join(root, 'apps/web/src/features/profile')).map((f) => readFileSync(join(root, 'apps/web/src/features/profile', f), 'utf8')).join('\n'), /accion=vincular-whatsapp|vincular-whatsapp/u)
  // Knowledge: the old token flow is gone, the real one is described, and turnos/señas exist.
  // Each flow has its own guide now (they are also the pages of the Help Center).
  const doc = (nombre) => readFileSync(join(root, 'docs/conocimiento', nombre), 'utf8')
  for (const nombre of ['registro-y-cuenta.md', 'verificar-celular.md', 'vincular-whatsapp.md']) assert.doesNotMatch(doc(nombre), /últimos 4 dígitos|Escribí "vincular mi cuenta"/u, 'the retired linking flow is not documented any more')
  assert.match(doc('verificar-celular.md'), /Verificar mi número/u)
  assert.match(doc('verificar-celular.md'), /VERIFICAR TUS/u)
  assert.match(doc('vincular-whatsapp.md'), /Son dos cosas distintas/u, 'verifying the phone and linking the WhatsApp are told apart')
  assert.match(doc('pagos.md'), /mitad del precio/u)
  assert.match(doc('turnos-y-senas.md'), /no se reprograma/u)
  assert.doesNotMatch(readFileSync(join(root, 'docs/conocimiento/asistente-whatsapp.md'), 'utf8'), /No envíes por el chat tu DNI/u, 'the chat does ask for the DNI to find the account: the doc no longer says the opposite')
})

test('AYUDA detección: questions and problems are recognised with their topic; answers to a step, searches and payments said done are not help', () => {
  const r = runTypeScriptScenario(`
    const { detectarAyuda } = await import('./apps/api/src/tus/asistente/asistencia.ts')
    const tema = (texto, enPaso = false) => { const a = detectarAyuda(texto, { enPaso }); return a ? [a.tema, a.frustracion, a.hecho, a.siguiente] : null }
    const casos = ['Pero cómo verifico mi número', 'donde valido el celu', 'no me reconoce el telefono', 'ya puse mi numero y no me deja', 'me dice que no estoy registrado', 'no me deja entrar', 'dónde vinculo whatsapp', 'el código venció', 'me dice código inválido', 'cambié de número', '¿cómo inicio sesión?', 'me olvidé la contraseña', '¿qué significa seña?', 'dónde subo mi foto', 'dónde configuro mis servicios', 'dónde pongo mis horarios', 'dónde vinculo Mercado Pago', 'dónde veo mis ganancias', 'cómo cancelo', 'me rechazó mercado pago', 'dónde mando el comprobante']
    const out = { casos: Object.fromEntries(casos.map((c) => [c, tema(c)?.[0] ?? null])) }
    out.noSonAyuda = ['Juan Ignacio Flores, 44321092', 'Juan Pérez', 'sí', 'no', 'la segunda', '9:45', 'el jueves', 'mañana a la tarde', 'cancelar', 'hola', 'gracias'].map((c) => tema(c, true))
    out.enPaso = { listo: tema('listo', true), yaEsta: tema('ya está', true), yDespues: tema('¿y después?', true), noFunciona: tema('no funciona', true), queHago: tema('qué hago ahora', true), mierda: tema('qué mierda tengo que hacer', true) }
    out.fueraDePaso = [tema('listo'), tema('no funciona'), tema('¿y después?')]
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.casos, {
    'Pero cómo verifico mi número': 'phone_verification',
    'donde valido el celu': 'phone_verification',
    'no me reconoce el telefono': 'phone_verification',
    'ya puse mi numero y no me deja': 'phone_verification',
    'me dice que no estoy registrado': 'registration',
    'no me deja entrar': 'login',
    'dónde vinculo whatsapp': 'whatsapp_linking',
    'el código venció': 'linking_code',
    'me dice código inválido': 'linking_code',
    'cambié de número': 'phone_change',
    '¿cómo inicio sesión?': 'login',
    'me olvidé la contraseña': 'password_reset',
    '¿qué significa seña?': 'deposit',
    'dónde subo mi foto': 'provider_profile',
    'dónde configuro mis servicios': 'provider_services',
    'dónde pongo mis horarios': 'provider_schedule',
    'dónde vinculo Mercado Pago': 'mercado_pago',
    'dónde veo mis ganancias': 'earnings',
    'cómo cancelo': 'cancellations',
    'me rechazó mercado pago': 'payments',
    'dónde mando el comprobante': 'receipts',
  })
  assert.deepEqual(r.noSonAyuda, Array(11).fill(null), 'data, choices, days, times and courtesy are never help')
  assert.deepEqual(r.enPaso.listo, ['next_step', false, true, false])
  assert.deepEqual(r.enPaso.yaEsta, ['next_step', false, true, false])
  assert.deepEqual(r.enPaso.yDespues, ['next_step', false, false, true])
  assert.deepEqual(r.enPaso.noFunciona, ['stuck', true, false, false])
  assert.deepEqual(r.enPaso.queHago, ['next_step', false, false, true])
  assert.equal(r.enPaso.mierda[0], 'stuck')
  assert.deepEqual(r.fueraDePaso, [null, null, null], 'with no step waiting, "listo" or "no funciona" alone are not about anything')
})
