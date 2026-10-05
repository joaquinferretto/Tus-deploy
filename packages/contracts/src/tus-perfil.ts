// Personal profile and geography of TUS: ONE contract shared by the API and the Web (types,
// document normalizer and field validation). Personal data here is PRIVATE: document, address and
// phone are only ever served to their owner and to an authorized platform administrator.

// ---- geography (País -> Provincia -> Localidad) ------------------------------------------------

export interface PaisDTO {
  id: string
  nombre: string
  codigoIso: string
}

export interface ProvinciaDTO {
  id: string
  paisId: string
  nombre: string
}

export interface LocalidadDTO {
  id: string
  provinciaId: string
  nombre: string
  // Reference point of the town (map centring). Never an address.
  latitud: number | null
  longitud: number | null
}

export interface CentroMapaDTO {
  latitud: number
  longitud: number
  // Where the centre comes from: the person's locality or the documented fallback.
  origen: 'localidad' | 'predeterminado'
  etiqueta: string
}

// Anonymous visitors and people without a locality: TUS operates from Corrientes Capital.
export const CENTRO_MAPA_PREDETERMINADO: CentroMapaDTO = { latitud: -27.4692, longitud: -58.8306, origen: 'predeterminado', etiqueta: 'Corrientes Capital' }

// ---- document ----------------------------------------------------------------------------------

export const TIPOS_DOCUMENTO = ['DNI', 'LC', 'LE', 'PASAPORTE'] as const
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]

export const ETIQUETA_TIPO_DOCUMENTO: Record<TipoDocumento, string> = {
  DNI: 'DNI',
  LC: 'Libreta cívica',
  LE: 'Libreta de enrolamiento',
  PASAPORTE: 'Pasaporte',
}

export type ResultadoDocumento = { ok: true; tipo: TipoDocumento; numero: string } | { ok: false; motivo: 'tipo' | 'vacio' | 'formato' }

// One normalizer for the API and the Web. DNI/LC/LE: digits only (dots and spaces removed), 6 to
// 8 digits (7 or 8 for DNI), no leading zero. Passport: 6 to 12 letters or digits, upper case.
export function normalizarDocumento(tipo: unknown, numero: unknown): ResultadoDocumento {
  if (typeof tipo !== 'string' || !(TIPOS_DOCUMENTO as readonly string[]).includes(tipo)) return { ok: false, motivo: 'tipo' }
  if (typeof numero !== 'string' || !numero.trim()) return { ok: false, motivo: 'vacio' }
  const tipoDocumento = tipo as TipoDocumento
  if (tipoDocumento === 'PASAPORTE') {
    const valor = numero.replace(/[\s.-]/gu, '').toUpperCase()
    return /^[A-Z0-9]{6,12}$/u.test(valor) ? { ok: true, tipo: tipoDocumento, numero: valor } : { ok: false, motivo: 'formato' }
  }
  if (!/^[\d\s.]+$/u.test(numero.trim())) return { ok: false, motivo: 'formato' }
  const digitos = numero.replace(/\D/gu, '')
  const minimo = tipoDocumento === 'DNI' ? 7 : 6
  if (digitos.length < minimo || digitos.length > 8 || digitos.startsWith('0')) return { ok: false, motivo: 'formato' }
  return { ok: true, tipo: tipoDocumento, numero: digitos }
}

// "12345678" -> "12.345.678" (display only).
export function formatearDocumento(tipo: TipoDocumento | null, numero: string | null): string {
  if (!numero) return ''
  return tipo === 'PASAPORTE' ? numero : numero.replace(/\B(?=(\d{3})+(?!\d))/gu, '.')
}

export function enmascararDocumento(numero: string | null): string {
  if (!numero) return ''
  return numero.length <= 3 ? '***' : `${'*'.repeat(numero.length - 3)}${numero.slice(-3)}`
}

// ---- personal profile --------------------------------------------------------------------------

export interface ResidenciaDTO {
  paisId: string
  paisNombre: string
  provinciaId: string
  provinciaNombre: string
  localidadId: string
  localidadNombre: string
  calle: string
  numero: string
  pisoDepto: string | null
  codigoPostal: string
}

export interface PerfilPersonalDTO {
  cuentaId: string
  email: string
  emailVerificado: boolean
  nombreVisible: string
  nombre: string | null
  apellido: string | null
  tipoDocumento: TipoDocumento | null
  numeroDocumento: string | null
  // Identity phone: verified by a WhatsApp challenge started by the person (never edited here).
  telefono: { verificado: boolean; numero: string | null; pendiente: string | null }
  // Selected locality even when the address is still incomplete.
  ubicacion: { paisId: string; provinciaId: string; localidadId: string } | null
  residencia: ResidenciaDTO | null
  perfilCompleto: boolean
  // Required fields still missing (empty when the profile is complete).
  faltantes: CampoPerfil[]
  centroMapa: CentroMapaDTO
}

export const CAMPOS_PERFIL = ['nombre', 'apellido', 'tipoDocumento', 'numeroDocumento', 'localidadId', 'calle', 'numero', 'pisoDepto', 'codigoPostal'] as const
export type CampoPerfil = (typeof CAMPOS_PERFIL)[number]

export interface ActualizarPerfilPersonal {
  nombre: string
  apellido: string
  tipoDocumento: TipoDocumento
  numeroDocumento: string
  localidadId: string
  calle: string
  numero: string
  pisoDepto?: string | null
  codigoPostal: string
}

export type ErroresPerfil = Partial<Record<CampoPerfil, string>>

const texto = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '')

// The name or the last name of a person. Unicode letters with their marks (José, Muñoz, Ñandú),
// words separated by ONE space, apostrophe or hyphen (María José, O'Connor, Pérez-Gómez), an
// optional period after a word (Ma. José); 2 to 60 characters; never a digit, never a symbol,
// never punctuation alone or doubled. The apostrophe a phone keyboard writes (U+2019 and its
// look-alikes) is the same apostrophe. Returns the normalized text, or null.
const APOSTROFES = /[\u2019\u2018\u02BC\u00B4`]/gu
const PALABRAS_NOMBRE = /^[\p{L}\p{M}]+\.?(?:[ '-][\p{L}\p{M}]+\.?)*$/u
export const LARGO_NOMBRE_PERSONA = { min: 2, max: 60 } as const
export function normalizarNombrePersona(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const nombre = value.normalize('NFC').replace(APOSTROFES, "'").replace(/\s+/gu, ' ').trim()
  const largo = [...nombre].length
  if (largo < LARGO_NOMBRE_PERSONA.min || largo > LARGO_NOMBRE_PERSONA.max || !/^\p{L}/u.test(nombre) || !PALABRAS_NOMBRE.test(nombre)) return null
  return nombre
}

export type ResultadoPerfil = { ok: true; valor: ActualizarPerfilPersonal & { pisoDepto: string | null } } | { ok: false; errores: ErroresPerfil }

export const CAMPOS_IDENTIDAD = ['nombre', 'apellido', 'tipoDocumento', 'numeroDocumento'] as const
export type CampoIdentidad = (typeof CAMPOS_IDENTIDAD)[number]
export type ErroresIdentidad = Partial<Record<CampoIdentidad, string>>
export interface IdentidadPersonal {
  nombre: string
  apellido: string
  tipoDocumento: TipoDocumento
  numeroDocumento: string
}
export type ResultadoIdentidad = { ok: true; valor: IdentidadPersonal } | { ok: false; errores: ErroresIdentidad }

// The identity of a person: first name, last name and document, validated as ONE set (never a
// name without its document). Names: Unicode letters, accents, ñ, inner spaces, apostrophe and
// hyphen ("María José", "O'Connor", "Pérez-Gómez"), 2 to 60 characters, never a digit; outer and
// repeated spaces are normalized. The document follows the rule of ITS type (normalizarDocumento).
// The same function runs in the Web form and in the API (the API is the authority).
export function validarIdentidadPersonal(input: Record<string, unknown>): ResultadoIdentidad {
  const errores: ErroresIdentidad = {}
  const nombre = normalizarNombrePersona(input['nombre']) ?? ''
  const apellido = normalizarNombrePersona(input['apellido']) ?? ''
  if (!nombre) errores.nombre = 'Ingresá el nombre: solo letras, de 2 a 60 caracteres.'
  if (!apellido) errores.apellido = 'Ingresá el apellido: solo letras, de 2 a 60 caracteres.'
  const documento = normalizarDocumento(input['tipoDocumento'], input['numeroDocumento'])
  if (!documento.ok) {
    if (documento.motivo === 'tipo') errores.tipoDocumento = 'Elegí el tipo de documento.'
    else errores.numeroDocumento = documento.motivo === 'vacio' ? 'Ingresá el número de documento.' : 'El número de documento no es válido para ese tipo.'
  }
  if (Object.keys(errores).length > 0 || !documento.ok) return { ok: false, errores }
  return { ok: true, valor: { nombre, apellido, tipoDocumento: documento.tipo, numeroDocumento: documento.numero } }
}

// Same validation in the Web form and in the API (the API is the authority and repeats it).
export function validarPerfilPersonal(input: Record<string, unknown>): ResultadoPerfil {
  const errores: ErroresPerfil = {}
  const nombre = normalizarNombrePersona(input['nombre']) ?? ''
  const apellido = normalizarNombrePersona(input['apellido']) ?? ''
  if (!nombre) errores.nombre = 'Ingresá tu nombre (2 a 60 letras).'
  if (!apellido) errores.apellido = 'Ingresá tu apellido (2 a 60 letras).'
  const documento = normalizarDocumento(input['tipoDocumento'], input['numeroDocumento'])
  if (!documento.ok) {
    if (documento.motivo === 'tipo') errores.tipoDocumento = 'Elegí el tipo de documento.'
    else errores.numeroDocumento = documento.motivo === 'vacio' ? 'Ingresá el número de documento.' : 'El número de documento no es válido para ese tipo.'
  }
  const localidadId = texto(input['localidadId'])
  if (!/^[A-Za-z0-9._:-]{2,120}$/u.test(localidadId)) errores.localidadId = 'Elegí tu localidad.'
  const calle = texto(input['calle'])
  if (calle.length < 2 || calle.length > 120) errores.calle = 'Ingresá la calle (2 a 120 caracteres).'
  const numero = texto(input['numero']).toUpperCase()
  if (!/^(S\/N|[0-9]{1,6}[A-Z]?)$/u.test(numero)) errores.numero = 'Ingresá la altura (por ejemplo 1234) o S/N.'
  const pisoDepto = texto(input['pisoDepto'])
  if (pisoDepto.length > 30) errores.pisoDepto = 'Hasta 30 caracteres.'
  const codigoPostal = texto(input['codigoPostal']).replace(/\s/gu, '').toUpperCase()
  if (!/^([0-9]{4}|[A-Z][0-9]{4}[A-Z]{3})$/u.test(codigoPostal)) errores.codigoPostal = 'Ingresá el código postal (por ejemplo 3400).'
  if (Object.keys(errores).length > 0 || !documento.ok) return { ok: false, errores }
  return { ok: true, valor: { nombre, apellido, tipoDocumento: documento.tipo, numeroDocumento: documento.numero, localidadId, calle, numero, pisoDepto: pisoDepto || null, codigoPostal } }
}

// ---- session capabilities ----------------------------------------------------------------------

// What the account can really do, decided by the API from the session (never from local data).
export interface CapacidadesCuentaDTO {
  platformAdmin: boolean
  provider: boolean
  profileComplete: boolean
  // A platform administration account that is not a provider is not asked for a personal profile.
  profileRequired: boolean
  mapCenter: CentroMapaDTO
}

// ---- administration of users -------------------------------------------------------------------

export interface FiltrosUsuariosAdmin {
  q?: string
  rol?: 'admin' | 'prestador' | 'cliente' | ''
  estado?: 'active' | 'suspended' | ''
  telefono?: 'verificado' | 'pendiente' | 'sin' | ''
  perfil?: 'completo' | 'incompleto' | ''
  paisId?: string
  provinciaId?: string
  localidadId?: string
  page?: number
  pageSize?: number
}

export interface UsuarioAdminDTO {
  id: string
  nombre: string
  email: string
  estado: string
  verificado: boolean
  administrada: boolean
  roles: ('admin' | 'prestador' | 'cliente')[]
  creadaEn: string
  telefono: { verificado: boolean; numero: string | null; verificadoEn: string | null; pendiente: string | null }
  documento: { tipo: TipoDocumento; numero: string } | null
  perfilCompleto: boolean
  ubicacion: { localidad: string; provincia: string } | null
}

export interface PaginaUsuariosAdmin {
  items: UsuarioAdminDTO[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PerfilUsuarioAdminDTO {
  nombre: string | null
  apellido: string | null
  documento: { tipo: TipoDocumento; numero: string } | null
  residencia: ResidenciaDTO | null
  perfilCompleto: boolean
  perfilActualizadoEn: string | null
}
