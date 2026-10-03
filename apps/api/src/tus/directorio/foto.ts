import { createHash } from 'node:crypto'

import { detectarTipoImagen, limpiarMetadataImagen, type TipoImagenDocumento } from '../identidad/documentos.ts'

// Profile photo of a provider (the avatar of the directory, the map and the public profile).
//
// The file is UNTRUSTED: the declared Content-Type and the file name are ignored. Only JPEG, PNG
// and WebP are accepted, detected by magic bytes (so SVG, GIF, HTML or a renamed file are not);
// the structure is walked and re-emitted without metadata (EXIF/GPS, XMP, text); the dimensions
// are read from the image header and bounded, which also refuses a small file that would expand
// into a huge bitmap in whoever decodes it (TUS never decodes it). The bytes are stored in
// PostgreSQL, one row per profile: there is no file name, no path and no public bucket, and a new
// photo replaces the previous one.

export const TAMANO_MAXIMO_FOTO = 2 * 1024 * 1024
export const LADO_MINIMO_FOTO = 96
export const LADO_MAXIMO_FOTO = 4096
// 4096 x 4096 fits; anything that would need more pixels than this is refused.
export const PIXELES_MAXIMOS_FOTO = 16_777_216

export type CodigoFoto = 'PHOTO_EMPTY' | 'PHOTO_TOO_LARGE' | 'PHOTO_TYPE_NOT_ALLOWED' | 'PHOTO_CORRUPT' | 'PHOTO_DIMENSIONS' | 'PHOTO_ANIMATED'

export class ErrorFotoPerfil extends Error {
  constructor(readonly code: CodigoFoto) {
    super(code)
  }
}

export interface FotoPerfil {
  perfilId: string
  tipoMime: TipoImagenDocumento
  tamanoBytes: number
  ancho: number
  alto: number
  sha256: string
  contenido: Buffer
  actualizadaEn: number
}

export interface AlmacenFotosPerfil {
  // Stores the photo of the profile (replacing the previous one) and records its hash on the
  // profile, atomically.
  guardar(foto: FotoPerfil): Promise<void>
  // Removes it; false when there was none.
  quitar(perfilId: string): Promise<boolean>
  obtener(perfilId: string): Promise<FotoPerfil | null>
}

const u24 = (bytes: Buffer, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)

// Width and height as declared by the image header (no pixel is decoded).
export function dimensionesImagen(bytes: Buffer, tipo: TipoImagenDocumento): { ancho: number; alto: number; animada: boolean } | null {
  if (tipo === 'image/png') {
    if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null
    // An APNG declares its animation in an acTL chunk before the image data.
    return { ancho: bytes.readUInt32BE(16), alto: bytes.readUInt32BE(20), animada: bytes.subarray(0, Math.min(bytes.length, 4096)).includes('acTL', 24, 'latin1') }
  }
  if (tipo === 'image/jpeg') {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null
      const marker = bytes[offset + 1]!
      if (marker === 0xff) {
        offset += 1
        continue
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
        continue
      }
      const length = bytes.readUInt16BE(offset + 2)
      if (length < 2) return null
      // SOF0..SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { alto: bytes.readUInt16BE(offset + 5), ancho: bytes.readUInt16BE(offset + 7), animada: false }
      if (marker === 0xda || marker === 0xd9) return null
      offset += 2 + length
    }
    return null
  }
  // WebP: RIFF....WEBP then the first chunk.
  if (bytes.length < 30) return null
  const chunk = bytes.toString('latin1', 12, 16)
  const data = 20
  if (chunk === 'VP8X') return { ancho: u24(bytes, data + 4) + 1, alto: u24(bytes, data + 7) + 1, animada: (bytes[data]! & 0x02) !== 0 }
  if (chunk === 'VP8L') {
    if (bytes[data] !== 0x2f) return null
    const bits = bytes.readUInt32LE(data + 1)
    return { ancho: (bits & 0x3fff) + 1, alto: ((bits >>> 14) & 0x3fff) + 1, animada: false }
  }
  if (chunk === 'VP8 ') {
    if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null
    return { ancho: bytes.readUInt16LE(data + 6) & 0x3fff, alto: bytes.readUInt16LE(data + 8) & 0x3fff, animada: false }
  }
  return null
}

// Validates and sanitizes an uploaded photo. Throws ErrorFotoPerfil with a fixed code.
export function prepararFotoPerfil(entrada: unknown): Omit<FotoPerfil, 'perfilId' | 'actualizadaEn'> {
  if (!Buffer.isBuffer(entrada) || entrada.length === 0) throw new ErrorFotoPerfil('PHOTO_EMPTY')
  if (entrada.length > TAMANO_MAXIMO_FOTO) throw new ErrorFotoPerfil('PHOTO_TOO_LARGE')
  const tipoMime = detectarTipoImagen(entrada)
  if (!tipoMime) throw new ErrorFotoPerfil('PHOTO_TYPE_NOT_ALLOWED')
  let contenido: Buffer
  try {
    contenido = limpiarMetadataImagen(entrada, tipoMime)
  } catch {
    throw new ErrorFotoPerfil('PHOTO_CORRUPT')
  }
  const dimensiones = dimensionesImagen(contenido, tipoMime)
  if (!dimensiones) throw new ErrorFotoPerfil('PHOTO_CORRUPT')
  if (dimensiones.animada) throw new ErrorFotoPerfil('PHOTO_ANIMATED')
  const { ancho, alto } = dimensiones
  if (ancho < LADO_MINIMO_FOTO || alto < LADO_MINIMO_FOTO || ancho > LADO_MAXIMO_FOTO || alto > LADO_MAXIMO_FOTO || ancho * alto > PIXELES_MAXIMOS_FOTO)
    throw new ErrorFotoPerfil('PHOTO_DIMENSIONS')
  if (contenido.length === 0 || contenido.length > TAMANO_MAXIMO_FOTO) throw new ErrorFotoPerfil('PHOTO_TOO_LARGE')
  return { tipoMime, tamanoBytes: contenido.length, ancho, alto, sha256: createHash('sha256').update(contenido).digest('hex'), contenido }
}

// Public path of a profile's photo. The version tag only busts caches; it grants nothing.
export function rutaFotoPerfil(perfilId: string, sha256: string | null | undefined): string | null {
  return sha256 && /^[a-f0-9]{64}$/u.test(sha256) && /^[A-Za-z0-9-]{1,64}$/u.test(perfilId) ? `/tus/v1/public/prestadores/${perfilId}/foto?v=${sha256.slice(0, 16)}` : null
}

// ---- en memoria (tests y composición local) -------------------------------------------------

export class AlmacenFotosPerfilEnMemoria implements AlmacenFotosPerfil {
  readonly fotos = new Map<string, FotoPerfil>()

  // `marcar` records the hash on the profile store, as the database does in the same transaction.
  constructor(private readonly marcar: (perfilId: string, sha256: string | null) => void = () => undefined) {}

  async guardar(foto: FotoPerfil) {
    this.fotos.set(foto.perfilId, { ...foto, contenido: Buffer.from(foto.contenido) })
    this.marcar(foto.perfilId, foto.sha256)
  }

  async quitar(perfilId: string) {
    const habia = this.fotos.delete(perfilId)
    this.marcar(perfilId, null)
    return habia
  }

  async obtener(perfilId: string) {
    const foto = this.fotos.get(perfilId)
    return foto ? { ...foto, contenido: Buffer.from(foto.contenido) } : null
  }
}

// ---- PostgreSQL (fotos_perfil_prestador + perfiles_publicos_prestador.foto_sha256) -----------

type Fila = Record<string, unknown>

export interface ClientePrismaFotosPerfil {
  fotoPerfilPrestador: {
    upsert(input: { where: Fila; create: Fila; update: Fila }): Promise<Fila>
    deleteMany(input: { where: Fila }): Promise<{ count: number }>
    findUnique(input: { where: Fila }): Promise<Fila | null>
  }
  perfilPublicoPrestador: { updateMany(input: { where: Fila; data: Fila }): Promise<{ count: number }> }
  $transaction<T>(operation: (client: ClientePrismaFotosPerfil) => Promise<T>): Promise<T>
}

export class AlmacenFotosPerfilPrisma implements AlmacenFotosPerfil {
  constructor(private readonly client: ClientePrismaFotosPerfil) {}

  async guardar(foto: FotoPerfil) {
    const datos = { tipoMime: foto.tipoMime, tamanoBytes: foto.tamanoBytes, ancho: foto.ancho, alto: foto.alto, sha256: foto.sha256, contenido: foto.contenido, fechaActualizacion: new Date(foto.actualizadaEn) }
    // One row per profile: the upsert overwrites the previous bytes, so no old photo is left behind.
    await this.client.$transaction(async (tx) => {
      await tx.fotoPerfilPrestador.upsert({ where: { perfilId: foto.perfilId }, create: { perfilId: foto.perfilId, ...datos }, update: datos })
      await tx.perfilPublicoPrestador.updateMany({ where: { id: foto.perfilId }, data: { fotoSha256: foto.sha256 } })
    })
  }

  async quitar(perfilId: string) {
    return this.client.$transaction(async (tx) => {
      const { count } = await tx.fotoPerfilPrestador.deleteMany({ where: { perfilId } })
      await tx.perfilPublicoPrestador.updateMany({ where: { id: perfilId }, data: { fotoSha256: null } })
      return count > 0
    })
  }

  async obtener(perfilId: string): Promise<FotoPerfil | null> {
    const fila = await this.client.fotoPerfilPrestador.findUnique({ where: { perfilId } })
    if (!fila) return null
    const tipo = String(fila['tipoMime'])
    if (tipo !== 'image/jpeg' && tipo !== 'image/png' && tipo !== 'image/webp') return null
    const tipoMime: TipoImagenDocumento = tipo
    return {
      perfilId: String(fila['perfilId']),
      tipoMime,
      tamanoBytes: Number(fila['tamanoBytes']),
      ancho: Number(fila['ancho']),
      alto: Number(fila['alto']),
      sha256: String(fila['sha256']),
      contenido: Buffer.from(fila['contenido'] as Uint8Array),
      actualizadaEn: fila['fechaActualizacion'] instanceof Date ? fila['fechaActualizacion'].getTime() : Number(fila['fechaActualizacion']),
    }
  }
}
