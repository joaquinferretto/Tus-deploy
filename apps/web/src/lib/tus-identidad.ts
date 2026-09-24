import { TUS_CONTRACT_VERSION } from '@factory/contracts'

import { resolveWebApiBaseUrl } from './api-url'
import { TUS_API_VERSION, TusRequestError, joinTusApiUrl } from './tus-client'
import type { TusWebSession } from './tus-ui-contract'

// IDENTITY-NOSIS web client. DNI images travel as raw bytes to the TUS API only; the browser
// never receives external (Nosis) data beyond the masked summary the API returns.

export type EstadoIdentidad =
  | 'not_started'
  | 'pending_upload'
  | 'queued'
  | 'processing'
  | 'retry_pending'
  | 'session_required'
  | 'review_required'
  | 'verified'
  | 'rejected'
  | 'failed'

export interface VistaIdentidadPrestador {
  verificationId: string | null
  status: EstadoIdentidad
  consentAccepted: boolean
  consentText: string
  consentVersion: string
  documents: { front: boolean; back: boolean }
  documentNumberMasked: string | null
  message: string
  updatedAt: string | null
}

export interface ItemVerificacionAdmin {
  verificationId: string
  tenantId: string
  userId: string
  status: EstadoIdentidad
  reviewReason: string | null
  verificationMethod: string | null
  attempts: number
  queuedAt: string | null
  createdAt: string
  updatedAt: string
  documentNumberMasked: string | null
}

export interface LecturaDocumentoWeb {
  reader: 'ocr' | 'vision'
  documentNumber: string | null
  firstName: string | null
  lastName: string | null
  birthDate: string | null
  sex: string | null
  nationality: string | null
  expirationDate: string | null
  confidence: number
  unavailable?: boolean
}

export interface DetalleVerificacionAdmin extends Omit<
  ItemVerificacionAdmin,
  'documentNumberMasked'
> {
  documentNumber: string | null
  extractedFirstName: string | null
  extractedLastName: string | null
  extractedBirthDate: string | null
  verifiedCuil: string | null
  providerReference: string | null
  decisionNote: string | null
  consentAcceptedAt: string | null
  consentVersion: string | null
  ocrReading: LecturaDocumentoWeb | null
  visionReading: LecturaDocumentoWeb | null
  externalSnapshot: {
    resultCount: number
    nameMatch: string | null
    cuilValid: boolean | null
  } | null
  verifiedAt: string | null
  rejectedAt: string | null
  documents: { front: boolean; back: boolean }
  job: {
    stage: string
    status: string
    availableAt: string
    attemptCount: number
    lastErrorCode: string | null
  } | null
}

export interface EstadoWorkerWeb {
  status: 'running' | 'paused' | 'session_required' | 'circuit_open' | 'rate_limited'
  used: number
  max: number
  nextEligibleAt: string | null
  pending: number
  providerState: { reason: string | null; consecutiveErrors: number; updatedAt: string }
}

export const TIPOS_IMAGEN_DNI = ['image/jpeg', 'image/png', 'image/webp'] as const
export const TAMANO_MAXIMO_DNI = 8 * 1024 * 1024

const PROVIDER_PATH = '/tus/v1/provider/identity-verification'
const ADMIN_PATH = '/tus/v1/admin/identity-verifications'

function baseUrl(): string {
  return resolveWebApiBaseUrl({
    canonicalUrl: process.env['NEXT_PUBLIC_API_URL'],
    legacyUrl: process.env['API_BASE_URL'],
    nodeEnv: process.env['NODE_ENV'],
  })
}

function headers(
  session: TusWebSession,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
    'X-Tenant-Id': session.tenantId,
    'X-Actor-Id': session.actorId,
    'X-Correlation-Id': session.correlationId,
    'X-TUS-API-Version': TUS_API_VERSION,
    'X-TUS-Contract-Version': TUS_CONTRACT_VERSION,
    ...extra,
  }
}

async function request<T>(
  session: TusWebSession,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  raw?: { bytes: Blob; contentType: string }
): Promise<T> {
  const response = await fetch(joinTusApiUrl(baseUrl(), path), {
    method,
    cache: 'no-store',
    headers: headers(
      session,
      raw
        ? { 'Content-Type': raw.contentType }
        : body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }
    ),
    ...(raw ? { body: raw.bytes } : body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    throw new TusRequestError(
      typeof payload?.['error'] === 'string'
        ? payload['error']
        : `TUS request failed with HTTP ${response.status}`,
      response.status,
      typeof payload?.['code'] === 'string' ? payload['code'] : undefined
    )
  }
  return (await response.json()) as T
}

export const clienteIdentidad = {
  estado: (session: TusWebSession) =>
    request<VistaIdentidadPrestador>(session, 'GET', PROVIDER_PATH),
  aceptarConsentimiento: (session: TusWebSession, consentVersion: string) =>
    request<VistaIdentidadPrestador>(session, 'POST', `${PROVIDER_PATH}/consent`, {
      accepted: true,
      consentVersion,
    }),
  subirDocumento: (session: TusWebSession, side: 'front' | 'back', file: Blob) =>
    request<VistaIdentidadPrestador>(
      session,
      'PUT',
      `${PROVIDER_PATH}/documents/${side}`,
      undefined,
      {
        bytes: file,
        contentType: 'application/octet-stream',
      }
    ),
  enviar: (session: TusWebSession) =>
    request<{ status: 'queued'; message: string; verificationId: string }>(
      session,
      'POST',
      `${PROVIDER_PATH}/submit`,
      {}
    ),

  listar: (session: TusWebSession, status?: string) =>
    request<{ verifications: ItemVerificacionAdmin[] }>(
      session,
      'GET',
      `${ADMIN_PATH}${status ? `?status=${encodeURIComponent(status)}` : ''}`
    ),
  detalle: (session: TusWebSession, id: string) =>
    request<DetalleVerificacionAdmin>(session, 'GET', `${ADMIN_PATH}/${encodeURIComponent(id)}`),
  decidir: (
    session: TusWebSession,
    id: string,
    decision: 'approve' | 'reject' | 'review' | 'retry',
    reason: string
  ) =>
    request<DetalleVerificacionAdmin>(
      session,
      'POST',
      `${ADMIN_PATH}/${encodeURIComponent(id)}/decision`,
      { decision, reason }
    ),
  estadoWorker: (session: TusWebSession) =>
    request<EstadoWorkerWeb>(session, 'GET', '/tus/v1/admin/identity-worker'),
  controlarWorker: (session: TusWebSession, action: 'pause' | 'resume' | 'reauthenticate') =>
    request<unknown>(session, 'POST', `/tus/v1/admin/identity-worker/${action}`, {}),
  // Authenticated image fetch; the caller turns it into a revocable object URL (never cached).
  imagenDocumento: async (
    session: TusWebSession,
    id: string,
    side: 'front' | 'back'
  ): Promise<Blob> => {
    const response = await fetch(
      joinTusApiUrl(baseUrl(), `${ADMIN_PATH}/${encodeURIComponent(id)}/documents/${side}`),
      {
        cache: 'no-store',
        headers: headers(session, { Accept: 'image/*' }),
      }
    )
    if (!response.ok)
      throw new TusRequestError(`TUS request failed with HTTP ${response.status}`, response.status)
    return response.blob()
  },
}

export function validarArchivoDni(file: { type: string; size: number }): string | null {
  if (!(TIPOS_IMAGEN_DNI as readonly string[]).includes(file.type))
    return 'Subí una foto JPG, PNG o WEBP.'
  if (file.size > TAMANO_MAXIMO_DNI) return 'La foto supera 8 MB. Probá con una de menor tamaño.'
  if (file.size < 8 * 1024) return 'La foto es demasiado chica para leerse bien.'
  return null
}

export const ETIQUETAS_ESTADO_IDENTIDAD: Record<EstadoIdentidad, string> = {
  not_started: 'Pendiente',
  pending_upload: 'Pendiente',
  queued: 'En cola',
  processing: 'Verificando',
  retry_pending: 'Verificando',
  session_required: 'Verificando',
  review_required: 'En revisión',
  verified: 'Verificado',
  rejected: 'Rechazado',
  failed: 'En revisión',
}

export const MOTIVOS_REVISION_TEXTO: Record<string, string> = {
  DOCUMENT_READER_MISMATCH: 'OCR y visión leyeron números de documento distintos',
  DOCUMENT_UNREADABLE: 'Documento ilegible',
  DOCUMENT_LOW_CONFIDENCE: 'Lectura con baja confianza',
  NOSIS_NOT_FOUND: 'Sin resultados en la fuente externa',
  NOSIS_AMBIGUOUS_RESULT: 'Más de un resultado en la fuente externa',
  DOCUMENT_NUMBER_MISMATCH: 'El DNI de la fuente no coincide',
  NAME_MISMATCH: 'El nombre no coincide',
  NAME_PARTIAL_MATCH: 'Coincidencia parcial de nombre (segundos nombres)',
  CUIL_INVALID: 'CUIL inválido',
  CUIL_DOCUMENT_MISMATCH: 'El CUIL no corresponde al DNI',
  IDENTITY_ALREADY_VERIFIED: 'Esa identidad ya está verificada por otro prestador',
  RETRIES_EXHAUSTED: 'Se agotaron los reintentos',
  MANUAL_REVIEW_REQUESTED: 'Revisión manual solicitada',
}
