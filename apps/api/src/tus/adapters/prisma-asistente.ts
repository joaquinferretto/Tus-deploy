import { randomUUID } from 'node:crypto'
import {
  DIMENSION_EMBEDDINGS,
  VERSION_CHUNKER,
  VERSION_INDICE,
  tokensBusqueda,
  type DocumentoConocimiento,
  type FiltroConocimiento,
  type FragmentoConocimiento,
  type PuertoIndiceConocimiento,
  type ResultadoBusqueda,
} from '../asistente/conocimiento.ts'
import {
  ErrorAsistente,
  ESTADO_CONVERSACIONAL_INICIAL,
  type ConfirmacionAsistente,
  type ContactoWhatsapp,
  type ConversacionWhatsapp,
  type MensajeConversacion,
  type TokenVinculacion,
  type TrabajoConversacion,
} from '../asistente/modelo.ts'
import type { PuertoTransaccionAsistente, RepositoriosAsistente } from '../asistente/puertos.ts'
import { isSerializationFailure } from './prisma-work.ts'

type Fila = Record<string, unknown>

export interface DelegadoPrismaAsistente {
  findFirst(input: { where: Fila; orderBy?: Fila | Fila[] }): Promise<Fila | null>
  findMany(input: { where: Fila; orderBy?: Fila | Fila[]; take?: number }): Promise<Fila[]>
  create(input: { data: Fila }): Promise<Fila>
  updateMany(input: { where: Fila; data: Fila }): Promise<{ count: number }>
  count(input: { where: Fila }): Promise<number>
}

export interface ClientePrismaAsistente {
  contactoWhatsapp: DelegadoPrismaAsistente
  conversacionWhatsapp: DelegadoPrismaAsistente
  mensajeConversacionWhatsapp: DelegadoPrismaAsistente
  colaConversacionWhatsapp: DelegadoPrismaAsistente
  tokenVinculacionWhatsapp: DelegadoPrismaAsistente
  confirmacionAsistente: DelegadoPrismaAsistente
  auditoriaAsistente: DelegadoPrismaAsistente
  $transaction<T>(
    callback: (client: ClientePrismaAsistente) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' }
  ): Promise<T>
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
}

const fecha = (value: string | null) => (value ? new Date(value) : null)
const iso = (value: unknown) =>
  value instanceof Date ? value.toISOString() : value ? String(value) : null
const texto = (value: unknown) => (value === null || value === undefined ? null : String(value))
const sinId = (row: Fila) => {
  const copy = { ...row }
  delete copy['id']
  return copy
}

const filaContacto = (value: ContactoWhatsapp): Fila => ({
  id: value.contactId,
  waId: value.waId,
  nombrePerfil: value.displayName,
  cuentaVinculadaId: value.linkedAccountId,
  tenantVinculadoId: value.linkedTenantId,
  vinculadoEn: fecha(value.linkedAt),
  bloqueadoHasta: fecha(value.blockedUntil),
  motivoBloqueo: value.blockedReason,
  ultimoEntranteEn: fecha(value.lastInboundAt),
  version: value.version,
  fechaCreacion: new Date(value.createdAt),
})

const mapContacto = (row: Fila): ContactoWhatsapp => ({
  contactId: String(row['id']),
  waId: String(row['waId']),
  displayName: texto(row['nombrePerfil']),
  linkedAccountId: texto(row['cuentaVinculadaId']),
  linkedTenantId: texto(row['tenantVinculadoId']),
  linkedAt: iso(row['vinculadoEn']),
  blockedUntil: iso(row['bloqueadoHasta']),
  blockedReason: texto(row['motivoBloqueo']),
  createdAt: iso(row['fechaCreacion'])!,
  lastInboundAt: iso(row['ultimoEntranteEn']),
  version: Number(row['version']),
})

const filaConversacion = (value: ConversacionWhatsapp): Fila => ({
  id: value.conversationId,
  contactoId: value.contactId,
  estado: value.status,
  modo: value.mode,
  motivoDerivacion: value.handoffReason,
  derivadaEn: fecha(value.handoffAt),
  operadorId: value.operatorId,
  abiertaEn: new Date(value.openedAt),
  ultimoMensajeEn: new Date(value.lastMessageAt),
  ultimoEntranteEn: fecha(value.lastInboundAt),
  noLeidos: value.unreadCount,
  resumen: value.summary,
  mensajesResumidos: value.summaryMessageCount,
  estadoConversacional: value.state,
  version: value.version,
})

const mapConversacion = (row: Fila): ConversacionWhatsapp => ({
  conversationId: String(row['id']),
  contactId: String(row['contactoId']),
  status: String(row['estado']) as ConversacionWhatsapp['status'],
  mode: String(row['modo']) as ConversacionWhatsapp['mode'],
  handoffReason: texto(row['motivoDerivacion']),
  handoffAt: iso(row['derivadaEn']),
  operatorId: texto(row['operadorId']),
  openedAt: iso(row['abiertaEn'])!,
  lastMessageAt: iso(row['ultimoMensajeEn'])!,
  lastInboundAt: iso(row['ultimoEntranteEn']),
  unreadCount: Number(row['noLeidos']),
  summary: texto(row['resumen']),
  summaryMessageCount: Number(row['mensajesResumidos']),
  state: { ...ESTADO_CONVERSACIONAL_INICIAL, ...(row['estadoConversacional'] as object) },
  version: Number(row['version']),
})

const filaMensaje = (value: MensajeConversacion): Fila => ({
  id: value.messageId,
  conversacionId: value.conversationId,
  contactoId: value.contactId,
  wamid: value.wamid,
  direccion: value.direction,
  tipo: value.type,
  texto: value.text,
  estado: value.status,
  estadoEn: fecha(value.statusAt),
  fechaExterna: fecha(value.externalTimestamp),
  respondeAWamid: value.replyToWamid,
  actor: value.actor,
  metadata: value.metadata,
  correlacionId: value.correlationId,
  fechaCreacion: new Date(value.createdAt),
})

const mapMensaje = (row: Fila): MensajeConversacion => ({
  messageId: String(row['id']),
  conversationId: String(row['conversacionId']),
  contactId: String(row['contactoId']),
  wamid: texto(row['wamid']),
  direction: String(row['direccion']) as MensajeConversacion['direction'],
  type: String(row['tipo']) as MensajeConversacion['type'],
  text: texto(row['texto']),
  status: String(row['estado']) as MensajeConversacion['status'],
  statusAt: iso(row['estadoEn']),
  externalTimestamp: iso(row['fechaExterna']),
  replyToWamid: texto(row['respondeAWamid']),
  actor: String(row['actor']),
  metadata: (row['metadata'] as Record<string, unknown>) ?? {},
  correlationId: String(row['correlacionId']),
  createdAt: iso(row['fechaCreacion'])!,
})

const filaTrabajo = (job: TrabajoConversacion): Fila => ({
  id: job.jobId,
  conversacionId: job.conversationId,
  estado: job.status,
  disponibleEn: new Date(job.availableAt),
  leaseOwner: job.leaseOwner,
  leaseHasta: fecha(job.leaseUntil),
  intentos: job.attempts,
  ultimoError: job.lastError,
  correlacionId: job.correlationId,
  fechaCreacion: new Date(job.createdAt),
  fechaActualizacion: new Date(job.updatedAt),
})

const mapTrabajo = (row: Fila): TrabajoConversacion => ({
  jobId: String(row['id']),
  conversationId: String(row['conversacionId']),
  status: String(row['estado']) as TrabajoConversacion['status'],
  availableAt: iso(row['disponibleEn'])!,
  leaseOwner: texto(row['leaseOwner']),
  leaseUntil: iso(row['leaseHasta']),
  attempts: Number(row['intentos']),
  lastError: texto(row['ultimoError']),
  correlationId: String(row['correlacionId']),
  createdAt: iso(row['fechaCreacion'])!,
  updatedAt: iso(row['fechaActualizacion'])!,
})

const mapToken = (row: Fila): TokenVinculacion => ({
  tokenId: String(row['id']),
  contactId: String(row['contactoId']),
  tokenHash: String(row['hashToken']),
  expiresAt: iso(row['expiraEn'])!,
  usedAt: iso(row['usadoEn']),
  usedByAccountId: texto(row['usadoPorCuentaId']),
  createdAt: iso(row['fechaCreacion'])!,
})

const filaConfirmacion = (value: ConfirmacionAsistente): Fila => ({
  id: value.confirmationId,
  conversacionId: value.conversationId,
  contactoId: value.contactId,
  cuentaId: value.accountId,
  tenantId: value.tenantId,
  herramienta: value.tool,
  argumentos: value.arguments,
  hashArgumentos: value.argumentsHash,
  resumen: value.summary,
  estado: value.status,
  resultado: value.result ?? undefined,
  expiraEn: new Date(value.expiresAt),
  fechaCreacion: new Date(value.createdAt),
  decididaEn: fecha(value.decidedAt),
})

const mapConfirmacion = (row: Fila): ConfirmacionAsistente => ({
  confirmationId: String(row['id']),
  conversationId: String(row['conversacionId']),
  contactId: String(row['contactoId']),
  accountId: String(row['cuentaId']),
  tenantId: String(row['tenantId']),
  tool: String(row['herramienta']),
  arguments: (row['argumentos'] as Record<string, unknown>) ?? {},
  argumentsHash: String(row['hashArgumentos']),
  summary: String(row['resumen']),
  status: String(row['estado']) as ConfirmacionAsistente['status'],
  result: (row['resultado'] as Record<string, unknown> | null) ?? null,
  expiresAt: iso(row['expiraEn'])!,
  createdAt: iso(row['fechaCreacion'])!,
  decidedAt: iso(row['decididaEn']),
})

export function repositoriosAsistentePrisma(client: ClientePrismaAsistente): RepositoriosAsistente {
  const ordenMensajes = [{ fechaExterna: 'asc' }, { fechaCreacion: 'asc' }]
  return {
    contactos: {
      buscarPorWaId: async (waId) => {
        const row = await client.contactoWhatsapp.findFirst({ where: { waId } })
        return row ? mapContacto(row) : null
      },
      buscar: async (id) => {
        const row = await client.contactoWhatsapp.findFirst({ where: { id } })
        return row ? mapContacto(row) : null
      },
      crear: async (value) => {
        await client.contactoWhatsapp.create({ data: filaContacto(value) })
      },
      actualizar: async (value, expected) =>
        (
          await client.contactoWhatsapp.updateMany({
            where: { id: value.contactId, version: expected },
            data: sinId(filaContacto(value)),
          })
        ).count === 1,
      vinculadosA: async (accountId) =>
        (await client.contactoWhatsapp.findMany({ where: { cuentaVinculadaId: accountId } })).map(
          mapContacto
        ),
    },
    conversaciones: {
      activaDeContacto: async (contactId) => {
        const row = await client.conversacionWhatsapp.findFirst({
          where: { contactoId: contactId, estado: 'active' },
        })
        return row ? mapConversacion(row) : null
      },
      buscar: async (id) => {
        const row = await client.conversacionWhatsapp.findFirst({ where: { id } })
        return row ? mapConversacion(row) : null
      },
      crear: async (value) => {
        await client.conversacionWhatsapp.create({ data: filaConversacion(value) })
      },
      actualizar: async (value, expected) =>
        (
          await client.conversacionWhatsapp.updateMany({
            where: { id: value.conversationId, version: expected },
            data: sinId(filaConversacion(value)),
          })
        ).count === 1,
      listar: async (filter) =>
        (
          await client.conversacionWhatsapp.findMany({
            where: filter.mode ? { modo: filter.mode } : {},
            orderBy: { ultimoMensajeEn: 'desc' },
            take: filter.limit ?? 100,
          })
        ).map(mapConversacion),
    },
    mensajes: {
      buscarPorWamid: async (wamid) => {
        const row = await client.mensajeConversacionWhatsapp.findFirst({ where: { wamid } })
        return row ? mapMensaje(row) : null
      },
      buscar: async (id) => {
        const row = await client.mensajeConversacionWhatsapp.findFirst({ where: { id } })
        return row ? mapMensaje(row) : null
      },
      crear: async (value) => {
        await client.mensajeConversacionWhatsapp.create({ data: filaMensaje(value) })
      },
      actualizar: async (value) => {
        await client.mensajeConversacionWhatsapp.updateMany({
          where: { id: value.messageId },
          data: sinId(filaMensaje(value)),
        })
      },
      pendientes: async (conversationId) =>
        (
          await client.mensajeConversacionWhatsapp.findMany({
            where: { conversacionId: conversationId, direccion: 'inbound', estado: 'received' },
            orderBy: ordenMensajes,
          })
        ).map(mapMensaje),
      ultimos: async (conversationId, limit) =>
        (
          await client.mensajeConversacionWhatsapp.findMany({
            where: { conversacionId: conversationId, estado: { not: 'rate_limited' } },
            orderBy: { fechaCreacion: 'desc' },
            take: limit,
          })
        )
          .map(mapMensaje)
          .sort(
            (a, b) =>
              (a.externalTimestamp ?? a.createdAt).localeCompare(
                b.externalTimestamp ?? b.createdAt
              ) || a.createdAt.localeCompare(b.createdAt)
          ),
      contar: async (conversationId) =>
        client.mensajeConversacionWhatsapp.count({ where: { conversacionId: conversationId } }),
      contarEntrantesDesde: async (contactId, since) =>
        client.mensajeConversacionWhatsapp.count({
          where: {
            contactoId: contactId,
            direccion: 'inbound',
            fechaCreacion: { gte: new Date(since) },
          },
        }),
    },
    cola: {
      encolar: async (input) => {
        const queued = await client.colaConversacionWhatsapp.findFirst({
          where: { conversacionId: input.conversationId, estado: 'queued' },
        })
        if (queued) {
          if (new Date(input.availableAt) > (queued['disponibleEn'] as Date))
            await client.colaConversacionWhatsapp.updateMany({
              where: { id: queued['id'], estado: 'queued' },
              data: {
                disponibleEn: new Date(input.availableAt),
                fechaActualizacion: new Date(input.now),
              },
            })
          return
        }
        await client.colaConversacionWhatsapp.create({
          data: filaTrabajo({
            jobId: input.jobId,
            conversationId: input.conversationId,
            status: 'queued',
            availableAt: input.availableAt,
            leaseOwner: null,
            leaseUntil: null,
            attempts: 0,
            lastError: null,
            correlationId: input.correlationId,
            createdAt: input.now,
            updatedAt: input.now,
          }),
        })
      },
      tomarSiguiente: async (input) => {
        const now = new Date(input.now)
        const busy = (
          await client.colaConversacionWhatsapp.findMany({
            where: { estado: 'leased', leaseHasta: { gte: now } },
          })
        ).map((row) => String(row['conversacionId']))
        const row = await client.colaConversacionWhatsapp.findFirst({
          where: {
            conversacionId: { notIn: busy },
            OR: [
              { estado: 'queued', disponibleEn: { lte: now } },
              { estado: 'leased', leaseHasta: { lt: now } },
            ],
          },
          orderBy: [{ disponibleEn: 'asc' }, { id: 'asc' }],
        })
        if (!row) return null
        const job = mapTrabajo(row)
        const claimed = await client.colaConversacionWhatsapp.updateMany({
          where: { id: job.jobId, estado: job.status, leaseOwner: job.leaseOwner },
          data: {
            estado: 'leased',
            leaseOwner: input.owner,
            leaseHasta: new Date(input.leaseUntil),
            intentos: job.attempts + 1,
            fechaActualizacion: now,
          },
        })
        if (claimed.count !== 1) return null
        return {
          ...job,
          status: 'leased',
          leaseOwner: input.owner,
          leaseUntil: input.leaseUntil,
          attempts: job.attempts + 1,
          updatedAt: input.now,
        }
      },
      actualizar: async (job, owner) =>
        (
          await client.colaConversacionWhatsapp.updateMany({
            where: { id: job.jobId, leaseOwner: owner },
            data: sinId(filaTrabajo(job)),
          })
        ).count === 1,
      contarPendientes: async () =>
        client.colaConversacionWhatsapp.count({ where: { estado: { not: 'done' } } }),
    },
    tokens: {
      crear: async (value) => {
        await client.tokenVinculacionWhatsapp.create({
          data: {
            id: value.tokenId,
            contactoId: value.contactId,
            hashToken: value.tokenHash,
            expiraEn: new Date(value.expiresAt),
            usadoEn: fecha(value.usedAt),
            usadoPorCuentaId: value.usedByAccountId,
            fechaCreacion: new Date(value.createdAt),
          },
        })
      },
      buscarPorHash: async (hash) => {
        const row = await client.tokenVinculacionWhatsapp.findFirst({ where: { hashToken: hash } })
        return row ? mapToken(row) : null
      },
      consumir: async (input) =>
        (
          await client.tokenVinculacionWhatsapp.updateMany({
            where: { id: input.tokenId, usadoEn: null, expiraEn: { gt: new Date(input.now) } },
            data: { usadoEn: new Date(input.now), usadoPorCuentaId: input.accountId },
          })
        ).count === 1,
    },
    confirmaciones: {
      crear: async (value) => {
        await client.confirmacionAsistente.create({ data: filaConfirmacion(value) })
      },
      buscar: async (id) => {
        const row = await client.confirmacionAsistente.findFirst({ where: { id } })
        return row ? mapConfirmacion(row) : null
      },
      actualizar: async (value, expected) =>
        (
          await client.confirmacionAsistente.updateMany({
            where: { id: value.confirmationId, estado: expected },
            data: sinId(filaConfirmacion(value)),
          })
        ).count === 1,
    },
    auditoria: {
      registrar: async (event) => {
        await client.auditoriaAsistente.create({
          data: {
            id: event.eventId,
            accion: event.action,
            contactoId: event.contactId,
            conversacionId: event.conversationId,
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

export class TransaccionAsistentePrisma implements PuertoTransaccionAsistente {
  constructor(private readonly client: ClientePrismaAsistente) {}

  async ejecutar<T>(operation: (repositories: RepositoriosAsistente) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await this.client.$transaction(
          (client) => operation(repositoriosAsistentePrisma(client)),
          { isolationLevel: 'Serializable' }
        )
      } catch (error) {
        if (!isSerializationFailure(error)) throw error
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20 * (attempt + 1)))
      }
    }
    throw new ErrorAsistente(
      409,
      'CONCURRENT_MODIFICATION',
      'conversation state changed concurrently; retry'
    )
  }
}

// ---- knowledge index on PostgreSQL (full-text) + existing "RagEmbedding" (pgvector) ----------

const TENANT_CONOCIMIENTO = 'tus-platform'
const WORKSPACE_CONOCIMIENTO = 'conocimiento-tus'

const vectorLiteral = (vector: number[]) =>
  `[${vector.map((value) => (Number.isFinite(value) ? value : 0).toFixed(7)).join(',')}]`

export class IndiceConocimientoPrisma implements PuertoIndiceConocimiento {
  constructor(private readonly client: ClientePrismaAsistente) {}

  async documento(documentId: string) {
    const rows = await this.client.$queryRawUnsafe<Fila[]>(
      'SELECT * FROM public."documentos_conocimiento" WHERE "id" = $1',
      documentId
    )
    const row = rows[0]
    if (!row) return null
    return {
      documentId: String(row['id']),
      source: String(row['fuente']),
      title: String(row['titulo']),
      version: String(row['version']),
      visibility: String(row['visibilidad']) as DocumentoConocimiento['visibility'],
      audience: String(row['audiencia']) as DocumentoConocimiento['audience'],
      language: 'es' as const,
      active: Boolean(row['activo']),
      checksum: String(row['checksum']),
      updatedAt: iso(row['fecha_actualizacion']) ?? '',
      embeddingVersion: texto(row['version_embeddings']),
    }
  }

  async reemplazar(
    document: DocumentoConocimiento,
    chunks: FragmentoConocimiento[],
    vectors: number[][] | null,
    embedding: { model: string; version: string } | null
  ) {
    if (vectors && vectors.some((vector) => vector.length !== DIMENSION_EMBEDDINGS))
      throw new Error('embedding dimension mismatch')
    await this.client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public."documentos_conocimiento" ("id","fuente","titulo","version","visibilidad","audiencia","idioma","activo","checksum","version_embeddings","fecha_actualizacion")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
         ON CONFLICT ("id") DO UPDATE SET "fuente"=EXCLUDED."fuente","titulo"=EXCLUDED."titulo","version"=EXCLUDED."version","visibilidad"=EXCLUDED."visibilidad","audiencia"=EXCLUDED."audiencia","idioma"=EXCLUDED."idioma","activo"=EXCLUDED."activo","checksum"=EXCLUDED."checksum","version_embeddings"=EXCLUDED."version_embeddings","fecha_actualizacion"=now()`,
          document.documentId,
          document.source,
          document.title,
          document.version,
          document.visibility,
          document.audience,
          document.language,
          document.active,
          document.checksum,
          vectors ? (embedding?.version ?? null) : null
        )
        // Obsolete chunks and vectors of the previous version are removed in the same transaction.
        await tx.$executeRawUnsafe(
          'DELETE FROM public."RagEmbedding" WHERE "tenantId" = $1 AND "workspaceId" = $2 AND "sourceId" = $3',
          TENANT_CONOCIMIENTO,
          WORKSPACE_CONOCIMIENTO,
          document.documentId
        )
        await tx.$executeRawUnsafe(
          'DELETE FROM public."fragmentos_conocimiento" WHERE "documento_id" = $1',
          document.documentId
        )
        for (const [index, chunk] of chunks.entries()) {
          await tx.$executeRawUnsafe(
            `INSERT INTO public."fragmentos_conocimiento" ("id","documento_id","version_documento","indice","seccion","texto","visibilidad","audiencia","idioma","activo") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            chunk.chunkId,
            chunk.documentId,
            chunk.documentVersion,
            chunk.chunkIndex,
            chunk.heading,
            chunk.text,
            chunk.visibility,
            chunk.audience,
            chunk.language,
            chunk.active
          )
          const vector = vectors?.[index]
          if (vector && embedding)
            await tx.$executeRawUnsafe(
              `INSERT INTO public."RagEmbedding" ("id","tenantId","workspaceId","sourceId","chunkId","chunkIndex","embeddingModel","embeddingVersion","indexVersion","vector","sourceChecksum","sourceUri","parserVersion","chunkerVersion","retentionUntil","metadata","createdAt","updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector,$11,$12,$13,$14,NULL,$15::jsonb,now(),now())`,
              `rag-conocimiento-${randomUUID()}`,
              TENANT_CONOCIMIENTO,
              WORKSPACE_CONOCIMIENTO,
              document.documentId,
              chunk.chunkId,
              chunk.chunkIndex,
              embedding.model,
              embedding.version,
              VERSION_INDICE,
              vectorLiteral(vector),
              document.checksum,
              document.source,
              'markdown-frontmatter-v1',
              VERSION_CHUNKER,
              JSON.stringify({
                visibility: chunk.visibility,
                audience: chunk.audience,
                language: chunk.language,
                documentVersion: chunk.documentVersion,
              })
            )
        }
      },
      { isolationLevel: 'Serializable' }
    )
  }

  async desactivarExcepto(activeDocumentIds: string[]) {
    const updated = await this.client.$executeRawUnsafe(
      'UPDATE public."documentos_conocimiento" SET "activo" = false, "fecha_actualizacion" = now() WHERE "activo" AND NOT ("id" = ANY($1::text[]))',
      activeDocumentIds
    )
    await this.client.$executeRawUnsafe(
      'UPDATE public."fragmentos_conocimiento" SET "activo" = false WHERE "activo" AND NOT ("documento_id" = ANY($1::text[]))',
      activeDocumentIds
    )
    return updated
  }

  private mapResultados(rows: Fila[]): ResultadoBusqueda[] {
    return rows.map((row) => ({
      documentTitle: String(row['titulo']),
      score: Number(row['score']),
      chunk: {
        chunkId: String(row['id']),
        documentId: String(row['documento_id']),
        documentVersion: String(row['version_documento']),
        chunkIndex: Number(row['indice']),
        heading: String(row['seccion']),
        text: String(row['texto']),
        visibility: String(row['visibilidad']) as FragmentoConocimiento['visibility'],
        audience: String(row['audiencia']) as FragmentoConocimiento['audience'],
        language: 'es',
        active: Boolean(row['activo']),
      },
    }))
  }

  // Visibility, audience, language, active flags and document version are filtered in SQL,
  // before ranking: restricted chunks never reach the application.
  async buscarVector(
    vector: number[],
    filter: FiltroConocimiento,
    limit: number,
    embeddingVersion: string
  ) {
    const rows = await this.client.$queryRawUnsafe<Fila[]>(
      `SELECT f."id", f."documento_id", f."version_documento", f."indice", f."seccion", f."texto", f."visibilidad", f."audiencia", f."activo", d."titulo",
              1 - (e."vector" <=> $1::vector) AS score
         FROM public."RagEmbedding" e
         JOIN public."fragmentos_conocimiento" f ON f."id" = e."chunkId"
         JOIN public."documentos_conocimiento" d ON d."id" = f."documento_id"
        WHERE e."tenantId" = $2 AND e."workspaceId" = $3 AND e."indexVersion" = $4 AND e."embeddingVersion" = $5
          AND f."activo" AND d."activo" AND f."version_documento" = d."version"
          AND f."visibilidad" = ANY($6::text[]) AND f."audiencia" = ANY($7::text[]) AND f."idioma" = $8
        ORDER BY e."vector" <=> $1::vector
        LIMIT $9`,
      vectorLiteral(vector),
      TENANT_CONOCIMIENTO,
      WORKSPACE_CONOCIMIENTO,
      VERSION_INDICE,
      embeddingVersion,
      filter.visibilities,
      filter.audiences,
      filter.language,
      limit
    )
    return this.mapResultados(rows)
  }

  async buscarLexico(query: string, filter: FiltroConocimiento, limit: number) {
    const terms = [...new Set(tokensBusqueda(query))]
      .filter((term) => /^[a-z0-9ñ]+$/u.test(term))
      .slice(0, 12)
    if (terms.length === 0) return []
    const rows = await this.client.$queryRawUnsafe<Fila[]>(
      `SELECT f."id", f."documento_id", f."version_documento", f."indice", f."seccion", f."texto", f."visibilidad", f."audiencia", f."activo", d."titulo",
              (SELECT count(*) FROM unnest($1::text[]) AS t(term) WHERE f."busqueda" @@ to_tsquery('spanish', t.term))::float / cardinality($1::text[]) AS score
         FROM public."fragmentos_conocimiento" f
         JOIN public."documentos_conocimiento" d ON d."id" = f."documento_id"
        WHERE f."busqueda" @@ to_tsquery('spanish', array_to_string($1::text[], ' | '))
          AND f."activo" AND d."activo" AND f."version_documento" = d."version"
          AND f."visibilidad" = ANY($2::text[]) AND f."audiencia" = ANY($3::text[]) AND f."idioma" = $4
        ORDER BY score DESC, ts_rank(f."busqueda", to_tsquery('spanish', array_to_string($1::text[], ' | '))) DESC
        LIMIT $5`,
      terms,
      filter.visibilities,
      filter.audiences,
      filter.language,
      limit
    )
    return this.mapResultados(rows)
  }

  async estadisticas() {
    const rows = await this.client.$queryRawUnsafe<Fila[]>(
      `SELECT (SELECT count(*) FROM public."documentos_conocimiento")::int AS documents,
              (SELECT count(*) FROM public."documentos_conocimiento" WHERE "activo")::int AS active_documents,
              (SELECT count(*) FROM public."fragmentos_conocimiento" WHERE "activo")::int AS chunks,
              (SELECT count(*) FROM public."RagEmbedding" WHERE "tenantId" = $1 AND "workspaceId" = $2)::int AS vectors`,
      TENANT_CONOCIMIENTO,
      WORKSPACE_CONOCIMIENTO
    )
    const row = rows[0] ?? {}
    return {
      documents: Number(row['documents'] ?? 0),
      activeDocuments: Number(row['active_documents'] ?? 0),
      chunks: Number(row['chunks'] ?? 0),
      vectors: Number(row['vectors'] ?? 0),
    }
  }
}
