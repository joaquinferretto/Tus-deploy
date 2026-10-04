import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTEXTO_SETUP } from './fixtures/asistente-contexto.mjs'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// ASISTENTE-IDENTIDAD-01. "Ya estoy registrado y logueado, ¿podés ver mi número?" is answered by the
// BACKEND with the real state of the link between this WhatsApp and a TUS account:
//   A. the number is not the verified phone of any account;
//   B. it is the verified phone of an account, not linked yet;
//   C. a verification / link challenge for it is waiting;
//   D. this WhatsApp is linked;
//   E. conflict (the account of this number is linked to another WhatsApp).
// What a person SAYS never moves that state, a Web session is never claimed to be seen, the only
// number ever looked up is the sender's own wa_id, and nothing of the account leaves the backend.

const SETUP = `${CONTEXTO_SETUP}
  const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  const { AlmacenTelefonosEnMemoria } = await import('./apps/api/src/auth-security/phone/almacenes.ts')
  const { crearServicioTelefono } = await import('./apps/api/src/auth-security/phone/composicion.ts')
  const idStore = new InMemoryIdentityStore()
  const auth = { ...createAuthService({ store: idStore, now: waClock }), store: idStore }
  const almacenTel = new AlmacenTelefonosEnMemoria(idStore, waStore.enlaceTelefonos())
  const tel = crearServicioTelefono({ auth, telefonos: almacenTel, env: { TUS_WHATSAPP_PUBLIC_NUMBER: '+54 9 379 400-0000' }, now: waClock })
  const modV = crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: accountResolver, domain: dominio, knowledgeIndex, whatsapp: fakeWa, chat: null, embeddings, transcriptor: null, now: waClock, metric: () => {}, verificadorTelefono: tel })
  const colaV = modV.crearWorker({ owner: 'identidad-1' })
  const salidas = (waId) => fakeWa.sent.filter((item) => item.to === waId).map((item) => item.message)
  async function enviar(waId, texto) {
    await modV.ingreso.procesar(parsearWebhookMeta(inbound(waId, texto), PHONE_ID), 'corr-identidad')
    for (let i = 0; i < 6; i += 1) if ((await colaV.procesarSiguiente()).outcome === 'idle') break
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
  const contacto = (waId) => waStore.repositorios().contactos.buscarPorWaId(waId)
  const vinculoDe = async (waId) => (await contacto(waId))?.linkedAccountId ?? null
  const PREGUNTA = 'ya estoy registrado y logueado ¿podés ver mi número?'
  const ver = (m) => [m.type, m.text, m.label ?? null, m.url ?? null]
`

const SESION = 'No puedo ver si iniciaste sesión en la Web: WhatsApp es un canal aparte. Lo que sí puedo comprobar es este número.'
const SIN_CUENTA = 'No encuentro este número como verificado en una cuenta TUS. Entrá a Mi perfil para verificarlo.'
const VERIFICADO = 'Sí, este número coincide con una cuenta TUS que ya tiene el celular verificado. Solo falta vincular este WhatsApp con tu cuenta.'
const PENDIENTE = 'Hay una verificación en curso para este número. Para terminarla, enviá desde este WhatsApp el mensaje "VERIFICAR TUS" con el código que te muestra Mi perfil.'
const VINCULADO = 'Sí, este WhatsApp ya está vinculado a tu cuenta TUS. ¿En qué te ayudo?'
const CONFLICTO = 'No puedo vincular este WhatsApp desde acá: el número figura asociado a otra vinculación. Revisalo desde Mi perfil.'
const PERFIL = 'https://web.tus.test/mi-perfil?accion=vincular-whatsapp'

test('IDENTIDAD estados: the reply to "¿podés ver mi número?" is the REAL state of the sender\'s number — unknown, verified but not linked, challenge pending, linked, conflict', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    // D of the tests: a number with no compatible account.
    out.sinCuenta = ver(await enviar('5493794000001', PREGUNTA))
    // B / C: the number is the verified phone of an account; the WhatsApp is not linked yet.
    const b = await cuenta('+5493794123456')
    out.verificado = ver(await enviar('5493794123456', PREGUNTA))
    // The same Argentine mobile as Meta may deliver it without the 9: one number, one state.
    const sin9 = await cuenta('+5493794222333')
    out.sinNueve = (await enviar('543794222333', '¿ves mi cuenta?')).text
    // F: a link challenge is waiting to be sent from this WhatsApp.
    const desafio = await tel.iniciarVinculo(b)
    out.pendiente = ver(await enviar('5493794123456', '¿está vinculado mi WhatsApp?'))
    // G: the challenge is sent from this WhatsApp: linked. Asked again: linked, and never asked to link again.
    out.exito = (await enviar('5493794123456', desafio.message)).text.split('\\n')[0]
    out.vinculo = (await vinculoDe('5493794123456')) === b
    out.vinculado = ver(await enviar('5493794123456', PREGUNTA))
    out.otraVez = ver(await enviar('5493794123456', 'estoy vinculado?'))
    // E (conflict): the account of this number is linked to ANOTHER WhatsApp.
    const c = await cuenta('+5493794555666')
    await enviar('5493794999000', 'hola')
    const ajeno = await contacto('5493794999000')
    await waTx.ejecutar((repos) => repos.contactos.actualizar({ ...ajeno, linkedAccountId: c, linkedTenantId: accounts.get(c).tenantId, linkedAt: new Date(waClock()).toISOString(), version: ajeno.version + 1 }, ajeno.version))
    out.conflicto = ver(await enviar('5493794555666', PREGUNTA))
    // A linked contact whose account is no longer available: never treated as linked.
    accounts.get(b).status = 'disabled'
    out.cuentaCaida = (await enviar('5493794123456', PREGUNTA)).text
    out.metricas = []
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.sinCuenta, ['cta_url', `${SESION}\n\n${SIN_CUENTA}`, 'Ir a Mi perfil', PERFIL])
  assert.deepEqual(r.verificado, ['cta_url', `${SESION}\n\n${VERIFICADO}`, 'Vincular mi cuenta TUS', PERFIL])
  assert.equal(r.sinNueve, VERIFICADO, 'with or without the 9: the canonical phone functions decide, not a second normaliser')
  assert.deepEqual(r.pendiente, ['cta_url', PENDIENTE, 'Vincular mi cuenta TUS', PERFIL])
  assert.equal(r.exito, '✅ ¡Listo! Este WhatsApp quedó vinculado a tu cuenta TUS.')
  assert.equal(r.vinculo, true)
  assert.deepEqual(r.vinculado, ['text', VINCULADO, null, null], 'linked: said, and the conversation goes on; a Web session is not mentioned')
  assert.deepEqual(r.otraVez, ['text', VINCULADO, null, null], 'once linked the link is never asked again')
  assert.deepEqual(r.conflicto, ['cta_url', `${SESION}\n\n${CONFLICTO}`, 'Vincular mi cuenta TUS', PERFIL])
  assert.equal(r.cuentaCaida, `${SESION}\n\n${CONFLICTO}`, 'a link to an account that is no longer available is a conflict, never "linked"')
})

test('IDENTIDAD gate: saying "ya estoy logueado" changes nothing — it is never a search, never a link, and personal actions still need the account', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const W = '5493794700001'
    await cuenta('+5493794700001')
    // The conversation of the screenshot: a search is going on, then the person says it is logged in.
    out.lista = (await enviar(W, LUNES)).text.split('\\n')[0]
    const consultas = dom.consultas.length
    const antes = await necesidad(W)
    const respuesta = await enviar(W, 'Ya estoy registrado y logueado, ¿podés ver mi número?')
    out.respuesta = respuesta.text
    out.sinBusqueda = dom.consultas.length - consultas
    const despues = await necesidad(W)
    out.necesidadIntacta = JSON.stringify(antes) === JSON.stringify(despues)
    out.sigueSinVinculo = await vinculoDe(W)
    // Every way of saying it: the same real state, never availability.
    out.frases = {}
    for (const frase of ['ya estoy logueado', 'estoy registrado', 'ya me registré', 'ya inicié sesión', 'podés ver mi cuenta?', 'ves mi número?', 'ya tengo la sesión iniciada', 'mi número ya está verificado']) {
      const m = await enviar(W, frase)
      out.frases[frase] = [/coincide con una cuenta TUS que ya tiene el celular verificado/u.test(m.text), /profesional|turno|disponibilidad|Masaje/u.test(m.text)]
    }
    out.sinBusquedaTrasFrases = dom.consultas.length - consultas
    out.sigueSinVinculoTrasFrases = await vinculoDe(W)
    // H. A public search is still allowed without the link.
    out.busquedaPublica = (await enviar(W, 'Quiero una masajista para el martes')).text.split('\\n')[0]
    // I. A personal action is not: choosing a turno tells the choice and its real price, asks for
    //    the link and requests nothing.
    const eleccion = await enviar(W, 'la primera')
    out.eleccion = [eleccion.type, eleccion.text.split('\\n').slice(0, 2), /vincular este número con una cuenta TUS|Solo falta vincular este WhatsApp/u.test(eleccion.text)]
    out.reservas = dom.reservas.length
    out.privado = (await enviar(W, '¿qué presupuesto tengo?')).type
    // "sí" after claiming to be logged in confirms nothing: there is nothing bound to an account.
    out.si = (await enviar(W, 'sí')).text
    out.reservasFinal = dom.reservas.length
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.lista, 'Encontré 3 profesionales de Masaje con turno el lunes 28:')
  assert.equal(r.respuesta, `${SESION}\n\n${VERIFICADO}`, 'the real state of the number; never "veo que estás logueado", never a list of turnos')
  assert.doesNotMatch(r.respuesta, /Masaje|disponibilidad|profesional|turno/iu)
  assert.equal(r.sinBusqueda, 0, '"ya" in "ya estoy registrado" is not "lo antes posible": nothing was searched')
  assert.equal(r.necesidadIntacta, true, 'the search in progress is untouched')
  assert.equal(r.sigueSinVinculo, null, 'a sentence never links a WhatsApp')
  for (const [frase, [estado, busqueda]] of Object.entries(r.frases)) {
    assert.equal(estado, true, `${frase}: answered with the state of the number`)
    assert.equal(busqueda, false, `${frase}: never answered with availability`)
  }
  assert.equal(r.sinBusquedaTrasFrases, 0)
  assert.equal(r.sigueSinVinculoTrasFrases, null)
  assert.equal(r.busquedaPublica, 'Encontré 2 profesionales de Masaje con turno el martes 29:', 'searching is public')
  assert.deepEqual(r.eleccion, ['cta_url', ['Perfecto: Bongio, el martes 29 a las 18:30.', 'El servicio cuesta $18.000 y la seña es de $9.000.'], true], 'requesting a turno needs the account')
  assert.equal(r.reservas, 0)
  assert.equal(r.privado, 'cta_url', 'private data needs the link')
  assert.equal(r.reservasFinal, 0, 'nothing was requested for an unlinked WhatsApp')
})

test('IDENTIDAD privacidad: only the sender\'s own number is ever looked up; a number typed in a message reveals nothing; no account data leaves the backend', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const id = await cuenta('+5493794123456')
    const cuentaGuardada = await idStore.getAccount(id)
    // Somebody else, from a number with no account, types the number of that account.
    const ajeno = '5493794000777'
    const respuestas = []
    for (const texto of ['ya estoy registrado, mi número es +54 9 379 4123456', '¿Está registrado el número +54 9 379 4123456?', 'podés ver mi número? es el 3794123456', '¿el 3794123456 tiene cuenta en TUS?']) respuestas.push((await enviar(ajeno, texto)).text)
    out.respuestas = respuestas
    // The owner of the number, from that number.
    const propio = (await enviar('5493794123456', 'podés ver mi número?')).text
    out.propio = propio
    const todo = [...respuestas, propio].join('\\n')
    out.fugas = [todo.includes(id), todo.includes(cuentaGuardada.tenantId), /persona\\d+@example\\.com/u.test(todo), /Persona Secreta/u.test(todo), /379\\s?4?123456|3794123456/u.test(todo)]
    // The port takes a wa_id and returns a state, nothing else.
    out.estados = [await tel.estadoNumero('5493794123456'), await tel.estadoNumero('543794123456'), await tel.estadoNumero(ajeno), await tel.estadoNumero('no-es-un-numero'), await tel.estadoNumero('+54 9 379 4123456')]
    console.log(JSON.stringify(out))
  `)
  assert.match(r.respuestas[0], /No encuentro este número como verificado en una cuenta TUS/u, 'the state is the SENDER\'s, whatever number the message carries')
  assert.match(r.respuestas[2], /No encuentro este número como verificado en una cuenta TUS/u)
  for (const texto of r.respuestas) assert.doesNotMatch(texto, /coincide con una cuenta TUS|ya está vinculado|verificación en curso/u, 'nothing is said about a number that is not the sender\'s')
  assert.match(r.propio, /este número coincide con una cuenta TUS que ya tiene el celular verificado/u)
  assert.deepEqual(r.fugas, [false, false, false, false, false], 'no account id, tenant, email, name or phone number in any reply')
  assert.deepEqual(r.estados.slice(0, 4), ['verificado_sin_vinculo', 'verificado_sin_vinculo', 'sin_cuenta', 'sin_cuenta'])
})
