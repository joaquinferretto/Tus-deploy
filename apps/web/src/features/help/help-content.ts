import { CATEGORIAS_AYUDA, articulosDeAyuda, type ArticuloAyuda, type CategoriaAyuda } from '@factory/contracts'

// AYUDA-01. The articles of the Help Center are the Markdown documents of docs/conocimiento: the
// SAME files the assistant's knowledge index reads. They are bundled as text at build time (they
// are never evaluated: no MDX, no HTML) and only the public ones that declare a slug become a
// page. Server only: nothing here is imported from a client component.
//
// Changing an article is a commit, a review and a deploy. There is no form that edits this.
const documentos = require.context('../../../../../docs/conocimiento', false, /\.md$/)

let cache: ArticuloAyuda[] | null = null

export function articulos(): ArticuloAyuda[] {
  cache ??= articulosDeAyuda(documentos.keys().map((clave) => ({ path: `docs/conocimiento/${clave.replace(/^\.\//u, '')}`, content: documentos(clave) })))
  return cache
}

export const articulo = (slug: string): ArticuloAyuda | null => articulos().find((item) => item.slug === slug) ?? null

export const tituloDeCategoria = (categoria: CategoriaAyuda): string => CATEGORIAS_AYUDA.find((item) => item.id === categoria)?.titulo ?? categoria

// The manual of the provider has a cover of its own (/ayuda/prestadores).
export const PORTADA_PRESTADORES = 'prestadores'
export const articulosDePrestador = (): ArticuloAyuda[] => articulos().filter((item) => item.categoria === 'prestadores')

// The REAL page an article sends the person to. A fixed list of internal, canonical paths: no
// destination is ever taken from a query string or from the document, so a guide cannot be turned
// into a redirect to somewhere else.
export const ACCIONES_AYUDA: Record<string, { href: string; etiqueta: string }> = {
  empezar: { href: '/registro', etiqueta: 'Registrarme' },
  registro: { href: '/registro', etiqueta: 'Registrarme' },
  'verificar-celular': { href: '/mi-perfil', etiqueta: 'Verificar mi celular' },
  'vincular-whatsapp': { href: '/mi-perfil?accion=vincular-whatsapp', etiqueta: 'Vincular WhatsApp' },
  solicitudes: { href: '/publicar', etiqueta: 'Publicar una solicitud' },
  presupuestos: { href: '/trabajos', etiqueta: 'Ver mis trabajos' },
  cancelaciones: { href: '/trabajos', etiqueta: 'Ver mis trabajos' },
  turnos: { href: '/trabajadores', etiqueta: 'Buscar un profesional' },
  pagos: { href: '/mis-turnos', etiqueta: 'Ver mis turnos' },
  'asistente-whatsapp': { href: '/asistente', etiqueta: 'Abrir el asistente' },
  'prestadores/primeros-pasos': { href: '/prestador/perfil-publico', etiqueta: 'Ir a mi perfil público' },
  'prestadores/verificacion-identidad': { href: '/prestador/pagos', etiqueta: 'Ir a mi panel' },
  'prestadores/perfil-publico': { href: '/prestador/perfil-publico', etiqueta: 'Editar mi perfil público' },
  'prestadores/servicios': { href: '/prestador/perfil-publico', etiqueta: 'Elegir mis servicios' },
  'prestadores/disponibilidad': { href: '/prestador/turnos', etiqueta: 'Configurar mis horarios' },
  'prestadores/solicitudes': { href: '/prestador/solicitudes', etiqueta: 'Ver solicitudes' },
  'prestadores/turnos': { href: '/prestador/turnos', etiqueta: 'Ver mis turnos' },
  'prestadores/mercado-pago': { href: '/prestador/pagos', etiqueta: 'Conectar Mercado Pago' },
  'prestadores/ganancias': { href: '/prestador/pagos', etiqueta: 'Ver mis ganancias' },
}
