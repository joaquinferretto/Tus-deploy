// Catálogo canónico de oficios de TUS. Es la única fuente para: categorías de solicitudes, oficio
// del perfil público del prestador, directorio "Buscar trabajador", asistente Web y WhatsApp.
// Los ids están fijados por CHECK en PostgreSQL (solicitudes_servicio, perfiles_publicos_prestador):
// agregar un oficio requiere una migración nueva.

export const OFICIOS = [
  {
    id: 'plomeria',
    label: 'Plomería',
    profesion: 'Plomero/a',
    palabrasClave: 'plomero plomera plomeria caneria cano canilla agua perdida gotea pierde bacha sifon inodoro deposito termotanque calefon destapacion destapar cloaca desague griferia',
  },
  {
    id: 'electricidad',
    label: 'Electricidad',
    profesion: 'Electricista',
    palabrasClave: 'electricista electricidad luz enchufe tomacorriente termica disyuntor tablero cable cortocircuito corto lampara instalacion electrica ventilador de techo',
  },
  {
    id: 'aire',
    label: 'Aire acondicionado',
    profesion: 'Técnico/a de aire acondicionado',
    palabrasClave: 'aire acondicionado split frio enfria calor calefaccion refrigeracion gas carga climatizacion equipo de aire',
  },
  {
    id: 'pintura',
    label: 'Pintura',
    profesion: 'Pintor/a',
    palabrasClave: 'pintor pintora pintura pintar pared paredes humedad revoque enduido techo fachada',
  },
  {
    id: 'mecanica',
    label: 'Mecánica',
    profesion: 'Mecánico/a',
    palabrasClave: 'mecanico mecanica auto moto freno frenos motor bateria cubierta aceite embrague arranca',
  },
  {
    id: 'otros',
    label: 'Otros oficios',
    profesion: 'Oficios varios',
    palabrasClave: 'carpintero carpinteria mueble placard armado albanil albanileria construccion obra cerrajero cerradura llave jardin jardinero mudanza tecnico reparacion',
  },
] as const

export type OficioId = (typeof OFICIOS)[number]['id']

export const IDS_OFICIOS: readonly OficioId[] = OFICIOS.map((oficio) => oficio.id)

export function esOficio(value: unknown): value is OficioId {
  return typeof value === 'string' && (IDS_OFICIOS as readonly string[]).includes(value)
}

export function oficio(id: OficioId) {
  return OFICIOS.find((item) => item.id === id)!
}

export function normalizarTexto(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9ñ\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

// Vista pública del catálogo (GET /tus/v1/public/oficios).
export function catalogoPublico() {
  return OFICIOS.map((item) => ({ id: item.id, label: item.label, profession: item.profesion }))
}
