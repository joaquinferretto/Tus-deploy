import { idRecordatorio, type AvisoRecordatorioTurno, type CanalRecordatoriosTurno, type ResultadoEnvioRecordatorio } from '../calendar/turnos-recordatorios.ts'
import { NotificadorTurnosWhatsapp } from './avisos-turnos.ts'
import type { MensajeSaliente } from './meta.ts'
import { fechaLarga, horaCorta } from './solicitud-turno.ts'

// TURNOS-RECORDATORIOS-01. The reminder of a turno on WhatsApp, through the same rules as every
// other notice of a turno: inside Meta's 24 hour window an interactive message; outside it ONLY
// the approved template (a scheduled reminder is usually outside it). Free text is never written
// to a closed window: without the template that number is not reminded, and the reason is kept.
//
// The templates are fixed texts in Meta, so the provider has its own pair: the client's mention
// the deposit, which is never the provider's concern.
export const PLANTILLAS_RECORDATORIO = {
  cliente: { '24h': 'turno_recordatorio_24h', '2h': 'turno_recordatorio_2h' },
  prestador: { '24h': 'turno_recordatorio_24h_prestador', '2h': 'turno_recordatorio_2h_prestador' },
} as const
export const BOTONES_RECORDATORIO = ['Confirmar asistencia', 'No puedo asistir'] as const

const parametro = (value: string): string => value.replace(/\s+/gu, ' ').trim().slice(0, 60) || '-'
const primerNombre = (value: string): string => parametro(value).split(' ')[0] ?? '-'

// The same content as the template, for a number whose window is open. The loss of the deposit is
// only mentioned to a client that paid something.
export function textoRecordatorio(aviso: AvisoRecordatorioTurno): string {
  const cuando = aviso.tipo === '24h' ? `mañana tenés un turno de ${aviso.servicio} el ${fechaLarga(aviso.inicio)} a las ${horaCorta(aviso.inicio)} con ${aviso.contraparte}` : `tu turno de ${aviso.servicio} es hoy a las ${horaCorta(aviso.inicio)} con ${aviso.contraparte}`
  const base = `Hola, ${primerNombre(aviso.nombre)}. Te recordamos que ${cuando}.`
  if (aviso.destinatario !== 'cliente' || !aviso.conPago) return base
  return aviso.tipo === '24h' ? `${base} Como se informó al reservar, desde este momento la seña no es reembolsable si cancelás el turno.` : `${base} Si cancelás ahora, la seña abonada no es reembolsable.`
}

export class NotificadorRecordatoriosWhatsapp extends NotificadorTurnosWhatsapp implements CanalRecordatoriosTurno {
  async recordatorio(aviso: AvisoRecordatorioTurno): Promise<ResultadoEnvioRecordatorio> {
    const { abiertos, cerrados, vinculados } = await this.destinos(aviso.cuentaId)
    if (vinculados === 0) return { enviado: false, motivo: 'sin_whatsapp' }
    const correlacion = `recordatorio-turno:${aviso.recordatorioId}`
    const ids = [idRecordatorio('asiste', aviso.recordatorioId), idRecordatorio('nopuede', aviso.recordatorioId)]
    let enviados = 0
    let fallidos = 0
    let wamid: string | null = null
    let via: 'plantilla' | 'ventana' | null = null
    const contar = (mensaje: { status: string; wamid: string | null }, por: 'plantilla' | 'ventana') => {
      if (mensaje.status === 'failed') return void (fallidos += 1)
      enviados += 1
      wamid ??= mensaje.wamid
      via ??= por
    }
    const interactivo: MensajeSaliente = { type: 'buttons', text: textoRecordatorio(aviso), buttons: [{ id: ids[0]!, title: BOTONES_RECORDATORIO[0] }, { id: ids[1]!, title: BOTONES_RECORDATORIO[1] }] }
    for (const destino of abiertos) contar(await this.enviar(destino, interactivo, correlacion), 'ventana')
    const nombrePlantilla = PLANTILLAS_RECORDATORIO[aviso.destinatario][aviso.tipo]
    let sinPlantilla = false
    if (cerrados.length > 0) {
      if (!this.plantillas?.aprobada(nombrePlantilla)) sinPlantilla = true
      else {
        const valores = { nombre: primerNombre(aviso.nombre), servicio: parametro(aviso.servicio), fecha: fechaLarga(aviso.inicio), hora: horaCorta(aviso.inicio), contraparte: parametro(aviso.contraparte) }
        const plantilla = this.plantillas.construir(nombrePlantilla, valores, ids)
        for (const contacto of cerrados) {
          const conversacion = await this.conversacionDe(contacto)
          if (conversacion) contar(await this.enviar({ conversacion, contacto }, plantilla, correlacion), 'plantilla')
        }
      }
    }
    this.metric?.('whatsapp.appointment_reminder', { sent: enviados > 0, kind: aviso.tipo, to: aviso.destinatario })
    if (enviados > 0) return { enviado: true, via: via ?? 'ventana', plantilla: via === 'plantilla' ? nombrePlantilla : null, wamid }
    return { enviado: false, motivo: fallidos > 0 ? 'fallo_envio' : sinPlantilla ? 'requiere_plantilla' : 'con_operador' }
  }
}
