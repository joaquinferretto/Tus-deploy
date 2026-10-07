import type { NotificadorUrgentes, AvisoOfertaUrgente, AvisoCliente } from '../urgentes/puertos.ts'
import type { MotivoNoEnviada } from '../urgentes/modelo.ts'
import { TEXTOS_URGENTE } from '../urgentes/modelo.ts'
import { textoParaCliente } from '../urgentes/servicio.ts'
import { NotificadorTurnosWhatsapp } from './avisos-turnos.ts'
import { BOTONES_URGENTE, PLANTILLA_SERVICIO_URGENTE, correlacionOfertaUrgente, idRespuestaUrgente, textoOfertaUrgente } from './urgente-texto.ts'

// SERVICIO-URGENTE-01 on WhatsApp. The notice of an urgent request to each candidate and what the
// parties are told afterwards, through the SAME mechanism as the notices of turnos: who a provider
// is comes from the account linked to the number; inside the 24 hour window an interactive message
// with two reply buttons, outside it ONLY the approved template (never free text); every message
// is recorded with the status Meta reports, which is what Admin reads.

// The names, button ids and wording live in urgente-texto.ts (no dependency on the notifier, so
// the orchestrator can read a button without loading this module).
export { BOTONES_URGENTE, PLANTILLA_SERVICIO_URGENTE, correlacionOfertaUrgente, idRespuestaUrgente, leerRespuestaUrgente, textoOfertaUrgente } from './urgente-texto.ts'

// A template parameter is one line of at most 120 characters.
const parametro = (value: string): string => value.replace(/\s+/gu, ' ').trim().slice(0, 120) || '-'

export class NotificadorUrgentesWhatsapp extends NotificadorTurnosWhatsapp implements NotificadorUrgentes {
  async ofrecer(aviso: AvisoOfertaUrgente): Promise<{ enviada: true } | { enviada: false; motivo: MotivoNoEnviada }> {
    const { abiertos, cerrados, vinculados } = await this.destinos(aviso.cuentaId)
    if (vinculados === 0) return { enviada: false, motivo: 'sin_whatsapp' }
    const correlacion = correlacionOfertaUrgente(aviso.solicitudId, aviso.ronda)
    const ids = [idRespuestaUrgente('asistir', aviso.solicitudId), idRespuestaUrgente('nopuedo', aviso.solicitudId)]
    let enviados = 0
    let fallidos = 0
    const contar = (status: string) => (status === 'failed' ? (fallidos += 1) : (enviados += 1))
    for (const destino of abiertos)
      contar((await this.enviar(destino, { type: 'buttons', text: textoOfertaUrgente(aviso), buttons: [{ id: ids[0]!, title: BOTONES_URGENTE[0] }, { id: ids[1]!, title: BOTONES_URGENTE[1] }] }, correlacion)).status)
    let sinPlantilla = false
    if (cerrados.length > 0) {
      if (!this.plantillas?.aprobada(PLANTILLA_SERVICIO_URGENTE)) sinPlantilla = true
      else {
        const plantilla = this.plantillas.construir(PLANTILLA_SERVICIO_URGENTE, { cliente: parametro(aviso.cliente), servicio: parametro(aviso.servicio), direccion: parametro(aviso.direccion), zona: parametro(aviso.zona), motivo: parametro(aviso.motivo) }, ids)
        for (const contacto of cerrados) {
          const conversacion = await this.conversacionDe(contacto)
          if (conversacion) contar((await this.enviar({ conversacion, contacto }, plantilla, correlacion)).status)
        }
      }
    }
    this.metric?.('whatsapp.urgent_offer', { sent: enviados > 0, round: aviso.ronda })
    if (enviados > 0) return { enviada: true }
    return { enviada: false, motivo: fallidos > 0 ? 'fallo_envio' : sinPlantilla ? 'requiere_plantilla' : 'con_operador' }
  }

  // Free text: only to the numbers whose window is open. Outside it nothing is written (a
  // provider that taps a button of an old notice is told then).
  async cerradaPorOtro(aviso: { solicitudId: string; ronda: number; cuentaId: string; servicio: string; direccion: string; zona: string }): Promise<void> {
    const { abiertos } = await this.destinos(aviso.cuentaId)
    for (const destino of abiertos) await this.enviar(destino, { type: 'text', text: TEXTOS_URGENTE.cerradaPorOtro(aviso) }, `urgente-cerrada:${aviso.solicitudId}:${aviso.ronda}`)
  }

  // The client hears it on the WhatsApp it asked from (window open); the Web shows the same state.
  async alCliente(aviso: { solicitudId: string; cuentaId: string; servicio: string; zona: string; evento: AvisoCliente; marca: string }): Promise<void> {
    await this.entregar(aviso.cuentaId, { type: 'text', text: textoParaCliente(aviso.evento, { servicio: aviso.servicio, zona: aviso.zona }) }, `urgente-cliente:${aviso.solicitudId}:${aviso.marca}`)
  }
}
