import { createHash } from 'node:crypto'

// RAG for KNOWLEDGE only (what TUS is, how budgets, payments or verification work). Live business
// data (works, budgets, payments) always comes from tools, never from this index. No personal
// data, conversations, secrets or internal security documents are indexed.

export const VISIBILIDADES_CONOCIMIENTO = [
  'public',
  'authenticated-client',
  'authenticated-provider',
  'internal-admin',
] as const
export type VisibilidadConocimiento = (typeof VISIBILIDADES_CONOCIMIENTO)[number]

export const VERSION_CHUNKER = 'markdown-headings-v1'
export const VERSION_INDICE = 'conocimiento-tus-v1'
export const DIMENSION_EMBEDDINGS = 1024 // Existing P3 column: "RagEmbedding"."vector" vector(1024)

export interface DocumentoConocimiento {
  documentId: string
  source: string
  title: string
  version: string
  visibility: VisibilidadConocimiento
  audience: 'all' | 'client' | 'provider'
  language: 'es'
  active: boolean
  checksum: string
  updatedAt: string
}

export interface FragmentoConocimiento {
  chunkId: string
  documentId: string
  documentVersion: string
  chunkIndex: number
  heading: string
  text: string
  visibility: VisibilidadConocimiento
  audience: DocumentoConocimiento['audience']
  language: 'es'
  active: boolean
}

// ---- sources ------------------------------------------------------------------------------

export interface ArchivoConocimiento {
  path: string
  content: string
}

const PATRONES_PROHIBIDOS = [
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/u,
  /(?:api[_-]?key|client[_-]?secret|access[_-]?token|password|contraseña)\s*[:=]\s*\S{8,}/iu,
  /\b(?:APP_USR|EAA[A-Za-z0-9]{10}|gsk_)[A-Za-z0-9_-]{10,}/u,
  /\bDATABASE_URL\b|postgres(?:ql)?:\/\//iu,
]

// Only markdown files under the knowledge directory with a complete front matter are indexed.
// Anything else (env, docs/SEGURIDAD, audits, logs) is out by construction.
export function parsearDocumentoConocimiento(
  file: ArchivoConocimiento
): { document: DocumentoConocimiento; body: string } | { error: string } {
  const normalizedPath = file.path.replaceAll('\\', '/')
  if (!/(^|\/)docs\/conocimiento\/[a-z0-9-]+\.md$/u.test(normalizedPath))
    return { error: 'path is outside docs/conocimiento' }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(file.content)
  if (!match) return { error: 'missing front matter' }
  const fields = new Map<string, string>()
  for (const line of match[1]!.split(/\r?\n/u)) {
    const pair = /^([a-z]+):\s*(.+)$/u.exec(line.trim())
    if (pair) fields.set(pair[1]!, pair[2]!.trim())
  }
  const visibility = fields.get('visibility') as VisibilidadConocimiento | undefined
  const audience = fields.get('audience') as DocumentoConocimiento['audience'] | undefined
  const id = fields.get('id')
  if (!id || !/^[a-z0-9-]{3,80}$/u.test(id)) return { error: 'invalid id' }
  if (!visibility || !VISIBILIDADES_CONOCIMIENTO.includes(visibility))
    return { error: 'invalid visibility' }
  if (!audience || !['all', 'client', 'provider'].includes(audience))
    return { error: 'invalid audience' }
  if (fields.get('language') !== 'es') return { error: 'only es is supported' }
  const title = fields.get('title')
  const version = fields.get('version')
  if (!title || !version) return { error: 'title and version are required' }
  const body = match[2]!.trim()
  if (PATRONES_PROHIBIDOS.some((pattern) => pattern.test(body)))
    return { error: 'content looks like a secret' }
  return {
    document: {
      documentId: id,
      source: normalizedPath.slice(normalizedPath.indexOf('docs/conocimiento/')),
      title,
      version,
      visibility,
      audience,
      language: 'es',
      active: fields.get('active') !== 'false',
      checksum: checksumConocimiento(`${title}\n${version}\n${visibility}\n${audience}\n${body}`),
      updatedAt: fields.get('updated') ?? '',
    },
    body,
  }
}

export function checksumConocimiento(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/gu, '\n').trim()).digest('hex')
}

// ---- chunking (deterministic) --------------------------------------------------------------

const MAX_CHUNK = 1100
const TARGET_CHUNK = 700

export function fragmentarMarkdown(
  document: DocumentoConocimiento,
  body: string
): FragmentoConocimiento[] {
  const sections: { heading: string; text: string }[] = []
  let headings: string[] = [document.title]
  let buffer: string[] = []
  const flush = () => {
    const text = buffer.join('\n').trim()
    if (text) sections.push({ heading: headings.join(' > '), text })
    buffer = []
  }
  for (const line of body.split(/\r?\n/u)) {
    const heading = /^(#{1,4})\s+(.+)$/u.exec(line)
    if (heading) {
      flush()
      const level = heading[1]!.length
      headings = [...headings.slice(0, Math.max(1, level)), heading[2]!.trim()].slice(0, 4)
      continue
    }
    buffer.push(line)
  }
  flush()
  const chunks: { heading: string; text: string }[] = []
  for (const section of sections) {
    const paragraphs = section.text
      .split(/\n\s*\n/u)
      .map((item) => item.trim())
      .filter(Boolean)
    let current = ''
    for (const paragraph of paragraphs) {
      const pieces =
        paragraph.length > MAX_CHUNK
          ? (paragraph.match(new RegExp(`[\\s\\S]{1,${MAX_CHUNK}}(?=\\s|$)`, 'gu')) ?? [paragraph])
          : [paragraph]
      for (const piece of pieces) {
        if (current && current.length + piece.length + 2 > TARGET_CHUNK) {
          chunks.push({ heading: section.heading, text: current })
          current = ''
        }
        current = current ? `${current}\n\n${piece.trim()}` : piece.trim()
      }
    }
    if (current) chunks.push({ heading: section.heading, text: current })
  }
  return chunks.map((chunk, index) => ({
    chunkId: `fragmento-${createHash('sha256').update(`${document.documentId}\0${document.version}\0${index}\0${chunk.text}`).digest('hex').slice(0, 32)}`,
    documentId: document.documentId,
    documentVersion: document.version,
    chunkIndex: index,
    heading: chunk.heading,
    text: chunk.text,
    visibility: document.visibility,
    audience: document.audience,
    language: 'es',
    active: document.active,
  }))
}

// ---- embeddings (separate from the chat provider) -------------------------------------------

export interface EmbeddingProvider {
  readonly id: string
  readonly model: string
  readonly version: string
  readonly dimensions: number
  embed(texts: string[]): Promise<number[][]>
}

function normalizarVector(values: number[]): number[] {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1
  return values.map((value) => value / magnitude)
}

// OpenAI-compatible /embeddings endpoint (any provider exposing it: configurable base URL, key and
// model). The output must have exactly DIMENSION_EMBEDDINGS values to fit the existing column.
export class ProveedorEmbeddingsCompatibleOpenAI implements EmbeddingProvider {
  readonly id = 'openai-compatible'
  readonly dimensions = DIMENSION_EMBEDDINGS

  constructor(
    private readonly options: {
      baseUrl: string
      apiKey: string
      model: string
      sendDimensions?: boolean
      timeoutMs?: number
      fetch?: typeof fetch
    }
  ) {}

  get model() {
    return this.options.model
  }

  get version() {
    return `${this.options.model}:${this.dimensions}`
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const response = await (this.options.fetch ?? fetch)(
      `${this.options.baseUrl.replace(/\/+$/u, '')}/embeddings`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.options.model,
          input: texts,
          ...(this.options.sendDimensions ? { dimensions: this.dimensions } : {}),
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
      }
    )
    if (!response.ok) throw new Error(`embedding request failed with status ${response.status}`)
    const payload = (await response.json()) as { data?: { index?: number; embedding?: unknown }[] }
    const data = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    if (data.length !== texts.length)
      throw new Error('embedding provider returned an unexpected count')
    return data.map((item) => {
      const vector = item.embedding
      if (
        !Array.isArray(vector) ||
        vector.length !== this.dimensions ||
        !vector.every((value) => typeof value === 'number' && Number.isFinite(value))
      )
        throw new Error(`embedding provider must return ${this.dimensions} finite values`)
      return normalizarVector(vector as number[])
    })
  }
}

export function tokensBusqueda(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .split(/[^a-z0-9ñ]+/u)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
}

const STOPWORDS = new Set([
  'que',
  'como',
  'para',
  'con',
  'los',
  'las',
  'del',
  'una',
  'uno',
  'por',
  'mas',
  'mis',
  'sus',
  'esto',
  'esta',
  'este',
  'hay',
  'son',
  'cual',
  'donde',
  'cuando',
  'puedo',
  'tengo',
  'quiero',
  'sobre',
  'entre',
  'pero',
  'sin',
  'the',
  'and',
])

// Deterministic local embedding (hashed bag of words). For tests and local development only:
// it has lexical, not semantic, quality and is never selected for production automatically.
export class EmbeddingsLocalesHash implements EmbeddingProvider {
  readonly id = 'local-hash'
  readonly model = 'local-hash-bow'
  readonly version = 'local-hash-bow:1024'
  readonly dimensions = DIMENSION_EMBEDDINGS

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Array<number>(this.dimensions).fill(0)
      for (const token of tokensBusqueda(text)) {
        const stem = token.length > 5 ? token.slice(0, 5) : token
        const bucket = createHash('sha256').update(stem).digest().readUInt32BE(0) % this.dimensions
        vector[bucket] = (vector[bucket] ?? 0) + 1
      }
      return normalizarVector(vector)
    })
  }
}

// ---- index port ---------------------------------------------------------------------------

export interface FiltroConocimiento {
  visibilities: VisibilidadConocimiento[]
  audiences: DocumentoConocimiento['audience'][]
  language: 'es'
}

export interface ResultadoBusqueda {
  chunk: FragmentoConocimiento
  documentTitle: string
  score: number
}

export interface PuertoIndiceConocimiento {
  documento(
    documentId: string
  ): Promise<(DocumentoConocimiento & { embeddingVersion: string | null }) | null>
  // Atomically replaces every chunk of the document (old versions become inactive/removed).
  reemplazar(
    document: DocumentoConocimiento,
    chunks: FragmentoConocimiento[],
    vectors: number[][] | null,
    embedding: { model: string; version: string } | null
  ): Promise<void>
  desactivarExcepto(activeDocumentIds: string[]): Promise<number>
  buscarVector(
    vector: number[],
    filter: FiltroConocimiento,
    limit: number,
    embeddingVersion: string
  ): Promise<ResultadoBusqueda[]>
  buscarLexico(
    query: string,
    filter: FiltroConocimiento,
    limit: number
  ): Promise<ResultadoBusqueda[]>
  estadisticas(): Promise<{
    documents: number
    activeDocuments: number
    chunks: number
    vectors: number
  }>
}

function coseno(a: number[], b: number[]): number {
  let sum = 0
  for (let index = 0; index < a.length; index += 1) sum += (a[index] ?? 0) * (b[index] ?? 0)
  return sum
}

export class IndiceConocimientoEnMemoria implements PuertoIndiceConocimiento {
  readonly documents = new Map<
    string,
    DocumentoConocimiento & { embeddingVersion: string | null }
  >()
  readonly chunks = new Map<
    string,
    FragmentoConocimiento & { vector: number[] | null; embeddingVersion: string | null }
  >()
  embedCalls = 0

  async documento(id: string) {
    return this.documents.get(id) ?? null
  }

  async reemplazar(
    document: DocumentoConocimiento,
    chunks: FragmentoConocimiento[],
    vectors: number[][] | null,
    embedding: { model: string; version: string } | null
  ) {
    for (const [key, chunk] of this.chunks)
      if (chunk.documentId === document.documentId) this.chunks.delete(key)
    chunks.forEach((chunk, index) =>
      this.chunks.set(chunk.chunkId, {
        ...chunk,
        vector: vectors?.[index] ?? null,
        embeddingVersion: vectors ? (embedding?.version ?? null) : null,
      })
    )
    this.documents.set(document.documentId, {
      ...document,
      embeddingVersion: vectors ? (embedding?.version ?? null) : null,
    })
  }

  async desactivarExcepto(ids: string[]) {
    let count = 0
    for (const [id, document] of this.documents) {
      if (!ids.includes(id) && document.active) {
        this.documents.set(id, { ...document, active: false })
        for (const [key, chunk] of this.chunks)
          if (chunk.documentId === id) this.chunks.set(key, { ...chunk, active: false })
        count += 1
      }
    }
    return count
  }

  private permitido(chunk: FragmentoConocimiento, filter: FiltroConocimiento) {
    const document = this.documents.get(chunk.documentId)
    return (
      chunk.active &&
      document?.active === true &&
      document.version === chunk.documentVersion &&
      filter.visibilities.includes(chunk.visibility) &&
      filter.audiences.includes(chunk.audience) &&
      chunk.language === filter.language
    )
  }

  async buscarVector(
    vector: number[],
    filter: FiltroConocimiento,
    limit: number,
    embeddingVersion: string
  ) {
    return [...this.chunks.values()]
      .filter(
        (chunk) =>
          chunk.vector &&
          chunk.embeddingVersion === embeddingVersion &&
          this.permitido(chunk, filter)
      )
      .map((chunk) => ({
        chunk: stripVector(chunk),
        documentTitle: this.documents.get(chunk.documentId)!.title,
        score: coseno(vector, chunk.vector!),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  async buscarLexico(query: string, filter: FiltroConocimiento, limit: number) {
    const terms = new Set(tokensBusqueda(query))
    if (terms.size === 0) return []
    return [...this.chunks.values()]
      .filter((chunk) => this.permitido(chunk, filter))
      .map((chunk) => {
        const words = tokensBusqueda(`${chunk.heading} ${chunk.text}`)
        const hits = [...terms].filter((term) =>
          words.some(
            (word) => word === term || (term.length > 4 && word.startsWith(term.slice(0, 5)))
          )
        )
        return {
          chunk: stripVector(chunk),
          documentTitle: this.documents.get(chunk.documentId)!.title,
          score: hits.length / terms.size,
        }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  async estadisticas() {
    const documents = [...this.documents.values()]
    return {
      documents: documents.length,
      activeDocuments: documents.filter((document) => document.active).length,
      chunks: [...this.chunks.values()].filter((chunk) => chunk.active).length,
      vectors: [...this.chunks.values()].filter((chunk) => chunk.active && chunk.vector).length,
    }
  }
}

function stripVector<T extends FragmentoConocimiento>(
  chunk: T & { vector?: unknown; embeddingVersion?: unknown }
): FragmentoConocimiento {
  const { vector: _vector, embeddingVersion: _version, ...rest } = chunk
  void _vector
  void _version
  return rest
}

// ---- indexer ------------------------------------------------------------------------------

export interface ResultadoIndexacion {
  indexed: string[]
  unchanged: string[]
  skipped: { path: string; reason: string }[]
  deactivated: number
  chunks: number
  embedded: number
  dryRun: boolean
}

export async function indexarConocimiento(input: {
  files: ArchivoConocimiento[]
  index: PuertoIndiceConocimiento
  embeddings: EmbeddingProvider | null
  dryRun?: boolean
}): Promise<ResultadoIndexacion> {
  const result: ResultadoIndexacion = {
    indexed: [],
    unchanged: [],
    skipped: [],
    deactivated: 0,
    chunks: 0,
    embedded: 0,
    dryRun: Boolean(input.dryRun),
  }
  const present: string[] = []
  for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parsed = parsearDocumentoConocimiento(file)
    if ('error' in parsed) {
      result.skipped.push({ path: file.path.replaceAll('\\', '/'), reason: parsed.error })
      continue
    }
    const { document, body } = parsed
    if (present.includes(document.documentId)) {
      result.skipped.push({ path: document.source, reason: 'duplicate id' })
      continue
    }
    if (document.active) present.push(document.documentId)
    const current = await input.index.documento(document.documentId)
    const wantedEmbedding = input.embeddings?.version ?? null
    // Same content, same version and same embedding model: no re-embedding (idempotent restarts).
    if (
      current &&
      current.checksum === document.checksum &&
      current.version === document.version &&
      current.active === document.active &&
      current.embeddingVersion === wantedEmbedding
    ) {
      result.unchanged.push(document.documentId)
      continue
    }
    const chunks = fragmentarMarkdown(document, body)
    result.chunks += chunks.length
    if (input.dryRun) {
      result.indexed.push(document.documentId)
      continue
    }
    let vectors: number[][] | null = null
    if (input.embeddings && chunks.length > 0) {
      vectors = []
      for (let start = 0; start < chunks.length; start += 16) {
        const batch = chunks.slice(start, start + 16)
        vectors.push(
          ...(await input.embeddings.embed(batch.map((chunk) => `${chunk.heading}\n${chunk.text}`)))
        )
      }
      result.embedded += vectors.length
    }
    await input.index.reemplazar(
      document,
      chunks,
      vectors,
      input.embeddings ? { model: input.embeddings.model, version: input.embeddings.version } : null
    )
    result.indexed.push(document.documentId)
  }
  if (!input.dryRun) result.deactivated = await input.index.desactivarExcepto(present)
  return result
}

// ---- retrieval ----------------------------------------------------------------------------

export interface ContextoRecuperacion {
  linked: boolean
  isProvider: boolean
}

export function filtroParaActor(actor: ContextoRecuperacion): FiltroConocimiento {
  // internal-admin documents are never retrievable from WhatsApp.
  const visibilities: VisibilidadConocimiento[] = ['public']
  if (actor.linked) visibilities.push('authenticated-client')
  if (actor.linked && actor.isProvider) visibilities.push('authenticated-provider')
  return {
    visibilities,
    audiences: actor.isProvider ? ['all', 'client', 'provider'] : ['all', 'client'],
    language: 'es',
  }
}

export interface RecuperacionConocimiento {
  confidence: 'high' | 'low'
  results: ResultadoBusqueda[]
  strategy: 'hybrid' | 'lexical'
}

export class RecuperadorConocimiento {
  constructor(
    private readonly index: PuertoIndiceConocimiento,
    private readonly embeddings: EmbeddingProvider | null,
    private readonly options: { topK: number; minVectorScore: number; minLexicalScore: number } = {
      topK: 4,
      minVectorScore: 0.35,
      minLexicalScore: 0.34,
    }
  ) {}

  async buscar(query: string, actor: ContextoRecuperacion): Promise<RecuperacionConocimiento> {
    const filter = filtroParaActor(actor)
    const candidates = this.options.topK * 3
    const lexical = await this.index.buscarLexico(query, filter, candidates)
    let vector: ResultadoBusqueda[] = []
    if (this.embeddings) {
      try {
        const [queryVector] = await this.embeddings.embed([query])
        vector = await this.index.buscarVector(
          queryVector!,
          filter,
          candidates,
          this.embeddings.version
        )
      } catch {
        vector = []
      }
    }
    // Reciprocal rank fusion of both rankings (k = 60).
    const fused = new Map<
      string,
      { item: ResultadoBusqueda; score: number; vectorScore: number; lexicalScore: number }
    >()
    const add = (items: ResultadoBusqueda[], kind: 'vector' | 'lexical') =>
      items.forEach((item, rank) => {
        const current = fused.get(item.chunk.chunkId) ?? {
          item,
          score: 0,
          vectorScore: 0,
          lexicalScore: 0,
        }
        current.score += 1 / (60 + rank + 1)
        if (kind === 'vector') current.vectorScore = item.score
        else current.lexicalScore = item.score
        fused.set(item.chunk.chunkId, current)
      })
    add(vector, 'vector')
    add(lexical, 'lexical')
    const ranked = [...fused.values()]
      .filter(
        (entry) =>
          entry.vectorScore >= this.options.minVectorScore ||
          entry.lexicalScore >= this.options.minLexicalScore
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, this.options.topK)
    return {
      confidence: ranked.length > 0 ? 'high' : 'low',
      results: ranked.map((entry) => ({ ...entry.item, score: Number(entry.score.toFixed(5)) })),
      strategy: this.embeddings ? 'hybrid' : 'lexical',
    }
  }
}

// Retrieved chunks are DATA: wrapped, with angle brackets neutralized so a document cannot close
// the wrapper or impersonate system/tool messages.
export function formatearFragmentosParaPrompt(results: ResultadoBusqueda[]): string {
  if (results.length === 0) return 'No se encontraron documentos relevantes.'
  return results
    .map(
      (result) =>
        `<documento id="${result.chunk.documentId}" version="${result.chunk.documentVersion}" seccion="${neutralizar(result.chunk.heading)}">\n${neutralizar(result.chunk.text)}\n</documento>`
    )
    .join('\n')
}

function neutralizar(text: string): string {
  return text.replace(/[<>]/gu, (char) => (char === '<' ? '‹' : '›'))
}
