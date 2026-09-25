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
}

export const PLANTILLAS_WHATSAPP: DefinicionPlantilla[] = [
  { name: 'verification_completed', category: 'UTILITY', language: 'es_AR', parameters: ['resultado'], body: 'Tu verificación de identidad en TUS finalizó: {{1}}. Entrá a TUS para ver el detalle.' },
  { name: 'provider_budget_received', category: 'UTILITY', language: 'es_AR', parameters: ['servicio'], body: 'Recibiste un presupuesto para {{1}} en TUS. Revisalo y decidí desde TUS.' },
  { name: 'reservation_reminder', category: 'UTILITY', language: 'es_AR', parameters: ['servicio', 'fecha'], body: 'Recordatorio: tu reserva de {{1}} es el {{2}}.' },
  { name: 'work_status_update', category: 'UTILITY', language: 'es_AR', parameters: ['servicio', 'estado'], body: 'Tu trabajo de {{1}} cambió de estado: {{2}}.' },
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

  construir(name: string, values: Record<string, string>): MensajeSaliente {
    const template = PLANTILLAS_WHATSAPP.find((item) => item.name === name)
    if (!template) throw new ErrorPlantillaWhatsapp('TEMPLATE_UNKNOWN', 'unknown template')
    if (!this.approved.has(name)) throw new ErrorPlantillaWhatsapp('TEMPLATE_NOT_APPROVED', 'template is not approved in WhatsApp Manager')
    const parameters = template.parameters.map((key) => values[key])
    if (parameters.some((value) => typeof value !== 'string' || !value.trim() || value.length > 120))
      throw new ErrorPlantillaWhatsapp('TEMPLATE_PARAMETERS', 'template parameters are invalid')
    return { type: 'template', name, language: template.language, parameters: parameters as string[] }
  }
}
