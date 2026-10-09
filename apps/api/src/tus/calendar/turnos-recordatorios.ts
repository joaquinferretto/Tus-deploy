import { randomUUID } from 'node:crypto'

import type { Prisma, PrismaClient } from '@prisma/client'

// TURNOS-RECORDATORIOS-01. Reminders of a confirmed turno: 24 hours and 2 hours before it, for its
// client and for its provider.
//
// Nothing is kept in memory and no timer belongs to a turno. Every reminder is a row
// (recordatorios_turno) with the instant it is due; `procesar` is a sweep that any process may run
// any number of times:
//   1. it computes the reminders of the confirmed turnos that do not have theirs yet (one per
//      turno + recipient + kind, a UNIQUE index: two processes cannot compute it twice);
//   2. it invalidates the pending ones of a turno whose time changed (new ones are computed);
//   3. it sends what is due, taking each row first (pending -> sending in one UPDATE): a reminder
//      is sent by one process only, and a restart neither repeats nor forgets it.
// It does not depend on any language model.

export type TipoRecordatorio = '24h' | '2h'
export type DestinatarioRecordatorio = 'cliente' | 'prestador'
export const ANTICIPACION_RECORDATORIO_MS: Record<TipoRecordatorio, number> = { '24h': 24 * 60 * 60 * 1000, '2h': 2 * 60 * 60 * 1000 }
// How far ahead the sweep looks for confirmed turnos, and how long a row may stay taken.
const HORIZONTE_MS = 8 * 24 * 60 * 60 * 1000
const RECLAMO_VENCIDO_MS = 10 * 60 * 1000

// What a reply button of a reminder carries: the answer and WHICH reminder. Who answers is the
// account linked to the number; the backend checks the reminder is theirs.
export type AccionRecordatorio = 'asiste' | 'nopuede' | 'cancelar' | 'cancelar-perdida' | 'volver'
export const idRecordatorio = (accion: AccionRecordatorio, recordatorioId: string): string => `recordatorio:${accion}:${recordatorioId}`
export function leerRecordatorio(replyId: string | null | undefined): { accion: AccionRecordatorio; recordatorioId: string } | null {
  const partes = /^recordatorio:(asiste|nopuede|cancelar-perdida|cancelar|volver):(rec-[A-Za-z0-9-]{8,64})$/u.exec(replyId ?? '')
  return partes ? { accion: partes[1] as AccionRecordatorio, recordatorioId: partes[2]! } : null
}

export interface AvisoRecordatorioTurno {
  recordatorioId: string
  reservaId: string
  tipo: TipoRecordatorio
  destinatario: DestinatarioRecordatorio
  // The account that receives it and how it is greeted.
  cuentaId: string
  nombre: string
  // The other party of the turno, as the recipient knows it.
  contraparte: string
  servicio: string
  inicio: Date
  // The client paid something in advance (only then is the loss of the deposit mentioned).
  conPago: boolean
}

export type ResultadoEnvioRecordatorio =
  | { enviado: true; via: 'plantilla' | 'ventana'; plantilla: string | null; wamid: string | null }
  | { enviado: false; motivo: 'sin_whatsapp' | 'requiere_plantilla' | 'con_operador' | 'fallo_envio' | 'sin_canal' }

export interface CanalRecordatoriosTurno {
  recordatorio(aviso: AvisoRecordatorioTurno): Promise<ResultadoEnvioRecordatorio>
}

// What the reminder needs to know of a turno (names and accounts, as the other notices read them).
export interface DatosTurnoRecordatorio {
  clienteCuentaId: string
  prestadorCuentaId: string | null
  clienteNombre: string
  prestadorNombre: string
  servicio: string
  conPago: boolean
}

export interface ResultadoBarridoRecordatorios {
  programados: number
  invalidados: number
  enviados: string[]
  omitidos: Record<string, string>
  fallidos: string[]
}

export interface RecordatorioRespondido {
  recordatorioId: string
  reservaId: string
  tipo: TipoRecordatorio
  destinatario: DestinatarioRecordatorio
  tenantId: string
  turnoEstado: string
  inicio: Date
  servicio: string
  contraparte: string
  conPago: boolean
}

type FilaRecordatorio = Prisma.RecordatorioTurnoGetPayload<Record<string, never>>

export class ServicioRecordatoriosTurno {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly datos: (reservaId: string) => Promise<DatosTurnoRecordatorio | null>,
    private canal: CanalRecordatoriosTurno | null,
    private readonly now: () => number = Date.now
  ) {}

  // Wired once the channels exist (the WhatsApp module is built after this service).
  conCanal(canal: CanalRecordatoriosTurno): this {
    this.canal = canal
    return this
  }

  async procesar(limit = 50): Promise<ResultadoBarridoRecordatorios> {
    const resultado: ResultadoBarridoRecordatorios = { programados: 0, invalidados: 0, enviados: [], omitidos: {}, fallidos: [] }
    const ahora = new Date(this.now())
    // A row taken by a process that died before recording its outcome is not sent again (the
    // message may have left): it is closed as failed, visible to the administration.
    await this.prisma.recordatorioTurno.updateMany({ where: { estado: 'sending', reclamadoEn: { lt: new Date(ahora.getTime() - RECLAMO_VENCIDO_MS) } }, data: { estado: 'failed', motivo: 'interrumpido', fechaActualizacion: ahora } })
    // The time of the turno changed: what was still to be sent was computed for another instant.
    resultado.invalidados = Number(
      await this.prisma.$executeRaw`UPDATE public."recordatorios_turno" r SET "estado" = 'invalidated', "motivo" = 'turno_reprogramado', "fecha_actualizacion" = ${ahora} FROM public."reservas" v WHERE v."id" = r."reserva_id" AND r."estado" = 'pending' AND v."fecha_inicio" <> r."turno_inicio"`
    )
    resultado.programados = await this.programar(ahora)
    const vencidos = await this.prisma.recordatorioTurno.findMany({ where: { estado: 'pending', programadoPara: { lte: ahora } }, orderBy: [{ programadoPara: 'asc' }, { id: 'asc' }], take: limit })
    for (const fila of vencidos) await this.enviar(fila, ahora, resultado)
    return resultado
  }

  // The reminders of every confirmed turno that is still to come and has not got them yet.
  private async programar(ahora: Date): Promise<number> {
    const turnos = await this.prisma.reserva.findMany({
      where: { estado: 'confirmed', fechaInicio: { gt: ahora, lte: new Date(ahora.getTime() + HORIZONTE_MS) } },
      select: { id: true, tenantId: true, fechaInicio: true, fechaActualizacion: true, esInvitado: true },
      orderBy: { fechaInicio: 'asc' },
      take: 500,
    })
    if (turnos.length === 0) return 0
    const existentes = new Set((await this.prisma.recordatorioTurno.findMany({ where: { reservaId: { in: turnos.map((turno) => turno.id) } }, select: { reservaId: true, destinatario: true, tipo: true, turnoInicio: true } })).map((fila) => `${fila.reservaId}|${fila.destinatario}|${fila.tipo}|${fila.turnoInicio.getTime()}`))
    const nuevos: Prisma.RecordatorioTurnoCreateManyInput[] = []
    for (const turno of turnos) {
      // A guest of the provider's own agenda has no account to be reminded through.
      const destinatarios: DestinatarioRecordatorio[] = turno.esInvitado ? ['prestador'] : ['cliente', 'prestador']
      for (const destinatario of destinatarios)
        for (const tipo of ['24h', '2h'] as const) {
          if (existentes.has(`${turno.id}|${destinatario}|${tipo}|${turno.fechaInicio.getTime()}`)) continue
          const programadoPara = new Date(turno.fechaInicio.getTime() - ANTICIPACION_RECORDATORIO_MS[tipo])
          // Confirmed when that reminder was already due: it is not sent late ("tomorrow" would no
          // longer be true). The one of 2 hours is still computed, and sent if it still applies.
          const tarde = turno.fechaActualizacion.getTime() > programadoPara.getTime()
          // A first sweep delayed after rescheduling must not create a retroactive 24h notice.
          // Existing pending notices keep their normal delivery rules; the 2h notice still applies.
          const retroactivo24 = tipo === '24h' && programadoPara.getTime() < ahora.getTime()
          nuevos.push({ id: `rec-${randomUUID()}`, tenantId: turno.tenantId, reservaId: turno.id, destinatario, tipo, turnoInicio: turno.fechaInicio, programadoPara, estado: tarde || retroactivo24 ? 'skipped' : 'pending', motivo: tarde ? `confirmado_con_menos_de_${tipo}` : retroactivo24 ? 'programado_fuera_de_24h' : null, fechaCreacion: ahora, fechaActualizacion: ahora })
        }
    }
    if (nuevos.length === 0) return 0
    // Two processes may compute the same reminder at once: the UNIQUE index keeps one.
    return (await this.prisma.recordatorioTurno.createMany({ data: nuevos, skipDuplicates: true })).count
  }

  private async enviar(fila: FilaRecordatorio, ahora: Date, resultado: ResultadoBarridoRecordatorios): Promise<void> {
    const omitir = async (motivo: string) => {
      const cerrado = await this.prisma.recordatorioTurno.updateMany({ where: { id: fila.id, estado: { in: ['pending', 'sending'] } }, data: { estado: 'skipped', motivo, fechaActualizacion: ahora } })
      if (cerrado.count > 0) resultado.omitidos[fila.id] = motivo
    }
    const reserva = await this.prisma.reserva.findUnique({ where: { id: fila.reservaId }, select: { estado: true, fechaInicio: true } })
    // Only a turno that is still confirmed, for the time this reminder was computed for.
    if (!reserva || reserva.estado !== 'confirmed') return omitir(`turno_${reserva?.estado ?? 'inexistente'}`)
    if (reserva.fechaInicio.getTime() !== fila.turnoInicio.getTime()) return omitir('turno_reprogramado')
    if (reserva.fechaInicio.getTime() <= ahora.getTime()) return omitir('turno_ya_empezo')
    // The reminder of the day before was due long ago (the API was down): by now the one of 2
    // hours says what matters.
    if (fila.tipo === '24h' && ahora.getTime() >= reserva.fechaInicio.getTime() - ANTICIPACION_RECORDATORIO_MS['2h']) return omitir('vencido')
    const datos = await this.datos(fila.reservaId)
    const cuentaId = datos ? (fila.destinatario === 'cliente' ? datos.clienteCuentaId : datos.prestadorCuentaId) : null
    if (!datos || !cuentaId) return omitir('sin_cuenta')
    // Taken by this process, or by none: nobody else sends this row.
    const tomado = await this.prisma.recordatorioTurno.updateMany({ where: { id: fila.id, estado: 'pending' }, data: { estado: 'sending', reclamadoEn: ahora, fechaActualizacion: ahora } })
    if (tomado.count !== 1) return
    const aviso: AvisoRecordatorioTurno = {
      recordatorioId: fila.id,
      reservaId: fila.reservaId,
      tipo: fila.tipo as TipoRecordatorio,
      destinatario: fila.destinatario as DestinatarioRecordatorio,
      cuentaId,
      nombre: fila.destinatario === 'cliente' ? datos.clienteNombre : datos.prestadorNombre,
      contraparte: fila.destinatario === 'cliente' ? datos.prestadorNombre : datos.clienteNombre,
      servicio: datos.servicio,
      inicio: reserva.fechaInicio,
      conPago: datos.conPago,
    }
    const envio: ResultadoEnvioRecordatorio = this.canal ? await this.canal.recordatorio(aviso).catch(() => ({ enviado: false as const, motivo: 'fallo_envio' as const })) : { enviado: false, motivo: 'sin_canal' }
    if (envio.enviado) {
      await this.prisma.recordatorioTurno.update({ where: { id: fila.id }, data: { estado: 'sent', via: envio.via, plantilla: envio.plantilla, wamid: envio.wamid, enviadoEn: ahora, fechaActualizacion: ahora } })
      resultado.enviados.push(fila.id)
      return
    }
    if (envio.motivo === 'fallo_envio') {
      await this.prisma.recordatorioTurno.update({ where: { id: fila.id }, data: { estado: 'failed', motivo: envio.motivo, fechaActualizacion: ahora } })
      resultado.fallidos.push(fila.id)
      return
    }
    // Nothing could be written to that account (no number, an operator has the conversation, or
    // the window is closed and the template is not approved): recorded with its reason.
    return omitir(envio.motivo)
  }

  /**
   * The answer to a reminder, from the account it was sent to. Recorded on the reminder (answer,
   * when, who, channel); repeating the same button changes nothing. It cancels nothing by itself.
   */
  async responder(input: { recordatorioId: string; cuentaId: string; respuesta: 'asiste' | 'no_puede'; canal: 'whatsapp' | 'web' }): Promise<RecordatorioRespondido | null> {
    const fila = await this.prisma.recordatorioTurno.findUnique({ where: { id: input.recordatorioId } })
    if (!fila) return null
    const datos = await this.datos(fila.reservaId)
    const propia = datos && (fila.destinatario === 'cliente' ? datos.clienteCuentaId : datos.prestadorCuentaId) === input.cuentaId
    // Somebody else's reminder does not exist for this account.
    if (!datos || !propia) return null
    const reserva = await this.prisma.reserva.findUnique({ where: { id: fila.reservaId }, select: { estado: true, fechaInicio: true } })
    if (!reserva) return null
    if (fila.respuesta !== input.respuesta) {
      const ahora = new Date(this.now())
      await this.prisma.recordatorioTurno.update({ where: { id: fila.id }, data: { respuesta: input.respuesta, respuestaEn: ahora, respuestaActor: input.cuentaId, respuestaCanal: input.canal, fechaActualizacion: ahora } })
    }
    return {
      recordatorioId: fila.id,
      reservaId: fila.reservaId,
      tipo: fila.tipo as TipoRecordatorio,
      destinatario: fila.destinatario as DestinatarioRecordatorio,
      tenantId: fila.tenantId,
      turnoEstado: reserva.estado,
      inicio: reserva.fechaInicio,
      servicio: datos.servicio,
      contraparte: fila.destinatario === 'cliente' ? datos.prestadorNombre : datos.clienteNombre,
      conPago: datos.conPago,
    }
  }

  /** The turno was cancelled from this reminder (after its explicit confirmation). */
  async cancelacionResultante(recordatorioId: string): Promise<void> {
    await this.prisma.recordatorioTurno.updateMany({ where: { id: recordatorioId }, data: { cancelacion: true, fechaActualizacion: new Date(this.now()) } })
  }

  /** Audit view: the reminders of a turno with what happened to each. */
  async deTurno(reservaId: string): Promise<{ id: string; destinatario: string; tipo: string; programadoPara: string; estado: string; motivo: string | null; via: string | null; plantilla: string | null; wamid: string | null; enviadoEn: string | null; respuesta: string | null; respuestaEn: string | null; respuestaCanal: string | null; cancelacion: boolean }[]> {
    const filas = await this.prisma.recordatorioTurno.findMany({ where: { reservaId }, orderBy: [{ programadoPara: 'asc' }, { destinatario: 'asc' }] })
    return filas.map((fila) => ({ id: fila.id, destinatario: fila.destinatario, tipo: fila.tipo, programadoPara: fila.programadoPara.toISOString(), estado: fila.estado, motivo: fila.motivo, via: fila.via, plantilla: fila.plantilla, wamid: fila.wamid, enviadoEn: fila.enviadoEn?.toISOString() ?? null, respuesta: fila.respuesta, respuestaEn: fila.respuestaEn?.toISOString() ?? null, respuestaCanal: fila.respuestaCanal, cancelacion: fila.cancelacion }))
  }
}
