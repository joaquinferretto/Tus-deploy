import { WORK_MESSAGE_MAX_LENGTH, type Trabajo, type WorkMessage } from '@factory/contracts'

// Private chat of a work between its client and its provider (after the match). It is NOT the
// WhatsApp channel (that one is contact <-> TUS official number). Rules:
// - only the work's client tenant and provider tenant can read or write (a third tenant gets
//   NOT_FOUND, never a hint that the work exists);
// - the author role is derived from the session tenant against the work, never from the body;
// - after the match contact data (phone, address, personal WhatsApp) is allowed: the anti-contact
//   rules of the PUBLIC texts do not apply here;
// - append-only; a retry with the same client message id never duplicates a message;
// - the text is never logged.

export const LARGO_MAXIMO_MENSAJE = WORK_MESSAGE_MAX_LENGTH
export const MENSAJES_POR_PAGINA = 100

export type RolAutorMensaje = 'cliente' | 'prestador'

export interface MensajeTrabajo {
  id: string
  tenantId: string
  trabajoId: string
  prestadorTenantId: string
  autorCuentaId: string
  autorRol: RolAutorMensaje
  texto: string
  creadoEn: string
}

export type VistaMensajeTrabajo = WorkMessage

export interface ContextoMensajes {
  tenantId: string
  // Account id of the session (author when writing).
  actorId: string
}

export interface PuertoMensajesTrabajo {
  // Last `limite` messages of the work (optionally older than `antesDe`), oldest first.
  listar(input: { tenantId: string; trabajoId: string; limite: number; antesDe?: string }): Promise<MensajeTrabajo[]>
  buscar(id: string): Promise<MensajeTrabajo | null>
  // Throws { code: 'P2002' } when the id already exists.
  crear(mensaje: MensajeTrabajo): Promise<void>
}

export interface PuertoTrabajosAccesibles {
  // The work if the tenant is its client or its provider; null otherwise.
  buscarAccesible(input: { tenantId: string; trabajoId: string }): Promise<Trabajo | null>
}

export class ErrorMensajesTrabajo extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ErrorMensajesTrabajo'
  }
}

// Control characters are removed (except line breaks and tabs); the rest is stored as typed.
export function normalizarTextoMensaje(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const limpio = value.replace(/\r\n?/gu, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '').trim()
  if (limpio.length === 0 || limpio.length > LARGO_MAXIMO_MENSAJE) return null
  return limpio
}

const ID_CLIENTE = /^[A-Za-z0-9-]{8,64}$/u

export class ServicioMensajesTrabajo {
  constructor(
    private readonly deps: {
      mensajes: PuertoMensajesTrabajo
      trabajos: PuertoTrabajosAccesibles
      now?: () => number
      newId?: () => string
    }
  ) {}

  private rol(trabajo: Trabajo, context: ContextoMensajes): RolAutorMensaje {
    if (trabajo.tenantId === context.tenantId) return 'cliente'
    if (trabajo.prestadorTenantId === context.tenantId) return 'prestador'
    throw new ErrorMensajesTrabajo(404, 'NOT_FOUND', 'work not found')
  }

  private async trabajo(context: ContextoMensajes, trabajoId: unknown): Promise<Trabajo> {
    if (typeof trabajoId !== 'string' || !trabajoId.trim() || trabajoId.length > 200)
      throw new ErrorMensajesTrabajo(404, 'NOT_FOUND', 'work not found')
    const trabajo = await this.deps.trabajos.buscarAccesible({ tenantId: context.tenantId, trabajoId })
    if (!trabajo) throw new ErrorMensajesTrabajo(404, 'NOT_FOUND', 'work not found')
    this.rol(trabajo, context)
    return trabajo
  }

  private vista(mensaje: MensajeTrabajo, context: ContextoMensajes): VistaMensajeTrabajo {
    return { id: mensaje.id, authorRole: mensaje.autorRol, mine: mensaje.autorCuentaId === context.actorId, text: mensaje.texto, createdAt: mensaje.creadoEn }
  }

  async listar(context: ContextoMensajes, trabajoId: unknown, opciones: { antesDe?: unknown } = {}): Promise<{ items: VistaMensajeTrabajo[] }> {
    const trabajo = await this.trabajo(context, trabajoId)
    const antesDe = typeof opciones.antesDe === 'string' && !Number.isNaN(Date.parse(opciones.antesDe)) ? new Date(opciones.antesDe).toISOString() : undefined
    const mensajes = await this.deps.mensajes.listar({ tenantId: trabajo.tenantId, trabajoId: trabajo.trabajoId, limite: MENSAJES_POR_PAGINA, ...(antesDe ? { antesDe } : {}) })
    return { items: mensajes.map((mensaje) => this.vista(mensaje, context)) }
  }

  async enviar(context: ContextoMensajes, trabajoId: unknown, body: { text?: unknown; clientMessageId?: unknown }): Promise<{ message: VistaMensajeTrabajo; created: boolean }> {
    const trabajo = await this.trabajo(context, trabajoId)
    const texto = normalizarTextoMensaje(body.text)
    if (!texto) throw new ErrorMensajesTrabajo(422, 'INVALID_MESSAGE', `the message must have between 1 and ${LARGO_MAXIMO_MENSAJE} characters`)
    const clienteId = typeof body.clientMessageId === 'string' && ID_CLIENTE.test(body.clientMessageId) ? body.clientMessageId : null
    // The id is derived from the work + the client's message id: a retry hits the primary key.
    const id = clienteId ? `mensaje-${trabajo.trabajoId}-${clienteId}` : `mensaje-${trabajo.trabajoId}-${(this.deps.newId ?? (() => crypto.randomUUID()))()}`
    const mensaje: MensajeTrabajo = {
      id,
      tenantId: trabajo.tenantId,
      trabajoId: trabajo.trabajoId,
      prestadorTenantId: trabajo.prestadorTenantId,
      autorCuentaId: context.actorId,
      autorRol: this.rol(trabajo, context),
      texto,
      creadoEn: new Date((this.deps.now ?? Date.now)()).toISOString(),
    }
    try {
      await this.deps.mensajes.crear(mensaje)
      return { message: this.vista(mensaje, context), created: true }
    } catch (error) {
      if ((error as { code?: unknown })?.code !== 'P2002') throw error
      const existente = await this.deps.mensajes.buscar(id)
      // Same id from ANOTHER author or text is not a retry: never overwrite, never reveal it.
      if (!existente || existente.autorCuentaId !== context.actorId || existente.texto !== texto)
        throw new ErrorMensajesTrabajo(409, 'CONFLICT', 'message id already used')
      return { message: this.vista(existente, context), created: false }
    }
  }
}

export class AlmacenMensajesTrabajoEnMemoria implements PuertoMensajesTrabajo {
  readonly mensajes = new Map<string, MensajeTrabajo>()

  async listar(input: { tenantId: string; trabajoId: string; limite: number; antesDe?: string }) {
    const todos = [...this.mensajes.values()]
      .filter((item) => item.tenantId === input.tenantId && item.trabajoId === input.trabajoId && (!input.antesDe || item.creadoEn < input.antesDe))
      .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn) || a.id.localeCompare(b.id))
    return todos.slice(-input.limite).map((item) => ({ ...item }))
  }

  async buscar(id: string) {
    const found = this.mensajes.get(id)
    return found ? { ...found } : null
  }

  async crear(mensaje: MensajeTrabajo) {
    if (this.mensajes.has(mensaje.id)) throw Object.assign(new Error('unique violation'), { code: 'P2002' })
    this.mensajes.set(mensaje.id, { ...mensaje })
  }
}

type Fila = Record<string, unknown>
export interface ClientePrismaMensajesTrabajo {
  mensajeTrabajo: {
    findMany(input: { where: Fila; orderBy: Fila[]; take: number }): Promise<Fila[]>
    findFirst(input: { where: Fila }): Promise<Fila | null>
    create(input: { data: Fila }): Promise<Fila>
  }
}

const desdeFila = (fila: Fila): MensajeTrabajo => ({
  id: String(fila['id']),
  tenantId: String(fila['tenantId']),
  trabajoId: String(fila['trabajoId']),
  prestadorTenantId: String(fila['prestadorTenantId']),
  autorCuentaId: String(fila['autorCuentaId']),
  autorRol: fila['autorRol'] === 'prestador' ? 'prestador' : 'cliente',
  texto: String(fila['texto']),
  creadoEn: (fila['fechaCreacion'] instanceof Date ? fila['fechaCreacion'] : new Date(String(fila['fechaCreacion']))).toISOString(),
})

export class AlmacenMensajesTrabajoPrisma implements PuertoMensajesTrabajo {
  constructor(private readonly client: ClientePrismaMensajesTrabajo) {}

  async listar(input: { tenantId: string; trabajoId: string; limite: number; antesDe?: string }) {
    // Newest page from the index, returned oldest first.
    const filas = await this.client.mensajeTrabajo.findMany({
      where: { tenantId: input.tenantId, trabajoId: input.trabajoId, ...(input.antesDe ? { fechaCreacion: { lt: new Date(input.antesDe) } } : {}) },
      orderBy: [{ fechaCreacion: 'desc' }, { id: 'desc' }],
      take: input.limite,
    })
    return filas.map(desdeFila).reverse()
  }

  async buscar(id: string) {
    const fila = await this.client.mensajeTrabajo.findFirst({ where: { id } })
    return fila ? desdeFila(fila) : null
  }

  async crear(mensaje: MensajeTrabajo) {
    await this.client.mensajeTrabajo.create({
      data: {
        id: mensaje.id,
        tenantId: mensaje.tenantId,
        trabajoId: mensaje.trabajoId,
        prestadorTenantId: mensaje.prestadorTenantId,
        autorCuentaId: mensaje.autorCuentaId,
        autorRol: mensaje.autorRol,
        texto: mensaje.texto,
        fechaCreacion: new Date(mensaje.creadoEn),
      },
    })
  }
}
