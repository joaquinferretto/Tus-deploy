// TURNOS-WHATSAPP-01 fixture: the REAL WhatsApp assistant (ingest, worker, orchestrator, notifier)
// over the in-memory assistant store, next to the real turnos service of `turnosPagosSetup`.
// Meta is the only stand-in (FakeWhatsappProvider: what would be sent is recorded).
export const ASISTENTE_TURNOS = `
  const { crearModuloWhatsapp } = await import('./apps/api/src/tus/asistente/composicion.ts')
  const { AlmacenAsistenteEnMemoria, TransaccionAsistenteEnMemoria } = await import('./apps/api/src/tus/asistente/memoria.ts')
  const { FakeWhatsappProvider, parsearWebhookMeta, cuerpoMensajeMeta } = await import('./apps/api/src/tus/asistente/meta.ts')
  const { DominioAsistenteTus } = await import('./apps/api/src/tus/asistente/dominio.ts')
  const { NotificadorTurnosWhatsapp, idRespuestaTurno } = await import('./apps/api/src/tus/asistente/avisos-turnos.ts')
  const { WhatsappTemplateService } = await import('./apps/api/src/tus/asistente/plantillas.ts')
  const { pagosTrabajo } = await import('./apps/api/src/tus/composition/index.ts')
  work.conPagos(pagosTrabajo(fin))
  const PHONE = '1234567890'
  const waStore = new AlmacenAsistenteEnMemoria()
  const waTx = new TransaccionAsistenteEnMemoria(waStore)
  const fakeWa = new FakeWhatsappProvider()
  const cuentas = new Map()
  const resolver = { contexto: async (accountId, tenantId, correlationId) => { const cuenta = cuentas.get(accountId); return cuenta && cuenta.tenantId === tenantId ? { subjectId: cuenta.id, sessionId: 'wa:' + cuenta.id, tenantId, correlationId, roles: ['owner'], permissions: ['tus:checkout', 'tus:read', 'tus:marketplace:read'] } : null } }
  const compartidos = { directorio: null, solicitudes: null, turnos }
  // The closing of a turno is the same service the Web uses (CIERRE-TRABAJO-01).
  const dominio = new DominioAsistenteTus({ work, serviceFinance: fin, workClosing: cierre }, () => Date.now(), compartidos)
  // Who is a provider: the real rule reads the marketplace store (an approved merchant of that
  // tenant); this scenario has no marketplace, so it reads the same fact from its table.
  dominio.esPrestador = async (context) => (await prisma.prestador.count({ where: { tenantId: context.tenantId, estado: 'approved' } })) > 0
  const envWa = { WHATSAPP_ENABLED: 'true', WHATSAPP_GRAPH_API_VERSION: 'v25.0', WHATSAPP_ACCESS_TOKEN: 'fictitious-access', WHATSAPP_PHONE_NUMBER_ID: PHONE, WHATSAPP_APP_SECRET: 'fictitious-app-secret-for-tests', WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'fictitious-verify-token-0001', TUS_WEB_BASE_URL: 'https://web.tus.test', WHATSAPP_DEBOUNCE_MS: '0' }
  let reloj = Date.now()
  const modulo = crearModuloWhatsapp({ env: envWa, transaction: waTx, accounts: resolver, domain: dominio, knowledgeIndex: null, whatsapp: fakeWa, chat: null, embeddings: null, transcriptor: null, now: () => reloj })
  // The notices of the turnos leave through the real WhatsApp notifier of the module.
  turnos.agregarNotificador(modulo.avisosTurnos)
  // As the server wires it: the client is told when its turno was finished and when its balance can be paid.
  cierre.conAvisos({
    finalizado: async (trabajo) => { if (trabajo.origin === 'turno' && trabajo.reservaId) await turnos.avisarCierreDe({ prestadorTenantId: trabajo.prestadorTenantId, reservaId: trabajo.reservaId, kind: 'turno_finalizado' }) },
    confirmado: async (trabajo, pagos) => { if (trabajo.origin === 'turno' && trabajo.reservaId && pagos?.pending === 'not_fully_paid') await turnos.avisarCierreDe({ prestadorTenantId: trabajo.prestadorTenantId, reservaId: trabajo.reservaId, kind: 'saldo_habilitado' }) },
  })
  const botonCierre = (accion, reservaId) => ({ type: 'interactive', body: { interactive: { type: 'button_reply', button_reply: { id: 'cierre:' + accion + ':' + reservaId, title: accion === 'confirmar' ? 'Confirmar' : 'Reportar problema' } } } })
  const cola = modulo.crearWorker({ owner: 'pg-turnos-wa' })
  let seq = 0
  const entrante = (waId, text, extra, wamid) => { seq += 1; const message = { from: waId, id: wamid ?? 'wamid.tw-' + run + '-' + seq, timestamp: String(Math.floor(reloj / 1000)), type: extra ? extra.type : 'text', ...(extra ? extra.body : { text: { body: text } }) }; return { object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '5490000000000', phone_number_id: PHONE }, contacts: [{ wa_id: waId, profile: { name: 'Persona' } }], messages: [message] } }] }] } }
  async function decir(waId, text, extra, wamid) {
    const antes = fakeWa.sent.length
    await modulo.ingreso.procesar(parsearWebhookMeta(entrante(waId, text, extra, wamid), PHONE), 'corr-tw')
    for (let i = 0; i < 5; i += 1) if ((await cola.procesarSiguiente()).outcome === 'idle') break
    reloj += 40000
    return fakeWa.sent.slice(antes).filter((x) => x.to === waId).map((x) => x.message.text ?? x.message.type)
  }
  let contactos = 0
  async function vincular(cuenta) {
    contactos += 1
    const id = '5491155900' + String(Date.now()).slice(-5) + String(contactos)
    await decir(id, 'hola')
    const contacto = await waStore.repositorios().contactos.buscarPorWaId(id)
    cuentas.set(cuenta.id, cuenta)
    await waTx.ejecutar((repos) => repos.contactos.actualizar({ ...contacto, linkedAccountId: cuenta.id, linkedTenantId: cuenta.tenantId, linkedAt: new Date().toISOString(), version: contacto.version + 1 }, contacto.version))
    return id
  }
  // The account of a provider: a real account moved to the tenant of its provider profile.
  async function cuentaDe(p, tag) {
    const cuenta = await cliente(tag)
    await prisma.account.update({ where: { id: cuenta.id }, data: { tenantId: p.tenantId } })
    // ...and linked to that provider by id (prestadores.cuenta_id): the one notices go to.
    await prisma.prestador.updateMany({ where: { tenantId: p.tenantId }, data: { cuentaId: cuenta.id } })
    return { ...cuenta, tenantId: p.tenantId }
  }
  const boton = (decision, reservaId) => ({ type: 'interactive', body: { interactive: { type: 'button_reply', button_reply: { id: idRespuestaTurno(decision, reservaId), title: decision === 'aceptar' ? 'Aceptar' : 'Rechazar' } } } })
  const enviadosA = (waId, desde = 0) => fakeWa.sent.slice(desde).filter((x) => x.to === waId).map((x) => x.message)
  const avisar = async () => { for (let i = 0; i < 6; i += 1) await turnos.procesarNotificacionesPendientes() }
  const fila = (id) => prisma.reserva.findUnique({ where: { id } })
  const auditoria = (id) => prisma.auditEvent.findMany({ where: { eventType: 'turnos.solicitud_respondida', metadata: { path: ['reservaId'], equals: id } }, orderBy: { occurredAt: 'asc' } })
  const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32BE(value >>> 0); return b }
  const trozo = (type, data) => Buffer.concat([u32(data.length), Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
  const png = (ancho, alto, extra = []) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), trozo('IHDR', Buffer.concat([u32(ancho), u32(alto), Buffer.from([8, 2, 0, 0, 0])])), ...extra.map(([t, d]) => trozo(t, Buffer.from(d, 'utf8'))), trozo('IDAT', Buffer.alloc(600, 7)), trozo('IEND', Buffer.alloc(0))])
  let fotos = 0
  const foto = (bytes) => { fotos += 1; const id = '77700' + String(Date.now()).slice(-6) + fotos; fakeWa.media.set(id, { mimeType: 'image/png', bytes }); return { type: 'image', body: { image: { id, mime_type: 'image/png', sha256: 'hash-' + id } } } }
  const pagoDe = async (reservaId) => {
    const trabajo = await prisma.trabajo.findFirst({ where: { origen: 'turno', reservaId } })
    const obligacion = trabajo ? await prisma.obligacionPagoServicio.findFirst({ where: { trabajoId: trabajo.trabajoId, tramo: 'sena' } }) : null
    const pago = obligacion ? await prisma.intencionPago.findFirst({ where: { obligacionId: obligacion.obligacionId } }) : null
    return { obligacion, pago, preferencia: pago ? mp.preferences.find((item) => item.body.external_reference === pago.pagoId) : null }
  }
`
