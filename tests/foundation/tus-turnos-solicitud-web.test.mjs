import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// TURNOS-SOLICITUD-01, Web side and shared contract: a client REQUESTS a turno as the account of
// the session; only the provider confirms it. The behaviour against PostgreSQL is in
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
  assert.deepEqual(r.estados, ['pending', 'confirmed', 'rejected', 'expired', 'cancelled', 'cancelled-late', 'no-show', 'completed'])
  assert.deepEqual(r.liberan, ['cancelled', 'cancelled-late', 'no-show', 'rejected', 'expired'])
  assert.deepEqual(r.etiquetas.slice(0, 5), ['Pendiente de confirmación', 'Confirmada', 'Rechazada', 'Vencida sin respuesta', 'Cancelada'])
  assert.equal(r.desconocido, 'otro')
  assert.deepEqual(r.transiciones.pending, ['confirmed', 'rejected', 'cancelled', 'expired'])
  assert.deepEqual(r.transiciones.confirmed, ['completed', 'cancelled', 'cancelled-late', 'no-show'])
  for (const final of ['rejected', 'expired', 'cancelled', 'cancelled-late', 'no-show', 'completed']) assert.deepEqual(r.transiciones[final], [], `${final} is final`)
  assert.equal(r.vigencia, 24)
  assert.ok(r.mensajes.every((mensaje) => mensaje !== 'GENERICO'), 'every code of the flow has its own message')
  // The predicate of the overlap rule in the migration is the same list as the contract.
  const migracion = read('apps/api/prisma/migrations/20261026100000_tus_turnos_solicitud_reserva/migration.sql')
  assert.match(migracion, /WHERE \("estado" NOT IN \('cancelled', 'cancelled-late', 'no-show', 'rejected', 'expired'\)\)/u)
  assert.match(migracion, /"estado" IN \('pending', 'confirmed', 'rejected', 'expired', 'cancelled', 'cancelled-late', 'no-show', 'completed'\)/u)
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
  assert.match(form, /El turno queda pendiente hasta que el prestador confirme\./u)
  assert.match(form, /Solicitud enviada/u)
  assert.match(form, /El turno quedará confirmado cuando la acepte\./u)
  assert.match(form, /etiquetaEstadoTurno\(solicitado\.estado\)\} del prestador/u, '"Pendiente de confirmación del prestador"')
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
  assert.match(mios, /El turno quedará confirmado cuando la acepte\./u)
  assert.match(mios, /turnosApi\.cancelarMiTurno\(turno\.id\)/u)
  assert.match(mios, /sign-in\?returnTo=\$\{encodeURIComponent\(RETURN_TO\)\}/u, 'a visitor is sent to sign in')

  const panel = web('features/provider/provider-turnos.tsx')
  assert.match(panel, /Solicitudes de reserva/u)
  assert.match(panel, /Nueva solicitud/u)
  for (const dato of ['Cliente:', 'Servicio:', 'Fecha:', 'Horario:', 'Duración:']) assert.ok(panel.includes(`<dt>${dato}</dt>`), `the request shows ${dato}`)
  assert.match(panel, /turnosApi\.aceptarSolicitud\(solicitud\.id\) : await turnosApi\.rechazarSolicitud\(solicitud\.id\)/u)
  assert.match(panel, />\s*Rechazar\s*<[\s\S]{0,400}'Aceptar'/u, 'Rechazar and Aceptar, in that order')
  assert.match(panel, /etiquetaEstadoTurno\(t\.estado\)/u)
  assert.doesNotMatch(panel, /\{t\.estado\}\n/u, 'no raw state code on screen')
  // The provider no longer "confirms" through the generic state change.
  assert.doesNotMatch(panel, /cambiarEstado\(t\.id, 'confirmed'\)/u)

  const api = web('lib/tus-turnos-client.ts')
  assert.match(api, /\/tus\/v1\/prestador\/turnos\/solicitudes/u)
  assert.match(api, /\/aceptar`, \{ method: 'POST' \}/u)
  assert.match(api, /\/rechazar`, \{ method: 'POST' \}/u)
  const estilo = web('features/turnos/estado-turno.ts')
  assert.match(estilo, /estado === 'pending' \? styles\.turnoStatePending/u, 'pending has its own look, not the one of a confirmed turno')

  // The assistant chips ask to request, and its button says what it does.
  const chat = web('features/assistant/assistant-conversation.tsx')
  assert.match(chat, /Quiero solicitar el turno con \$\{provider\.name\}/u)
  assert.doesNotMatch(chat, /Quiero reservar/u)
  assert.match(read('apps/api/src/tus/asistente/orquestador.ts'), /tool === 'book_appointment' \? 'Solicitar turno' : 'Confirmar'/u)
})

test('TURNOS solicitud API surface: requesting needs a session and reads no identity from the body; the provider answers only through aceptar / rechazar; notices reuse the account email transport', () => {
  const http = read('apps/api/src/tus/calendar/turnos-http.ts')
  const solicitar = /const solicitar = asyncHandler\(([\s\S]*?)\n  \}\)\n/u.exec(http)?.[1] ?? ''
  assert.match(solicitar, /if \(!context\) return void enviarError\(response, 401, CODIGO_SESION_REQUERIDA/u)
  assert.match(solicitar, /clienteId: context\.subjectId,\n\s+clienteTenantId: context\.tenantId,/u, 'the client is the session')
  assert.doesNotMatch(solicitar, /body\['(clienteId|userId|clienteNombre|nombre|clienteTelefono|telefono|clienteEmail|email|estado)'\]/u, 'identity and state fields of the body are never read')
  assert.match(http, /router\.post\('\/tus\/v1\/prestadores\/:id\/turnos\/solicitudes', solicitar\)\n  router\.post\('\/tus\/v1\/public\/prestadores\/:id\/turnos\/reservar', solicitar\)/u)
  assert.match(http, /if \(!\['cancelled', 'completed', 'no-show'\]\.includes\(nuevoEstado\)\)/u, 'the generic state change of the provider cannot confirm')
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
  assert.ok(pantalla.includes('Queda pendiente hasta que el prestador la confirme.'))
  for (const viejo of ['Confirmar reserva', 'Reserva confirmada', 'Confirmando la reserva', 'onReservaConfirmada', "status: 'confirmed'"]) assert.ok(!pantalla.includes(viejo), 'still there: ' + viejo)
  const mercado = web('components/mercado/mercado-servicios.tsx')
  assert.ok(!mercado.includes('onReservaConfirmada') && !mercado.includes('la reserva se confirman'))
  assert.ok(web('lib/tus-client.ts').includes("status: 'pending' | 'confirmed' | 'rejected' | 'expired' | 'cancelled' | 'cancelled-late' | 'no-show' | 'completed'"))
  // No "Reservar turno" where the person actually requests one.
  for (const archivo of ['features/directory/worker-card.tsx', 'features/home/provider-map.tsx', 'features/directory/worker-profile.tsx']) assert.ok(!web(archivo).includes('Reservar turno'), archivo)
})
