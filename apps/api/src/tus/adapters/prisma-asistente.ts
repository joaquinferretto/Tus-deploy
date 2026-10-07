import { randomUUID } from 'node:crypto'
import {
  DIMENSION_EMBEDDINGS,
  PESO_ENCABEZADO,
  PESO_FRASE,
  UMBRAL_LEXICO,
  VERSION_CHUNKER,
  fraseNormalizada,
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
  canalDe,
  type CanalConversacion,
  type ConfirmacionAsistente,
  type ContactoWhatsapp,
  type ConversacionWhatsapp,
  type MensajeConversacion,
  type ResumenConversacion,
  type TokenVinculacion,
  type TrabajoConversacion,
} from '../asistente/modelo.ts'
import type { CuentaPorDocumento, PuertoCuentasPorDocumento } from '../asistente/identificacion.ts'
import { VERSION_INDICE_MEMORIA, type FragmentoMemoria, type PuertoIndiceMemoria } from '../asistente/memoria-semantica.ts'
import type { HechoMemoria, PuertoHechos } from '../asistente/hechos.ts'
import type { PuertoTransaccionAsistente, RepositoriosAsistente } from '../asistente/puertos.ts'
import { isSerializationFailure } from './prisma-work.ts'
import type { ConsentimientoWhatsApp } from '../whatsapp/consent.ts'

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
  resumenConversacion: DelegadoPrismaAsistente
  consentimientoWhatsApp?: {
    findUnique(input: {
      where: { tenantId_tipoDestinatario_destinatarioId: { tenantId: string; tipoDestinatario: string; destinatarioId: string } }
    }): Promise<Fila | null>
    upsert(input: {
      where: { tenantId_tipoDestinatario_destinatarioId: { tenantId: string; tipoDestinatario: string; destinatarioId: string } }
      create: Fila
      update: Fila
    }): Promise<Fila>
  }
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

// Rows written before the Web channel existed (and the column default) are WhatsApp.
const canal = (value: unknown): CanalConversacion => (value === 'web' ? 'web' : 'whatsapp')
const filtroPanel = (filter: { mode?: string; channel?: CanalConversacion }): Fila => ({
  ...(filter.mode ? { modo: filter.mode } : {}),
  ...(filter.channel ? { canal: filter.channel } : {}),
})

const filaContacto = (value: ContactoWhatsapp): Fila => ({
  id: value.contactId,
  canal: canalDe(value),
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
  channel: canal(row['canal']),
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
  canal: canalDe(value),
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
  cuentaIdentificadaId: value.identifiedAccountId ?? null,
  identificadaEn: fecha(value.identifiedAt ?? null),
})

const mapConversacion = (row: Fila): ConversacionWhatsapp => ({
  conversationId: String(row['id']),
  contactId: String(row['contactoId']),
  channel: canal(row['canal']),
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
  identifiedAccountId: texto(row['cuentaIdentificadaId']),
  identifiedAt: iso(row['identificadaEn']),
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
  ...(row['secuencia'] === undefined || row['secuencia'] === null ? {} : { sequence: Number(row['secuencia']) }),
})

const mapResumen = (row: Fila): ResumenConversacion => ({
  summaryId: String(row['id']),
  conversationId: String(row['conversacionId']),
  version: Number(row['version']),
  fromSequence: Number(row['desdeSecuencia']),
  throughSequence: Number(row['hastaSecuencia']),
  messageCount: Number(row['mensajes']),
  text: String(row['texto']),
  model: texto(row['modelo']),
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
      buscarVarios: async (ids) =>
        ids.length === 0
          ? []
          : (await client.contactoWhatsapp.findMany({ where: { id: { in: [...ids] } } })).map(mapContacto),
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
      deContacto: async (contactId) => (await client.conversacionWhatsapp.findMany({ where: { contactoId: contactId }, orderBy: { abiertaEn: 'desc' } })).map(mapConversacion),
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
            where: filtroPanel(filter),
            orderBy: [{ ultimoMensajeEn: 'desc' }, { id: 'desc' }],
            ...(filter.offset ? { skip: filter.offset } : {}),
            take: filter.limit ?? 100,
          })
        ).map(mapConversacion),
      contar: async (filter) => client.conversacionWhatsapp.count({ where: filtroPanel(filter) }),
      identificadasPor: async (accountId) =>
        (await client.conversacionWhatsapp.findMany({ where: { cuentaIdentificadaId: accountId, estado: 'active' } })).map(mapConversacion),
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
      posteriores: async (conversationId, input) =>
        (
          await client.mensajeConversacionWhatsapp.findMany({
            where: { conversacionId: conversationId, estado: { not: 'rate_limited' }, secuencia: { gt: BigInt(input.after) } },
            orderBy: { secuencia: 'asc' },
            take: input.limit,
          })
        ).map(mapMensaje),
      // ix_mensajes_conversacion_whatsapp_correlacion.
      porCorrelaciones: async (ids) =>
        ids.length === 0 ? [] : (await client.mensajeConversacionWhatsapp.findMany({ where: { correlacionId: { in: [...ids] } }, orderBy: { secuencia: 'asc' } })).map(mapMensaje),
      // ix_mensajes_conversacion_whatsapp_secuencia: the page right before `before`, oldest first.
      pagina: async (conversationId, input) =>
        (
          await client.mensajeConversacionWhatsapp.findMany({
            where: { conversacionId: conversationId, estado: { not: 'rate_limited' }, ...(input.before === null ? {} : { secuencia: { lt: BigInt(input.before) } }) },
            orderBy: { secuencia: 'desc' },
            take: input.limit,
          })
        )
          .map(mapMensaje)
          .reverse(),
      // DISTINCT ON walks ix_mensajes_conversacion_whatsapp_historial once per conversation: the
      // newest non rate-limited message of each, like `ultimos(id, 1)`, in a single statement.
      ultimoDeConversaciones: async (ids) =>
        ids.length === 0
          ? []
          : (
              await client.$queryRawUnsafe<Fila[]>(
                `SELECT DISTINCT ON ("conversacion_id")
                   "id", "conversacion_id" AS "conversacionId", "contacto_id" AS "contactoId", "wamid",
                   "direccion", "tipo", "texto", "estado", "estado_en" AS "estadoEn",
                   "fecha_externa" AS "fechaExterna", "responde_a_wamid" AS "respondeAWamid", "actor",
                   "metadata", "correlacion_id" AS "correlacionId", "fecha_creacion" AS "fechaCreacion"
                 FROM public."mensajes_conversacion_whatsapp"
                 WHERE "conversacion_id" = ANY($1::text[]) AND "estado" <> 'rate_limited'
                 ORDER BY "conversacion_id", "fecha_creacion" DESC`,
                [...ids]
              )
            ).map(mapMensaje),
      contar: async (conversationId) =>
        client.mensajeConversacionWhatsapp.count({ where: { conversacionId: conversationId } }),
      contarEntrantesDesde: async (contactId, since, types) =>
        client.mensajeConversacionWhatsapp.count({
          where: {
            contactoId: contactId,
            direccion: 'inbound',
            fechaCreacion: { gte: new Date(since) },
            ...(types ? { tipo: { in: [...types] } } : {}),
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
      // ix_confirmaciones_asistente_conversacion.
      ejecutadasDe: async (conversationId, tool) =>
        (await client.confirmacionAsistente.findMany({ where: { conversacionId: conversationId, herramienta: tool, estado: 'executed' }, orderBy: { fechaCreacion: 'asc' } })).map(mapConfirmacion),
    },
    resumenes: {
      vigente: async (conversationId) => {
        const row = await client.resumenConversacion.findFirst({ where: { conversacionId: conversationId }, orderBy: { version: 'desc' } })
        return row ? mapResumen(row) : null
      },
      listar: async (conversationId) => (await client.resumenConversacion.findMany({ where: { conversacionId: conversationId }, orderBy: { version: 'asc' } })).map(mapResumen),
      crear: async (value) => {
        await client.resumenConversacion.create({
          data: { id: value.summaryId, conversacionId: value.conversationId, version: value.version, desdeSecuencia: BigInt(value.fromSequence), hastaSecuencia: BigInt(value.throughSequence), mensajes: value.messageCount, texto: value.text, modelo: value.model, fechaCreacion: new Date(value.createdAt) },
        })
      },
      eliminar: async (conversationId, desde) =>
        Number(await client.$executeRawUnsafe('DELETE FROM public."resumenes_conversacion" WHERE "conversacion_id" = $1 AND ($2::bigint IS NULL OR "hasta_secuencia" >= $2::bigint)', conversationId, desde)),
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
      // ix_auditoria_asistente_correlacion.
      porCorrelaciones: async (input) =>
        input.correlationIds.length === 0
          ? []
          : (await client.auditoriaAsistente.findMany({ where: { accion: input.action, correlacionId: { in: [...input.correlationIds] } }, orderBy: { fechaCreacion: 'asc' } })).map((row: Fila) => ({
              eventId: String(row['id']),
              action: String(row['accion']),
              contactId: row['contactoId'] === null ? null : String(row['contactoId']),
              conversationId: row['conversacionId'] === null ? null : String(row['conversacionId']),
              actorId: String(row['actorId']),
              correlationId: String(row['correlacionId']),
              metadata: (row['metadata'] ?? {}) as Record<string, unknown>,
              createdAt: (row['fechaCreacion'] as Date).toISOString(),
            })),
      contarDesde: async (input) =>
        client.auditoriaAsistente.count({ where: { conversacionId: input.conversationId, accion: input.action, fechaCreacion: { gte: new Date(input.since) } } }),
    },
    consentimientosWhatsapp: {
      buscar: async (tenantId, recipientType, recipientId) => {
        const row = await client.consentimientoWhatsApp?.findUnique({
          where: {
            tenantId_tipoDestinatario_destinatarioId: {
              tenantId,
              tipoDestinatario: recipientType,
              destinatarioId: recipientId,
            },
          },
        })
        if (!row) return null
        return {
          consentId: String(row['id']),
          tenantId: String(row['tenantId']),
          recipientType: String(row['tipoDestinatario']) as ConsentimientoWhatsApp['recipientType'],
          recipientId: String(row['destinatarioId']),
          status: String(row['estado']) as ConsentimientoWhatsApp['status'],
          source: String(row['origen']),
          grantedAt: new Date(String(row['fechaOtorgamiento'])).toISOString(),
          revokedAt: row['fechaRevocacion'] ? new Date(String(row['fechaRevocacion'])).toISOString() : null,
          updatedAt: new Date(String(row['fechaActualizacion'])).toISOString(),
          retentionUntil: new Date(String(row['fechaActualizacion'])).toISOString(),
        }
      },
      guardar: async (value: ConsentimientoWhatsApp) => {
        if (!client.consentimientoWhatsApp) return
        await client.consentimientoWhatsApp.upsert({
          where: {
            tenantId_tipoDestinatario_destinatarioId: {
              tenantId: value.tenantId,
              tipoDestinatario: value.recipientType,
              destinatarioId: value.recipientId,
            },
          },
          create: {
            id: value.consentId,
            tenantId: value.tenantId,
            destinatarioId: value.recipientId,
            tipoDestinatario: value.recipientType,
            estado: value.status,
            origen: value.source,
            fechaOtorgamiento: new Date(value.grantedAt),
            fechaRevocacion: null,
            fechaCreacion: new Date(value.grantedAt),
            fechaActualizacion: new Date(value.updatedAt),
          },
          update: {
            tipoDestinatario: value.recipientType,
            estado: value.status,
            origen: value.source,
            fechaOtorgamiento: new Date(value.grantedAt),
            fechaRevocacion: null,
            fechaActualizacion: new Date(value.updatedAt),
          },
        })
      },
    },
  }
}

// Account of a person by its document (TURNOS-SENA-01). The document is unique per person in
// the database (uq_user_documento); among the accounts of that person the oldest active one is
// the person's own. Read-only.
export class CuentasPorDocumentoPrisma implements PuertoCuentasPorDocumento {
  constructor(
    private readonly client: {
      user: { findFirst(input: { where: Fila; include: Fila }): Promise<Fila | null> }
    }
  ) {}

  async buscarPorDocumento(tipo: string, numero: string): Promise<CuentaPorDocumento | null> {
    const persona = await this.client.user.findFirst({
      where: { documentType: tipo, documentNumber: numero },
      include: { accounts: { where: { status: 'active' }, orderBy: { createdAt: 'asc' }, take: 1 } },
    })
    const cuenta = (persona?.['accounts'] as Fila[] | undefined)?.[0]
    if (!persona || !cuenta) return null
    return {
      accountId: String(cuenta['id']),
      tenantId: String(cuenta['tenantId']),
      firstName: texto(persona['firstName']),
      lastName: texto(persona['lastName']),
      displayName: String(persona['displayName'] ?? ''),
    }
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
    // Mismo ranking que IndiceConocimientoEnMemoria: cobertura + PESO_ENCABEZADO × cobertura en
    // título/sección + PESO_FRASE si la pregunta es una frase del título o la sección. $6 solo
    // contiene [a-z0-9ñ ] (fraseNormalizada), así que es seguro dentro de LIKE.
    // Cada término cuenta si coincide con el diccionario 'spanish' (stemming) O con 'simple': en
    // PostgreSQL "tus" es stopword de 'spanish', así que sin 'simple' la marca TUS nunca coincidía.
    const frase = fraseNormalizada(query)
    const rows = await this.client.$queryRawUnsafe<Fila[]>(
      `WITH candidatos AS (
         SELECT f."id", f."documento_id", f."version_documento", f."indice", f."seccion", f."texto", f."visibilidad", f."audiencia", f."activo", d."titulo", f."busqueda",
                (SELECT count(*) FROM unnest($1::text[]) AS t(term)
                  WHERE f."busqueda" @@ to_tsquery('spanish', t.term)
                     OR to_tsvector('simple', f."seccion" || ' ' || f."texto") @@ to_tsquery('simple', t.term))::float / cardinality($1::text[]) AS cobertura,
                (SELECT count(*) FROM unnest($1::text[]) AS t(term)
                  WHERE to_tsvector('spanish', d."titulo" || ' ' || f."seccion") @@ to_tsquery('spanish', t.term)
                     OR to_tsvector('simple', d."titulo" || ' ' || f."seccion") @@ to_tsquery('simple', t.term))::float / cardinality($1::text[]) AS cobertura_encabezado,
                (length($6) >= 4 AND (
                  regexp_replace(translate(lower(d."titulo"), 'áéíóúü', 'aeiouu'), '[^a-z0-9ñ]+', ' ', 'g') LIKE '%' || $6 || '%'
                  OR regexp_replace(translate(lower(f."seccion"), 'áéíóúü', 'aeiouu'), '[^a-z0-9ñ]+', ' ', 'g') LIKE '%' || $6 || '%'
                )) AS frase_exacta
           FROM public."fragmentos_conocimiento" f
           JOIN public."documentos_conocimiento" d ON d."id" = f."documento_id"
          WHERE (f."busqueda" @@ to_tsquery('spanish', array_to_string($1::text[], ' | '))
                 OR to_tsvector('simple', f."seccion" || ' ' || f."texto") @@ to_tsquery('simple', array_to_string($1::text[], ' | ')))
            AND f."activo" AND d."activo" AND f."version_documento" = d."version"
            AND f."visibilidad" = ANY($2::text[]) AND f."audiencia" = ANY($3::text[]) AND f."idioma" = $4
       )
       SELECT "id", "documento_id", "version_documento", "indice", "seccion", "texto", "visibilidad", "audiencia", "activo", "titulo",
              CASE WHEN cobertura < ${UMBRAL_LEXICO} THEN cobertura
                   ELSE cobertura + ${PESO_ENCABEZADO} * cobertura_encabezado + CASE WHEN frase_exacta THEN ${PESO_FRASE} ELSE 0 END
              END AS score
         FROM candidatos
        ORDER BY score DESC, ts_rank("busqueda", to_tsquery('spanish', array_to_string($1::text[], ' | '))) DESC
        LIMIT $5`,
      terms,
      filter.visibilities,
      filter.audiences,
      filter.language,
      limit,
      frase
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

// ---- semantic memory of conversations on PostgreSQL + the existing "RagEmbedding" (pgvector) ---
// The account is part of the WHERE of every query: the similarity ordering only ever sees the
// vectors of that account (tenant 'tus-memoria', workspace = the account).
const TENANT_MEMORIA = 'tus-memoria'

const mapFragmento = (row: Fila): FragmentoMemoria => ({
  fragmentId: String(row['id']),
  accountId: String(row['cuenta_id']),
  conversationId: String(row['conversacion_id']),
  channel: String(row['canal']) as FragmentoMemoria['channel'],
  fromSequence: Number(row['desde_secuencia']),
  throughSequence: Number(row['hasta_secuencia']),
  text: String(row['texto']),
  checksum: String(row['checksum']),
  createdAt: iso(row['fecha_creacion'])!,
  expiresAt: iso(row['expira_en']),
})

export class IndiceMemoriaPrisma implements PuertoIndiceMemoria {
  constructor(private readonly client: ClientePrismaAsistente) {}

  // The fragment and its vector are written together or not at all.
  async guardar(fragment: FragmentoMemoria, vector: number[], embedding: { model: string; version: string }) {
    if (vector.length !== DIMENSION_EMBEDDINGS) throw new Error('memory vector has an unexpected dimension')
    return this.client.$transaction(async (tx) => {
      const insertados = await tx.$executeRawUnsafe(
        `INSERT INTO public."fragmentos_memoria" ("id","cuenta_id","conversacion_id","canal","desde_secuencia","hasta_secuencia","texto","checksum","version_embeddings","fecha_creacion","expira_en")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz)
         ON CONFLICT ("conversacion_id","desde_secuencia","hasta_secuencia") DO NOTHING`,
        fragment.fragmentId, fragment.accountId, fragment.conversationId, fragment.channel, fragment.fromSequence, fragment.throughSequence, fragment.text, fragment.checksum, embedding.version, fragment.createdAt, fragment.expiresAt
      )
      if (Number(insertados) === 0) return 'existente' as const
      await tx.$executeRawUnsafe(
        `INSERT INTO public."RagEmbedding" ("id","tenantId","workspaceId","sourceId","chunkId","chunkIndex","embeddingModel","embeddingVersion","indexVersion","vector","sourceChecksum","sourceUri","parserVersion","chunkerVersion","retentionUntil","metadata","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector,$11,$12,$13,$14,$15::timestamptz,$16::jsonb,now(),now())`,
        `rag-memoria-${fragment.fragmentId}`, TENANT_MEMORIA, fragment.accountId, fragment.conversationId, fragment.fragmentId, fragment.fromSequence % 2_147_483_647, embedding.model, embedding.version, VERSION_INDICE_MEMORIA,
        vectorLiteral(vector), fragment.checksum, `memoria://conversacion/${fragment.conversationId}`, 'memoria-v1', 'mensajes-v1', fragment.expiresAt, JSON.stringify({ channel: fragment.channel })
      )
      return 'guardado' as const
    })
  }

  async buscar(input: { accountId: string; vector: number[]; embeddingVersion: string; limit: number; now: string }) {
    if (!input.accountId) return []
    const rows = await this.client.$queryRawUnsafe<Fila[]>(
      `SELECT f.*, 1 - (e."vector" <=> $1::vector) AS score
         FROM public."RagEmbedding" e
         JOIN public."fragmentos_memoria" f ON f."id" = e."chunkId"
        WHERE e."tenantId" = $2 AND e."workspaceId" = $3 AND f."cuenta_id" = $3
          AND e."indexVersion" = $4 AND e."embeddingVersion" = $5
          AND (f."expira_en" IS NULL OR f."expira_en" > $6::timestamptz)
        ORDER BY e."vector" <=> $1::vector
        LIMIT $7`,
      vectorLiteral(input.vector), TENANT_MEMORIA, input.accountId, VERSION_INDICE_MEMORIA, input.embeddingVersion, input.now, input.limit
    )
    return rows.map((row) => ({ fragment: mapFragmento(row), score: Number(row['score']) }))
  }

  async deCuenta(accountId: string) {
    return (await this.client.$queryRawUnsafe<Fila[]>('SELECT * FROM public."fragmentos_memoria" WHERE "cuenta_id" = $1 ORDER BY "fecha_creacion", "desde_secuencia"', accountId)).map(mapFragmento)
  }

  async tiene(accountId: string) {
    if (!accountId) return false
    return (await this.client.$queryRawUnsafe<Fila[]>('SELECT 1 AS uno FROM public."fragmentos_memoria" WHERE "cuenta_id" = $1 LIMIT 1', accountId)).length > 0
  }

  // The vectors first, then the fragments, in one transaction: neither is left without the other.
  private async quitar(condicion: string, parametros: unknown[]): Promise<number> {
    return this.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM public."RagEmbedding" e USING public."fragmentos_memoria" f WHERE e."tenantId" = '${TENANT_MEMORIA}' AND e."chunkId" = f."id" AND ${condicion}`, ...parametros)
      return Number(await tx.$executeRawUnsafe(`DELETE FROM public."fragmentos_memoria" f WHERE ${condicion}`, ...parametros))
    })
  }

  async eliminar(input: { accountId: string; conversationId?: string; afterSequence?: number }) {
    if (!input.accountId) return 0
    return this.quitar('f."cuenta_id" = $1 AND ($2::text IS NULL OR f."conversacion_id" = $2) AND ($3::bigint IS NULL OR f."hasta_secuencia" > $3::bigint)', [input.accountId, input.conversationId ?? null, input.afterSequence ?? null])
  }

  async eliminarVencidos(now: string) {
    return this.quitar('f."expira_en" IS NOT NULL AND f."expira_en" <= $1::timestamptz', [now])
  }

  async origenes(limit: number) {
    const rows = await this.client.$queryRawUnsafe<Fila[]>('SELECT DISTINCT "cuenta_id", "conversacion_id" FROM public."fragmentos_memoria" ORDER BY "cuenta_id", "conversacion_id" LIMIT $1', limit)
    return rows.map((row) => ({ accountId: String(row['cuenta_id']), conversationId: String(row['conversacion_id']) }))
  }
}

// ---- facts of an account on PostgreSQL ------------------------------------------------------------
const mapHecho = (row: Fila): HechoMemoria => ({
  factId: String(row['id']),
  accountId: String(row['cuenta_id']),
  type: String(row['tipo']) as HechoMemoria['type'],
  value: String(row['valor']),
  conversationId: texto(row['conversacion_id']),
  sourceMessageId: texto(row['mensaje_origen_id']),
  channel: String(row['canal']) as HechoMemoria['channel'],
  confidence: row['confianza'] === null || row['confianza'] === undefined ? null : Number(row['confianza']),
  createdAt: iso(row['fecha_creacion'])!,
  updatedAt: iso(row['fecha_actualizacion'])!,
  expiresAt: iso(row['expira_en']),
  invalidatedAt: iso(row['invalidado_en']),
  invalidationReason: texto(row['motivo_invalidacion']),
})

export class HechosPrisma implements PuertoHechos {
  constructor(private readonly client: ClientePrismaAsistente) {}

  async activos(accountId: string, now: string) {
    return (await this.client.$queryRawUnsafe<Fila[]>('SELECT * FROM public."hechos_memoria" WHERE "cuenta_id" = $1 AND "invalidado_en" IS NULL AND ("expira_en" IS NULL OR "expira_en" > $2::timestamptz) ORDER BY "tipo"', accountId, now)).map(mapHecho)
  }

  async historial(accountId: string) {
    return (await this.client.$queryRawUnsafe<Fila[]>('SELECT * FROM public."hechos_memoria" WHERE "cuenta_id" = $1 ORDER BY "fecha_creacion", "id"', accountId)).map(mapHecho)
  }

  // Refresh, or invalidate + insert, in one transaction; the partial unique index decides a race.
  async guardar(hecho: HechoMemoria): Promise<'guardado' | 'reemplazado' | 'sin_cambio'> {
    const intento = () =>
      this.client.$transaction(async (tx) => {
        const [activo] = await tx.$queryRawUnsafe<Fila[]>('SELECT "id", "valor" FROM public."hechos_memoria" WHERE "cuenta_id" = $1 AND "tipo" = $2 AND "invalidado_en" IS NULL FOR UPDATE', hecho.accountId, hecho.type)
        if (activo && String(activo['valor']) === hecho.value) {
          await tx.$executeRawUnsafe('UPDATE public."hechos_memoria" SET "fecha_actualizacion" = $2::timestamptz, "expira_en" = $3::timestamptz WHERE "id" = $1', String(activo['id']), hecho.updatedAt, hecho.expiresAt)
          return 'sin_cambio' as const
        }
        if (activo) await tx.$executeRawUnsafe('UPDATE public."hechos_memoria" SET "invalidado_en" = $2::timestamptz, "motivo_invalidacion" = $3 WHERE "id" = $1', String(activo['id']), hecho.createdAt, 'reemplazado')
        await tx.$executeRawUnsafe(
          `INSERT INTO public."hechos_memoria" ("id","cuenta_id","tipo","valor","conversacion_id","mensaje_origen_id","canal","confianza","fecha_creacion","fecha_actualizacion","expira_en")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::timestamptz,$10::timestamptz,$11::timestamptz)`,
          hecho.factId, hecho.accountId, hecho.type, hecho.value, hecho.conversationId, hecho.sourceMessageId, hecho.channel, hecho.confidence, hecho.createdAt, hecho.updatedAt, hecho.expiresAt
        )
        return activo ? ('reemplazado' as const) : ('guardado' as const)
      })
    // Several writers of the same type at once: whoever loses the unique index (or finds the row
    // it locked already replaced) tries again and sees the winner. Bounded.
    for (let vuelta = 0; ; vuelta += 1) {
      try {
        return await intento()
      } catch (error) {
        const conflicto = /23505|P2002|40001|40P01|uq_hechos_memoria_activo/u.test(`${(error as { code?: string })?.code ?? ''} ${(error as Error)?.message ?? ''}`)
        if (!conflicto || vuelta >= 7) throw error
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 25 * (vuelta + 1)))
      }
    }
  }

  async invalidar(input: { accountId: string; type: HechoMemoria['type'] | null; reason: string; now: string }) {
    return Number(
      await this.client.$executeRawUnsafe(
        'UPDATE public."hechos_memoria" SET "invalidado_en" = $3::timestamptz, "motivo_invalidacion" = $4 WHERE "cuenta_id" = $1 AND "invalidado_en" IS NULL AND ($2::text IS NULL OR "tipo" = $2)',
        input.accountId, input.type, input.now, input.reason.slice(0, 80)
      )
    )
  }

  async eliminar(accountId: string, factId: string) {
    return Number(await this.client.$executeRawUnsafe('DELETE FROM public."hechos_memoria" WHERE "cuenta_id" = $1 AND "id" = $2', accountId, factId)) > 0
  }

  async eliminarDeOrigen(input: { accountId: string; conversationId?: string; messageId?: string }) {
    if (!input.accountId) return 0
    return Number(
      await this.client.$executeRawUnsafe(
        'DELETE FROM public."hechos_memoria" WHERE "cuenta_id" = $1 AND ($2::text IS NULL OR "conversacion_id" = $2) AND ($3::text IS NULL OR "mensaje_origen_id" = $3)',
        input.accountId, input.conversationId ?? null, input.messageId ?? null
      )
    )
  }

  async depurar(antes: string) {
    return Number(await this.client.$executeRawUnsafe('DELETE FROM public."hechos_memoria" WHERE ("invalidado_en" IS NOT NULL AND "invalidado_en" < $1::timestamptz) OR ("expira_en" IS NOT NULL AND "expira_en" < $1::timestamptz)', antes))
  }
}
