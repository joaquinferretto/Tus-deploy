import type { MensajeSaliente } from './meta.ts'

// Transactional (UTILITY) templates for messages outside Meta's 24h customer service window.
// They must be created and approved in WhatsApp Manager first; this code never creates them
// remotely and refuses to send a template that is not listed in WHATSAPP_APPROVED_TEMPLATES.
// No marketing templates.

export interface DefinicionPlantilla {
  name: string
  category: 'UTILITY'
  language: 'es_AR'
  parameters: string[]
  body: string
  // Quick-reply buttons of the template, in order (titles as created in WhatsApp Manager).
  buttons?: string[]
  // ADMIN-WHATSAPP-RESPUESTA-01: an operator may send it by hand from the support panel to
  // contact somebody whose 24 hour window is closed.
  manual?: boolean
}

export const PLANTILLAS_WHATSAPP: DefinicionPlantilla[] = [
  { name: 'verification_completed', category: 'UTILITY', language: 'es_AR', parameters: ['resultado'], body: 'Tu verificación de identidad en TUS finalizó: {{1}}. Entrá a TUS para ver el detalle.' },
  { name: 'provider_budget_received', category: 'UTILITY', language: 'es_AR', parameters: ['servicio'], body: 'Recibiste un presupuesto para {{1}} en TUS. Revisalo y decidí desde TUS.' },
  { name: 'reservation_reminder', category: 'UTILITY', language: 'es_AR', parameters: ['servicio', 'fecha'], body: 'Recordatorio: tu reserva de {{1}} es el {{2}}.' },
  { name: 'work_status_update', category: 'UTILITY', language: 'es_AR', parameters: ['servicio', 'estado'], body: 'Tu trabajo de {{1}} cambió de estado: {{2}}.' },
  // TURNOS-WHATSAPP-01: a request of turno for a provider whose 24 hour window is closed. The two
  // quick replies come back with the payload TUS sent (which request, accept or reject).
  {
    name: 'turno_solicitud_recibida',
    category: 'UTILITY',
    language: 'es_AR',
    parameters: ['cliente', 'servicio', 'fecha', 'hora', 'precio', 'sena'],
    body: '{{1}} te solicitó un turno de {{2}} para el {{3}} a las {{4}}. Precio: {{5}}. Seña: {{6}}. ¿Lo aceptás?',
    buttons: ['Aceptar', 'Rechazar'],
  },
  // SERVICIO-URGENTE-01: an urgent request offered to a provider whose 24 hour window is closed.
  // The quick replies come back with the payload TUS sent (which request, can or cannot go).
  {
    name: 'servicio_urgente_disponible',
    category: 'UTILITY',
    language: 'es_AR',
    parameters: ['cliente', 'servicio', 'direccion', 'zona', 'motivo'],
    body: 'Hola, {{1}} necesita un servicio urgente de {{2}}.\nDirección: {{3}}\nBarrio/Zona: {{4}}\nMotivo: {{5}}\n¿Podés asistir ahora?',
    buttons: ['Puedo asistir', 'No puedo'],
  },
  // ADMIN-WHATSAPP-RESPUESTA-01: continuity of a conversation an operator is attending, when the
  // 24 hour window is closed. Its answer opens the window again for free text. The category is
  // Meta's decision; it is only usable once it is approved AND listed in the configuration.
  {
    name: 'continuar_atencion_tus',
    category: 'UTILITY',
    language: 'es_AR',
    parameters: ['nombre'],
    body: 'Hola, {{1}}. Queremos continuar con tu solicitud en TUS. Respondé este mensaje y seguimos con la atención por acá.',
    buttons: ['Continuar atención'],
    manual: true,
  },
  // TURNOS-RECORDATORIOS-01: a scheduled reminder is usually outside the 24 hour window, so it
  // travels as a template. The client's pair mentions the deposit (TURNOS-CANCELACION-01); the
  // provider has its own pair, which never does. The quick replies come back with the payload TUS
  // sent (which reminder, attends or cannot attend).
  {
    name: 'turno_recordatorio_24h',
    category: 'UTILITY',
    language: 'es_AR',
    parameters: ['nombre', 'servicio', 'fecha', 'hora', 'contraparte'],
    body: 'Hola, {{1}}. Te recordamos que mañana tenés un turno de {{2}} el {{3}} a las {{4}} con {{5}}. Como se informó al reservar, desde este momento la seña no es reembolsable si cancelás el turno.',
    buttons: ['Confirmar asistencia', 'No puedo asistir'],
  },
  {
    name: 'turno_recordatorio_2h',
    category: 'UTILITY',
    language: 'es_AR',
    parameters: ['nombre', 'servicio', 'hora', 'contraparte'],
    body: 'Hola, {{1}}. Te recordamos que tu turno de {{2}} es hoy a las {{3}} con {{4}}. Si cancelás ahora, la seña abonada no es reembolsable.',
    buttons: ['Confirmar asistencia', 'No puedo asistir'],
  },
  {
    name: 'turno_recordatorio_24h_prestador',
    category: 'UTILITY',
    language: 'es_AR',
    parameters: ['nombre', 'servicio', 'fecha', 'hora', 'contraparte'],
    body: 'Hola, {{1}}. Te recordamos que mañana tenés un turno de {{2}} el {{3}} a las {{4}} con {{5}}.',
    buttons: ['Confirmar asistencia', 'No puedo asistir'],
  },
  {
    name: 'turno_recordatorio_2h_prestador',
    category: 'UTILITY',
    language: 'es_AR',
    parameters: ['nombre', 'servicio', 'hora', 'contraparte'],
    body: 'Hola, {{1}}. Te recordamos que tu turno de {{2}} es hoy a las {{3}} con {{4}}.',
    buttons: ['Confirmar asistencia', 'No puedo asistir'],
  },
  // TURNOS-REPROGRAMACION-01: the provider is told that a client moved its turno, also when its
  // 24 hour window is closed. No button: the new time belongs to the availability the provider
  // itself published, so the change is already valid.
  {
    name: 'turno_reprogramado_prestador',
    category: 'UTILITY',
    language: 'es_AR',
    parameters: ['nombre', 'cliente', 'servicio', 'fechaAnterior', 'horaAnterior', 'fechaNueva', 'horaNueva'],
    body: 'Hola, {{1}}. {{2}} reprogramó su turno de {{3}}. El horario anterior era {{4}} a las {{5}} y el nuevo horario es {{6}} a las {{7}}.',
  },
  { name: 'payment_available', category: 'UTILITY', language: 'es_AR', parameters: ['servicio'], body: 'Tu servicio {{1}} está listo para pagar en TUS.' },
]

export class ErrorPlantillaWhatsapp extends Error {
  constructor(readonly code: 'TEMPLATE_UNKNOWN' | 'TEMPLATE_NOT_APPROVED' | 'TEMPLATE_PARAMETERS', message: string) {
    super(message)
    this.name = 'ErrorPlantillaWhatsapp'
  }
}

export class WhatsappTemplateService {
  constructor(private readonly approved: ReadonlySet<string>) {}

  static desdeEnv(env: Record<string, string | undefined>): WhatsappTemplateService {
    return new WhatsappTemplateService(new Set((env['WHATSAPP_APPROVED_TEMPLATES'] ?? '').split(',').map((name) => name.trim()).filter(Boolean)))
  }

  // The templates an operator can send by hand: defined here, marked manual and approved.
  manualesAprobadas(): DefinicionPlantilla[] {
    return PLANTILLAS_WHATSAPP.filter((item) => item.manual === true && this.approved.has(item.name))
  }

  aprobada(name: string): boolean {
    return this.approved.has(name) && PLANTILLAS_WHATSAPP.some((item) => item.name === name)
  }

  construir(name: string, values: Record<string, string>, buttonPayloads?: string[]): MensajeSaliente {
    const template = PLANTILLAS_WHATSAPP.find((item) => item.name === name)
    if (!template) throw new ErrorPlantillaWhatsapp('TEMPLATE_UNKNOWN', 'unknown template')
    if (!this.approved.has(name)) throw new ErrorPlantillaWhatsapp('TEMPLATE_NOT_APPROVED', 'template is not approved in WhatsApp Manager')
    const parameters = template.parameters.map((key) => values[key])
    if (parameters.some((value) => typeof value !== 'string' || !value.trim() || value.length > 120))
      throw new ErrorPlantillaWhatsapp('TEMPLATE_PARAMETERS', 'template parameters are invalid')
    if ((template.buttons?.length ?? 0) !== (buttonPayloads?.length ?? 0)) throw new ErrorPlantillaWhatsapp('TEMPLATE_PARAMETERS', 'template buttons do not match')
    return { type: 'template', name, language: template.language, parameters: parameters as string[], ...(buttonPayloads?.length ? { buttonPayloads } : {}) }
  }
}
