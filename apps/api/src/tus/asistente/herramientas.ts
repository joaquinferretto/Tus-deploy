import * as z from 'zod/v4'
import type { TusAuthenticatedTenantContext } from '../ports/index.ts'
import { esOficio, idsOficios } from '../directorio/oficios.ts'
import type { PuertoDominioAsistente } from './dominio.ts'
import type { DefinicionHerramientaChat } from './groq.ts'

// Tools the LLM may REQUEST. The backend validates the arguments (strict schemas, unknown fields
// rejected), checks the actor (link, role) and executes the same domain services as the Web. The
// model never gets database access and its text never authorizes anything.

export interface ActorAsistente {
  contactId: string
  conversationId: string
  // Current authority resolved from the linked account on EVERY turn (never cached roles).
  context: TusAuthenticatedTenantContext | null
  isProvider: boolean
}

export type AudienciaHerramienta = 'public' | 'linked' | 'provider'

const ID = z.string().regex(/^[A-Za-z0-9._:-]{3,120}$/u, 'invalid id')
const CATEGORIAS = ['beauty-personal-care', 'repairs-trades'] as const
// Trade ids come from the administered catalog (the same the Web uses). The model sees the CURRENT
// list: definicionChat() fills the enum on every call, so a trade created in the panel is usable
// at once without a deploy.
const OFICIO = z.string().refine((value) => esOficio(value), 'unknown trade')

interface Herramienta<S extends z.ZodType = z.ZodType> {
  name: string
  description: string
  audience: AudienciaHerramienta
  schema: S
  // Writes are never executed directly: a bound confirmation is created first.
  confirmation: null | { summarize: (args: z.infer<S>) => string }
  execute: (args: z.infer<S>, actor: ActorAsistente, domain: PuertoDominioAsistente, extra: { idempotencyKey: string }) => Promise<unknown>
}

function herramienta<S extends z.ZodType>(definition: Herramienta<S>): Herramienta<S> {
  return definition
}

const vacio = z.strictObject({})
const conTrabajo = z.strictObject({ workId: ID })

export const HERRAMIENTAS = [
  herramienta({
    name: 'collect_service_request',
    description: 'Conserva los datos que el usuario ya dio para buscar un prestador. Si falta oficio, problema o zona, formulá una pregunta natural SOLO sobre lo faltante. No incluyas resultados ni prestadores en la pregunta. Si cambia de necesidad, reemplazá los datos anteriores. Usá null para datos desconocidos; nunca los supongas.',
    audience: 'public',
    schema: z.strictObject({
      profession: OFICIO.nullable(),
      problem: z.string().trim().min(3).max(300).nullable(),
      zone: z.string().trim().min(2).max(60).nullable(),
      question: z.string().trim().min(5).max(500).nullable(),
    }),
    confirmation: null,
    execute: async (args) => args,
  }),
  herramienta({
    name: 'search_services',
    description: 'Busca servicios publicados en TUS por texto libre y/o categoría. Devuelve datos públicos (sin datos personales).',
    audience: 'public',
    schema: z.strictObject({ query: z.string().trim().min(2).max(80).nullable(), category: z.enum(CATEGORIAS).nullable() }),
    confirmation: null,
    execute: async (args, _actor, domain) => ({ services: await domain.buscarServicios({ query: args.query, category: args.category }) }),
  }),
  herramienta({
    name: 'search_providers',
    description:
      'Busca prestadores reales del directorio TUS compatibles con la necesidad (oficio y barrio de Corrientes). Devuelve hasta 5 con datos públicos: nombre público, oficio, barrio aproximado, verificación, trabajos completados y horarios publicados. Nunca inventes prestadores, valoraciones ni disponibilidad.',
    audience: 'public',
    schema: z.strictObject({
      query: z.string().trim().min(3).max(300),
      profession: OFICIO,
      zone: z.string().trim().min(2).max(60),
    }),
    confirmation: null,
    execute: async (args, _actor, domain) => {
      const result = await domain.buscarPrestadores({ query: args.query, profession: args.profession, zone: args.zone })
      return {
        profession: result.profession,
        providers: result.providers.map((item) => ({
          providerId: item.id,
          name: item.displayName,
          profession: item.profession.title,
          area: item.approximateArea,
          distanceKm: item.distanceKm,
          verified: item.verified,
          completedJobs: item.completedJobs,
          availability: item.availability.label,
        })),
        note: result.providers.length === 0 ? 'La búsqueda no encontró prestadores compatibles.' : 'Los horarios publicados no confirman disponibilidad para un trabajo. El cliente elige.',
      }
    },
  }),
  herramienta({
    name: 'get_available_slots',
    description:
      'Consulta los turnos y horarios disponibles de un prestador para una fecha (YYYY-MM-DD) y oficio. Devuelve las franjas horarias y tarifas.',
    audience: 'public',
    schema: z.strictObject({
      providerId: z.string().min(3),
      profession: OFICIO,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'formato de fecha debe ser YYYY-MM-DD'),
    }),
    confirmation: null,
    execute: async (args, _actor, domain) => {
      const res = await domain.turnosDisponibles(args.providerId, args.profession, args.date)
      return {
        date: args.date,
        slots: res.slots
          .filter((s) => s.disponible)
          .map((s) => ({ inicio: s.inicio, fin: s.fin, duracionMinutos: s.duracionMinutos })),
        tariffs: res.tarifas.map((t) => ({ id: t.id, name: t.nombre, durationMinutes: t.duracionMinutos, price: t.precio })),
        message: res.mensaje ?? null,
      }
    },
  }),
  herramienta({
    name: 'book_appointment',
    description:
      'Prepara la reserva de un turno con un prestador en un horario disponible (requiere confirmación explícita del usuario antes de confirmarse).',
    audience: 'public',
    schema: z.strictObject({
      providerId: z.string().min(3),
      profession: OFICIO,
      startsAt: z.string().min(10),
      tariffId: z.string().optional(),
      clientName: z.string().trim().min(2).max(100),
      clientPhone: z.string().trim().min(6).max(30).optional(),
      notes: z.string().trim().max(300).optional(),
    }),
    confirmation: {
      summarize: (args) =>
        `Voy a reservar tu turno:\nPrestador: ${args.providerId}\nServicio: ${args.profession}\nHorario: ${args.startsAt}\nA nombre de: ${args.clientName}${args.notes ? `\nNota: ${args.notes}` : ''}\n¿Confirmás?`,
    },
    execute: async (args, actor, domain) => ({
      appointment: await domain.reservarTurno(actor.context, {
        providerId: args.providerId,
        oficioId: args.profession,
        inicio: args.startsAt,
        tarifaId: args.tariffId,
        clienteNombre: args.clientName,
        clienteTelefono: args.clientPhone,
        notas: args.notes,
      }),
    }),
  }),
  herramienta({
    name: 'get_service_details',
    description: 'Detalle público de un servicio publicado por su listingId.',
    audience: 'public',
    schema: z.strictObject({ listingId: ID }),
    confirmation: null,
    execute: async (args, _actor, domain) => ({ service: await domain.servicio(args.listingId) }),
  }),
  herramienta({
    name: 'list_my_requests',
    description: 'Lista las solicitudes/compromisos del cliente vinculado.',
    audience: 'linked',
    schema: vacio,
    confirmation: null,
    execute: async (_args, actor, domain) => ({ requests: await domain.solicitudes(actor.context!) }),
  }),
  herramienta({
    name: 'list_my_reservations',
    description: 'Lista las reservas (solicitudes con horario) del cliente vinculado.',
    audience: 'linked',
    schema: vacio,
    confirmation: null,
    execute: async (_args, actor, domain) => ({ reservations: (await domain.solicitudes(actor.context!)).filter((item) => item.slotStart) }),
  }),
  herramienta({
    name: 'list_my_works',
    description: 'Lista los trabajos del cliente vinculado con su estado.',
    audience: 'linked',
    schema: vacio,
    confirmation: null,
    execute: async (_args, actor, domain) => ({ works: await domain.trabajos(actor.context!, 'client') }),
  }),
  herramienta({
    name: 'get_my_work',
    description: 'Detalle de un trabajo del usuario vinculado (estado y presupuestos).',
    audience: 'linked',
    schema: conTrabajo,
    confirmation: null,
    execute: async (args, actor, domain) => ({ work: await domain.trabajo(actor.context!, args.workId) }),
  }),
  herramienta({
    name: 'get_my_budget',
    description: 'Presupuestos de un trabajo del cliente vinculado.',
    audience: 'linked',
    schema: conTrabajo,
    confirmation: null,
    execute: async (args, actor, domain) => {
      const work = await domain.trabajo(actor.context!, args.workId)
      return { workId: work.workId, workStatus: work.status, budgets: work.budgets }
    },
  }),
  herramienta({
    name: 'get_payment_status',
    description: 'Estado de pago de un trabajo del cliente vinculado (si está listo para pagar y el estado del pago).',
    audience: 'linked',
    schema: conTrabajo,
    confirmation: null,
    execute: async (args, actor, domain) => ({ payment: await domain.estadoPago(actor.context!, args.workId) }),
  }),
  herramienta({
    name: 'list_provider_jobs',
    description: 'Lista los trabajos del prestador vinculado.',
    audience: 'provider',
    schema: vacio,
    confirmation: null,
    execute: async (_args, actor, domain) => ({ jobs: await domain.trabajos(actor.context!, 'provider') }),
  }),
  herramienta({
    name: 'get_provider_job',
    description: 'Detalle de un trabajo del prestador vinculado.',
    audience: 'provider',
    schema: conTrabajo,
    confirmation: null,
    execute: async (args, actor, domain) => ({ job: await domain.trabajo(actor.context!, args.workId) }),
  }),
  herramienta({
    name: 'list_provider_reservations',
    description: 'Trabajos con reserva del prestador vinculado.',
    audience: 'provider',
    schema: vacio,
    confirmation: null,
    execute: async (_args, actor, domain) => ({ reservations: (await domain.trabajos(actor.context!, 'provider')).filter((job) => job.hasReservation) }),
  }),
  herramienta({
    name: 'get_identity_status',
    description: 'Estado de la verificación de identidad del prestador vinculado.',
    audience: 'provider',
    schema: vacio,
    confirmation: null,
    execute: async (_args, actor, domain) => ({ identity: await domain.estadoIdentidad(actor.context!) }),
  }),
  herramienta({
    name: 'get_mercadopago_connection_status',
    description: 'Estado de la conexión de Mercado Pago del prestador vinculado.',
    audience: 'provider',
    schema: vacio,
    confirmation: null,
    execute: async (_args, actor, domain) => ({ mercadoPago: await domain.estadoMercadoPago(actor.context!) }),
  }),
  // ---- writes: always require an explicit, bound confirmation ------------------------------
  herramienta({
    name: 'create_service_request',
    description: 'Prepara una solicitud de servicio (requiere confirmación explícita del usuario antes de crearse).',
    audience: 'linked',
    schema: z.strictObject({
      listingId: ID,
      problem: z.string().trim().min(3).max(300),
      zone: z.string().trim().max(80).nullable(),
      urgency: z.enum(['hoy', 'esta_semana', 'sin_apuro']).nullable(),
    }),
    confirmation: {
      summarize: (args) =>
        `Voy a crear una solicitud:\nServicio: ${args.listingId}\nProblema: ${args.problem}${args.zone ? `\nZona: ${args.zone}` : ''}${args.urgency ? `\nUrgencia: ${args.urgency.replace('_', ' ')}` : ''}\n¿Confirmás?`,
    },
    execute: async (args, actor, domain, extra) => ({ request: await domain.crearSolicitud(actor.context!, { listingId: args.listingId, idempotencyKey: extra.idempotencyKey }) }),
  }),
  herramienta({
    name: 'request_provider',
    description: 'Prepara una solicitud TUS dirigida al prestador que el cliente eligió (requiere confirmación explícita). Queda pendiente hasta que el prestador la acepte.',
    audience: 'linked',
    schema: z.strictObject({
      providerId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/u),
      title: z.string().trim().min(5).max(90),
      description: z.string().trim().max(500).nullable(),
      zone: z.string().trim().min(2).max(60),
      urgency: z.enum(['urgente', 'hoy_manana', 'esta_semana', 'sin_apuro']),
      budgetMax: z.number().int().positive().max(100_000_000).nullable(),
    }),
    confirmation: {
      summarize: (args) =>
        `Voy a enviar tu solicitud al prestador elegido:
${args.title}${args.description ? `
${args.description}` : ''}
Barrio: ${args.zone}
Urgencia: ${args.urgency.replace('_', ' ')}${args.budgetMax ? `
Presupuesto máximo: $${args.budgetMax}` : ''}
Queda pendiente hasta que el prestador la acepte. ¿Confirmás?`,
    },
    execute: async (args, actor, domain) => ({ request: await domain.solicitarPrestador(actor.context!, args) }),
  }),
  // ---- postulaciones a solicitudes públicas (TUS recomienda, el cliente elige) ----
  herramienta({
    name: 'search_open_requests',
    description:
      'Lista solicitudes públicas abiertas de clientes (del mapa de TUS), opcionalmente por oficio y barrio. Un prestador puede ofrecerse aunque no sea su rubro. Solo datos públicos: título, barrio aproximado, presupuesto y urgencia; nunca contacto ni dirección.',
    audience: 'provider',
    schema: z.strictObject({ profession: OFICIO.nullable(), zone: z.string().trim().min(2).max(60).nullable() }),
    confirmation: null,
    execute: async (args, _actor, domain) => ({ requests: await domain.solicitudesAbiertas(args) }),
  }),
  herramienta({
    name: 'apply_to_request',
    description: 'Prepara la postulación del prestador a una solicitud pública abierta, con un mensaje opcional para el cliente (requiere confirmación). Postularse no confirma nada: el cliente decide.',
    audience: 'provider',
    schema: z.strictObject({ requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/u), message: z.string().trim().min(1).max(300).nullable() }),
    confirmation: {
      summarize: (args) => `Vas a postularte a esa solicitud${args.message ? ` con este mensaje:\n"${args.message}"` : ' sin mensaje'}.\nEl cliente decide a quién acepta. ¿Confirmás?`,
    },
    execute: async (args, actor, domain) => ({ application: await domain.postularse(actor.context!, { requestId: args.requestId, message: args.message }) }),
  }),
  herramienta({
    name: 'list_my_open_requests',
    description: 'Lista las solicitudes TUS del cliente (publicadas en el mapa o enviadas a un prestador) con su estado real.',
    audience: 'linked',
    schema: vacio,
    confirmation: null,
    execute: async (_args, actor, domain) => ({ requests: await domain.misSolicitudesTus(actor.context!) }),
  }),
  herramienta({
    name: 'list_request_applicants',
    description: 'Lista los prestadores que se ofrecieron para una solicitud del cliente (solo sus propias solicitudes), con perfil público y mensaje.',
    audience: 'linked',
    schema: z.strictObject({ requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/u) }),
    confirmation: null,
    execute: async (args, actor, domain) => ({ applicants: await domain.postulantes(actor.context!, args.requestId) }),
  }),
  herramienta({
    name: 'choose_applicant',
    description: 'Prepara la elección de un postulante para una solicitud del cliente (requiere confirmación). Confirma el trabajo con ese prestador, saca la solicitud del mapa y rechaza al resto.',
    audience: 'linked',
    schema: z.strictObject({ requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/u), applicationId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/u) }),
    confirmation: {
      summarize: () => 'Vas a elegir a ese prestador para tu solicitud. Queda confirmado con él, la solicitud sale del mapa y los demás postulantes quedan como no elegidos. ¿Confirmás?',
    },
    execute: async (args, actor, domain) => ({ result: await domain.elegirPostulante(actor.context!, args) }),
  }),
  herramienta({
    name: 'accept_budget',
    description: 'Prepara la aceptación de un presupuesto de un trabajo del cliente (requiere confirmación).',
    audience: 'linked',
    schema: z.strictObject({ workId: ID, budgetId: ID }),
    confirmation: { summarize: (args) => `Vas a aceptar el presupuesto ${args.budgetId} del trabajo ${args.workId}. ¿Confirmás?` },
    execute: async (args, actor, domain, extra) => ({ result: await domain.decidirPresupuesto(actor.context!, { ...args, decision: 'accepted', idempotencyKey: extra.idempotencyKey }) }),
  }),
  herramienta({
    name: 'reject_budget',
    description: 'Prepara el rechazo de un presupuesto con un motivo (requiere confirmación).',
    audience: 'linked',
    schema: z.strictObject({ workId: ID, budgetId: ID, reason: z.string().trim().min(3).max(300) }),
    confirmation: { summarize: (args) => `Vas a rechazar el presupuesto ${args.budgetId} (motivo: ${args.reason}). ¿Confirmás?` },
    execute: async (args, actor, domain, extra) => ({ result: await domain.decidirPresupuesto(actor.context!, { ...args, decision: 'rejected', idempotencyKey: extra.idempotencyKey }) }),
  }),
  herramienta({
    name: 'get_payment_link',
    description: 'Prepara el link seguro de pago con Mercado Pago de un trabajo listo para pagar (requiere confirmación). Nunca modifica montos.',
    audience: 'linked',
    schema: conTrabajo,
    confirmation: { summarize: (args) => `Te genero el link de pago del trabajo ${args.workId}. ¿Confirmás?` },
    execute: async (args, actor, domain, extra) => ({ payment: await domain.linkPago(actor.context!, args.workId, extra.idempotencyKey) }),
  }),
  herramienta({
    name: 'cancel_work',
    description: 'Prepara la cancelación de un trabajo por el prestador (requiere confirmación).',
    audience: 'provider',
    schema: conTrabajo,
    confirmation: { summarize: (args) => `Vas a cancelar el trabajo ${args.workId}. Esta acción no se puede deshacer. ¿Confirmás?` },
    execute: async (args, actor, domain, extra) => ({ result: await domain.transicionTrabajo(actor.context!, { workId: args.workId, action: 'cancel', idempotencyKey: extra.idempotencyKey }) }),
  }),
  herramienta({
    name: 'complete_work',
    description: 'Prepara marcar como completado un trabajo del prestador (requiere confirmación).',
    audience: 'provider',
    schema: conTrabajo,
    confirmation: { summarize: (args) => `Vas a marcar como completado el trabajo ${args.workId}. ¿Confirmás?` },
    execute: async (args, actor, domain, extra) => ({ result: await domain.transicionTrabajo(actor.context!, { workId: args.workId, action: 'complete', idempotencyKey: extra.idempotencyKey }) }),
  }),
] as const

export type NombreHerramienta = (typeof HERRAMIENTAS)[number]['name']

export function buscarHerramienta(name: string): Herramienta | null {
  return (HERRAMIENTAS as readonly Herramienta[]).find((tool) => tool.name === name) ?? null
}

export function permitida(tool: Herramienta, actor: ActorAsistente): 'ok' | 'LINK_REQUIRED' | 'PROVIDER_REQUIRED' {
  if (tool.audience === 'public') return 'ok'
  if (!actor.context) return 'LINK_REQUIRED'
  if (tool.audience === 'provider' && !actor.isProvider) return 'PROVIDER_REQUIRED'
  return 'ok'
}

export function definicionChat(tool: Herramienta): DefinicionHerramientaChat {
  const schema = z.toJSONSchema(tool.schema) as Record<string, unknown>
  delete schema['$schema']
  const properties = schema['properties'] as Record<string, Record<string, unknown>> | undefined
  const profession = properties?.['profession']
  if (profession) {
    const ids = idsOficios()
    const nullable = Array.isArray(profession['anyOf'])
    properties!['profession'] = nullable ? { anyOf: [{ type: 'string', enum: ids }, { type: 'null' }] } : { type: 'string', enum: ids }
  }
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: schema } }
}

// ---- intent router: a few tools per turn, never the whole catalog ---------------------------

export type IntencionAsistente = 'buscar' | 'postulaciones' | 'trabajos' | 'presupuesto' | 'reserva' | 'pago' | 'identidad' | 'conocimiento' | 'saludo' | 'otro'

const REGLAS: { intent: IntencionAsistente; pattern: RegExp }[] = [
  { intent: 'presupuesto', pattern: /presupuest|cotizaci/iu },
  { intent: 'pago', pattern: /\bpag(o|ar|u[eé])|link de pago|mercado ?pago|cobr(o|ar)/iu },
  { intent: 'identidad', pattern: /identidad|verificaci[oó]n de (mi )?(dni|identidad)|estoy verificad/iu },
  { intent: 'reserva', pattern: /reserv|turno|agenda|ma[nñ]ana a las|horario/iu },
  // Antes que "trabajos": "trabajos de electricidad disponibles cerca mío", "¿quién se ofreció?".
  {
    intent: 'postulaciones',
    pattern: /postul|qui[eé]n(es)? se (ofreci|postul)|(trabajos?|solicitud(es)?|pedidos?)\b.*\b(disponibles?|abiertas?|abiertos?|nuev[oa]s?|cerca)\b/iu,
  },
  { intent: 'trabajos', pattern: /(mis |el |ese )?trabajos?|pedidos?|solicitud|qu[eé] pas[oó]|pendiente|terminad|cancel|complet/iu },
  { intent: 'conocimiento', pattern: /qu[eé] es tus|c[oó]mo funciona|c[oó]mo (me )?registr|pol[ií]tica|protecci[oó]n|c[oó]mo public|qu[eé] (datos|necesito)|t[eé]rminos|ayuda/iu },
  { intent: 'buscar', pattern: /necesito|busco|hay alg|servicio|prestador|electricist|plomer|gasist|aire acondicionado|pintor|cerrajer|arregl|repar|se me rompi|cerca|cu[aá]nto (sale|cuesta|puede costar)/iu },
  { intent: 'saludo', pattern: /^\s*(hola|buen(os|as) (d[ií]as|tardes|noches)|hey|buenas)\s*[!.]*\s*$/iu },
]

export function detectarIntencion(text: string): IntencionAsistente {
  for (const rule of REGLAS) if (rule.pattern.test(text)) return rule.intent
  return 'otro'
}

const HERRAMIENTAS_POR_INTENCION: Record<IntencionAsistente, { client: NombreHerramienta[]; provider: NombreHerramienta[] }> = {
  buscar: { client: ['collect_service_request', 'search_providers', 'get_available_slots', 'book_appointment', 'request_provider', 'search_services'], provider: [] },
  postulaciones: {
    client: ['list_my_open_requests', 'list_request_applicants', 'choose_applicant'],
    provider: ['search_open_requests', 'apply_to_request'],
  },
  trabajos: { client: ['list_my_works', 'get_my_work', 'list_my_requests', 'list_my_open_requests'], provider: ['list_provider_jobs', 'get_provider_job', 'cancel_work', 'complete_work'] },
  presupuesto: { client: ['list_my_works', 'get_my_budget', 'accept_budget', 'reject_budget'], provider: ['list_provider_jobs', 'get_provider_job'] },
  reserva: { client: ['get_available_slots', 'book_appointment', 'collect_service_request', 'search_providers', 'list_my_reservations', 'get_service_details'], provider: ['list_provider_reservations'] },
  pago: { client: ['list_my_works', 'get_payment_status', 'get_payment_link'], provider: ['get_mercadopago_connection_status'] },
  identidad: { client: [], provider: ['get_identity_status'] },
  conocimiento: { client: [], provider: [] },
  saludo: { client: [], provider: [] },
  otro: { client: ['search_services'], provider: [] },
}

export const MAX_HERRAMIENTAS_POR_TURNO = 6

export function seleccionarHerramientas(intent: IntencionAsistente, actor: ActorAsistente): Herramienta[] {
  const names = [...HERRAMIENTAS_POR_INTENCION[intent].client, ...(actor.isProvider ? HERRAMIENTAS_POR_INTENCION[intent].provider : [])]
  return [...new Set(names)]
    .map((name) => buscarHerramienta(name)!)
    .filter((tool) => permitida(tool, actor) === 'ok')
    .slice(0, MAX_HERRAMIENTAS_POR_TURNO)
}

// True when the intent needs private data the unlinked contact cannot access.
export function intencionPrivada(intent: IntencionAsistente): boolean {
  return ['postulaciones', 'trabajos', 'presupuesto', 'pago', 'identidad'].includes(intent)
}

// ---- execution -----------------------------------------------------------------------------

export type ResultadoHerramienta =
  | { ok: true; data: unknown }
  | { ok: true; confirmationRequired: true; summary: string; arguments: Record<string, unknown> }
  | { ok: false; error: string }

export async function validarYEjecutar(input: {
  name: string
  rawArguments: string
  actor: ActorAsistente
  domain: PuertoDominioAsistente
  allowed: Set<string>
  timeoutMs: number
  // Only set when executing an already confirmed action.
  confirmed?: { idempotencyKey: string }
}): Promise<ResultadoHerramienta> {
  const tool = buscarHerramienta(input.name)
  if (!tool || !input.allowed.has(tool.name)) return { ok: false, error: 'TOOL_NOT_AVAILABLE' }
  const permission = permitida(tool, input.actor)
  if (permission !== 'ok') return { ok: false, error: permission }
  let raw: unknown
  try {
    raw = input.rawArguments.trim() ? JSON.parse(input.rawArguments) : {}
  } catch {
    return { ok: false, error: 'INVALID_ARGUMENTS' }
  }
  const parsed = tool.schema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'INVALID_ARGUMENTS' }
  if (tool.confirmation && !input.confirmed)
    return { ok: true, confirmationRequired: true, summary: tool.confirmation.summarize(parsed.data), arguments: parsed.data as Record<string, unknown> }
  try {
    const data = await conTimeout(
      tool.execute(parsed.data, input.actor, input.domain, { idempotencyKey: input.confirmed?.idempotencyKey ?? `whatsapp-read-${Date.now()}` }),
      input.timeoutMs
    )
    return { ok: true, data }
  } catch (error) {
    return { ok: false, error: codigoErrorSeguro(error) }
  }
}

function conTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('tool timeout'), { code: 'TOOL_TIMEOUT' })), ms)
    }),
  ])
}

// Domain errors keep only their safe code (FORBIDDEN, NOT_FOUND, VERSION_CONFLICT...).
export function codigoErrorSeguro(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,60}$/u.test(code) ? code : 'TOOL_FAILED'
}
