import { randomUUID } from 'node:crypto'

import {
  CATEGORIAS_SOLICITUD,
  LIMITES_SOLICITUD,
  nombrePublico,
  ubicacionAproximada,
  validarNuevaSolicitud,
  vistaPropia,
  vistaPublica,
  type CampoSolicitud,
  type CategoriaSolicitud,
  type SolicitudServicio,
  type VistaPropiaSolicitud,
  type VistaPublicaSolicitud,
} from './modelo.ts'
import type { AlmacenSolicitudes, CuentasSolicitudes } from './puertos.ts'

const DIA_MS = 24 * 60 * 60 * 1000

export type ResultadoSolicitud<T> =
  | ({ ok: true } & T)
  | { ok: false; code: 'INVALID_REQUEST'; fields: CampoSolicitud[] }
  | { ok: false; code: 'ACCOUNT_NOT_ALLOWED' | 'RATE_LIMITED' | 'NOT_FOUND'; fields?: undefined }

export interface DependenciasSolicitudes {
  almacen: AlmacenSolicitudes
  cuentas: CuentasSolicitudes
  now?: () => number
  newId?: () => string
}

export class ServicioSolicitudes {
  private readonly now: () => number
  private readonly newId: () => string

  constructor(private readonly deps: DependenciasSolicitudes) {
    this.now = deps.now ?? Date.now
    this.newId = deps.newId ?? randomUUID
  }

  async listarPublicas(input: { categoria?: unknown } = {}): Promise<VistaPublicaSolicitud[]> {
    const categoria = (CATEGORIAS_SOLICITUD as readonly unknown[]).includes(input.categoria) ? (input.categoria as CategoriaSolicitud) : undefined
    const solicitudes = await this.deps.almacen.listarAbiertas({
      ahora: this.now(),
      limite: LIMITES_SOLICITUD.listadoPublicoMax,
      ...(categoria ? { categoria } : {}),
    })
    return solicitudes.map(vistaPublica)
  }

  async publicar(cuentaId: string, body: Record<string, unknown>): Promise<ResultadoSolicitud<{ solicitud: VistaPropiaSolicitud }>> {
    const validacion = validarNuevaSolicitud(body)
    if (!validacion.ok) return { ok: false, code: 'INVALID_REQUEST', fields: validacion.campos }
    const cuenta = await this.deps.cuentas.getAccount(cuentaId)
    if (!cuenta || cuenta.status !== 'active' || !cuenta.emailVerifiedAt) return { ok: false, code: 'ACCOUNT_NOT_ALLOWED' }
    const ahora = this.now()
    const [recientes, abiertas] = await Promise.all([
      this.deps.almacen.contarPublicadasDesde(cuentaId, ahora - DIA_MS),
      this.deps.almacen.contarAbiertas(cuentaId, ahora),
    ])
    if (recientes >= LIMITES_SOLICITUD.publicacionesPorDia || abiertas >= LIMITES_SOLICITUD.abiertasPorCuenta) return { ok: false, code: 'RATE_LIMITED' }

    const id = this.newId()
    const punto = ubicacionAproximada(validacion.valor.zona, id)
    const solicitud: SolicitudServicio = {
      id,
      cuentaId,
      ...validacion.valor,
      nombrePublico: nombrePublico(cuenta.displayName),
      latitud: punto.lat,
      longitud: punto.lng,
      estado: 'abierta',
      creadaEn: ahora,
      actualizadaEn: ahora,
      expiraEn: ahora + LIMITES_SOLICITUD.vigenciaDias * DIA_MS,
    }
    await this.deps.almacen.guardar(solicitud)
    return { ok: true, solicitud: vistaPropia(solicitud) }
  }

  async mias(cuentaId: string): Promise<VistaPropiaSolicitud[]> {
    return (await this.deps.almacen.listarDeCuenta(cuentaId)).map(vistaPropia)
  }

  async cerrar(cuentaId: string, id: unknown): Promise<ResultadoSolicitud<object>> {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) return { ok: false, code: 'NOT_FOUND' }
    return (await this.deps.almacen.cerrar({ id, cuentaId, ahora: this.now() })) ? { ok: true } : { ok: false, code: 'NOT_FOUND' }
  }
}
