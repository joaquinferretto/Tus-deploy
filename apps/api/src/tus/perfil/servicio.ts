import {
  CENTRO_MAPA_PREDETERMINADO,
  enmascararTelefono,
  validarPerfilPersonal,
  type CampoPerfil,
  type CentroMapaDTO,
  type ErroresPerfil,
  type LocalidadDTO,
  type PaisDTO,
  type PerfilPersonalDTO,
  type PerfilUsuarioAdminDTO,
  type ProvinciaDTO,
  type ResidenciaDTO,
} from '@factory/contracts'

import type { AlmacenPerfil, LocalidadGeo, PerfilAlmacenado } from './almacen.ts'

// PERFIL-GEO-01. Personal profile of the person behind an account: names, document and residence.
// It is PERSONAL data (private); the professional profile of a provider lives in the directory and
// is a different thing. The account is always the one of the session: nothing here takes an
// account id from a request body.

export type ResultadoActualizarPerfil =
  | { ok: true; perfil: PerfilPersonalDTO }
  | { ok: false; code: 'INVALID_PROFILE'; errores: ErroresPerfil }
  | { ok: false; code: 'DOCUMENT_ALREADY_REGISTERED' | 'NOT_FOUND' }

const REQUERIDOS: { campo: CampoPerfil; valor: (perfil: PerfilAlmacenado) => string | null }[] = [
  { campo: 'nombre', valor: (perfil) => perfil.firstName },
  { campo: 'apellido', valor: (perfil) => perfil.lastName },
  { campo: 'tipoDocumento', valor: (perfil) => perfil.documentType },
  { campo: 'numeroDocumento', valor: (perfil) => perfil.documentNumber },
  { campo: 'localidadId', valor: (perfil) => perfil.localidadId },
  { campo: 'calle', valor: (perfil) => perfil.addressStreet },
  { campo: 'numero', valor: (perfil) => perfil.addressNumber },
  { campo: 'codigoPostal', valor: (perfil) => perfil.postalCode },
]

export class ServicioPerfil {
  constructor(
    private readonly almacen: AlmacenPerfil,
    private readonly now: () => number = Date.now
  ) {}

  paises(): Promise<PaisDTO[]> {
    return this.almacen.paises()
  }

  provincias(paisId: string): Promise<ProvinciaDTO[]> {
    return this.almacen.provincias(paisId)
  }

  localidades(provinciaId: string, q: string): Promise<LocalidadDTO[]> {
    return this.almacen.localidades(provinciaId, q)
  }

  async obtener(accountId: string): Promise<PerfilPersonalDTO | null> {
    const perfil = await this.almacen.perfil(accountId)
    if (!perfil) return null
    const localidad = perfil.localidadId ? await this.almacen.localidad(perfil.localidadId) : null
    return vista(perfil, localidad)
  }

  // Map centre of the person: the reference point of their locality. Without a locality (or for a
  // visitor) the documented default applies. The browser's GPS is never used in its place.
  async centroMapa(accountId: string | null): Promise<CentroMapaDTO> {
    const perfil = accountId ? await this.almacen.perfil(accountId) : null
    const localidad = perfil?.localidadId ? await this.almacen.localidad(perfil.localidadId) : null
    return centro(localidad)
  }

  async estado(accountId: string): Promise<{ profileComplete: boolean; mapCenter: CentroMapaDTO }> {
    const perfil = await this.almacen.perfil(accountId)
    const localidad = perfil?.localidadId ? await this.almacen.localidad(perfil.localidadId) : null
    return { profileComplete: perfil?.profileComplete === true, mapCenter: centro(localidad) }
  }

  async actualizar(accountId: string, body: Record<string, unknown>): Promise<ResultadoActualizarPerfil> {
    const validado = validarPerfilPersonal(body)
    if (!validado.ok) return { ok: false, code: 'INVALID_PROFILE', errores: validado.errores }
    const datos = validado.valor
    // The locality must exist in the administered catalog, be active and hang from a province.
    const localidad = await this.almacen.localidad(datos.localidadId)
    if (!localidad) return { ok: false, code: 'INVALID_PROFILE', errores: { localidadId: 'Elegí una localidad de la lista.' } }
    const resultado = await this.almacen.guardar(accountId, {
      displayName: `${datos.nombre} ${datos.apellido}`.slice(0, 120),
      firstName: datos.nombre,
      lastName: datos.apellido,
      documentType: datos.tipoDocumento,
      documentNumber: datos.numeroDocumento,
      localidadId: localidad.id,
      addressStreet: datos.calle,
      addressNumber: datos.numero,
      addressUnit: datos.pisoDepto,
      postalCode: datos.codigoPostal,
      // Every required field was just validated: the profile is complete.
      profileComplete: true,
      profileUpdatedAt: new Date(this.now()).toISOString(),
    })
    if (resultado === 'documento_duplicado') return { ok: false, code: 'DOCUMENT_ALREADY_REGISTERED' }
    if (resultado === 'no_encontrado') return { ok: false, code: 'NOT_FOUND' }
    const perfil = await this.obtener(accountId)
    return perfil ? { ok: true, perfil } : { ok: false, code: 'NOT_FOUND' }
  }

  // Platform administration (authorized by the HTTP layer): the full personal data of an account.
  async perfilAdmin(accountId: string): Promise<PerfilUsuarioAdminDTO | null> {
    const perfil = await this.almacen.perfil(accountId)
    if (!perfil) return null
    const localidad = perfil.localidadId ? await this.almacen.localidad(perfil.localidadId) : null
    return {
      nombre: perfil.firstName,
      apellido: perfil.lastName,
      documento: perfil.documentType && perfil.documentNumber ? { tipo: perfil.documentType, numero: perfil.documentNumber } : null,
      residencia: residencia(perfil, localidad),
      perfilCompleto: perfil.profileComplete,
      perfilActualizadoEn: perfil.profileUpdatedAt,
    }
  }
}

function centro(localidad: LocalidadGeo | null): CentroMapaDTO {
  if (!localidad || localidad.latitud === null || localidad.longitud === null) return CENTRO_MAPA_PREDETERMINADO
  return { latitud: localidad.latitud, longitud: localidad.longitud, origen: 'localidad', etiqueta: localidad.nombre }
}

function residencia(perfil: PerfilAlmacenado, localidad: LocalidadGeo | null): ResidenciaDTO | null {
  if (!localidad || !perfil.addressStreet || !perfil.addressNumber || !perfil.postalCode) return null
  return {
    paisId: localidad.paisId,
    paisNombre: localidad.paisNombre,
    provinciaId: localidad.provinciaId,
    provinciaNombre: localidad.provinciaNombre,
    localidadId: localidad.id,
    localidadNombre: localidad.nombre,
    calle: perfil.addressStreet,
    numero: perfil.addressNumber,
    pisoDepto: perfil.addressUnit,
    codigoPostal: perfil.postalCode,
  }
}

function vista(perfil: PerfilAlmacenado, localidad: LocalidadGeo | null): PerfilPersonalDTO {
  return {
    cuentaId: perfil.accountId,
    email: perfil.email,
    emailVerificado: perfil.emailVerified,
    nombreVisible: perfil.displayName,
    nombre: perfil.firstName,
    apellido: perfil.lastName,
    tipoDocumento: perfil.documentType,
    numeroDocumento: perfil.documentNumber,
    telefono: {
      verificado: Boolean(perfil.phoneNumber),
      numero: perfil.phoneNumber ? enmascararTelefono(perfil.phoneNumber) : null,
      pendiente: perfil.phonePending ? enmascararTelefono(perfil.phonePending) : null,
    },
    ubicacion: localidad ? { paisId: localidad.paisId, provinciaId: localidad.provinciaId, localidadId: localidad.id } : null,
    residencia: residencia(perfil, localidad),
    perfilCompleto: perfil.profileComplete,
    faltantes: perfil.profileComplete ? [] : REQUERIDOS.filter((item) => !item.valor(perfil)).map((item) => item.campo),
    centroMapa: centro(localidad),
  }
}
