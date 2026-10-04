import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONTEXTO_SETUP } from './fixtures/asistente-contexto.mjs'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// "VERIFICAR TUS <code>" links the WhatsApp to the TUS account in the SAME transaction that consumes
// the challenge: the field the assistant reads (contact.linkedAccountId) is the single source of
// truth. These tests replay the real failure: verify -> "Quiero una masajista" -> the bot asked to
// link again.

const SETUP = `${CONTEXTO_SETUP}
  const { createAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { InMemoryIdentityStore } = await import('./apps/api/src/auth-security/adapters/in-memory-identity-store.ts')
  const { AlmacenTelefonosEnMemoria } = await import('./apps/api/src/auth-security/phone/almacenes.ts')
  const { crearServicioTelefono } = await import('./apps/api/src/auth-security/phone/composicion.ts')
  const { normalizarTelefono, telefonoDesdeWaId } = await import('./packages/contracts/src/tus-telefono.ts')
  const idStore = new InMemoryIdentityStore()
  const auth = { ...createAuthService({ store: idStore, now: waClock }), store: idStore }
  const almacenTel = new AlmacenTelefonosEnMemoria(idStore, waStore.enlaceTelefonos())
  const tel = crearServicioTelefono({ auth, telefonos: almacenTel, env: { TUS_WHATSAPP_PUBLIC_NUMBER: '+54 9 379 400-0000' }, now: waClock })
  const moduloV = (verificador) => crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: accountResolver, domain: dominio, knowledgeIndex, whatsapp: fakeWa, chat: null, embeddings, transcriptor: null, now: waClock, metric: () => {}, verificadorTelefono: verificador })
  let modV = moduloV(tel)
  let colaV = modV.crearWorker({ owner: 'vinculo-1' })
  // A process restart: a brand new module, worker and identity service over the same storage.
  function reiniciar() {
    const almacen = new AlmacenTelefonosEnMemoria(idStore, waStore.enlaceTelefonos())
    const servicio = crearServicioTelefono({ auth, telefonos: almacen, env: { TUS_WHATSAPP_PUBLIC_NUMBER: '+54 9 379 400-0000' }, now: waClock })
    modV = moduloV(servicio); colaV = modV.crearWorker({ owner: 'vinculo-2' })
    return servicio
  }
  async function enviar(waId, texto) {
    await modV.ingreso.procesar(parsearWebhookMeta(inbound(waId, texto), PHONE_ID), 'corr-vinculo')
    for (let i = 0; i < 6; i += 1) if ((await colaV.procesarSiguiente()).outcome === 'idle') break
    waAdvance(6000)
    return salidas(waId).at(-1)
  }
  const salidas = (waId) => fakeWa.sent.filter((item) => item.to === waId).map((item) => item.message)
  let cuentas = 0
  async function cuenta(telefonoVerificado) {
    cuentas += 1
    const out = await auth.service.registerAccount({ email: 'persona' + cuentas + '@example.com', password: 'una frase larga y segura 2026', displayName: 'Persona ' + cuentas })
    const id = out.created.account.id
    const guardada = await idStore.getAccount(id)
    accounts.set(id, { tenantId: guardada.tenantId, status: 'active', roles: ['owner'] })
    if (telefonoVerificado) await almacenTel.fijarVerificado(id, telefonoVerificado, waClock())
    return id
  }
  const contacto = (waId) => waStore.repositorios().contactos.buscarPorWaId(waId)
  const vinculoDe = async (waId) => (await contacto(waId))?.linkedAccountId ?? null
`

test('VINCULO E2E: VERIFICAR TUS -> linked -> "Quiero una masajista" never asks to link again, the assistant acts as the account, and it survives a restart', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const W = '5493794123456'
    const out = {}
    const id = await cuenta('+5493794123456')
    out.id = id
    out.antesEstado = await tel.estadoCuenta(id)
    // Before: the phone is verified but the WhatsApp is not linked: the bot asks to link (and knows the number is verified).
    out.antes = (await enviar(W, 'ya verifiqué mi número')).text
    const desafio = await tel.iniciarVinculo(id)
    out.desafio = [desafio.ok, desafio.purpose, desafio.phoneMasked]
    const exito = await enviar(W, desafio.message)
    out.exito = exito.text
    out.vinculo = [await vinculoDe(W) === id, (await contacto(W)).linkedTenantId === (await idStore.getAccount(id)).tenantId]
    out.despuesEstado = await tel.estadoCuenta(id)
    // The very next message.
    const masajista = await enviar(W, 'Quiero una masajista para el lunes que viene')
    out.masajista = masajista.text
    out.pasos = [(await enviar(W, 'Melina a las 10:15')).text, (await enviar(W, 'sí')).text]
    out.reservaComo = dom.reservas.map((reserva) => reserva.subjectId)
    out.pidioVincular = salidas(W).filter((m) => /vincular este WhatsApp con tu cuenta|Vincular mi cuenta/u.test(m.text ?? '') ).length
    // Restart: nothing lives in the process.
    reiniciar()
    out.trasReinicio = (await enviar(W, 'ya tengo cuenta')).text
    out.vinculoTrasReinicio = await vinculoDe(W) === id
    out.audit = waStore.state.auditoria.filter((e) => e.action === 'whatsapp.linked').map((e) => [e.actorId === id, e.metadata.origin])
    out.consentimiento = [...waStore.state.consentimientosWhatsapp.values()].map((c) => [c.recipientId, c.source, c.status])
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.antesEstado, { verified: true, phoneMasked: '+549379•••3456', verifiedAt: r.antesEstado.verifiedAt, pendingMasked: null, whatsappLinked: false })
  assert.match(r.antes, /Tu número ya está verificado\. Solo falta vincular este WhatsApp/u)
  assert.deepEqual(r.desafio, [true, 'verificar_telefono', '+549379•••3456'])
  assert.equal(r.exito, '✅ ¡Listo! Este WhatsApp quedó vinculado a tu cuenta TUS.\n\nYa podés buscar profesionales, consultar tus turnos, verificar pagos y usar TUS directamente desde acá.')
  assert.deepEqual(r.vinculo, [true, true], 'contact.linkedAccountId is the account, with its tenant')
  assert.equal(r.despuesEstado.whatsappLinked, true)
  assert.doesNotMatch(r.masajista, /vincular|Vincular/u, 'the next message is never answered with the link request')
  assert.equal(r.pidioVincular, 0)
  assert.equal(r.reservaComo.length, 1, 'the assistant went on and requested the turno: ' + JSON.stringify([r.masajista, r.pasos]))
  assert.equal(r.reservaComo[0], r.id, 'the turno was requested AS the linked account')
  assert.match(r.trasReinicio, /ya está vinculado a tu cuenta TUS/u)
  assert.equal(r.vinculoTrasReinicio, true)
  assert.deepEqual(r.audit, [[true, 'phone_verification']])
  assert.equal(r.consentimiento.length, 1)
  assert.deepEqual(r.consentimiento[0].slice(1), ['whatsapp_inbound', 'active'])
})

test('VINCULO challenge rules: expired, used, wrong code, other sender, other user\'s challenge -> nothing linked, nothing verified, fixed answer', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const invalido = 'No pudimos verificar ese código. Volvé a TUS y generá una nueva verificación.'
    out.invalido = invalido
    // Expired (10 minutes).
    const a = await cuenta('+5493794111111')
    const dA = await tel.iniciarVinculo(a)
    waAdvance(11 * 60 * 1000)
    out.vencido = [(await enviar('5493794111111', dA.message)).text === invalido, await vinculoDe('5493794111111')]
    // Used: the same code twice (a NEW message the second time).
    const b = await cuenta('+5493794222222')
    const dB = await tel.iniciarVinculo(b)
    const ok = await enviar('5493794222222', dB.message)
    const otraVez = await enviar('5493794222222', dB.message)
    out.usado = [ok.text.startsWith('✅ ¡Listo!'), otraVez.text === invalido, await vinculoDe('5493794222222') === b]
    // Wrong code.
    const c = await cuenta('+5493794333333')
    await tel.iniciarVinculo(c)
    out.incorrecto = [(await enviar('5493794333333', 'VERIFICAR TUS ZZZZZZZZ')).text === invalido, await vinculoDe('5493794333333')]
    // Another WhatsApp sends the challenge of account c: not its number.
    const dC = await tel.iniciarVinculo(c)
    out.otroWaId = [(await enviar('5493794999999', dC.message)).text === invalido, await vinculoDe('5493794999999'), await vinculoDe('5493794333333')]
    // The challenge of one user sent from the phone of ANOTHER verified user.
    const d = await cuenta('+5493794444444')
    const dD = await tel.iniciarVinculo(d)
    out.deOtroUsuario = [(await enviar('5493794222222', dD.message)).text === invalido, await vinculoDe('5493794222222') === b, await vinculoDe('5493794444444')]
    // A challenge is only created for the account's own VERIFIED number, and only once linked.
    const sinTel = await cuenta(null)
    out.sinTelefono = await tel.iniciarVinculo(sinTel)
    out.yaVinculada = await tel.iniciarVinculo(b)
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.vencido, [true, null])
  assert.deepEqual(r.usado, [true, true, true])
  assert.deepEqual(r.incorrecto, [true, null])
  assert.deepEqual(r.otroWaId, [true, null, null])
  assert.deepEqual(r.deOtroUsuario, [true, true, null])
  assert.deepEqual(r.sinTelefono, { ok: false, code: 'PHONE_NOT_VERIFIED' })
  assert.deepEqual(r.yaVinculada, { ok: false, code: 'ALREADY_LINKED' })
})

test('VINCULO conflicts: a wa_id linked to another account is never reassigned (rolled back, audited); the same account is idempotent; a race has one winner', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    // wa_id already linked to ANOTHER account by the token flow.
    const W = '5493794555555'
    await enviar(W, 'hola')
    await linkContact(W, 'customer-user')
    const intruso = await cuenta(null)
    const registro = await tel.iniciarRegistro(intruso, '+5493794555555')
    const respuesta = await enviar(W, registro.message)
    out.ocupado = [respuesta.text, await vinculoDe(W), (await almacenTel.estado(intruso)).phoneNumber, (await almacenTel.desafio(registro.challengeId)).invalidationReason]
    out.auditado = auth.audit.events.filter((e) => e.kind === 'phone.verification_failed').map((e) => e.metadata.reason)
    // Same account again (a new challenge for an already linked contact): idempotent.
    const dueña = await cuenta('+5493794666666')
    const primero = await tel.iniciarVinculo(dueña)
    await enviar('5493794666666', primero.message)
    const versionAntes = (await contacto('5493794666666')).version
    const segundo = await tel.iniciarRegistro(dueña, '+5493794666666')
    const repetido = await enviar('5493794666666', segundo.message)
    out.idempotente = [repetido.text.startsWith('✅ ¡Listo!'), await vinculoDe('5493794666666') === dueña, (await contacto('5493794666666')).version - versionAntes <= 2, waStore.state.auditoria.filter((e) => e.action === 'whatsapp.linked' && e.actorId === dueña).length]
    // Two accounts race for one number: exactly one wins, the loser changes nothing.
    const x = await cuenta(null), y = await cuenta(null)
    const dx = await tel.iniciarRegistro(x, '+5493794777777'), dy = await tel.iniciarRegistro(y, '+5493794777777')
    const resultados = await Promise.all([
      tel.verificarDesdeWhatsapp({ waId: '5493794777777', texto: dx.message, wamid: 'wamid.race-x' }),
      tel.verificarDesdeWhatsapp({ waId: '5493794777777', texto: dy.message, wamid: 'wamid.race-y' }),
    ])
    const ganador = await vinculoDe('5493794777777')
    out.carrera = [resultados.map((resultado) => resultado.resultado).sort(), [x, y].includes(ganador), (await almacenTel.estado(x)).phoneNumber === '+5493794777777' ? 1 : 0, (await almacenTel.estado(y)).phoneNumber === '+5493794777777' ? 1 : 0]
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.ocupado[0], 'Este WhatsApp ya está vinculado a otra cuenta TUS, así que no lo vinculé. Si es tu número, desvinculalo desde esa cuenta y volvé a intentarlo.')
  assert.equal(r.ocupado[1], 'customer-user', 'not reassigned')
  assert.equal(r.ocupado[2], null, 'the phone was rolled back with the link')
  assert.equal(r.ocupado[3], 'conflicto')
  assert.deepEqual(r.auditado, ['whatsapp_linked_elsewhere'])
  assert.deepEqual(r.idempotente, [true, true, true, 1], 'one link event for the account')
  assert.deepEqual(r.carrera[0], ['invalido', 'vinculado'])
  assert.equal(r.carrera[1], true)
  assert.equal(r.carrera[2] + r.carrera[3], 1, 'one owner of the number')
})

test('VINCULO normalization: the wa_id with and without "+" is the same canonical +549 number; the mobile 9 is kept', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const canon = (v) => { const x = normalizarTelefono(v); return x.ok ? x.e164 : null }
    console.log(JSON.stringify({
      waId: telefonoDesdeWaId('5493794123456'), conMas: canon('+5493794123456'), sinMas: canon('5493794123456'), medio: canon('+54 9 379 412-3456'),
      sinNueve: telefonoDesdeWaId('543794123456'),
      verificado: await (async () => { const id = await cuenta('+5493794123456'); return [await tel.numeroVerificado('5493794123456'), await tel.numeroVerificado('5493794000000')] })(),
    }))
  `)
  assert.equal(r.waId, '+5493794123456')
  assert.equal(r.conMas, '+5493794123456')
  assert.equal(r.sinMas, '+5493794123456')
  assert.equal(r.medio, '+5493794123456')
  assert.equal(r.sinNueve, '+5493794123456', 'a wa_id without the mobile 9 still reads as the same mobile')
  assert.deepEqual(r.verificado, [true, false])
})

test('VINCULO bot wording follows the REAL state, the CTA goes to Mi perfil, and a number change drops the link of the number given up', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    // Not verified, not linked: the four steps and the CTA.
    const W = '5493794800001'
    const sinCuenta = await enviar(W, 'ya tengo cuenta')
    out.pasos = [sinCuenta.text, sinCuenta.label, sinCuenta.url, sinCuenta.type]
    // Linked: the steps are not repeated.
    const id = await cuenta('+5493794800002')
    const d = await tel.iniciarVinculo(id)
    await enviar('5493794800002', d.message)
    out.vinculado = (await enviar('5493794800002', 'por qué tengo que vincular')).text
    // Number change: the new WhatsApp becomes the linked one, the old one is unlinked.
    const nuevo = await tel.iniciar(id, { telefono: '+5493794800003' })
    out.cambio = [nuevo.ok, nuevo.purpose]
    const hecho = await enviar('5493794800003', nuevo.message)
    out.tras = [hecho.text.startsWith('✅ ¡Listo!'), await vinculoDe('5493794800003') === id, await vinculoDe('5493794800002'), (await tel.estadoCuenta(id)).phoneMasked]
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.pasos[0], 'Para continuar por WhatsApp necesitás vincular este número con una cuenta TUS.\n\n1. Registrate o iniciá sesión en TUS.\n2. Entrá a Mi perfil.\n3. Verificá tu número de celular.\n4. Tocá "Vincular este WhatsApp".\n\nDespués volvés acá y podés seguir normalmente.')
  assert.deepEqual(r.pasos.slice(1), ['Vincular mi cuenta TUS', 'https://web.tus.test/mi-perfil?accion=vincular-whatsapp', 'cta_url'])
  assert.equal(r.vinculado, 'Tu número ya está verificado y este WhatsApp ya está vinculado a tu cuenta TUS.', 'a question about linking is answered from the real state')
  assert.deepEqual(r.cambio, [true, 'cambiar_telefono'])
  assert.deepEqual(r.tras, [true, true, null, '+549379•••0003'])
})

test('VINCULO Argentine 9: the same mobile arriving as 549379... or 54379... is ONE contact, so the link is never lost on a second row', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const out = {}
    const id = await cuenta('+5493794123456')
    // The contact is first seen WITHOUT the 9 (how Meta may deliver it) ...
    await enviar('543794123456', 'hola')
    // ... and the VERIFICAR message arrives WITH the 9: it links the same contact.
    const d = await tel.iniciarVinculo(id)
    await enviar('5493794123456', d.message)
    out.exito = fakeWa.sent.at(-1).message.text.startsWith('✅ ¡Listo!')
    out.contactos = [...waStore.state.contactos.values()].filter((c) => c.waId.endsWith('3794123456')).map((c) => [c.waId, c.linkedAccountId === id])
    // Later messages in either form are the same linked person: never asked to link again.
    await enviar('543794123456', 'ya tengo cuenta')
    const sinNueve = fakeWa.sent.at(-1)
    await enviar('5493794123456', 'ya tengo cuenta')
    const conNueve = fakeWa.sent.at(-1)
    out.respuestas = [sinNueve.message.text, conNueve.message.text]
    out.destinos = [sinNueve.to, conNueve.to]
    out.contactosDespues = [...waStore.state.contactos.values()].filter((c) => c.waId.endsWith('3794123456')).length
    // Other countries and numbers that only look alike are never merged.
    const { waIdEquivalentes } = await import('./packages/contracts/src/tus-telefono.ts')
    out.equivalentes = [waIdEquivalentes('5493794123456'), waIdEquivalentes('543794123456'), waIdEquivalentes('14155552671'), waIdEquivalentes('54911')]
    console.log(JSON.stringify(out))
  `)
  assert.equal(r.exito, true)
  assert.deepEqual(r.contactos, [['543794123456', true]], 'one contact, linked')
  assert.deepEqual(r.respuestas, ['Este WhatsApp ya está vinculado a tu cuenta TUS.', 'Este WhatsApp ya está vinculado a tu cuenta TUS.'])
  assert.deepEqual(r.destinos, ['543794123456', '543794123456'], 'replies go to the stored wa_id of the single contact')
  assert.equal(r.contactosDespues, 1)
  assert.deepEqual(r.equivalentes, [['5493794123456', '543794123456'], ['543794123456', '5493794123456'], ['14155552671'], ['54911']])
})
