import { ErrorIdentidad, type LecturaDocumento } from '../identidad/modelo.ts'
import type {
  DocumentoIdentidadCifrado,
  EstadoProveedorIdentidad,
  PuertoTransaccionIdentidad,
  RepositoriosIdentidad,
  TrabajoIdentidad,
  VerificacionIdentidad,
} from '../identidad/puertos.ts'
import { isSerializationFailure } from './prisma-work.ts'

// PostgreSQL adapters for IDENTITY-NOSIS. Every operation runs inside a Serializable transaction:
// the FIFO lease, the sliding-window reservation and the provider state are atomic across worker
// processes. The rate-limit reservation also bumps the provider state row, so two concurrent
// reservations always conflict on the same row (one of them retries and sees the new count).

type Fila = Record<string, unknown>

export interface DelegadoPrismaIdentidad {
  findFirst(input: { where: Fila; orderBy?: Fila | Fila[] }): Promise<Fila | null>
  findMany(input: { where: Fila; orderBy?: Fila | Fila[]; take?: number }): Promise<Fila[]>
  create(input: { data: Fila }): Promise<Fila>
  updateMany(input: { where: Fila; data: Fila }): Promise<{ count: number }>
  count(input: { where: Fila }): Promise<number>
  upsert(input: { where: Fila; create: Fila; update: Fila }): Promise<Fila>
  deleteMany(input: { where: Fila }): Promise<{ count: number }>
}

export interface ClientePrismaIdentidad {
  verificacionIdentidad: DelegadoPrismaIdentidad
  documentoIdentidad: DelegadoPrismaIdentidad
  colaVerificacionIdentidad: DelegadoPrismaIdentidad
  consultaProveedorIdentidad: DelegadoPrismaIdentidad
  estadoProveedorIdentidad: DelegadoPrismaIdentidad
  sesionNavegadorProveedor: DelegadoPrismaIdentidad
  auditoriaIdentidad: DelegadoPrismaIdentidad
  $transaction<T>(
    callback: (client: ClientePrismaIdentidad) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' }
  ): Promise<T>
}

const fecha = (value: string | null) => (value ? new Date(value) : null)
const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : value ? String(value) : null
const texto = (value: unknown) => (value === null || value === undefined ? null : String(value))

function sinId(row: Fila): Fila {
  const copy = { ...row }
  delete copy['id']
  return copy
}

function filaVerificacion(value: VerificacionIdentidad): Fila {
  return {
    id: value.verificationId,
    tenantId: value.tenantId,
    usuarioId: value.userId,
    proveedorId: value.providerId,
    tipoDocumento: value.documentType,
    numeroDocumento: value.documentNumber,
    nombreExtraido: value.extractedFirstName,
    apellidoExtraido: value.extractedLastName,
    fechaNacimientoExtraida: value.extractedBirthDate,
    sexoExtraido: value.extractedSex,
    cuilVerificado: value.verifiedCuil,
    estado: value.status,
    metodoVerificacion: value.verificationMethod,
    referenciaProveedor: value.providerReference,
    motivoRevision: value.reviewReason,
    notaDecision: value.decisionNote,
    consentimientoAceptadoEn: fecha(value.consentAcceptedAt),
    consentimientoVersion: value.consentVersion,
    consentimientoProposito: value.consentPurpose,
    lecturaOcr: value.ocrReading ?? undefined,
    lecturaVision: value.visionReading ?? undefined,
    resultadoExterno: value.externalSnapshot ?? undefined,
    intentos: value.attempts,
    version: value.version,
    fechaCreacion: new Date(value.createdAt),
    encoladaEn: fecha(value.queuedAt),
    procesamientoIniciadoEn: fecha(value.processingStartedAt),
    verificadaEn: fecha(value.verifiedAt),
    rechazadaEn: fecha(value.rejectedAt),
    fechaActualizacion: new Date(value.updatedAt),
  }
}

function mapVerificacion(row: Fila): VerificacionIdentidad {
  return {
    verificationId: String(row['id']),
    tenantId: String(row['tenantId']),
    userId: String(row['usuarioId']),
    providerId: String(row['proveedorId']),
    documentType: 'dni',
    documentNumber: texto(row['numeroDocumento']),
    extractedFirstName: texto(row['nombreExtraido']),
    extractedLastName: texto(row['apellidoExtraido']),
    extractedBirthDate: texto(row['fechaNacimientoExtraida']),
    extractedSex: texto(row['sexoExtraido']) as VerificacionIdentidad['extractedSex'],
    verifiedCuil: texto(row['cuilVerificado']),
    status: String(row['estado']) as VerificacionIdentidad['status'],
    verificationMethod: texto(
      row['metodoVerificacion']
    ) as VerificacionIdentidad['verificationMethod'],
    providerReference: texto(row['referenciaProveedor']),
    reviewReason: texto(row['motivoRevision']) as VerificacionIdentidad['reviewReason'],
    decisionNote: texto(row['notaDecision']),
    consentAcceptedAt: iso(row['consentimientoAceptadoEn']),
    consentVersion: texto(row['consentimientoVersion']),
    consentPurpose: texto(row['consentimientoProposito']),
    ocrReading: (row['lecturaOcr'] as LecturaDocumento | null) ?? null,
    visionReading: (row['lecturaVision'] as LecturaDocumento | null) ?? null,
    externalSnapshot:
      (row['resultadoExterno'] as VerificacionIdentidad['externalSnapshot']) ?? null,
    attempts: Number(row['intentos']),
    version: Number(row['version']),
    createdAt: iso(row['fechaCreacion'])!,
    queuedAt: iso(row['encoladaEn']),
    processingStartedAt: iso(row['procesamientoIniciadoEn']),
    verifiedAt: iso(row['verificadaEn']),
    rejectedAt: iso(row['rechazadaEn']),
    updatedAt: iso(row['fechaActualizacion'])!,
  }
}

function filaTrabajo(job: TrabajoIdentidad): Fila {
  return {
    id: job.jobId,
    verificacionId: job.verificationId,
    etapa: job.stage,
    estado: job.status,
    encoladoEn: new Date(job.queuedAt),
    disponibleEn: new Date(job.availableAt),
    intentos: job.attemptCount,
    leaseOwner: job.leaseOwner,
    leaseHasta: fecha(job.leaseUntil),
    ultimoError: job.lastErrorCode,
    fechaActualizacion: new Date(job.updatedAt),
  }
}

function mapTrabajo(row: Fila): TrabajoIdentidad {
  return {
    jobId: String(row['id']),
    verificationId: String(row['verificacionId']),
    stage: String(row['etapa']) as TrabajoIdentidad['stage'],
    status: String(row['estado']) as TrabajoIdentidad['status'],
    queuedAt: iso(row['encoladoEn'])!,
    availableAt: iso(row['disponibleEn'])!,
    attemptCount: Number(row['intentos']),
    leaseOwner: texto(row['leaseOwner']),
    leaseUntil: iso(row['leaseHasta']),
    lastErrorCode: texto(row['ultimoError']),
    updatedAt: iso(row['fechaActualizacion'])!,
  }
}

function mapDocumento(row: Fila): DocumentoIdentidadCifrado {
  return {
    verificationId: String(row['verificacionId']),
    tenantId: String(row['tenantId']),
    side: String(row['lado']) as DocumentoIdentidadCifrado['side'],
    mimeType: String(row['tipoMime']) as DocumentoIdentidadCifrado['mimeType'],
    size: Number(row['tamano']),
    sha256: String(row['sha256']),
    ciphertext: String(row['contenidoCifrado']),
    keyVersion: String(row['versionClave']),
    createdAt: iso(row['fechaCreacion'])!,
  }
}

function estadoInicial(providerId: string): EstadoProveedorIdentidad {
  return {
    providerId,
    status: 'running',
    consecutiveErrors: 0,
    reason: null,
    version: 0,
    updatedAt: new Date(0).toISOString(),
  }
}

async function uso(
  client: ClientePrismaIdentidad,
  input: { providerId: string; max: number; windowMs: number; now: string }
) {
  const now = Date.parse(input.now)
  const rows = await client.consultaProveedorIdentidad.findMany({
    where: {
      proveedorId: input.providerId,
      consumidaEn: { gt: new Date(now - input.windowMs), lte: new Date(now) },
    },
    orderBy: { consumidaEn: 'asc' },
  })
  const used = rows.length
  if (used < input.max) return { used, nextEligibleAt: null }
  const oldestBlocking = Date.parse(iso(rows[used - input.max]!['consumidaEn'])!)
  return { used, nextEligibleAt: new Date(oldestBlocking + input.windowMs + 1).toISOString() }
}

export function repositoriosIdentidadPrisma(client: ClientePrismaIdentidad): RepositoriosIdentidad {
  const ACTIVOS = { in: ['queued', 'leased'] }
  return {
    verificaciones: {
      crear: async (value) => {
        await client.verificacionIdentidad.create({ data: filaVerificacion(value) })
      },
      buscar: async (id) => {
        const row = await client.verificacionIdentidad.findFirst({ where: { id } })
        return row ? mapVerificacion(row) : null
      },
      ultimaDeTenant: async (tenantId) => {
        const row = await client.verificacionIdentidad.findFirst({
          where: { tenantId },
          orderBy: { fechaCreacion: 'desc' },
        })
        return row ? mapVerificacion(row) : null
      },
      actualizar: async (value, expectedVersion) => {
        const data = sinId(filaVerificacion(value))
        const result = await client.verificacionIdentidad.updateMany({
          where: { id: value.verificationId, version: expectedVersion },
          data,
        })
        return result.count === 1
      },
      listar: async (filter) =>
        (
          await client.verificacionIdentidad.findMany({
            where: filter.status ? { estado: filter.status } : {},
            orderBy: { fechaCreacion: 'desc' },
            take: filter.limit ?? 100,
          })
        ).map(mapVerificacion),
      existeVerificadaDeOtro: async (input) => {
        const or: Fila[] = []
        if (input.documentNumber) or.push({ numeroDocumento: input.documentNumber })
        if (input.cuil) or.push({ cuilVerificado: input.cuil })
        if (or.length === 0) return false
        const count = await client.verificacionIdentidad.count({
          where: { estado: 'verified', tenantId: { not: input.tenantId }, OR: or },
        })
        return count > 0
      },
      tenantVerificado: async (tenantId) =>
        (await client.verificacionIdentidad.count({ where: { tenantId, estado: 'verified' } })) > 0,
    },
    documentos: {
      guardar: async (value) => {
        const data = {
          verificacionId: value.verificationId,
          tenantId: value.tenantId,
          lado: value.side,
          tipoMime: value.mimeType,
          tamano: value.size,
          sha256: value.sha256,
          contenidoCifrado: value.ciphertext,
          versionClave: value.keyVersion,
          fechaCreacion: new Date(value.createdAt),
        }
        await client.documentoIdentidad.upsert({
          where: { id: `${value.verificationId}:${value.side}` },
          create: { id: `${value.verificationId}:${value.side}`, ...data },
          update: data,
        })
      },
      leer: async (id, side) => {
        const row = await client.documentoIdentidad.findFirst({
          where: { verificacionId: id, lado: side },
        })
        return row ? mapDocumento(row) : null
      },
    },
    cola: {
      encolar: async (job) => {
        await client.colaVerificacionIdentidad.create({ data: filaTrabajo(job) })
      },
      tomarSiguiente: async (input) => {
        const now = new Date(input.now)
        const row = await client.colaVerificacionIdentidad.findFirst({
          where: {
            etapa: { in: input.stages },
            disponibleEn: { lte: now },
            OR: [{ estado: 'queued' }, { estado: 'leased', leaseHasta: { lt: now } }],
          },
          orderBy: [{ encoladoEn: 'asc' }, { id: 'asc' }],
        })
        if (!row) return null
        const job = mapTrabajo(row)
        // Conditional claim: only if nobody else claimed it since the read (Serializable too).
        const claimed = await client.colaVerificacionIdentidad.updateMany({
          where: { id: job.jobId, estado: job.status, leaseOwner: job.leaseOwner },
          data: {
            estado: 'leased',
            leaseOwner: input.owner,
            leaseHasta: new Date(input.leaseUntil),
            fechaActualizacion: now,
          },
        })
        if (claimed.count !== 1) return null
        return {
          ...job,
          status: 'leased',
          leaseOwner: input.owner,
          leaseUntil: input.leaseUntil,
          updatedAt: input.now,
        }
      },
      actualizar: async (job, owner) => {
        const data = sinId(filaTrabajo(job))
        const result = await client.colaVerificacionIdentidad.updateMany({
          where: { id: job.jobId, leaseOwner: owner },
          data,
        })
        return result.count === 1
      },
      buscarActivo: async (id) => {
        const row = await client.colaVerificacionIdentidad.findFirst({
          where: { verificacionId: id, estado: ACTIVOS },
        })
        return row ? mapTrabajo(row) : null
      },
      contarPendientes: async () =>
        client.colaVerificacionIdentidad.count({ where: { estado: ACTIVOS } }),
    },
    limite: {
      reservar: async (input) => {
        // Serialize reservations of the same provider on its state row.
        await client.estadoProveedorIdentidad.upsert({
          where: { proveedorId: input.providerId },
          create: {
            proveedorId: input.providerId,
            estado: 'running',
            erroresConsecutivos: 0,
            motivo: null,
            version: 1,
            fechaActualizacion: new Date(input.now),
          },
          update: { fechaActualizacion: new Date(input.now) },
        })
        const usage = await uso(client, input)
        if (usage.used >= input.max) return { granted: false, ...usage }
        await client.consultaProveedorIdentidad.create({
          data: {
            id: `consulta-identidad-${input.verificationId}-${Date.parse(input.now)}-${usage.used}`,
            proveedorId: input.providerId,
            verificacionId: input.verificationId,
            consumidaEn: new Date(input.now),
          },
        })
        return { granted: true, ...(await uso(client, input)) }
      },
      uso: async (input) => uso(client, input),
    },
    estadoProveedor: {
      leer: async (providerId) => {
        const row = await client.estadoProveedorIdentidad.findFirst({
          where: { proveedorId: providerId },
        })
        if (!row) return estadoInicial(providerId)
        return {
          providerId,
          status: String(row['estado']) as EstadoProveedorIdentidad['status'],
          consecutiveErrors: Number(row['erroresConsecutivos']),
          reason: texto(row['motivo']),
          version: Number(row['version']),
          updatedAt: iso(row['fechaActualizacion'])!,
        }
      },
      guardar: async (value, expectedVersion) => {
        const data = {
          estado: value.status,
          erroresConsecutivos: value.consecutiveErrors,
          motivo: value.reason,
          version: value.version,
          fechaActualizacion: new Date(value.updatedAt),
        }
        if (expectedVersion === 0) {
          const existing = await client.estadoProveedorIdentidad.findFirst({
            where: { proveedorId: value.providerId },
          })
          if (existing && Number(existing['version']) !== 0) return false
          await client.estadoProveedorIdentidad.upsert({
            where: { proveedorId: value.providerId },
            create: { proveedorId: value.providerId, ...data },
            update: data,
          })
          return true
        }
        const result = await client.estadoProveedorIdentidad.updateMany({
          where: { proveedorId: value.providerId, version: expectedVersion },
          data,
        })
        return result.count === 1
      },
    },
    auditoria: {
      registrar: async (event) => {
        await client.auditoriaIdentidad.create({
          data: {
            id: event.eventId,
            accion: event.action,
            verificacionId: event.verificationId,
            tenantId: event.tenantId,
            actorId: event.actorId,
            correlacionId: event.correlationId,
            metadata: event.metadata,
            fechaCreacion: new Date(event.createdAt),
          },
        })
      },
    },
  }
}

export class TransaccionIdentidadPrisma implements PuertoTransaccionIdentidad {
  constructor(private readonly client: ClientePrismaIdentidad) {}

  async ejecutar<T>(operation: (repositories: RepositoriosIdentidad) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return await this.client.$transaction(
          (client) => operation(repositoriosIdentidadPrisma(client)),
          {
            isolationLevel: 'Serializable',
          }
        )
      } catch (error) {
        // Unique violations (verified DNI/CUIL, active job) surface to the caller as P2002.
        if (!isSerializationFailure(error)) throw error
        // Several workers compete for the same queue head: back off with jitter.
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20 * (attempt + 1)))
      }
    }
    throw new ErrorIdentidad(
      409,
      'CONCURRENT_MODIFICATION',
      'identity state changed concurrently; retry'
    )
  }
}

// Encrypted session rows (the ciphertext is produced by SesionNavegadorCifrada).
export class BackendSesionPrisma {
  constructor(private readonly client: ClientePrismaIdentidad) {}

  async leer(providerId: string) {
    const row = await this.client.sesionNavegadorProveedor.findFirst({
      where: { proveedorId: providerId },
    })
    return row
      ? { ciphertext: String(row['estadoCifrado']), keyVersion: String(row['versionClave']) }
      : null
  }

  async guardar(providerId: string, value: { ciphertext: string; keyVersion: string }) {
    const data = {
      estadoCifrado: value.ciphertext,
      versionClave: value.keyVersion,
      fechaActualizacion: new Date(),
    }
    await this.client.sesionNavegadorProveedor.upsert({
      where: { proveedorId: providerId },
      create: { proveedorId: providerId, ...data },
      update: data,
    })
  }

  async borrar(providerId: string) {
    await this.client.sesionNavegadorProveedor.deleteMany({ where: { proveedorId: providerId } })
  }
}
