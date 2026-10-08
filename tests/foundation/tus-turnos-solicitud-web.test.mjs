import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// TURNOS-SOLICITUD-01, Web side and shared contract: a client REQUESTS a turno as the account of
// the session; provider acceptance opens payment and only its verified payment confirms it. The behaviour against PostgreSQL is in
// tus-turnos-solicitud-postgres.test.mjs.
const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')
// Line endings differ between checkouts: the patterns below are written for LF.
const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
const web = (path) => read(join('apps/web/src', path))

function run(source) {
  const output = execFileSync(process.execPath, [tsxCli, '--eval', `(async () => {\n${source}\n})()`], { cwd: root, encoding: 'utf8' })
  return JSON.parse(output.trim())
}

test('TURNOS solicitud contract: one list of states, pending is not confirmed, rejected and expired release the time, nothing leaves a final state', () => {
  const r = run(`
    const c = await import('./packages/contracts/src/tus-turnos.ts')
    console.log(JSON.stringify({
      estados: c.ESTADOS_TURNO,
      liberan: c.ESTADOS_TURNO_LIBERAN,
      etiquetas: c.ESTADOS_TURNO.map((estado) => c.etiquetaEstadoTurno(estado)),
      desconocido: c.etiquetaEstadoTurno('otro'),
      transiciones: c.TRANSICIONES_TURNO,
      vigencia: c.HORAS_VIGENCIA_SOLICITUD_TURNO,
      mensajes: ['LOGIN_REQUIRED', 'REQUEST_NOT_PENDING', 'REQUEST_EXPIRED', 'REQUEST_SLOT_UNAVAILABLE', 'TOO_MANY_PENDING_REQUESTS', 'INVALID_TRANSITION', 'SLOT_OCCUPIED'].map((code) => c.mensajeErrorTurno(code, 'GENERICO')),
    }))
  `)
  assert.deepEqual(r.estados, ['pending', 'awaiting_payment', 'confirmed', 'rejected', 'expired', 'cancelled', 'cancelled-late', 'no-show', 'completed'])
  assert.deepEqual(r.liberan, ['cancelled', 'cancelled-late', 'no-show', 'rejected', 'expired'])
  assert.deepEqual(r.etiquetas.slice(0, 6), ['Pendiente de respuesta', 'Esperando pago de seña', 'Turno confirmado', 'Rechazada', 'Vencida', 'Cancelada'])
  assert.equal(r.desconocido, 'otro')
  // pending -> confirmed only exists for a turno with nothing to pay (no price, or online payments
  // off for the whole platform); with a deposit the acceptance goes to awaiting_payment.
  assert.deepEqual(r.transiciones.pending, ['awaiting_payment', 'confirmed', 'rejected', 'cancelled', 'expired'])
  assert.deepEqual(r.transiciones.awaiting_payment, ['confirmed', 'cancelled', 'expired'])
  assert.deepEqual(r.transiciones.confirmed, ['completed', 'cancelled', 'cancelled-late', 'no-show'])
  for (const final of ['rejected', 'expired', 'cancelled', 'cancelled-late', 'no-show', 'completed']) assert.deepEqual(r.transiciones[final], [], `${final} is final`)
  assert.equal(r.vigencia, 24)
  assert.ok(r.mensajes.every((mensaje) => mensaje !== 'GENERICO'), 'every code of the flow has its own message')
  // The predicate of the overlap rule in the migration is the same list as the contract.
  const migracion = read('apps/api/prisma/migrations/20261026100000_tus_turnos_solicitud_reserva/migration.sql')
  assert.match(migracion, /WHERE \("estado" NOT IN \('cancelled', 'cancelled-late', 'no-show', 'rejected', 'expired'\)\)/u)
  assert.match(migracion, /"estado" IN \('pending', 'confirmed', 'rejected', 'expired', 'cancelled', 'cancelled-late', 'no-show', 'completed'\)/u)
  assert.match(read('apps/api/prisma/migrations/20261027100000_tus_turnos_sena/migration.sql'), /'pending', 'awaiting_payment', 'confirmed'/u)
  assert.doesNotMatch(migracion, /\bDROP (TABLE|COLUMN)\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b/iu, 'forward-only: nothing is deleted or rewritten')
})

test('TURNOS solicitud Web: the form requests (never confirms), shows the data of the session account instead of asking for it, sends no identity, and a visitor is sent to sign in and back to the same time', () => {
  const form = web('features/directory/turno-booking.tsx')
  // 14. Nothing of the person is typed again: no name, phone or email fields.
  assert.doesNotMatch(form, /type="tel"|type="email"|id="turno-nombre"|Tu nombre y apellido|clienteNombre|clienteTelefono|clienteEmail/u, 'no contact fields and no contact state')
  assert.match(form, /Solicitás el turno como/u)
  assert.match(form, /turnosApi\s*\.solicitante\(\)/u, 'the data shown comes from the API (the account of the session)')
  assert.match(form, /solicitante\.nombre[\s\S]{0,200}solicitante\.telefono[\s\S]{0,200}solicitante\.email/u)
  // What is sent: the service, the time, the tarifa and the optional note. Nothing about who asks.
  const envio = /turnosApi\.solicitarTurno\(worker\.id, \{([\s\S]*?)\}\)\n/u.exec(form)?.[1] ?? ''
  assert.match(envio, /oficioId: selectedOficio/u)
  assert.match(envio, /inicio: selectedSlot\.inicio/u)
  assert.doesNotMatch(envio, /cliente|userId|accountId|nombre|telefono|email|estado/iu, 'the browser sends no identity and no state')
  // The wording: a request waiting for the provider.
  assert.match(form, /'Solicitar reserva'/u)
  assert.match(form, /La solicitud queda pendiente hasta que el prestador acepte\./u)
  assert.match(form, /Solicitud enviada/u)
  assert.match(form, /después deberás pagar la seña para confirmar el turno/u)
  assert.match(form, /etiquetaEstadoTurno\(solicitado\.estado\)\} del prestador/u, '"Pendiente de respuesta del prestador"')
  assert.doesNotMatch(form, /Confirmar reserva|Turno Confirmado|quedó agendado|Confirmando\.\.\.|#22c55e|#15803d/u, 'nothing looks or reads like a confirmed turno')
  assert.match(form, /Notas para el profesional \(opcional\)/u, 'the note stays, optional')
  // 13. A visitor: sign in and come back to the same service and time.
  assert.match(form, /'Iniciar sesión para solicitar'/u)
  assert.match(form, /\/sign-in\?returnTo=\$\{encodeURIComponent\(`\$\{retorno\}\?\$\{params\.toString\(\)\}`\)\}/u)
  assert.match(form, /CODIGO_SESION_REQUERIDA \|\| err\.status === 401/u, 'a session that ended meanwhile goes through the same path')
  // The time carried back is only chosen again if the API still offers it.
  assert.match(form, /item\.inicio === pendienteDeElegir && item\.estado === 'disponible'/u)
  const perfil = web('features/directory/worker-profile.tsx')
  assert.match(perfil, /autenticado=\{session\.status === 'authenticated' \? true : session\.status === 'loading' \? null : false\}/u)
  assert.match(perfil, /Date\.parse\(inicio\) > Date\.now\(\)/u, 'a time from the URL is validated before any use')
  assert.match(perfil, /Solicitar turno\n/u)
  assert.doesNotMatch(perfil, /Reservar turno|authenticatedName/u)

  const cliente = web('lib/tus-turnos-client.ts')
  assert.match(cliente, /`\/tus\/v1\/prestadores\/\$\{encodeURIComponent\(prestadorId\)\}\/turnos\/solicitudes`, \{ method: 'POST'/u)
  assert.match(cliente, /solicitante: \(\) => json<SolicitanteTurnoDTO>\('\/tus\/v1\/cliente\/turnos\/solicitante'\)/u)
})

test('TURNOS solicitud Web: the client follows the real state in "Mis turnos"; the provider has "Solicitudes de reserva" with Aceptar / Rechazar; states are shown with their label, never raw', () => {
  assert.ok(existsSync(join(root, 'apps/web/src/app/mis-turnos/page.tsx')), 'the /mis-turnos route exists')
  const mios = web('features/turnos/mis-turnos-page.tsx')
  assert.match(mios, /turnosApi\s*\.misTurnos\(\)/u)
  assert.match(mios, /etiquetaEstadoTurno\(turno\.estado\)/u)
  assert.match(mios, /\{servicio\} — \{diaTurno\(turno\.inicio\)\} — \{horaTurno\(turno\.inicio\)\}/u, '"Masaje — viernes 2 de octubre — 09:45"')
  assert.match(mios, /Para confirmar definitivamente el turno tenés que abonar la seña/u)
  // PAGOS-MODALIDAD-01: one checkout for the deposit, the total or the balance; only the part travels.
  assert.match(mios, /turnosApi\.pagarTurno\(turno\.id, tramo\)/u)
  assert.match(mios, /turnosApi\.cancelarMiTurno\(turno\.id\)/u)
  assert.match(mios, /sign-in\?returnTo=\$\{encodeURIComponent\(RETURN_TO\)\}/u, 'a visitor is sent to sign in')

  const panel = web('features/provider/provider-turnos.tsx')
  assert.match(panel, /Solicitudes de reserva/u)
  assert.match(panel, /Nueva solicitud/u)
  for (const dato of ['Cliente:', 'Servicio:', 'Fecha:', 'Horario:', 'Duración:']) assert.ok(panel.includes(`<dt>${dato}</dt>`), `the request shows ${dato}`)
  assert.match(panel, /turnosApi\.aceptarSolicitud\(solicitud\.id\) : await turnosApi\.rechazarSolicitud\(solicitud\.id\)/u)
  assert.match(panel, />\s*Rechazar\s*<[\s\S]{0,400}'Aceptar'/u, 'Rechazar and Aceptar, in that order')
  assert.match(panel, /etiquetaEstadoTurno\(t\.estado\)/u)
  assert.match(panel, /<option value="awaiting_payment">Esperando pago de seña<\/option>/u)
  assert.match(panel, /t\.estado === 'confirmed' \|\| t\.estado === 'awaiting_payment'/u, 'the provider can cancel an accepted turno that is still waiting for payment')
  assert.doesNotMatch(panel, /\{t\.estado\}\n/u, 'no raw state code on screen')
  // The provider no longer "confirms" through the generic state change.
  assert.doesNotMatch(panel, /cambiarEstado\(t\.id, 'confirmed'\)/u)

  const api = web('lib/tus-turnos-client.ts')
  assert.match(api, /\/tus\/v1\/prestador\/turnos\/solicitudes/u)
  assert.match(api, /\/aceptar`, \{ method: 'POST' \}/u)
  assert.match(api, /\/rechazar`, \{ method: 'POST' \}/u)
  const estilo = web('features/turnos/estado-turno.ts')
  assert.match(estilo, /estado === 'pending' \|\| estado === 'awaiting_payment' \? styles\.turnoStatePending/u, 'pending and awaiting payment are visually distinct from confirmed')

  // The assistant chips ask to request, and its button says what it does.
  const chat = web('features/assistant/assistant-conversation.tsx')
  assert.match(chat, /Quiero solicitar el turno con \$\{provider\.name\}/u)
  assert.doesNotMatch(chat, /Quiero reservar/u)
  assert.match(read('apps/api/src/tus/asistente/solicitud-turno.ts'), /BOTONES_SOLICITUD = \{ si: 'Sí, solicitar turno', no: 'No' \}/u, 'the button of the card requests, it never confirms')
})

test('TURNOS solicitud API surface: requesting needs a session and reads no identity from the body; the provider answers only through aceptar / rechazar; notices reuse the account email transport', () => {
  const http = read('apps/api/src/tus/calendar/turnos-http.ts')
  const solicitar = /const solicitar = asyncHandler\(([\s\S]*?)\n  \}\)\n/u.exec(http)?.[1] ?? ''
  assert.match(solicitar, /if \(!context\) return void enviarError\(response, 401, CODIGO_SESION_REQUERIDA/u)
  assert.match(solicitar, /clienteId: context\.subjectId,\n\s+clienteTenantId: context\.tenantId,/u, 'the client is the session')
  assert.doesNotMatch(solicitar, /body\['(clienteId|userId|clienteNombre|nombre|clienteTelefono|telefono|clienteEmail|email|estado)'\]/u, 'identity and state fields of the body are never read')
  assert.match(http, /router\.post\('\/tus\/v1\/prestadores\/:id\/turnos\/solicitudes', solicitar\)\n  router\.post\('\/tus\/v1\/public\/prestadores\/:id\/turnos\/reservar', solicitar\)/u)
  assert.match(http, /if \(!\['cancelled', 'completed', 'no-show'\]\.includes\(entrada\.valor\.estado\)\)/u, 'the generic state change of the provider cannot confirm')
  const servicio = read('apps/api/src/tus/calendar/turnos-service.ts')
  assert.match(servicio, /estado: solicitud \? 'pending' : 'confirmed'/u)
  assert.match(servicio, /clienteNombre: solicitud \? null :/u, 'a request stores no copy of the person')
  assert.match(servicio, /await this\.conAgendaBloqueada\(calendario, async \(tx\) => \{\n\s+const ahora = new Date\(\)\n\s+\/\/ Read again with the agenda locked/u, 'the answer is decided with the agenda locked')
  const avisos = read('apps/api/src/tus/calendar/turnos-notificaciones.ts')
  assert.match(avisos, /from '\.\.\/\.\.\/auth-security\/adapters\/email\/email-senders\.ts'/u, 'the existing email transport, not a parallel one')
  assert.match(read('apps/api/src/server.ts'), /new ServicioTurnos\(prisma as unknown as PrismaClient, NotificadorTurnosEmail\.desdeEnv\(/u)
})

test('TURNOS solicitud and the marketplace booking of published services share the agenda: a time held by a pending request is neither offered nor taken there; a rejected or expired one is offered again', () => {
  const r = run(`
    const { InMemoryMarketplaceStore, TusMarketplaceService } = await import('./apps/api/src/tus/catalog/index.ts')
    const { InMemoryServiceCalendarStore, ServiceCalendarService } = await import('./apps/api/src/tus/calendar/bookings.ts')
    const store = new InMemoryServiceCalendarStore()
    const AHORA = '2026-09-14T11:00:00.000Z'
    const calendar = new ServiceCalendarService(store, () => Date.parse(AHORA))
    const marketplace = new TusMarketplaceService(new InMemoryMarketplaceStore(), { calendarResolver: calendar })
    const merchant = { subjectId: 'merchant-user', sessionId: 'merchant-session', tenantId: 'merchant-tenant', roles: ['merchant'], permissions: ['tus:marketplace:write', 'tus:marketplace:read'], correlationId: 'corr-merchant' }
    const customer = { subjectId: 'customer-user', sessionId: 'customer-session', tenantId: 'customer-tenant', roles: ['customer'], permissions: ['tus:marketplace:read'], correlationId: 'corr-customer' }
    await marketplace.onboard(merchant, { merchantId: 'provider-1', cohort: 'repairs-trades', locationId: 'location-1', timezone: 'America/Argentina/Buenos_Aires', staffRoles: ['owner'], operatingPolicyVersion: 'policy-1' })
    const listing = await marketplace.createListing(merchant, { merchantId: 'provider-1', kind: 'service', name: 'Repair', description: 'A scheduled repair', cohort: 'repairs-trades', locationId: 'location-1', currency: 'ARS', price: 1000, durationMinutes: 45, capacity: 1, workingHours: [{ day: 1, start: '09:00', end: '12:00' }] })
    const published = await marketplace.publishListing(merchant, listing.listingId)
    await calendar.createCalendar({ ...merchant, permissions: ['tus:marketplace:write', 'tus:calendar:write', 'tus:marketplace:read'] }, { calendarId: 'calendar-primary', prestadorId: 'provider-1', timezone: 'America/Argentina/Buenos_Aires', capacity: 1, granularityMinutes: 15, bufferMinutes: 15, workingHours: [{ weekday: 1, start: '09:00', end: '12:00' }] })
    const ofrecidos = async () => (await calendar.slotsForPublication(customer, published, 'calendar-primary', '2026-09-14', AHORA)).map((slot) => slot.slotId)
    const antes = await ofrecidos()
    const reserva = await calendar.bookPublication(customer, published, { calendarId: 'calendar-primary', customerId: customer.subjectId, slotId: antes[0], idempotencyKey: 'k-1', requestHash: 'h-1', now: AHORA })
    const out = {}
    for (const status of ['confirmed', 'pending', 'rejected', 'expired', 'cancelled']) {
      // The same row as a turno request would leave it in the shared agenda.
      await store.bookings.save({ ...reserva, status })
      const lista = await ofrecidos()
      const intento = await calendar.bookPublication({ ...customer, subjectId: 'otro-' + status }, published, { calendarId: 'calendar-primary', customerId: 'otro-' + status, slotId: antes[0], idempotencyKey: 'k-' + status, requestHash: 'h-' + status, now: AHORA })
      const tomado = !('status' in intento && intento.status === 'rejected')
      out[status] = [lista.includes(antes[0]), tomado ? 'booked' : 'rejected']
      if (tomado) await store.bookings.save({ ...intento, status: 'cancelled' })
    }
    console.log(JSON.stringify(out))
  `)
  assert.deepEqual(r.confirmed, [false, 'rejected'])
  assert.deepEqual(r.pending, [false, 'rejected'], 'a pending request holds its time for the marketplace booking too')
  assert.deepEqual(r.rejected, [true, 'booked'])
  assert.deepEqual(r.expired, [true, 'booked'])
  assert.deepEqual(r.cancelled, [true, 'booked'])
})

test('RESERVA de una publicación, Web: the screens of /tus/mercado and /tus/calendario request a reservation, they do not confirm it', () => {
  const pantalla = web('components/calendario/calendario-cliente.tsx')
  assert.ok(pantalla.includes('        Solicitar reserva\n'), 'the button requests')
  assert.ok(pantalla.includes('Queda pendiente hasta que el prestador la acepte; después deberás pagar para confirmar.'))
  for (const viejo of ['Confirmar reserva', 'Reserva confirmada', 'Confirmando la reserva', 'onReservaConfirmada', "status: 'confirmed'"]) assert.ok(!pantalla.includes(viejo), 'still there: ' + viejo)
  const mercado = web('components/mercado/mercado-servicios.tsx')
  assert.ok(!mercado.includes('onReservaConfirmada') && !mercado.includes('la reserva se confirman'))
  assert.ok(web('lib/tus-client.ts').includes("status: 'pending' | 'awaiting_payment' | 'confirmed' | 'rejected' | 'expired' | 'cancelled' | 'cancelled-late' | 'no-show' | 'completed'"))
  // No "Reservar turno" where the person actually requests one.
  for (const archivo of ['features/directory/worker-card.tsx', 'features/home/provider-map.tsx', 'features/directory/worker-profile.tsx']) assert.ok(!web(archivo).includes('Reservar turno'), archivo)
})

// TURNOS-SENA-01 on the Web: the price and the deposit shown are the ones the API computed, the
// turno is called confirmed only once it is, the return from Mercado Pago confirms nothing, and
// the assistant sends a visitor to sign in or register with the way back to its turno.
test('TURNOS seña Web: price and deposit come from the API, awaiting_payment is never shown as confirmed, the checkout return only re-reads, and the assistant keeps the way back to the turno', () => {
  const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n')
  const form = read('apps/web/src/features/directory/turno-booking.tsx')
  const mios = read('apps/web/src/features/turnos/mis-turnos-page.tsx')
  const panel = read('apps/web/src/features/provider/provider-turnos.tsx')
  const asistente = read('apps/web/src/features/assistant/assistant-conversation.tsx')
  const cliente = read('apps/web/src/lib/tus-turnos-client.ts')

  // SERVICIO-A-PRESUPUESTAR-01: the form does not decide it; the agenda says the service is priced
  // by a budget, the request button is disabled and the person is sent to "Solicitar servicio".
  assert.match(form, /setRequierePresupuesto\(agenda\.requierePresupuesto === true\)/u)
  assert.match(form, /data-servicio-a-presupuestar/u)
  assert.match(form, /se presupuesta[\s\S]{0,160}Solicitar servicio/u)
  assert.match(form, /disabled=\{[^}]*\|\| requierePresupuesto\}/u)
  assert.match(cliente + read('packages/contracts/src/tus-turnos.ts'), /SERVICE_REQUIRES_BUDGET/u)

  // The form shows the price and the deposit of the selection as the agenda returned them.
  assert.match(form, /setCobro\(\{ precio: agenda\.precio \?\? null, sena: agenda\.sena \?\? null \}\)/u)
  assert.match(form, /Precio: <strong>\{formatearPesos\(cobro\.precio\)\}<\/strong>/u)
  assert.match(form, /Seña: <strong>\{formatearPesos\(cobro\.sena\)\}<\/strong> \(se abona cuando el prestador acepte\)/u)
  // No deposit, no price and no percentage is ever computed or sent by the Web.
  for (const [nombre, fuente] of [['form', form], ['mis turnos', mios], ['panel', panel], ['client', cliente]]) {
    assert.doesNotMatch(fuente, /\*\s*0?\.5\b|\/\s*2\b|50\s*%/u, nombre + ': the Web never computes a deposit')
  }
  assert.doesNotMatch(cliente, /pagarSena:[^\n]*body:/u, 'the checkout request carries no body: turno by path, client by session, amount by the API')
  assert.match(cliente, /solicitarTurno: \(prestadorId: string, input: \{ oficioId: string; inicio: string; tarifaId\?: string; notas\?: string \}\)/u, 'a request sends only the service, the time, the variant and a note')

  // "Mis turnos": every state says what it is; "confirmed" only for a confirmed turno.
  assert.match(mios, /awaiting_payment: 'El prestador aceptó tu solicitud\. Para confirmar definitivamente el turno tenés que abonar la seña\.'/u)
  assert.match(mios, /if \(turno\.estado === 'confirmed'\) return pagada \? 'El pago de la seña fue aprobado\. ¡Tu turno quedó confirmado!' : 'El prestador aceptó tu solicitud: el turno está confirmado\.'/u)
  // PAGOS-MODALIDAD-01: a third one, for a turno confirmed by its total payment.
  assert.match(mios, /if \(turno\.estado === 'confirmed' && pago\?\.modalidad === 'total'\) return 'El pago total fue aprobado\. ¡Tu turno quedó confirmado!'/u)
  assert.equal((mios.match(/quedó confirmado|está confirmado/gu) ?? []).length, 3, 'no other text of the page says confirmed')
  assert.match(mios, /turno\.estado === 'awaiting_payment' && turno\.sena\?\.estado === 'pending' \?/u, 'the pay button exists only while the deposit is due')
  assert.match(mios, /Pagar seña — \$\{formatearPesos\(turno\.sena\.monto\)\}/u)
  assert.match(mios, /Seña: <strong>\{formatearPesos\(turno\.sena\.monto\)\}<\/strong> \(\{etiquetaSenaTurno\(turno\.sena\.estado\)\}\)/u, 'amount and payment state of the deposit')
  // Back from Mercado Pago: only a notice and a re-read. Nothing is confirmed from the URL.
  assert.match(mios, /get\('pago'\) !== 'retorno'\) return\n\s+setRetornoPago\(true\)\n\s+window\.history\.replaceState\(null, '', RETURN_TO\)\n\s+const esperas = \[3000, 8000, 15000\]\.map\(\(ms\) => window\.setTimeout\(cargar, ms\)\)/u)
  assert.match(mios, /el turno se confirma cuando Mercado Pago lo acredita/u)
  assert.doesNotMatch(mios, /collection_status|payment_id|status=approved|searchParams\.get\('status'\)/u, 'no query parameter of the checkout is trusted')

  // Provider: accepting is not confirming, and the request shows price and deposit.
  assert.match(panel, /Queda esperando que el cliente abone la seña; se confirma cuando Mercado Pago acredite el pago\./u)
  assert.match(panel, /seña \$\{formatearPesos\(solicitud\.sena\.monto\)\} \(la abona el cliente cuando aceptes\)/u)

  // Assistant: sign in / register come back to the turno the API named (an internal path only).
  assert.match(asistente, /withReturnTo\('\/sign-in', \(value\.kind === 'sign_in' && value\.returnTo\) \|\| pathname\)/u)
  assert.match(asistente, /withReturnTo\('\/registro', \(value\.kind === 'sign_in' && value\.returnTo\) \|\| pathname\)/u)
  assert.match(read('apps/web/src/features/auth/auth-validation.ts'), /const safe = safeInternalPath\(returnTo\)/u)
})
