import type { TusApplicationService } from '../application/tus-application-service.ts'
import type { HechosPrestador, PerfilPublico, ServicioResumen } from './modelo.ts'
import type { OficioId } from './oficios.ts'
import type { AlmacenPerfiles, FuentesDirectorio, ResumenAdminPrestador } from './puertos.ts'
import type { AreaDomicilioFallback } from './ubicacion.ts'

// ---- en memoria (tests y composición local) -------------------------------------------------

// Principal first, unique: the same invariant the database enforces.
export function copiaPerfil(perfil: PerfilPublico): PerfilPublico {
  const oficios = [...new Set([perfil.oficio, ...(perfil.oficios ?? [])])]
  return { ...perfil, oficio: oficios[0]!, oficios, zonasCobertura: [...perfil.zonasCobertura] }
}

function filtroOficios(input: { oficio?: OficioId; oficios?: readonly OficioId[] }): OficioId[] | null {
  const ids = [...(input.oficios ?? []), ...(input.oficio ? [input.oficio] : [])]
  return ids.length ? [...new Set(ids)] : null
}

export class AlmacenPerfilesEnMemoria implements AlmacenPerfiles {
  readonly perfiles = new Map<string, PerfilPublico>()

  async guardar(perfil: PerfilPublico) {
    for (const [id, actual] of this.perfiles) if (actual.tenantId === perfil.tenantId && id !== perfil.id) this.perfiles.delete(id)
    this.perfiles.set(perfil.id, copiaPerfil(perfil))
  }

  async porTenant(tenantId: string) {
    const found = [...this.perfiles.values()].find((perfil) => perfil.tenantId === tenantId)
    return found ? copiaPerfil(found) : null
  }

  async porTenants(tenantIds: readonly string[]) {
    const wanted = new Set(tenantIds)
    return [...this.perfiles.values()].filter((p) => wanted.has(p.tenantId)).map(copiaPerfil)
  }

  async porId(id: string) {
    const found = this.perfiles.get(id)
    return found ? copiaPerfil(found) : null
  }

  async visibles(input: { oficio?: OficioId; oficios?: readonly OficioId[]; limite: number }) {
    const buscados = filtroOficios(input)
    return [...this.perfiles.values()]
      .filter((perfil) => perfil.visible && (!buscados || perfil.oficios.some((id) => buscados.includes(id))))
      .sort((a, b) => b.actualizadoEn - a.actualizadoEn)
      .slice(0, input.limite)
      .map(copiaPerfil)
  }

  async todos(input: { limite: number }) {
    return [...this.perfiles.values()].sort((a, b) => b.actualizadoEn - a.actualizadoEn).slice(0, input.limite).map(copiaPerfil)
  }

  async tenants() {
    return [...new Set([...this.perfiles.values()].map((perfil) => perfil.tenantId))]
  }

  async paginaAdmin(input: { pagina: number; tamano: number; q: string; oficio: string; zona: string; visible: boolean | null; verificado: boolean | null }) {
    const q = input.q.toLocaleLowerCase('es')
    const items = [...this.perfiles.values()]
      .filter((item) => !q || item.nombrePublico.toLocaleLowerCase('es').includes(q))
      .filter((item) => !input.oficio || item.oficios.includes(input.oficio))
      .filter((item) => !input.zona || item.zona === input.zona || item.zonasCobertura.includes(input.zona))
      .filter((item) => input.visible === null || item.visible === input.visible)
      .sort((a, b) => b.actualizadoEn - a.actualizadoEn || b.id.localeCompare(a.id))
    const page = items.slice((input.pagina - 1) * input.tamano, input.pagina * input.tamano)
    return { items: page.map(copiaPerfil), total: items.length }
  }
}

// ---- PostgreSQL (perfiles_publicos_prestador) ------------------------------------------------

type Fila = Record<string, unknown>

interface DelegadoPerfiles {
  findFirst(input: { where: Fila; include?: Fila }): Promise<Fila | null>
  findMany(input: { where: Fila; orderBy?: Fila | Fila[]; skip?: number; take?: number; select?: Fila; distinct?: string[]; include?: Fila }): Promise<Fila[]>
  count(input: { where: Fila }): Promise<number>
  upsert(input: { where: Fila; create: Fila; update: Fila }): Promise<Fila>
}

export interface ClientePrismaDirectorio {
  perfilPublicoPrestador: DelegadoPerfiles
  // perfil_servicios (N:M). Optional only for legacy doubles; the Prisma client always has it.
  perfilServicio?: {
    deleteMany(input: { where: Fila }): Promise<{ count: number }>
    createMany(input: { data: Fila[]; skipDuplicates?: boolean }): Promise<{ count: number }>
    upsert(input: { where: Fila; create: Fila; update: Fila }): Promise<Fila>
  }
  $transaction?<T>(operation: (client: ClientePrismaDirectorio) => Promise<T>): Promise<T>
  trabajo: { count(input: { where: Fila }): Promise<number> }
  // Real delegate of verificaciones_identidad (model VerificacionIdentidad); its approved state is 'verified'.
  verificacionIdentidad?: { findMany(input: { where: Fila; select: Fila; distinct?: string[] }): Promise<Fila[]> }
}

const desdeFecha = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value))

// Every profile read brings its services in the same query plan (one batched relation read).
const CON_SERVICIOS = { servicios: { select: { oficioId: true, orden: true }, orderBy: [{ orden: 'asc' }, { oficioId: 'asc' }] } }

function oficiosDeFila(fila: Fila): OficioId[] {
  const principal = String(fila['oficio'])
  const servicios = Array.isArray(fila['servicios'])
    ? (fila['servicios'] as Fila[]).map((item) => String(item['oficioId']))
    : []
  return [...new Set([principal, ...servicios])]
}

function desdeFila(fila: Fila): PerfilPublico {
  const zona = fila['zona'] === null || fila['zona'] === undefined ? null : String(fila['zona'])
  const zonasCobertura = Array.isArray(fila['zonasCobertura'])
    ? fila['zonasCobertura'].filter((item): item is string => typeof item === 'string')
    : zona
      ? [zona]
      : []
  return {
    id: String(fila['id']),
    tenantId: String(fila['tenantId']),
    prestadorId: String(fila['prestadorId']),
    nombrePublico: String(fila['nombrePublico']),
    oficio: fila['oficio'] as OficioId,
    oficios: oficiosDeFila(fila),
    zona,
    zonasCobertura,
    modalidadAtencion: fila['modalidadAtencion'] === 'local' || fila['modalidadAtencion'] === 'mixto' ? fila['modalidadAtencion'] : 'domicilio',
    radioCoberturaKm: fila['radioCoberturaKm'] === null || fila['radioCoberturaKm'] === undefined ? null : Number(fila['radioCoberturaKm']),
    descripcion: (fila['descripcion'] as string | null) ?? null,
    aniosExperiencia: fila['aniosExperiencia'] === null || fila['aniosExperiencia'] === undefined ? null : Number(fila['aniosExperiencia']),
    visible: fila['visible'] === true,
    creadoEn: desdeFecha(fila['fechaCreacion']),
    actualizadoEn: desdeFecha(fila['fechaActualizacion']),
  }
}

export class AlmacenPerfilesPrisma implements AlmacenPerfiles {
  constructor(private readonly client: ClientePrismaDirectorio) {}

  async guardar(perfil: PerfilPublico) {
    const datos = {
      nombrePublico: perfil.nombrePublico,
      oficio: perfil.oficio,
      zona: perfil.zona,
      zonasCobertura: perfil.zonasCobertura,
      modalidadAtencion: perfil.modalidadAtencion,
      radioCoberturaKm: perfil.radioCoberturaKm,
      descripcion: perfil.descripcion,
      aniosExperiencia: perfil.aniosExperiencia,
      visible: perfil.visible,
      fechaActualizacion: new Date(perfil.actualizadoEn),
    }
    const oficios = [...new Set([perfil.oficio, ...perfil.oficios])]
    // Profile + its service set in ONE transaction: the deferred FK checks at commit that the
    // principal service belongs to the set; PK (perfil_id, oficio_id) forbids duplicates.
    const escribir = async (client: ClientePrismaDirectorio) => {
      const fila = await client.perfilPublicoPrestador.upsert({
        where: { tenantId_prestadorId: { tenantId: perfil.tenantId, prestadorId: perfil.prestadorId } },
        create: { id: perfil.id, tenantId: perfil.tenantId, prestadorId: perfil.prestadorId, ...datos, fechaCreacion: new Date(perfil.creadoEn) },
        update: datos,
      })
      if (!client.perfilServicio) return
      const perfilId = String(fila['id'])
      await client.perfilServicio.deleteMany({ where: { perfilId, oficioId: { notIn: oficios } } })
      for (const [orden, oficioId] of oficios.entries())
        await client.perfilServicio.upsert({
          where: { perfilId_oficioId: { perfilId, oficioId } },
          create: { perfilId, oficioId, orden },
          update: { orden },
        })
    }
    if (this.client.$transaction) await this.client.$transaction((tx) => escribir(tx))
    else await escribir(this.client)
  }

  async porTenant(tenantId: string) {
    const fila = await this.client.perfilPublicoPrestador.findFirst({ where: { tenantId }, include: CON_SERVICIOS })
    return fila ? desdeFila(fila) : null
  }

  async porTenants(tenantIds: readonly string[]) {
    if (!tenantIds.length) return []
    return (await this.client.perfilPublicoPrestador.findMany({ where: { tenantId: { in: [...new Set(tenantIds)] } }, include: CON_SERVICIOS })).map(desdeFila)
  }

  async porId(id: string) {
    const fila = await this.client.perfilPublicoPrestador.findFirst({ where: { id }, include: CON_SERVICIOS })
    return fila ? desdeFila(fila) : null
  }

  async visibles(input: { oficio?: OficioId; oficios?: readonly OficioId[]; limite: number }) {
    const buscados = filtroOficios(input)
    const filas = await this.client.perfilPublicoPrestador.findMany({
      // A provider matches when ANY of its services is requested (one row per provider).
      where: { visible: true, ...(buscados ? { servicios: { some: { oficioId: { in: buscados } } } } : {}) },
      orderBy: { fechaActualizacion: 'desc' },
      take: input.limite,
      include: CON_SERVICIOS,
    })
    return filas.map(desdeFila)
  }

  async todos(input: { limite: number }) {
    const filas = await this.client.perfilPublicoPrestador.findMany({ where: {}, orderBy: { fechaActualizacion: 'desc' }, take: input.limite, include: CON_SERVICIOS })
    return filas.map(desdeFila)
  }

  async tenants() {
    const filas = await this.client.perfilPublicoPrestador.findMany({ where: {}, select: { tenantId: true }, distinct: ['tenantId'] })
    return filas.map((fila) => String(fila['tenantId']))
  }

  async paginaAdmin(input: { pagina: number; tamano: number; q: string; oficio: string; zona: string; visible: boolean | null; verificado: boolean | null }) {
    let tenantIds: string[] | null = null
    if (input.verificado !== null && this.client.verificacionIdentidad) {
      const verificadas = await this.client.verificacionIdentidad.findMany({ where: { estado: 'verified' }, select: { tenantId: true }, distinct: ['tenantId'] })
      tenantIds = verificadas.map((item) => String(item['tenantId']))
    }
    const where: Fila = { AND: [
      ...(input.q ? [{ nombrePublico: { contains: input.q, mode: 'insensitive' } }] : []),
      ...(input.oficio ? [{ servicios: { some: { oficioId: input.oficio } } }] : []),
      ...(input.zona ? [{ OR: [{ zona: input.zona }, { zonasCobertura: { has: input.zona } }] }] : []),
      ...(input.visible === null ? [] : [{ visible: input.visible }]),
      ...(tenantIds === null ? [] : [{ tenantId: input.verificado ? { in: tenantIds } : { notIn: tenantIds } }]),
    ] }
    const [filas, total] = await Promise.all([
      this.client.perfilPublicoPrestador.findMany({ where, orderBy: [{ fechaActualizacion: 'desc' }, { id: 'desc' }], skip: (input.pagina - 1) * input.tamano, take: input.tamano, include: CON_SERVICIOS }),
      this.client.perfilPublicoPrestador.count({ where }),
    ])
    return { items: filas.map(desdeFila), total }
  }
}

// ---- hechos desde los módulos existentes ------------------------------------------------------

// Marketplace (prestador aprobado y servicios publicados), identidad (verificación) y trabajos
// completados. `contarCompletados` viene de Prisma en producción y de un fake en tests.
export class FuentesDirectorioTus implements FuentesDirectorio {
  constructor(
    private readonly application: TusApplicationService,
    private readonly contarCompletados: (tenantId: string) => Promise<number>,
    private readonly resumenCalificaciones?: (tenantIds: readonly string[]) => Promise<Map<string, { average: number; count: number }>>,
    private readonly resumenOperacion?: (tenantIds: readonly string[]) => Promise<Map<string, { mercadoPago: string; completados: number }>>
  ) {}

  async operacionAdmin(tenantIds: readonly string[]) {
    return this.resumenOperacion && tenantIds.length
      ? this.resumenOperacion(tenantIds)
      : new Map<string, { mercadoPago: string; completados: number }>()
  }

  async calificaciones(tenantIds: readonly string[]) {
    return this.resumenCalificaciones && tenantIds.length
      ? this.resumenCalificaciones(tenantIds).catch(() => new Map<string, { average: number; count: number }>())
      : new Map<string, { average: number; count: number }>()
  }

  async prestador(tenantId: string) {
    const merchant = await this.application.marketplace?.store.merchant.find(tenantId)
    return merchant ? { prestadorId: merchant.merchantId, aprobado: merchant.status === 'approved' } : null
  }

  async hechos(tenantId: string): Promise<HechosPrestador> {
    const [prestador, publicaciones, verificado, trabajosCompletados] = await Promise.all([
      this.prestador(tenantId),
      this.application.marketplace?.store.listings.forTenant(tenantId) ?? Promise.resolve([]),
      this.application.identity ? this.application.identity.identidadVerificada(tenantId).catch(() => false) : Promise.resolve(false),
      this.contarCompletados(tenantId).catch(() => 0),
    ])
    const servicios: ServicioResumen[] = publicaciones
      .filter((publicacion) => publicacion.published && publicacion.kind === 'service')
      .map((publicacion) => ({
        listingId: publicacion.listingId,
        nombre: publicacion.name,
        precio: Number.isFinite(publicacion.price) ? publicacion.price : null,
        moneda: publicacion.currency,
        modalidadPrecio: publicacion.priceMode ?? null,
        horario: publicacion.workingHours.map((item) => ({ day: item.day, start: item.start, end: item.end })),
      }))
    return { aprobado: prestador?.aprobado ?? false, verificado, trabajosCompletados, servicios }
  }

  async ubicacionIdentidadVerificada(tenantId: string) {
    return this.application.identity?.ubicacionPublicaVerificada?.(tenantId) ?? null
  }

  // Two batch reads for a whole admin page: merchants (prestadores WHERE tenant_id IN ...) and
  // identity verifications (verificaciones_identidad WHERE tenant_id IN ...).
  async resumenAdmin(tenantIds: readonly string[]): Promise<Map<string, ResumenAdminPrestador>> {
    const unicos = [...new Set(tenantIds)]
    const merchantStore = this.application.marketplace?.store.merchant
    const [merchants, identidad] = await Promise.all([
      !merchantStore || unicos.length === 0
        ? Promise.resolve([])
        : merchantStore.findMany
          ? merchantStore.findMany(unicos)
          // Test doubles without a batch read.
          : Promise.all(unicos.map((tenantId) => merchantStore.find(tenantId))).then((items) => items.filter((item) => item !== null)),
      this.application.identity
        ? this.application.identity.resumenDeTenants(unicos).catch(() => new Map<string, { verificado: boolean; area: AreaDomicilioFallback | null }>())
        : Promise.resolve(new Map<string, { verificado: boolean; area: AreaDomicilioFallback | null }>()),
    ])
    const porTenant = new Map(merchants.map((merchant) => [merchant.tenantId, merchant]))
    return new Map(unicos.map((tenantId) => {
      const merchant = porTenant.get(tenantId)
      const verificacion = identidad.get(tenantId)
      return [tenantId, {
        prestador: merchant ? { prestadorId: merchant.merchantId, aprobado: merchant.status === 'approved' } : null,
        verificado: verificacion?.verificado ?? false,
        ubicacionVerificada: verificacion?.area ?? null,
      }]
    }))
  }
}

// FASE 10 admin: two batched reads for a whole page (payment accounts + completed works GROUP BY).
// Only the account STATUS leaves this function; tokens live encrypted in another table.
export function operacionAdminPrisma(client: {
  cuentaCobroPrestador: { findMany(input: { where: Record<string, unknown>; select: Record<string, boolean> }): Promise<Record<string, unknown>[]> }
  trabajo: { groupBy(input: { by: string[]; where: Record<string, unknown>; _count: Record<string, boolean> }): Promise<Record<string, unknown>[]> }
}) {
  return async (tenantIds: readonly string[]) => {
    const ids = [...new Set(tenantIds)]
    const [cuentas, completados] = await Promise.all([
      client.cuentaCobroPrestador.findMany({ where: { prestadorTenantId: { in: ids } }, select: { prestadorTenantId: true, estado: true } }),
      client.trabajo.groupBy({ by: ['prestadorTenantId'], where: { prestadorTenantId: { in: ids }, estado: 'completed' }, _count: { _all: true } }),
    ])
    const estado = new Map(cuentas.map((fila) => [String(fila['prestadorTenantId']), String(fila['estado'])]))
    const cuenta = new Map(completados.map((fila) => [String(fila['prestadorTenantId']), Number((fila['_count'] as Record<string, unknown>)['_all'])]))
    return new Map(ids.map((id) => [id, { mercadoPago: estado.get(id) ?? 'not_connected', completados: cuenta.get(id) ?? 0 }]))
  }
}

export function contarCompletadosPrisma(client: ClientePrismaDirectorio) {
  return (tenantId: string) => client.trabajo.count({ where: { prestadorTenantId: tenantId, estado: 'completed' } })
}
