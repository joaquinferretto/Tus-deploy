import { formatearPesos } from '@factory/contracts'
import type { AvisoTurnoReprogramado } from '../calendar/turnos-notificaciones.ts'
import type { AvisoImagenTurno, AvisoRespuestaTurno, AvisoSaldoTurno, AvisoSolicitudTurno, AvisoTurnoCancelado, AvisoTurnoConfirmado, AvisoTurnoFinalizado, NotificadorTurnos } from '../calendar/turnos-notificaciones.ts'
import type { WhatsappTemplateService } from './plantillas.ts'
import type { WhatsappProvider, MensajeSaliente } from './meta.ts'
import { createHash, randomUUID } from 'node:crypto'

import { ESTADO_CONVERSACIONAL_INICIAL, canalDe, ventanaServicioAbierta, type ContactoWhatsapp, type ConversacionWhatsapp } from './modelo.ts'
import { enviarMensajeSaliente, type Metrica } from './orquestador.ts'
import type { PuertoTransaccionAsistente } from './puertos.ts'
import { fechaLarga, horaCorta } from './solicitud-turno.ts'

// TURNOS-SENA-01. The provider answered a request of turno: the client is told on WhatsApp, in
// the conversation it asked from, with the payment link of the deposit when the turno was
// accepted. The amount and the link are computed by the backend (turnos + finance) and arrive
// here already made; this only delivers them.
//
// Who receives it: the WhatsApp conversations of THAT account (linked to it, or that identified
// it by name + document), and only inside Meta's customer service window (a free-form message
// more than 24 hours after the person's last one needs an approved template, which TUS does not
// have): outside it the email and "Mis turnos" carry the notice.
// ADMIN-WHATSAPP-AVISOS-01. The correlation every message of the notice of one request carries,
// and why a notice was not sent at all.
export const correlacionAvisoSolicitud = (reservaId: string): string => `turno-solicitado:${reservaId}`
// TURNOS-REPROGRAMACION-01: the notice of ONE rescheduling (the turno and the time it was moved to).
export const correlacionAvisoReprogramacion = (reservaId: string, nuevoInicio: Date): string => `turno-reprogramado:${reservaId}:${nuevoInicio.getTime()}`
export const PLANTILLA_TURNO_REPROGRAMADO = 'turno_reprogramado_prestador'
export const ACCION_AVISO_NO_ENVIADO = 'whatsapp.appointment_notice_not_sent'
export type MotivoAvisoNoEnviado = 'provider_without_account' | 'no_whatsapp_linked' | 'template_required' | 'conversation_with_operator'

export class NotificadorTurnosWhatsapp implements NotificadorTurnos {
  // `protected`: the notices of urgent requests (avisos-urgentes.ts) reach providers and clients
  // through these same rules.
  constructor(
    protected readonly transaction: PuertoTransaccionAsistente,
    protected readonly whatsapp: WhatsappProvider,
    protected readonly now: () => number = Date.now,
    protected readonly metric?: Metrica,
    // Approved templates: the only way to write first to a number whose 24 hour window is closed.
    protected readonly plantillas?: WhatsappTemplateService
  ) {}

  // TURNOS-WHATSAPP-01. The provider is told with everything it needs to decide and answers
  // right there: two reply buttons that carry which request and which answer. Inside the 24 hour
  // window, an interactive message and the pictures; outside it, the approved template (if TUS
  // has it) with the same two answers as quick replies.
  async solicitudRecibida(aviso: AvisoSolicitudTurno): Promise<void> {
    if (!aviso.prestadorCuentaId) return this.noEnviado(aviso.reservaId, 'provider_without_account')
    const { abiertos, cerrados, vinculados } = await this.destinos(aviso.prestadorCuentaId)
    const botones = [
      { id: idRespuestaTurno('aceptar', aviso.reservaId), title: 'Aceptar' },
      { id: idRespuestaTurno('rechazar', aviso.reservaId), title: 'Rechazar' },
    ]
    for (const destino of abiertos) {
      await this.enviar(destino, { type: 'buttons', text: textoSolicitud(aviso), buttons: botones }, `turno-solicitado:${aviso.reservaId}`)
      for (const [indice, imagen] of (aviso.imagenes ?? []).slice(0, 2).entries())
        await this.enviar(destino, { type: 'image', text: `Foto ${indice + 1} de la solicitud de ${aviso.clienteNombre}`, mimeType: imagen.tipoMime, bytes: imagen.contenido }, `turno-solicitado-foto-${indice}:${aviso.reservaId}`)
    }
    if (cerrados.length === 0) {
      // No number at all, or every number is in a conversation an operator took.
      if (abiertos.length === 0) await this.noEnviado(aviso.reservaId, vinculados === 0 ? 'no_whatsapp_linked' : 'conversation_with_operator')
      return
    }
    if (!this.plantillas?.aprobada(PLANTILLA_SOLICITUD_TURNO)) {
      // Nothing can be written first to these numbers: the email and the panel carry the notice.
      this.metric?.('whatsapp.appointment_notice', { sent: false, type: 'template', reason: 'template_not_approved' })
      if (abiertos.length === 0) await this.noEnviado(aviso.reservaId, 'template_required')
      return
    }
    const plantilla = this.plantillas.construir(
      PLANTILLA_SOLICITUD_TURNO,
      { cliente: aviso.clienteNombre.slice(0, 60), servicio: aviso.servicio.slice(0, 60), fecha: fechaLarga(aviso.inicio), hora: horaCorta(aviso.inicio), precio: aviso.precio ? formatearPesos(aviso.precio) : 'a convenir', sena: aviso.sena ? formatearPesos(aviso.sena) : 'sin seña' },
      botones.map((boton) => boton.id)
    )
    let enviados = abiertos.length
    for (const contacto of cerrados) {
      const conversacion = await this.conversacionDe(contacto)
      if (!conversacion) continue
      await this.enviar({ conversacion, contacto }, plantilla, `turno-solicitado:${aviso.reservaId}`)
      enviados += 1
    }
    if (enviados === 0) await this.noEnviado(aviso.reservaId, 'conversation_with_operator')
  }

  // ADMIN-WHATSAPP-AVISOS-01. A notice that was NOT sent leaves no message, so the reason is
  // recorded (never a phone number): Admin tells "nothing was sent" from "it is on its way".
  // What WAS sent needs nothing here: its message carries the status Meta reports.
  private async noEnviado(reservaId: string, reason: MotivoAvisoNoEnviado, correlationId: string = correlacionAvisoSolicitud(reservaId)): Promise<void> {
    this.metric?.('whatsapp.appointment_notice', { sent: false, reason })
    await this.transaction.ejecutar((repositories) =>
      repositories.auditoria.registrar({
        eventId: `auditoria-asistente-${randomUUID()}`,
        action: ACCION_AVISO_NO_ENVIADO,
        contactId: null,
        conversationId: null,
        actorId: 'assistant',
        correlationId,
        metadata: { reservaId, reason },
        createdAt: new Date(this.now()).toISOString(),
      })
    )
  }

  // A picture added after the provider was told: it follows, inside the window only.
  async imagenAgregada(aviso: AvisoImagenTurno): Promise<void> {
    if (!aviso.prestadorCuentaId) return
    const { abiertos } = await this.destinos(aviso.prestadorCuentaId)
    for (const destino of abiertos)
      await this.enviar(destino, { type: 'image', text: `${aviso.clienteNombre} sumó una foto a su solicitud de ${aviso.servicio} del ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)}.`, mimeType: aviso.imagen.tipoMime, bytes: aviso.imagen.contenido }, `turno-foto:${aviso.reservaId}:${createHash('sha256').update(aviso.imagen.contenido).digest('hex').slice(0, 24)}`)
  }

  async solicitudRespondida(aviso: AvisoRespuestaTurno): Promise<void> {
    await this.entregar(aviso.clienteCuentaId, mensajeRespuesta(aviso), `turno-respondido:${aviso.resultado}:${aviso.reservaId}`)
  }

  async turnoConfirmado(aviso: AvisoTurnoConfirmado): Promise<void> {
    await this.entregar(aviso.clienteCuentaId, { type: 'text', text: `¡Tu turno quedó confirmado! ${aviso.servicio} con ${aviso.prestadorNombre}, ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)}.` }, `turno-confirmado:${aviso.reservaId}`)
    if (aviso.prestadorCuentaId)
      await this.entregar(aviso.prestadorCuentaId, { type: 'text', text: `${aviso.clienteNombre} pagó la seña: el turno de ${aviso.servicio} del ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)} quedó confirmado.` }, `turno-confirmado-prestador:${aviso.reservaId}`)
  }

  // CIERRE-TRABAJO-01. The provider finished the turno: the client confirms it or reports a
  // problem with the buttons (or does nothing: TUS confirms when its window runs out).
  async turnoFinalizado(aviso: AvisoTurnoFinalizado): Promise<void> {
    await this.entregar(aviso.clienteCuentaId, {
      type: 'buttons',
      text: `${aviso.prestadorNombre} marcó como finalizado tu turno de ${aviso.servicio} del ${fechaLarga(aviso.inicio)}${aviso.evidencia ? `: "${aviso.evidencia.slice(0, 300)}"` : ''}. ¿Se realizó? Si no respondés antes del ${fechaLarga(aviso.confirmacionVenceEn)} a las ${horaCorta(aviso.confirmacionVenceEn)}, se confirma automáticamente.`,
      buttons: [
        { id: idCierreTurno('confirmar', aviso.reservaId), title: 'Confirmar' },
        { id: idCierreTurno('problema', aviso.reservaId), title: 'Reportar problema' },
      ],
    }, `turno-finalizado:${aviso.reservaId}`)
  }

  // PAGOS-MODALIDAD-01. Confirmed with something left to pay: the balance and its checkout.
  async saldoHabilitado(aviso: AvisoSaldoTurno): Promise<void> {
    const texto = `Tu turno de ${aviso.servicio} con ${aviso.prestadorNombre} quedó confirmado como realizado. Ya podés pagar el saldo de ${formatearPesos(aviso.monto)}.`
    await this.entregar(aviso.clienteCuentaId, aviso.url ? { type: 'cta_url', text: `${texto} El pago se acredita cuando Mercado Pago lo aprueba.`, label: 'Pagar saldo', url: aviso.url } : { type: 'text', text: `${texto} Escribime "pagar el saldo" y te paso el link.` }, `saldo-habilitado:${aviso.reservaId}`)
  }

  // TURNOS-REPROGRAMACION-01: the provider is told that its client moved the turno. Nothing is
  // asked of it: the client took a time the provider itself offered as free.
  // Inside the 24 hour window a normal message; outside it ONLY the approved template (never free
  // text). One notice per rescheduling: its correlation carries the turno and its new time, so a
  // retry of the delivery is the same message. What could not be sent is recorded with its reason.
  async turnoReprogramado(aviso: AvisoTurnoReprogramado): Promise<void> {
    const correlacion = correlacionAvisoReprogramacion(aviso.reservaId, aviso.inicio)
    if (!aviso.prestadorCuentaId) return this.noEnviado(aviso.reservaId, 'provider_without_account', correlacion)
    const { abiertos, cerrados, vinculados } = await this.destinos(aviso.prestadorCuentaId)
    for (const destino of abiertos) await this.enviar(destino, { type: 'text', text: textoReprogramacionPrestador(aviso) }, correlacion)
    if (cerrados.length === 0) {
      if (abiertos.length === 0) await this.noEnviado(aviso.reservaId, vinculados === 0 ? 'no_whatsapp_linked' : 'conversation_with_operator', correlacion)
      return
    }
    if (!this.plantillas?.aprobada(PLANTILLA_TURNO_REPROGRAMADO)) {
      this.metric?.('whatsapp.appointment_notice', { sent: false, type: 'template', reason: 'template_not_approved' })
      if (abiertos.length === 0) await this.noEnviado(aviso.reservaId, 'template_required', correlacion)
      return
    }
    const recorte = (value: string): string => value.replace(/\s+/gu, ' ').trim().slice(0, 60) || '-'
    const plantilla = this.plantillas.construir(PLANTILLA_TURNO_REPROGRAMADO, {
      nombre: recorte(aviso.prestadorNombre),
      cliente: recorte(aviso.clienteNombre),
      servicio: recorte(aviso.servicio),
      fechaAnterior: fechaLarga(aviso.anterior),
      horaAnterior: horaCorta(aviso.anterior),
      fechaNueva: fechaLarga(aviso.inicio),
      horaNueva: horaCorta(aviso.inicio),
    })
    let enviados = abiertos.length
    for (const contacto of cerrados) {
      const conversacion = await this.conversacionDe(contacto)
      if (!conversacion) continue
      await this.enviar({ conversacion, contacto }, plantilla, correlacion)
      enviados += 1
    }
    if (enviados === 0) await this.noEnviado(aviso.reservaId, 'conversation_with_operator', correlacion)
  }

  async turnoCancelado(aviso: AvisoTurnoCancelado): Promise<void> {
    if (aviso.canceladoPor === 'cliente') {
      if (!aviso.prestadorCuentaId) return
      await this.entregar(aviso.prestadorCuentaId, { type: 'text', text: `${aviso.clienteNombre} canceló el turno de ${aviso.servicio} del ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)}.` }, `turno-cancelado-prestador:${aviso.reservaId}`)
      return
    }
    await this.entregar(aviso.clienteCuentaId, { type: 'text', text: `${aviso.prestadorNombre} canceló tu turno de ${aviso.servicio} del ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)}. Podés pedirme otro horario u otro profesional.` }, `turno-cancelado-cliente:${aviso.reservaId}`)
  }

  // The WhatsApp numbers of an account: the ones that can be written to now (an active
  // conversation in bot mode inside the 24 hour window) and the linked ones that cannot.
  protected async destinos(cuentaId: string): Promise<{ abiertos: { conversacion: ConversacionWhatsapp; contacto: ContactoWhatsapp }[]; cerrados: ContactoWhatsapp[]; vinculados: number }> {
    return this.transaction.ejecutar(async (repositories) => {
      const abiertos: { conversacion: ConversacionWhatsapp; contacto: ContactoWhatsapp }[] = []
      const cerrados: ContactoWhatsapp[] = []
      let vinculados = 0
      for (const contacto of await repositories.contactos.vinculadosA(cuentaId)) {
        if (canalDe(contacto) !== 'whatsapp') continue
        vinculados += 1
        const conversacion = await repositories.conversaciones.activaDeContacto(contacto.contactId)
        if (conversacion && canalDe(conversacion) === 'whatsapp' && conversacion.mode === 'bot' && ventanaServicioAbierta(conversacion.lastInboundAt, this.now())) abiertos.push({ conversacion, contacto })
        // A conversation an operator took is left alone; any other closed window needs a template.
        else if (!conversacion || conversacion.mode === 'bot') cerrados.push(contacto)
      }
      return { abiertos, cerrados, vinculados }
    })
  }

  // The conversation a template is recorded in: the active one, or a new one for a number that
  // was linked (by its owner or by the administration) and never wrote.
  protected async conversacionDe(contacto: ContactoWhatsapp): Promise<ConversacionWhatsapp | null> {
    return this.transaction.ejecutar(async (repositories) => {
      const activa = await repositories.conversaciones.activaDeContacto(contacto.contactId)
      if (activa) return activa.mode === 'bot' ? activa : null
      const ahora = new Date(this.now()).toISOString()
      const nueva: ConversacionWhatsapp = { conversationId: `conversacion-whatsapp-${randomUUID()}`, contactId: contacto.contactId, status: 'active', mode: 'bot', handoffReason: null, handoffAt: null, operatorId: null, openedAt: ahora, lastMessageAt: ahora, lastInboundAt: null, unreadCount: 0, summary: null, summaryMessageCount: 0, state: { ...ESTADO_CONVERSACIONAL_INICIAL }, version: 1 }
      await repositories.conversaciones.crear(nueva)
      return nueva
    })
  }

  protected async entregar(clienteCuentaId: string, message: MensajeSaliente, correlationId: string): Promise<void> {
    const destinos = await this.transaction.ejecutar(async (repositories) => {
      const conversaciones = new Map<string, ConversacionWhatsapp>()
      for (const contacto of await repositories.contactos.vinculadosA(clienteCuentaId)) {
        const conversacion = await repositories.conversaciones.activaDeContacto(contacto.contactId)
        if (conversacion) conversaciones.set(conversacion.conversationId, conversacion)
      }
      for (const conversacion of await repositories.conversaciones.identificadasPor(clienteCuentaId)) conversaciones.set(conversacion.conversationId, conversacion)
      const abiertas = [...conversaciones.values()].filter((conversacion) => canalDe(conversacion) === 'whatsapp' && conversacion.mode === 'bot' && ventanaServicioAbierta(conversacion.lastInboundAt, this.now()))
      const contactos = await repositories.contactos.buscarVarios(abiertas.map((conversacion) => conversacion.contactId))
      const contactoDe = new Map(contactos.map((contacto) => [contacto.contactId, contacto]))
      return abiertas.flatMap((conversacion) => {
        const contacto = contactoDe.get(conversacion.contactId)
        return contacto && canalDe(contacto) === 'whatsapp' ? [{ conversacion, contacto }] : []
      })
    })
    for (const destino of destinos) await this.enviar(destino, message, correlationId)
  }

  protected async enviar(destino: { conversacion: ConversacionWhatsapp; contacto: ContactoWhatsapp }, message: MensajeSaliente, correlationId: string) {
    const enviado = await enviarMensajeSaliente({
      transaction: this.transaction,
      whatsapp: this.whatsapp,
      conversationId: destino.conversacion.conversationId,
      contact: destino.contacto,
      message,
      actor: 'assistant',
      correlationId,
      idempotencyKey: `${correlationId}:${destino.conversacion.conversationId}`,
      inReplyTo: [],
      replyToWamid: undefined,
      now: this.now,
    })
    this.metric?.('whatsapp.appointment_notice', { sent: enviado.status === 'sent', type: message.type })
    return enviado
  }
}

// What the client is told. Accepted with a payable deposit and its checkout at hand: the link.
// Paying is what Mercado Pago confirms, never opening the link.
export function mensajeRespuesta(aviso: AvisoRespuestaTurno): MensajeSaliente {
  const turno = `tu turno de ${aviso.servicio} con ${aviso.prestadorNombre} del ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)}`
  if (aviso.resultado === 'confirmed') return { type: 'text', text: `El prestador aceptó tu solicitud: ${turno} quedó confirmado.` }
  if (aviso.resultado !== 'awaiting_payment')
    return { type: 'text', text: `${aviso.prestadorNombre} no pudo tomar tu solicitud de turno de ${aviso.servicio} del ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)}. Podés pedirme otro horario u otro profesional.` }
  const sena = aviso.sena ?? null
  if (!sena) return { type: 'text', text: `El prestador aceptó tu solicitud: ${turno}. El turno sigue esperando el pago de seña.` }
  const monto = formatearPesos(sena.monto)
  // PAGOS-MODALIDAD-01: the deposit is the default; the total at once is offered in words (asking
  // for it replaces this link: only one way of paying is open at a time).
  if (sena.pagable && sena.url)
    return { type: 'cta_url', text: `El prestador aceptó tu solicitud: ${turno}. Para confirmar definitivamente el turno tenés que abonar la seña de ${monto}. Si preferís pagar el total de una vez, respondé "pagar total".`, label: 'Pagar seña', url: sena.url }
  if (sena.pagable) return { type: 'text', text: `El prestador aceptó tu solicitud: ${turno}. Para confirmar definitivamente el turno tenés que abonar la seña de ${monto}: escribime "pagar la seña" y te paso el link, o "pagar total" si preferís pagar todo de una vez.` }
  return { type: 'text', text: `El prestador aceptó tu solicitud: ${turno}. La seña de ${monto} sigue pendiente; el pago online todavía no está disponible.` }
}

// ---- TURNOS-WHATSAPP-01: the provider answers a request from WhatsApp ---------------------------

// Utility template (created and approved in WhatsApp Manager) for a provider outside the window.
export const PLANTILLA_SOLICITUD_TURNO = 'turno_solicitud_recibida'

// What a reply button carries: which answer and which request. Nothing else is trusted from it:
// who answers is the account linked to the number, and the backend checks the request is theirs.
export const idRespuestaTurno = (decision: 'aceptar' | 'rechazar', reservaId: string): string => `turno:${decision}:${reservaId}`

// CIERRE-TRABAJO-01. What the buttons of "your turno was finished" carry: the answer and the turno.
// WHO answers is the account linked to the number; the backend checks the turno is theirs.
export const idCierreTurno = (accion: 'confirmar' | 'problema', reservaId: string): string => `cierre:${accion}:${reservaId}`
export function leerCierreTurno(replyId: string | null | undefined): { accion: 'confirmar' | 'problema'; reservaId: string } | null {
  const partes = /^cierre:(confirmar|problema):([A-Za-z0-9._:-]{3,160})$/u.exec(replyId ?? '')
  return partes ? { accion: partes[1] as 'confirmar' | 'problema', reservaId: partes[2]! } : null
}

export function leerRespuestaTurno(replyId: string | null | undefined): { aceptar: boolean; reservaId: string } | null {
  const partes = /^turno:(aceptar|rechazar):([A-Za-z0-9_-]{6,80})$/u.exec(replyId ?? '')
  return partes ? { aceptar: partes[1] === 'aceptar', reservaId: partes[2]! } : null
}

// Everything the provider needs to decide, as TUS computed it.
export function textoSolicitud(aviso: AvisoSolicitudTurno): string {
  const lineas = [
    'Nueva solicitud de turno',
    `Cliente: ${aviso.clienteNombre}`,
    `Servicio: ${aviso.servicio}`,
    `Fecha: ${fechaLarga(aviso.inicio)}`,
    `Hora: ${horaCorta(aviso.inicio)}`,
    `Precio: ${aviso.precio ? formatearPesos(aviso.precio) : 'a convenir'}`,
    `Seña: ${aviso.sena ? `${formatearPesos(aviso.sena)} (la paga el cliente si aceptás)` : 'sin seña'}`,
    ...(aviso.notas?.trim() ? [`Observación: ${aviso.notas.trim().slice(0, 400)}`] : []),
    ...((aviso.imagenes?.length ?? 0) > 0 ? [`Fotos adjuntas: ${aviso.imagenes!.length}`] : []),
    `Tenés tiempo de responder hasta el ${fechaLarga(aviso.expiraEn)} a las ${horaCorta(aviso.expiraEn)}.`,
  ]
  return lineas.join('\n')
}

// TURNOS-REPROGRAMACION-01: who, which service, when it was and when it is now.
export function textoReprogramacionPrestador(aviso: AvisoTurnoReprogramado): string {
  return `${aviso.clienteNombre} reprogramó su turno de ${aviso.servicio}. Antes: ${fechaLarga(aviso.anterior)} a las ${horaCorta(aviso.anterior)}. Ahora: ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)}. No tenés que hacer nada: eligió un horario libre de tu agenda.`
}
