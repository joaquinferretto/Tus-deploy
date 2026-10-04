// AYUDA-01. The knowledge of TUS has ONE source: the Markdown documents of docs/conocimiento. The
// Help Center of the Web and the assistant's RAG read the same files through the functions below,
// so there is never a text for the Web and another one for WhatsApp.
//
// MARKDOWN EXPLAINS, TOOLS READ, THE BACKEND DECIDES. A document can describe how something is
// done; it never carries a state (a price, a balance, a slot, whether a phone is verified) and it
// never grants anything. It is plain Markdown: no HTML, no JSX, no script. What is not plain
// Markdown is shown as text, never interpreted.

export const CATEGORIAS_AYUDA = [
  { id: 'empezar', titulo: 'Empezar' },
  { id: 'cuenta', titulo: 'Cuenta y celular' },
  { id: 'solicitudes', titulo: 'Solicitudes' },
  { id: 'turnos', titulo: 'Turnos' },
  { id: 'pagos', titulo: 'Pagos' },
  { id: 'prestadores', titulo: 'Prestadores' },
  { id: 'problemas', titulo: 'Problemas frecuentes' },
] as const
export type CategoriaAyuda = (typeof CATEGORIAS_AYUDA)[number]['id']

export const VISIBILIDADES_DOCUMENTO = ['public', 'authenticated-client', 'authenticated-provider', 'internal-admin'] as const
export type VisibilidadDocumento = (typeof VISIBILIDADES_DOCUMENTO)[number]

// Who a document is written for. `all` is the historical spelling of `public`.
export const AUDIENCIAS_DOCUMENTO = ['public', 'client', 'provider', 'all'] as const
export type AudienciaDocumento = 'public' | 'client' | 'provider'

// The ONLY fields a document may declare. Anything else is rejected: a typo or an unexpected key
// never passes silently.
const CAMPOS_PERMITIDOS = new Set(['id', 'title', 'description', 'slug', 'category', 'order', 'version', 'visibility', 'audience', 'language', 'updated', 'active', 'next', 'keywords'])

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/u

export interface MetadatosDocumento {
  id: string
  title: string
  version: string
  visibility: VisibilidadDocumento
  audience: AudienciaDocumento
  language: 'es'
  updated: string
  active: boolean
  // Help Center fields: a document with a slug is an article of /ayuda/<slug>.
  slug: string | null
  description: string | null
  category: CategoriaAyuda | null
  order: number
  // The article that comes next ("Siguiente paso").
  next: string | null
  keywords: string[]
}

export type DocumentoParseado = { ok: true; metadatos: MetadatosDocumento; cuerpo: string } | { ok: false; error: string }

// Front matter between two `---` lines, one `clave: valor` per line, validated field by field.
export function parsearDocumentoAyuda(contenido: string): DocumentoParseado {
  const partes = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(contenido)
  if (!partes) return { ok: false, error: 'missing front matter' }
  const campos = new Map<string, string>()
  for (const linea of partes[1]!.split(/\r?\n/u)) {
    if (!linea.trim()) continue
    const par = /^([a-z]+):\s*(.*)$/u.exec(linea.trim())
    if (!par) return { ok: false, error: 'invalid front matter line' }
    if (!CAMPOS_PERMITIDOS.has(par[1]!)) return { ok: false, error: `unknown field: ${par[1]}` }
    if (campos.has(par[1]!)) return { ok: false, error: `duplicated field: ${par[1]}` }
    campos.set(par[1]!, par[2]!.trim())
  }
  const id = campos.get('id')
  if (!id || !/^[a-z0-9-]{3,80}$/u.test(id)) return { ok: false, error: 'invalid id' }
  const visibility = campos.get('visibility') as VisibilidadDocumento | undefined
  if (!visibility || !VISIBILIDADES_DOCUMENTO.includes(visibility)) return { ok: false, error: 'invalid visibility' }
  const audiencia = campos.get('audience')
  if (!audiencia || !(AUDIENCIAS_DOCUMENTO as readonly string[]).includes(audiencia)) return { ok: false, error: 'invalid audience' }
  if (campos.get('language') !== 'es') return { ok: false, error: 'only es is supported' }
  const title = campos.get('title')
  const version = campos.get('version')
  if (!title || !version) return { ok: false, error: 'title and version are required' }
  if (title.length > 90) return { ok: false, error: 'title is too long' }
  const updated = campos.get('updated') ?? ''
  if (updated && !/^\d{4}-\d{2}-\d{2}$/u.test(updated)) return { ok: false, error: 'invalid updated date' }
  const activo = campos.get('active')
  if (activo !== undefined && activo !== 'true' && activo !== 'false') return { ok: false, error: 'invalid active' }

  const slug = campos.get('slug') ?? null
  const description = campos.get('description') ?? null
  const categoria = campos.get('category') ?? null
  const orden = campos.get('order')
  const siguiente = campos.get('next') ?? null
  if (slug !== null) {
    if (!SLUG.test(slug) || slug.length > 60) return { ok: false, error: 'invalid slug' }
    // Only public knowledge is ever published as a page.
    if (visibility !== 'public') return { ok: false, error: 'a help article must be public' }
    if (!description || description.length < 20 || description.length > 180) return { ok: false, error: 'description is required (20 to 180 characters)' }
    if (!categoria || !CATEGORIAS_AYUDA.some((item) => item.id === categoria)) return { ok: false, error: 'invalid category' }
    if (!orden || !/^\d{1,3}$/u.test(orden)) return { ok: false, error: 'invalid order' }
    if (!updated) return { ok: false, error: 'updated is required' }
  } else if (description !== null || categoria !== null || orden !== undefined || siguiente !== null) {
    return { ok: false, error: 'help fields need a slug' }
  }
  if (siguiente !== null && !SLUG.test(siguiente)) return { ok: false, error: 'invalid next' }
  const keywords = (campos.get('keywords') ?? '').split(',').map((palabra) => palabra.trim().toLowerCase()).filter(Boolean)
  if (keywords.length > 20 || keywords.some((palabra) => !/^[\p{L}\p{N} ]{2,40}$/u.test(palabra))) return { ok: false, error: 'invalid keywords' }

  return {
    ok: true,
    metadatos: {
      id,
      title,
      version,
      visibility,
      audience: audiencia === 'all' ? 'public' : (audiencia as AudienciaDocumento),
      language: 'es',
      updated,
      active: activo !== 'false',
      slug,
      description,
      category: categoria as CategoriaAyuda | null,
      order: orden ? Number(orden) : 0,
      next: siguiente,
      keywords,
    },
    cuerpo: partes[2]!.trim(),
  }
}

// ---- links -------------------------------------------------------------------------------------

// Where a link of a document may go: a path of TUS itself ("/mi-perfil", "/ayuda/turnos#sena") or
// an https address. Never javascript:, data:, vbscript:, a protocol-relative "//host", or a path
// with a backslash or a control character (the ways a "path" turns into another origin).
export function destinoSeguroAyuda(href: string): { href: string; externo: boolean } | null {
  const destino = href.trim()
  if (!destino || destino.length > 300 || /[\u0000-\u001f\u007f\\]/u.test(destino)) return null
  if (destino.startsWith('/')) return destino.startsWith('//') ? null : { href: destino, externo: false }
  if (/^https:\/\/[a-z0-9.-]+(?::\d{2,5})?(?:[/?#][^\s]*)?$/iu.test(destino)) return { href: destino, externo: true }
  return null
}

// ---- Markdown -> a tree of plain data (never HTML) ----------------------------------------------

export type EnLinea =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'fuerte'; hijos: EnLinea[] }
  | { tipo: 'enfasis'; hijos: EnLinea[] }
  | { tipo: 'codigo'; texto: string }
  | { tipo: 'enlace'; href: string; externo: boolean; hijos: EnLinea[] }

export type BloqueAyuda =
  | { tipo: 'titulo'; nivel: 2 | 3 | 4; id: string; hijos: EnLinea[]; texto: string }
  | { tipo: 'parrafo'; hijos: EnLinea[] }
  | { tipo: 'lista'; ordenada: boolean; items: EnLinea[][] }
  | { tipo: 'cita'; hijos: EnLinea[] }

const sinAcentos = (texto: string): string => texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export const anclaDe = (texto: string): string => sinAcentos(texto).replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60) || 'seccion'

// Inline Markdown: **fuerte**, *énfasis*, `código` and [texto](destino). Everything else is text,
// including anything that looks like HTML: it is kept as characters and shown as characters.
export function enLinea(texto: string): EnLinea[] {
  const salida: EnLinea[] = []
  const patron = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/gu
  let ultimo = 0
  for (const hallado of texto.matchAll(patron)) {
    if (hallado.index > ultimo) salida.push({ tipo: 'texto', texto: texto.slice(ultimo, hallado.index) })
    if (hallado[1] !== undefined) salida.push({ tipo: 'codigo', texto: hallado[1] })
    else if (hallado[2] !== undefined) salida.push({ tipo: 'fuerte', hijos: enLinea(hallado[2]) })
    else if (hallado[3] !== undefined) salida.push({ tipo: 'enfasis', hijos: enLinea(hallado[3]) })
    else {
      const destino = destinoSeguroAyuda(hallado[5]!)
      // A link that may not be followed keeps its words and loses its destination.
      if (destino) salida.push({ tipo: 'enlace', href: destino.href, externo: destino.externo, hijos: [{ tipo: 'texto', texto: hallado[4]! }] })
      else salida.push({ tipo: 'texto', texto: hallado[4]! })
    }
    ultimo = hallado.index + hallado[0].length
  }
  if (ultimo < texto.length) salida.push({ tipo: 'texto', texto: texto.slice(ultimo) })
  return salida
}

export const textoPlano = (nodos: EnLinea[]): string => nodos.map((nodo) => ('texto' in nodo ? nodo.texto : textoPlano(nodo.hijos))).join('')

// Block Markdown: headings (## to ####; the single # repeats the title and is dropped), paragraphs,
// ordered and unordered lists, and quotes. No tables, images, HTML blocks or code fences.
export function markdownAyuda(cuerpo: string): BloqueAyuda[] {
  const bloques: BloqueAyuda[] = []
  const usados = new Map<string, number>()
  let parrafo: string[] = []
  let lista: { ordenada: boolean; items: string[] } | null = null
  const cerrar = () => {
    if (parrafo.length > 0) bloques.push({ tipo: 'parrafo', hijos: enLinea(parrafo.join(' ')) })
    if (lista) bloques.push({ tipo: 'lista', ordenada: lista.ordenada, items: lista.items.map(enLinea) })
    parrafo = []
    lista = null
  }
  for (const cruda of cuerpo.replace(/\r\n/gu, '\n').split('\n')) {
    const linea = cruda.trimEnd()
    if (!linea.trim()) {
      cerrar()
      continue
    }
    const titulo = /^(#{1,4})\s+(.+)$/u.exec(linea)
    if (titulo) {
      cerrar()
      if (titulo[1]!.length === 1) continue
      const hijos = enLinea(titulo[2]!.trim())
      const texto = textoPlano(hijos)
      const base = anclaDe(texto)
      const repetido = usados.get(base) ?? 0
      usados.set(base, repetido + 1)
      bloques.push({ tipo: 'titulo', nivel: titulo[1]!.length as 2 | 3 | 4, id: repetido ? `${base}-${repetido + 1}` : base, hijos, texto })
      continue
    }
    const item = /^\s*(?:(\d{1,2})[.)]|[-*+])\s+(.+)$/u.exec(linea)
    if (item) {
      const ordenada = item[1] !== undefined
      if (parrafo.length > 0 || (lista && lista.ordenada !== ordenada)) cerrar()
      lista ??= { ordenada, items: [] }
      lista.items.push(item[2]!.trim())
      continue
    }
    // A line indented under a list item continues that item.
    if (lista && /^\s{2,}\S/u.test(cruda)) {
      lista.items[lista.items.length - 1] += ` ${linea.trim()}`
      continue
    }
    const cita = /^>\s?(.*)$/u.exec(linea)
    if (cita) {
      cerrar()
      bloques.push({ tipo: 'cita', hijos: enLinea(cita[1]!.trim()) })
      continue
    }
    if (lista) cerrar()
    parrafo.push(linea.trim())
  }
  cerrar()
  return bloques
}

// Every destination a document links to (to check that the internal ones are real pages).
export function enlacesDe(bloques: BloqueAyuda[]): { href: string; externo: boolean }[] {
  const salida: { href: string; externo: boolean }[] = []
  const recorrer = (nodos: EnLinea[]) => {
    for (const nodo of nodos) {
      if (nodo.tipo === 'enlace') salida.push({ href: nodo.href, externo: nodo.externo })
      if ('hijos' in nodo) recorrer(nodo.hijos)
    }
  }
  for (const bloque of bloques) {
    if (bloque.tipo === 'lista') bloque.items.forEach(recorrer)
    else recorrer(bloque.hijos)
  }
  return salida
}

// ---- articles and search -----------------------------------------------------------------------

export interface ArticuloAyuda {
  slug: string
  titulo: string
  descripcion: string
  categoria: CategoriaAyuda
  orden: number
  audiencia: AudienciaDocumento
  siguiente: string | null
  palabrasClave: string[]
  actualizado: string
  documentoId: string
  bloques: BloqueAyuda[]
}

// The articles of the Help Center out of the documents of the knowledge directory: the public,
// active ones that declare a slug. A document that does not parse is skipped here and reported by
// the tests and by the indexer.
export function articulosDeAyuda(archivos: { path: string; content: string }[]): ArticuloAyuda[] {
  const articulos: ArticuloAyuda[] = []
  for (const archivo of archivos) {
    const documento = parsearDocumentoAyuda(archivo.content)
    if (!documento.ok || !documento.metadatos.slug || !documento.metadatos.active || documento.metadatos.visibility !== 'public') continue
    const m = documento.metadatos
    articulos.push({ slug: m.slug!, titulo: m.title, descripcion: m.description!, categoria: m.category!, orden: m.order, audiencia: m.audience, siguiente: m.next, palabrasClave: m.keywords, actualizado: m.updated, documentoId: m.id, bloques: markdownAyuda(documento.cuerpo) })
  }
  return articulos.sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug))
}

export interface ResultadoBusquedaAyuda {
  slug: string
  titulo: string
  descripcion: string
  categoria: CategoriaAyuda
}

const VACIAS = new Set(['como', 'para', 'que', 'con', 'una', 'uno', 'los', 'las', 'del', 'por', 'mis', 'puedo', 'tengo', 'hago', 'donde', 'cuando', 'esta', 'este', 'hay', 'ser', 'the'])

// The search of /ayuda: deterministic, in memory, over the same articles. No model, no network.
// Words match by their stem, from the START of a word ("verificar" finds "verificación", and
// "seña" does not find "contraseña"); the title and the keywords of an article weigh more than
// its text.
export function buscarAyuda(articulos: ArticuloAyuda[], consulta: string, limite = 8): ResultadoBusquedaAyuda[] {
  const terminos = [...new Set(sinAcentos(consulta.slice(0, 120)).split(/[^a-z0-9ñ]+/u).filter((palabra) => palabra.length >= 3 && !VACIAS.has(palabra)).map((palabra) => palabra.slice(0, Math.max(4, palabra.length - 2))))]
  if (terminos.length === 0) return []
  const palabras = (texto: string) => sinAcentos(texto).split(/[^a-z0-9ñ]+/u).filter(Boolean)
  const aparece = (lista: string[], termino: string) => lista.some((palabra) => palabra.startsWith(termino))
  const cuenta = (texto: string) => { const lista = palabras(texto); return terminos.filter((termino) => aparece(lista, termino)).length }
  return articulos
    .map((articulo) => {
      const cuerpo = articulo.bloques.map((bloque) => (bloque.tipo === 'lista' ? bloque.items.map(textoPlano).join(' ') : textoPlano(bloque.hijos))).join(' ')
      const titulos = articulo.bloques.filter((bloque) => bloque.tipo === 'titulo').map((bloque) => (bloque.tipo === 'titulo' ? bloque.texto : '')).join(' ')
      const puntaje = cuenta(articulo.titulo) * 6 + cuenta(articulo.palabrasClave.join(' ')) * 5 + cuenta(articulo.descripcion) * 3 + cuenta(titulos) * 2 + cuenta(cuerpo)
      // Every word of the question has to appear somewhere in the article.
      const todo = palabras(`${articulo.titulo} ${articulo.palabrasClave.join(' ')} ${articulo.descripcion} ${titulos} ${cuerpo}`)
      const cubre = terminos.every((termino) => aparece(todo, termino))
      return { articulo, puntaje: cubre ? puntaje : 0 }
    })
    .filter((item) => item.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje || a.articulo.orden - b.articulo.orden)
    .slice(0, limite)
    .map(({ articulo }) => ({ slug: articulo.slug, titulo: articulo.titulo, descripcion: articulo.descripcion, categoria: articulo.categoria }))
}

export const rutaDeArticulo = (slug: string): string => `/ayuda/${slug}`
