import { WHATSAPP_SETUP } from './whatsapp.mjs'
import { SERVICE_SETUP } from './web-09-servicio.mjs'

// ASISTENTE-CONTEXTO fixture: three masseuses with a weekly agenda, a recording fake domain
// (availability, agenda re-read, prices, requests) and the real WhatsApp pipeline with no model.
// Clock: Friday 2026-09-25, 09:00 in Argentina; nobody has a free turno today.
export const CONTEXTO_SETUP = `${SERVICE_SETUP}${WHATSAPP_SETUP}
  const { catalogoVigente, establecerCatalogo } = await import('./apps/api/src/tus/catalogo/vigente.ts')
  const catalogo = catalogoVigente()
  establecerCatalogo({ ...catalogo, oficios: [...catalogo.oficios, { id: 'masaje', categoriaId: null, nombre: 'Masaje', profesion: 'Masajista', slug: 'masaje', descripcion: null, icono: 'herramienta', activo: true, orden: 20, sinonimos: ['masaje', 'masajes', 'masajista', 'contractura'] }] })
  const { formatearPesos } = await import('./packages/contracts/src/tus-turnos.ts')

  // Free local times of each professional per weekday (0 Sunday ... 6 Saturday).
  const BONGIO = { id: 'perfil-bongio', name: 'Bongio', area: 'Centro', semana: { 1: ['09:30'], 2: ['18:30'] }, precio: 18000 }
  const MELINA = { id: 'perfil-melina', name: 'Melina', area: 'Barrio Sur', semana: { 1: ['10:15', '11:00'], 6: ['09:00', '10:15'] }, precio: 20000 }
  const SABRINA = { id: 'perfil-sabrina', name: 'Sabrina', area: 'San Benito', semana: { 1: ['16:00', '19:00'], 2: ['18:00'] }, precio: null }
  const AGENDA = [BONGIO, MELINA, SABRINA]
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
      const providers = AGENDA.map((p) => {
        const libres = dias.flatMap((d) => libresDe(p, d))
        const matches = libres.filter(([h]) => cabe(h, consulta.time)).map(([, i]) => i)
        return { providerId: p.id, name: p.name, profession: 'Masajista', area: p.area, verified: true, completedJobs: 3, takesAppointments: true, durationMinutes: 60, tariffs: [], matches, nearby: matches.length === 0 && consulta.time ? libres.slice(0, 3).map(([, i]) => i) : [] }
      })
      const outcome = providers.some((p) => p.matches.length) ? 'matches' : providers.some((p) => p.nearby.length) ? 'nearby' : 'no_availability'
      return { profession: consulta.profession, outcome, zoneRelaxed: false, providers }
    },
    turnosDisponibles: async (providerId, oficioId, fecha) => {
      const p = AGENDA.find((x) => x.id === providerId)
      const horas = p ? (p.semana[diaSemana(fecha)] ?? []) : []
      return { slots: horas.map((h) => ({ inicio: iso(fecha, h), fin: iso(fecha, h), duracionMinutos: 60, disponible: !ocupados.has(iso(fecha, h)) })), tarifas: [] }
    },
    servicioDeTurno: async (providerId) => {
      dom.precios += 1
      const p = AGENDA.find((x) => x.id === providerId)
      return p ? { serviceName: 'Masaje', options: [{ tariffId: null, name: 'Masaje', durationMinutes: 60, price: p.precio, deposit: p.precio ? p.precio / 2 : null }] } : null
    },
    reservarTurno: async (context, input) => {
      if (alReservar.has(input.inicio)) throw Object.assign(new Error('slot taken'), { status: 409, code: 'SLOT_OCCUPIED' })
      dom.reservas.push({ subjectId: context?.subjectId ?? null, providerId: input.providerId, inicio: input.inicio })
      return { id: 'res-' + dom.reservas.length, prestadorNombre: 'x', inicio: input.inicio, fin: input.inicio, precioFinal: 20000, estado: 'pending' }
    },
  }
  const modulo = crearModuloWhatsapp({ env: waEnv, transaction: waTx, accounts: accountResolver, domain: dominio, knowledgeIndex, whatsapp: fakeWa, chat: null, embeddings, transcriptor: null, now: waClock, metric: () => {} })
  const cola = modulo.crearWorker({ owner: 'contexto' })
  async function whatsapp(waId, text) {
    await modulo.ingreso.procesar(parsearWebhookMeta(inbound(waId, text), PHONE_ID), 'corr-contexto')
    for (let i = 0; i < 5; i += 1) if ((await cola.procesarSiguiente()).outcome === 'idle') break
    waAdvance(6000)
    return lastSent().message
  }
  let numero = 0
  const nuevoContacto = () => '54911555' + String(70000 + (numero += 1))
  const necesidad = async (waId) => (await conversationOf(waId)).state.need
  // The days and windows the backend was asked for, from a given point.
  const pedidas = (desde) => dom.consultas.slice(desde).map((c) => [c.day, c.time ? c.time.kind + ':' + (c.time.from ?? '') + '-' + (c.time.to ?? '') : null])
  const LUNES = 'Quiero una masajista para el lunes que viene'
`
