import { formatearPesos } from '@factory/contracts'
import type { AvisoRespuestaTurno, AvisoSolicitudTurno, AvisoTurnoCancelado, AvisoTurnoConfirmado, NotificadorTurnos } from '../calendar/turnos-notificaciones.ts'
import type { WhatsappProvider, MensajeSaliente } from './meta.ts'
import { canalDe, ventanaServicioAbierta, type ContactoWhatsapp, type ConversacionWhatsapp } from './modelo.ts'
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
export class NotificadorTurnosWhatsapp implements NotificadorTurnos {
  constructor(
    private readonly transaction: PuertoTransaccionAsistente,
    private readonly whatsapp: WhatsappProvider,
    private readonly now: () => number = Date.now,
    private readonly metric?: Metrica
  ) {}

  async solicitudRecibida(aviso: AvisoSolicitudTurno): Promise<void> {
    if (!aviso.prestadorCuentaId) return
    await this.entregar(
      aviso.prestadorCuentaId,
      { type: 'text', text: `${aviso.clienteNombre} te solicitó un turno de ${aviso.servicio} para el ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)}. Podés aceptarlo o rechazarlo desde Solicitudes de reserva.` },
      `turno-solicitado:${aviso.reservaId}`
    )
  }

  async solicitudRespondida(aviso: AvisoRespuestaTurno): Promise<void> {
    await this.entregar(aviso.clienteCuentaId, mensajeRespuesta(aviso), `turno-respondido:${aviso.resultado}:${aviso.reservaId}`)
  }

  async turnoConfirmado(aviso: AvisoTurnoConfirmado): Promise<void> {
    await this.entregar(aviso.clienteCuentaId, { type: 'text', text: `¡Tu turno quedó confirmado! ${aviso.servicio} con ${aviso.prestadorNombre}, ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)}.` }, `turno-confirmado:${aviso.reservaId}`)
    if (aviso.prestadorCuentaId)
      await this.entregar(aviso.prestadorCuentaId, { type: 'text', text: `${aviso.clienteNombre} pagó la seña: el turno de ${aviso.servicio} del ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)} quedó confirmado.` }, `turno-confirmado-prestador:${aviso.reservaId}`)
  }

  async turnoCancelado(aviso: AvisoTurnoCancelado): Promise<void> {
    if (aviso.canceladoPor === 'cliente') {
      if (!aviso.prestadorCuentaId) return
      await this.entregar(aviso.prestadorCuentaId, { type: 'text', text: `${aviso.clienteNombre} canceló el turno de ${aviso.servicio} del ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)}.` }, `turno-cancelado-prestador:${aviso.reservaId}`)
      return
    }
    await this.entregar(aviso.clienteCuentaId, { type: 'text', text: `${aviso.prestadorNombre} canceló tu turno de ${aviso.servicio} del ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)}. Podés pedirme otro horario u otro profesional.` }, `turno-cancelado-cliente:${aviso.reservaId}`)
  }

  private async entregar(clienteCuentaId: string, message: MensajeSaliente, correlationId: string): Promise<void> {
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

  private async enviar(destino: { conversacion: ConversacionWhatsapp; contacto: ContactoWhatsapp }, message: MensajeSaliente, correlationId: string) {
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
  if (sena.pagable && sena.url)
    return { type: 'cta_url', text: `El prestador aceptó tu solicitud: ${turno}. Para confirmar definitivamente el turno tenés que abonar la seña de ${monto}.`, label: 'Pagar seña', url: sena.url }
  if (sena.pagable) return { type: 'text', text: `El prestador aceptó tu solicitud: ${turno}. Para confirmar definitivamente el turno tenés que abonar la seña de ${monto}: escribime "pagar la seña" y te paso el link.` }
  return { type: 'text', text: `El prestador aceptó tu solicitud: ${turno}. La seña de ${monto} sigue pendiente; el pago online todavía no está disponible.` }
}
