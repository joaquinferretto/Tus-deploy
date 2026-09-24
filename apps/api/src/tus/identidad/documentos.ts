import { createHash } from 'node:crypto'
import { ErrorIdentidad } from './modelo.ts'

// DNI images: JPEG, PNG or WEBP detected by magic bytes (the browser Content-Type is ignored),
// structurally parsed, and re-emitted without metadata (EXIF/GPS, XMP, IPTC, text chunks).
// Only the stripped copy is stored and processed.

export const TAMANO_MAXIMO_DOCUMENTO = 8 * 1024 * 1024
export const TAMANO_MINIMO_DOCUMENTO = 8 * 1024

export type TipoImagenDocumento = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ImagenDocumentoLimpia {
  mimeType: TipoImagenDocumento
  bytes: Buffer
  sha256: string
  removedMetadata: string[]
}

export function detectarTipoImagen(bytes: Buffer): TipoImagenDocumento | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg'
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png'
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'image/webp'
  return null
}

export function prepararImagenDocumento(input: Buffer): ImagenDocumentoLimpia {
  if (!Buffer.isBuffer(input) || input.length === 0)
    throw new ErrorIdentidad(400, 'DOCUMENT_EMPTY', 'document image is empty')
  if (input.length > TAMANO_MAXIMO_DOCUMENTO)
    throw new ErrorIdentidad(413, 'DOCUMENT_TOO_LARGE', 'document image exceeds the size limit')
  if (input.length < TAMANO_MINIMO_DOCUMENTO)
    throw new ErrorIdentidad(400, 'DOCUMENT_TOO_SMALL', 'document image is too small to be read')
  const mimeType = detectarTipoImagen(input)
  if (!mimeType)
    throw new ErrorIdentidad(
      415,
      'DOCUMENT_TYPE_NOT_ALLOWED',
      'only JPEG, PNG or WEBP images are accepted'
    )
  const result =
    mimeType === 'image/jpeg'
      ? limpiarJpeg(input)
      : mimeType === 'image/png'
        ? limpiarPng(input)
        : limpiarWebp(input)
  return {
    mimeType,
    bytes: result.bytes,
    sha256: createHash('sha256').update(result.bytes).digest('hex'),
    removedMetadata: result.removed,
  }
}

function corrupto(): never {
  throw new ErrorIdentidad(422, 'DOCUMENT_CORRUPT', 'document image is corrupt or truncated')
}

// JPEG: walk the marker segments until SOS; drop APP1 (EXIF/XMP), APP2..APP15 except APP14
// (Adobe color transform) and COM. Keeps APP0 (JFIF). Requires a final EOI marker.
function limpiarJpeg(input: Buffer): { bytes: Buffer; removed: string[] } {
  const parts: Buffer[] = [input.subarray(0, 2)]
  const removed: string[] = []
  let offset = 2
  while (offset < input.length) {
    if (input[offset] !== 0xff) corrupto()
    const marker = input[offset + 1]
    if (marker === undefined) corrupto()
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(input.subarray(offset, offset + 2))
      offset += 2
      continue
    }
    if (offset + 4 > input.length) corrupto()
    const length = input.readUInt16BE(offset + 2)
    if (length < 2 || offset + 2 + length > input.length) corrupto()
    const segment = input.subarray(offset, offset + 2 + length)
    if (marker === 0xda) {
      // Start of scan: the rest is entropy-coded data up to EOI.
      const rest = input.subarray(offset)
      if (rest.length < 4 || rest[rest.length - 2] !== 0xff || rest[rest.length - 1] !== 0xd9)
        corrupto()
      parts.push(rest)
      return { bytes: Buffer.concat(parts), removed }
    }
    const isMetadata = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe
    if (isMetadata)
      removed.push(
        marker === 0xe1 ? 'exif/xmp' : marker === 0xfe ? 'comment' : `app${marker - 0xe0}`
      )
    else parts.push(segment)
    offset += 2 + length
  }
  return corrupto()
}

const CHUNKS_PNG_METADATA = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'])

function limpiarPng(input: Buffer): { bytes: Buffer; removed: string[] } {
  const parts: Buffer[] = [input.subarray(0, 8)]
  const removed: string[] = []
  let offset = 8
  let sawEnd = false
  while (offset < input.length) {
    if (offset + 12 > input.length) corrupto()
    const length = input.readUInt32BE(offset)
    const type = input.toString('latin1', offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > input.length || !/^[A-Za-z]{4}$/u.test(type)) corrupto()
    if (CHUNKS_PNG_METADATA.has(type)) removed.push(type)
    else parts.push(input.subarray(offset, end))
    offset = end
    if (type === 'IEND') {
      sawEnd = true
      break
    }
  }
  if (!sawEnd) corrupto()
  return { bytes: Buffer.concat(parts), removed }
}

// WEBP (RIFF): drop EXIF and XMP chunks and clear the VP8X metadata flags.
function limpiarWebp(input: Buffer): { bytes: Buffer; removed: string[] } {
  const declared = input.readUInt32LE(4) + 8
  if (declared > input.length || declared < 12) corrupto()
  const chunks: Buffer[] = []
  const removed: string[] = []
  let offset = 12
  while (offset < declared) {
    if (offset + 8 > declared) corrupto()
    const type = input.toString('latin1', offset, offset + 4)
    const size = input.readUInt32LE(offset + 4)
    const end = offset + 8 + size + (size % 2)
    if (end > declared) corrupto()
    if (type === 'EXIF' || type === 'XMP ') {
      removed.push(type.trim())
    } else {
      const chunk = Buffer.from(input.subarray(offset, end))
      if (type === 'VP8X' && chunk.length >= 9) chunk[8] = chunk[8]! & ~0x0c
      chunks.push(chunk)
    }
    offset = end
  }
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(body.length + 4, 4)
  header.write('WEBP', 8, 'latin1')
  return { bytes: Buffer.concat([header, body]), removed }
}
