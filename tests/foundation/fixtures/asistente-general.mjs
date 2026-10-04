import { WHATSAPP_SETUP } from './whatsapp.mjs'
import { SERVICE_SETUP } from './web-09-servicio.mjs'

// ASISTENTE-GENERAL fixture: professionals of SEVERAL trades (plumbing, electricity, massage,
// gardening, locksmithing) with a weekly agenda, a recording fake domain (availability by trade,
// agenda re-read, prices, requests) and the real WhatsApp pipeline with no model.
// Clock: Tuesday 2026-10-06, 09:00 in Argentina. Thursday is the 8th and Friday the 9th.
export const GENERAL_SETUP = `${SERVICE_SETUP}${WHATSAPP_SETUP}
  const { catalogoVigente, establecerCatalogo } = await import('./apps/api/src/tus/catalogo/vigente.ts')
  const catalogo = catalogoVigente()
  establecerCatalogo({ ...catalogo, oficios: [...catalogo.oficios,
    { id: 'masaje', categoriaId: null, nombre: 'Masaje', profesion: 'Masajista', slug: 'masaje', descripcion: null, icono: 'herramienta', activo: true, orden: 20, sinonimos: ['masaje', 'masajes', 'masajista', 'contractura'] },
    { id: 'jardineria', categoriaId: null, nombre: 'Jardinería', profesion: 'Jardinero/a', slug: 'jardineria', descripcion: null, icono: 'herramienta', activo: true, orden: 21, sinonimos: ['jardineria', 'jardinero', 'jardinera', 'pasto', 'cesped', 'podar'] },
  ] })
  waNow = Date.parse('2026-10-06T12:00:00.000Z')

  // Free local times of each professional per weekday (0 Sunday ... 6 Saturday).
  const AGENDA = [
    { id: 'perfil-juan', name: 'Juan Pérez', area: 'Centro', oficio: 'plomeria', profesion: 'Plomero/a', semana: { 4: ['09:00', '09:45', '10:30', '12:00'], 5: ['08:30'] }, precio: 200 },
    { id: 'perfil-maria', name: 'María Gómez', area: 'Barrio Sur', oficio: 'plomeria', profesion: 'Plomero/a', semana: { 4: ['09:45', '11:00', '14:00'] }, precio: 200 },
    { id: 'perfil-pedro', name: 'Pedro Díaz', area: 'Cambá Cuá', oficio: 'plomeria', profesion: 'Plomero/a', semana: { 4: ['09:45'], 5: ['08:30', '09:30'] }, precio: 200 },
    { id: 'perfil-laura', name: 'Laura Gómez', area: 'Centro', oficio: 'electricidad', profesion: 'Electricista', semana: { 4: ['14:00', '16:00'] }, precio: 200 },
    { id: 'perfil-omar', name: 'Omar Ríos', area: 'San Benito', oficio: 'electricidad', profesion: 'Electricista', semana: { 4: ['09:00', '10:30'] }, precio: 200 },
    { id: 'perfil-melina', name: 'Melina', area: 'Barrio Sur', oficio: 'masaje', profesion: 'Masajista', semana: { 3: ['09:00', '09:15', '09:30', '09:45'] }, precio: 200 },
    { id: 'perfil-sabrina', name: 'Sabrina', area: 'San Benito', oficio: 'masaje', profesion: 'Masajista', semana: { 3: ['09:45', '10:00'] }, precio: 200 },
    { id: 'perfil-bongio', name: 'Bongio', area: 'Centro', oficio: 'masaje', profesion: 'Masajista', semana: { 3: ['09:45'] }, precio: 200 },
    // Only next week: Monday the 12th.
    { id: 'perfil-rosa', name: 'Rosa Vera', area: 'Laguna Seca', oficio: 'jardineria', profesion: 'Jardinero/a', semana: { 1: ['10:00', '11:00'] }, precio: 200 },
    // Tuesdays at 08:00: today's already passed, the next one is a week away (the 13th).
    { id: 'perfil-tito', name: 'Tito Sosa', area: 'Centro', oficio: 'cerrajeria', profesion: 'Cerrajero/a', semana: { 2: ['08:00'] }, precio: null },
  ]
  // Starts taken meanwhile: gone from the agenda (ocupados) or rejected only when requested (alReservar).
  const ocupados = new Set()
  const alReservar = new Set()
  const dom = { consultas: [], reservas: [], precios: 0 }
  const iso = (dia, hora) => new Date(dia + 'T' + hora + ':00.000-03:00').toISOString()
  const diaSemana = (dia) => new Date(dia + 'T12:00:00.000Z').getUTCDay()
  const cabe = (hora, t) => !t || (t.kind === 'exact' ? hora === t.from : t.kind === 'from' ? hora >= t.from : t.kind === 'until' ? hora < t.to : hora >= t.from && hora < t.to)
  const libresDe = (p, dia) => (p.semana[diaSemana(dia)] ?? []).map((h) => [h, iso(dia, h)]).filter(([, i]) => !ocupados.has(i))
  const dominio = {
    esPrestador: async () => false,
    buscarServicios: async () => [],
    servicio: async () => null,
    solicitudes: async () => [],
    trabajos: async () => [],
    buscarPrestadores: async (filter) => ({ profession: filter.profession, providers: [] }),
    nombrePrestador: async (id) => AGENDA.find((p) => p.id === id)?.name ?? null,
    buscarDisponibilidad: async (consulta) => {
      dom.consultas.push(consulta)
      const dias = [consulta.day, ...(consulta.dayTo ? [consulta.dayTo] : [])]
      const providers = AGENDA.filter((p) => p.oficio === consulta.profession).map((p) => {
        const libres = dias.flatMap((d) => libresDe(p, d))
        const matches = libres.filter(([h]) => cabe(h, consulta.time)).map(([, i]) => i)
        return { providerId: p.id, name: p.name, profession: p.profesion, area: p.area, verified: true, completedJobs: 3, takesAppointments: true, durationMinutes: 45, tariffs: [], matches, nearby: matches.length === 0 && consulta.time ? libres.slice(0, 3).map(([, i]) => i) : [] }
      })
      const outcome = providers.length === 0 ? 'no_providers' : providers.some((p) => p.matches.length) ? 'matches' : providers.some((p) => p.nearby.length) ? 'nearby' : 'no_availability'
      const peso = (p) => (p.matches.length ? 0 : p.nearby.length ? 1 : 2)
      return { profession: consulta.profession, outcome, zoneRelaxed: false, providers: providers.map((p, i) => [p, i]).sort((a, b) => peso(a[0]) - peso(b[0]) || a[1] - b[1]).map(([p]) => p) }
    },
    turnosDisponibles: async (providerId, oficioId, fecha) => {
      const p = AGENDA.find((x) => x.id === providerId && x.oficio === oficioId)
      const horas = p ? (p.semana[diaSemana(fecha)] ?? []) : []
      return { slots: horas.map((h) => ({ inicio: iso(fecha, h), fin: iso(fecha, h), duracionMinutos: 45, disponible: !ocupados.has(iso(fecha, h)) })), tarifas: [] }
    },
    // The price and the deposit are the backend's: the deposit is half of the price, computed here
    // like the domain does, never by the assistant.
    servicioDeTurno: async (providerId, oficioId) => {
      dom.precios += 1
      const p = AGENDA.find((x) => x.id === providerId && x.oficio === oficioId)
      const nombre = catalogoVigente().oficios.find((o) => o.id === oficioId)?.nombre ?? oficioId
      return p ? { serviceName: nombre, options: [{ tariffId: null, name: nombre, durationMinutes: 45, price: p.precio, deposit: p.precio ? p.precio / 2 : null }] } : null
    },
    reservarTurno: async (context, input) => {
      if (alReservar.has(input.inicio)) throw Object.assign(new Error('slot taken'), { status: 409, code: 'SLOT_OCCUPIED' })
      dom.reservas.push({ subjectId: context?.subjectId ?? null, providerId: input.providerId, oficioId: input.oficioId, inicio: input.inicio })
      return { id: 'res-' + dom.reservas.length, prestadorNombre: 'x', inicio: input.inicio, fin: input.inicio, precioFinal: 200, estado: 'pending' }
    },
  }
  const modulo = crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: accountResolver, domain: dominio, knowledgeIndex, whatsapp: fakeWa, chat: null, embeddings, transcriptor: null, now: waClock, metric: () => {} })
  const cola = modulo.crearWorker({ owner: 'general' })
  async function whatsapp(waId, text) {
    await modulo.ingreso.procesar(parsearWebhookMeta(inbound(waId, text), PHONE_ID), 'corr-general')
    for (let i = 0; i < 5; i += 1) if ((await cola.procesarSiguiente()).outcome === 'idle') break
    waAdvance(6000)
    return lastSent().message
  }
  let numero = 0
  const nuevoContacto = () => '54911555' + String(80000 + (numero += 1))
  const estadoDe = async (waId) => (await conversationOf(waId)).state
  // A whole conversation: every reply, in order.
  async function charla(waId, mensajes) {
    const respuestas = []
    for (const texto of mensajes) respuestas.push((await whatsapp(waId, texto)).text)
    return respuestas
  }
`
