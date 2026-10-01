import type { LocalidadDTO, PaisDTO, ProvinciaDTO, TipoDocumento } from '@factory/contracts'

// PERFIL-GEO-01. Storage of the personal profile (on the person, "User") and of the normalized
// geography (paises -> provincias -> localidades). The same semantics in memory and in PostgreSQL.

export interface LocalidadGeo {
  id: string
  nombre: string
  provinciaId: string
  provinciaNombre: string
  paisId: string
  paisNombre: string
  latitud: number | null
  longitud: number | null
}

export interface PerfilAlmacenado {
  accountId: string
  email: string
  emailVerified: boolean
  displayName: string
  firstName: string | null
  lastName: string | null
  documentType: TipoDocumento | null
  documentNumber: string | null
  localidadId: string | null
  addressStreet: string | null
  addressNumber: string | null
  addressUnit: string | null
  postalCode: string | null
  profileComplete: boolean
  profileUpdatedAt: string | null
  phoneNumber: string | null
  phonePending: string | null
}

export interface DatosPerfil {
  displayName: string
  firstName: string
  lastName: string
  documentType: TipoDocumento
  documentNumber: string
  localidadId: string
  addressStreet: string
  addressNumber: string
  addressUnit: string | null
  postalCode: string
  profileComplete: boolean
  profileUpdatedAt: string
}

export interface AlmacenPerfil {
  paises(): Promise<PaisDTO[]>
  provincias(paisId: string): Promise<ProvinciaDTO[]>
  // Active localities of a province that have their normalized link (never the legacy text).
  localidades(provinciaId: string, q: string): Promise<LocalidadDTO[]>
  localidad(id: string): Promise<LocalidadGeo | null>
  perfil(accountId: string): Promise<PerfilAlmacenado | null>
  // 'documento_duplicado': another person already has that document (UNIQUE in the database).
  guardar(accountId: string, datos: DatosPerfil): Promise<'ok' | 'documento_duplicado' | 'no_encontrado'>
}

// ---- in memory (tests / local) -------------------------------------------------------------------

export class AlmacenPerfilEnMemoria implements AlmacenPerfil {
  readonly perfiles = new Map<string, PerfilAlmacenado>()

  constructor(
    private readonly geografia: {
      paises: PaisDTO[]
      provincias: ProvinciaDTO[]
      localidades: (LocalidadDTO & { activo?: boolean })[]
    }
  ) {}

  async paises() {
    return this.geografia.paises.map((pais) => ({ ...pais }))
  }

  async provincias(paisId: string) {
    return this.geografia.provincias.filter((provincia) => provincia.paisId === paisId).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }

  async localidades(provinciaId: string, q: string) {
    const termino = q.toLowerCase()
    return this.geografia.localidades
      .filter((localidad) => localidad.activo !== false && localidad.provinciaId === provinciaId && (!termino || localidad.nombre.toLowerCase().includes(termino)))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .map(({ id, provinciaId: provincia, nombre, latitud, longitud }) => ({ id, provinciaId: provincia, nombre, latitud, longitud }))
  }

  async localidad(id: string): Promise<LocalidadGeo | null> {
    const localidad = this.geografia.localidades.find((item) => item.id === id && item.activo !== false)
    const provincia = localidad ? this.geografia.provincias.find((item) => item.id === localidad.provinciaId) : undefined
    const pais = provincia ? this.geografia.paises.find((item) => item.id === provincia.paisId) : undefined
    if (!localidad || !provincia || !pais) return null
    return { id: localidad.id, nombre: localidad.nombre, provinciaId: provincia.id, provinciaNombre: provincia.nombre, paisId: pais.id, paisNombre: pais.nombre, latitud: localidad.latitud, longitud: localidad.longitud }
  }

  async perfil(accountId: string) {
    const perfil = this.perfiles.get(accountId)
    return perfil ? { ...perfil } : null
  }

  async guardar(accountId: string, datos: DatosPerfil) {
    const actual = this.perfiles.get(accountId)
    if (!actual) return 'no_encontrado' as const
    const duplicado = [...this.perfiles.values()].some((otro) => otro.accountId !== accountId && otro.documentType === datos.documentType && otro.documentNumber === datos.documentNumber)
    if (duplicado) return 'documento_duplicado' as const
    this.perfiles.set(accountId, { ...actual, ...datos })
    return 'ok' as const
  }
}

// ---- PostgreSQL ----------------------------------------------------------------------------------

type Fila = Record<string, unknown>

export interface ClientePrismaPerfil {
  pais: { findMany(input: { where?: Fila; orderBy?: Fila | Fila[] }): Promise<Fila[]> }
  provincia: { findMany(input: { where?: Fila; orderBy?: Fila | Fila[] }): Promise<Fila[]> }
  localidad: {
    findMany(input: { where?: Fila; orderBy?: Fila | Fila[]; take?: number }): Promise<Fila[]>
    findFirst(input: { where?: Fila; include?: Fila }): Promise<Fila | null>
  }
  account: { findFirst(input: { where?: Fila; include?: Fila }): Promise<Fila | null> }
  user: { update(input: { where: Fila; data: Fila }): Promise<Fila> }
}

const texto = (value: unknown) => (value === null || value === undefined ? null : String(value))
const numero = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export class AlmacenPerfilPrisma implements AlmacenPerfil {
  constructor(private readonly client: ClientePrismaPerfil) {}

  async paises(): Promise<PaisDTO[]> {
    const filas = await this.client.pais.findMany({ where: { activo: true }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] })
    return filas.map((fila) => ({ id: String(fila['id']), nombre: String(fila['nombre']), codigoIso: String(fila['codigoIso']) }))
  }

  async provincias(paisId: string): Promise<ProvinciaDTO[]> {
    const filas = await this.client.provincia.findMany({ where: { paisId, activo: true }, orderBy: [{ nombre: 'asc' }] })
    return filas.map((fila) => ({ id: String(fila['id']), paisId: String(fila['paisId']), nombre: String(fila['nombre']) }))
  }

  async localidades(provinciaId: string, q: string): Promise<LocalidadDTO[]> {
    const filas = await this.client.localidad.findMany({
      where: { provinciaId, activo: true, ...(q ? { nombre: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: [{ nombre: 'asc' }],
      take: 500,
    })
    return filas.map((fila) => ({ id: String(fila['id']), provinciaId: String(fila['provinciaId']), nombre: String(fila['nombre']), latitud: numero(fila['latitud']), longitud: numero(fila['longitud']) }))
  }

  async localidad(id: string): Promise<LocalidadGeo | null> {
    const fila = await this.client.localidad.findFirst({ where: { id, activo: true, provinciaId: { not: null } }, include: { provinciaRef: { include: { pais: true } } } })
    const provincia = fila?.['provinciaRef'] as Fila | undefined
    const pais = provincia?.['pais'] as Fila | undefined
    if (!fila || !provincia || !pais) return null
    return {
      id: String(fila['id']),
      nombre: String(fila['nombre']),
      provinciaId: String(provincia['id']),
      provinciaNombre: String(provincia['nombre']),
      paisId: String(pais['id']),
      paisNombre: String(pais['nombre']),
      latitud: numero(fila['latitud']),
      longitud: numero(fila['longitud']),
    }
  }

  async perfil(accountId: string): Promise<PerfilAlmacenado | null> {
    const fila = await this.client.account.findFirst({ where: { id: accountId }, include: { user: true } })
    const user = fila?.['user'] as Fila | undefined
    if (!fila || !user) return null
    const actualizado = user['profileUpdatedAt']
    return {
      accountId: String(fila['id']),
      email: String(user['email']),
      emailVerified: fila['emailVerifiedAt'] != null,
      displayName: String(user['displayName'] ?? ''),
      firstName: texto(user['firstName']),
      lastName: texto(user['lastName']),
      documentType: texto(user['documentType']) as PerfilAlmacenado['documentType'],
      documentNumber: texto(user['documentNumber']),
      localidadId: texto(user['localidadId']),
      addressStreet: texto(user['addressStreet']),
      addressNumber: texto(user['addressNumber']),
      addressUnit: texto(user['addressUnit']),
      postalCode: texto(user['postalCode']),
      profileComplete: user['profileComplete'] === true,
      profileUpdatedAt: actualizado instanceof Date ? actualizado.toISOString() : null,
      phoneNumber: texto(user['phoneNumber']),
      phonePending: texto(user['phonePending']),
    }
  }

  async guardar(accountId: string, datos: DatosPerfil) {
    const fila = await this.client.account.findFirst({ where: { id: accountId } })
    if (!fila) return 'no_encontrado' as const
    try {
      await this.client.user.update({ where: { id: String(fila['userId']) }, data: { ...datos, profileUpdatedAt: new Date(datos.profileUpdatedAt) } })
      return 'ok' as const
    } catch (error) {
      // uq_user_documento: the document belongs to another person.
      if ((error as { code?: string })?.code === 'P2002') return 'documento_duplicado' as const
      throw error
    }
  }
}
