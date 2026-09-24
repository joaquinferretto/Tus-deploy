import type {
  EstadoVerificacionIdentidad,
  LecturaDocumento,
  MetodoVerificacionIdentidad,
  MotivoRevisionIdentidad,
} from './modelo.ts'

export interface VerificacionIdentidad {
  verificationId: string
  tenantId: string
  userId: string
  providerId: string
  documentType: 'dni'
  documentNumber: string | null
  extractedFirstName: string | null
  extractedLastName: string | null
  extractedBirthDate: string | null
  extractedSex: 'M' | 'F' | 'X' | null
  verifiedCuil: string | null
  status: EstadoVerificacionIdentidad
  verificationMethod: MetodoVerificacionIdentidad | null
  providerReference: string | null
  reviewReason: MotivoRevisionIdentidad | null
  decisionNote: string | null
  consentAcceptedAt: string | null
  consentVersion: string | null
  consentPurpose: string | null
  ocrReading: LecturaDocumento | null
  visionReading: LecturaDocumento | null
  // Minimal external snapshot: normalized name compared and match outcome. Never raw pages.
  externalSnapshot: {
    resultCount: number
    nameMatch: string | null
    cuilValid: boolean | null
  } | null
  attempts: number
  version: number
  createdAt: string
  queuedAt: string | null
  processingStartedAt: string | null
  verifiedAt: string | null
  rejectedAt: string | null
  updatedAt: string
}

export interface DocumentoIdentidadCifrado {
  verificationId: string
  tenantId: string
  side: 'front' | 'back'
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  size: number
  sha256: string
  ciphertext: string
  keyVersion: string
  createdAt: string
}

export type EtapaTrabajoIdentidad = 'lectura' | 'consulta'

export interface TrabajoIdentidad {
  jobId: string
  verificationId: string
  stage: EtapaTrabajoIdentidad
  status: 'queued' | 'leased' | 'done' | 'cancelled'
  queuedAt: string
  availableAt: string
  attemptCount: number
  leaseOwner: string | null
  leaseUntil: string | null
  lastErrorCode: string | null
  updatedAt: string
}

export type EstadoWorkerIdentidad = 'running' | 'paused' | 'session_required' | 'circuit_open'

export interface EstadoProveedorIdentidad {
  providerId: string
  status: EstadoWorkerIdentidad
  consecutiveErrors: number
  reason: string | null
  version: number
  updatedAt: string
}

export interface EventoAuditoriaIdentidad {
  eventId: string
  action: string
  verificationId: string | null
  tenantId: string | null
  actorId: string
  correlationId: string
  // Masked values only (never full DNI/CUIL, never secrets or HTML).
  metadata: Record<string, unknown>
  createdAt: string
}

export interface FiltroVerificaciones {
  status?: EstadoVerificacionIdentidad
  limit?: number
}

export interface RepositoriosIdentidad {
  verificaciones: {
    crear(value: VerificacionIdentidad): Promise<void>
    buscar(verificationId: string): Promise<VerificacionIdentidad | null>
    ultimaDeTenant(tenantId: string): Promise<VerificacionIdentidad | null>
    actualizar(value: VerificacionIdentidad, expectedVersion: number): Promise<boolean>
    listar(filter: FiltroVerificaciones): Promise<VerificacionIdentidad[]>
    // Another tenant already verified with that DNI or CUIL.
    existeVerificadaDeOtro(input: {
      tenantId: string
      documentNumber?: string
      cuil?: string
    }): Promise<boolean>
    tenantVerificado(tenantId: string): Promise<boolean>
  }
  documentos: {
    guardar(value: DocumentoIdentidadCifrado): Promise<void>
    leer(verificationId: string, side: 'front' | 'back'): Promise<DocumentoIdentidadCifrado | null>
  }
  cola: {
    encolar(job: TrabajoIdentidad): Promise<void>
    // FIFO by queuedAt among jobs available now; `stages` restricts which stages may be taken.
    tomarSiguiente(input: {
      owner: string
      now: string
      leaseUntil: string
      stages: EtapaTrabajoIdentidad[]
    }): Promise<TrabajoIdentidad | null>
    actualizar(job: TrabajoIdentidad, expectedOwner: string): Promise<boolean>
    buscarActivo(verificationId: string): Promise<TrabajoIdentidad | null>
    contarPendientes(): Promise<number>
  }
  limite: {
    // Atomically counts searches in [now - windowMs, now] and records one if below max.
    reservar(input: {
      providerId: string
      verificationId: string
      max: number
      windowMs: number
      now: string
    }): Promise<{ granted: boolean; used: number; nextEligibleAt: string | null }>
    uso(input: { providerId: string; max: number; windowMs: number; now: string }): Promise<{
      used: number
      nextEligibleAt: string | null
    }>
  }
  estadoProveedor: {
    leer(providerId: string): Promise<EstadoProveedorIdentidad>
    guardar(value: EstadoProveedorIdentidad, expectedVersion: number): Promise<boolean>
  }
  auditoria: { registrar(event: EventoAuditoriaIdentidad): Promise<void> }
}

export interface PuertoTransaccionIdentidad {
  ejecutar<T>(operation: (repositories: RepositoriosIdentidad) => Promise<T>): Promise<T>
}

// Encrypted browser session state (cookies/storage of the Mi Nosis account).
export interface BrowserSessionStore {
  leer(providerId: string): Promise<string | null>
  guardar(providerId: string, plaintextState: string): Promise<void>
  borrar(providerId: string): Promise<void>
}
