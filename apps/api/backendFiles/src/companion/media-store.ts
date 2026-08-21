import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AUDIO_SOURCE, type CompanionAudioRef, type CompanionMediaMetadata } from '@repo/zod-schemas'

interface StoredMedia {
  metadata: CompanionMediaMetadata
  bytes: Buffer
}

const mediaById = new Map<string, StoredMedia>()
const DEFAULT_MAX_BYTES = 1024 * 1024
const ALLOWED_MIME_TYPES = new Set(['audio/webm', 'audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/wav'])
const localDir = resolve(process.env['COMPANION_MEDIA_DIR'] ?? './.local/companion-media')

export class CompanionMediaValidationError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

export function resetCompanionMediaStoreForTest(): void {
  mediaById.clear()
  if (process.env['NODE_ENV'] === 'test' && existsSync(localDir)) rmSync(localDir, { recursive: true, force: true })
}

export function clearCompanionMediaCacheForTest(): void {
  mediaById.clear()
}

export function persistCompanionAudioRef(audio: CompanionAudioRef): CompanionAudioRef {
  if (!audio.url.startsWith('data:')) throw new CompanionMediaValidationError(400, 'audio must be uploaded as a data URL for durable storage')
  const parsed = parseDataAudioUrl(audio.url)
  validateMedia(parsed.mimeType || audio.mimeType, parsed.bytes.byteLength)
  const metadata: CompanionMediaMetadata = {
    id: audio.id,
    source: audio.source,
    url: `/companion/media/${audio.id}`,
    mimeType: parsed.mimeType || audio.mimeType,
    byteLength: parsed.bytes.byteLength,
    ...(audio.durationMs === undefined ? {} : { durationMs: audio.durationMs }),
  }
  mediaById.set(audio.id, { metadata, bytes: parsed.bytes })
  writeLocalMedia(audio.id, parsed.bytes)
  return metadata
}

export function storeGeneratedCompanionSpeech(id: string, bytes: Buffer, mimeType = 'audio/mpeg'): CompanionAudioRef {
  validateMedia(mimeType, bytes.byteLength)
  const metadata: CompanionMediaMetadata = { id, source: AUDIO_SOURCE.TTS, url: `/companion/media/${id}`, mimeType, byteLength: bytes.byteLength }
  mediaById.set(id, { metadata, bytes })
  writeLocalMedia(id, bytes)
  return metadata
}

export function getCompanionMedia(id: string): StoredMedia | undefined {
  const cached = mediaById.get(id)
  if (cached) return cached
  const metadataPath = join(localDir, `${safeMediaId(id)}.json`)
  const bytesPath = join(localDir, `${safeMediaId(id)}.bin`)
  if (!existsSync(metadataPath) || !existsSync(bytesPath)) return undefined
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as CompanionMediaMetadata
  const bytes = readFileSync(bytesPath)
  mediaById.set(id, { metadata, bytes })
  return { metadata, bytes }
}

function parseDataAudioUrl(url: string): { mimeType: string; bytes: Buffer } {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(url)
  if (!match) throw new Error('unsupported audio data URL')
  return { mimeType: match[1] ?? 'application/octet-stream', bytes: Buffer.from(match[2] ?? '', 'base64') }
}

function validateMedia(mimeType: string, byteLength: number): void {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new CompanionMediaValidationError(415, 'unsupported media type')
  if (byteLength > DEFAULT_MAX_BYTES) throw new CompanionMediaValidationError(413, 'media too large')
}

function writeLocalMedia(id: string, bytes: Buffer): void {
  mkdirSync(localDir, { recursive: true })
  const media = mediaById.get(id)
  if (!media) return
  writeFileSync(join(localDir, `${safeMediaId(id)}.bin`), bytes)
  writeFileSync(join(localDir, `${safeMediaId(id)}.json`), JSON.stringify(media.metadata))
}

function safeMediaId(id: string): string {
  return id.replace(/[^A-Za-z0-9._:-]/g, '_')
}
