import type { TusApplicationService } from '../application/tus-application-service.ts'
import type { HechosPrestador, PerfilPublico, ServicioResumen } from './modelo.ts'
import type { OficioId } from './oficios.ts'
import type { AlmacenPerfiles, FuentesDirectorio } from './puertos.ts'

// ---- en memoria (tests y composición local) -------------------------------------------------

export class AlmacenPerfilesEnMemoria implements AlmacenPerfiles {
  readonly perfiles = new Map<string, PerfilPublico>()

  async guardar(perfil: PerfilPublico) {
    for (const [id, actual] of this.perfiles) if (actual.tenantId === perfil.tenantId && id !== perfil.id) this.perfiles.delete(id)
    this.perfiles.set(perfil.id, { ...perfil })
  }

  async porTenant(tenantId: string) {
    const found = [...this.perfiles.values()].find((perfil) => perfil.tenantId === tenantId)
    return found ? { ...found } : null
  }

  async porId(id: string) {
    const found = this.perfiles.get(id)
    return found ? { ...found } : null
  }

  async visibles(input: { oficio?: OficioId; limite: number }) {
    return [...this.perfiles.values()]
      .filter((perfil) => perfil.visible && (!input.oficio || perfil.oficio === input.oficio))
      .sort((a, b) => b.actualizadoEn - a.actualizadoEn)
      .slice(0, input.limite)
      .map((perfil) => ({ ...perfil }))
  }
}

// ---- PostgreSQL (perfiles_publicos_prestador) ------------------------------------------------

type Fila = Record<string, unknown>

interface DelegadoPerfiles {
  findFirst(input: { where: Fila }): Promise<Fila | null>
  findMany(input: { where: Fila; orderBy?: Fila; take?: number }): Promise<Fila[]>
  upsert(input: { where: Fila; create: Fila; update: Fila }): Promise<Fila>
}

export interface ClientePrismaDirectorio {
  perfilPublicoPrestador: DelegadoPerfiles
  trabajo: { count(input: { where: Fila }): Promise<number> }
}

const desdeFecha = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value))

function desdeFila(fila: Fila): PerfilPublico {
  return {
    id: String(fila['id']),
    tenantId: String(fila['tenantId']),
    prestadorId: String(fila['prestadorId']),
    nombrePublico: String(fila['nombrePublico']),
    oficio: fila['oficio'] as OficioId,
    zona: String(fila['zona']),
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
      descripcion: perfil.descripcion,
      aniosExperiencia: perfil.aniosExperiencia,
      visible: perfil.visible,
      fechaActualizacion: new Date(perfil.actualizadoEn),
    }
    await this.client.perfilPublicoPrestador.upsert({
      where: { tenantId_prestadorId: { tenantId: perfil.tenantId, prestadorId: perfil.prestadorId } },
      create: { id: perfil.id, tenantId: perfil.tenantId, prestadorId: perfil.prestadorId, ...datos, fechaCreacion: new Date(perfil.creadoEn) },
      update: datos,
    })
  }

  async porTenant(tenantId: string) {
    const fila = await this.client.perfilPublicoPrestador.findFirst({ where: { tenantId } })
    return fila ? desdeFila(fila) : null
  }

  async porId(id: string) {
    const fila = await this.client.perfilPublicoPrestador.findFirst({ where: { id } })
    return fila ? desdeFila(fila) : null
  }

  async visibles(input: { oficio?: OficioId; limite: number }) {
    const filas = await this.client.perfilPublicoPrestador.findMany({
      where: { visible: true, ...(input.oficio ? { oficio: input.oficio } : {}) },
      orderBy: { fechaActualizacion: 'desc' },
      take: input.limite,
    })
    return filas.map(desdeFila)
  }
}

// ---- hechos desde los módulos existentes ------------------------------------------------------

// Marketplace (prestador aprobado y servicios publicados), identidad (verificación) y trabajos
// completados. `contarCompletados` viene de Prisma en producción y de un fake en tests.
export class FuentesDirectorioTus implements FuentesDirectorio {
  constructor(
    private readonly application: TusApplicationService,
    private readonly contarCompletados: (tenantId: string) => Promise<number>
  ) {}

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
}

export function contarCompletadosPrisma(client: ClientePrismaDirectorio) {
  return (tenantId: string) => client.trabajo.count({ where: { prestadorTenantId: tenantId, estado: 'completed' } })
}
