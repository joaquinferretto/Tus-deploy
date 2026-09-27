import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { disconnectPrisma, getPrismaClient } from '../../infrastructure/database/prisma/client.ts'
import {
  IndiceConocimientoPrisma,
  type ClientePrismaAsistente,
} from '../adapters/prisma-asistente.ts'
import { crearProveedorEmbeddings, leerLimites } from './composicion.ts'
import {
  formatearFragmentosParaPrompt,
  RecuperadorConocimiento,
  UMBRAL_LEXICO,
  indexarConocimiento,
  type ArchivoConocimiento,
} from './conocimiento.ts'
import { ServicioAyudaPublica } from './ayuda.ts'
import { redactarPii } from './modelo.ts'

const repositoryRoot = resolve(process.cwd())
const knowledgeDirectory = join(repositoryRoot, 'docs', 'conocimiento')
const env = process.env
const command = process.argv[2]

const out = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }))

async function main() {
  if (!['ingest', 'search', 'stats', 'smoke'].includes(command ?? '')) {
    out('rag.usage', {
      commands: [
        'tus:rag:ingest [--dry-run]',
        'tus:rag:search --query <text> [--linked] [--provider]',
        'tus:rag:stats',
        'tus:rag:smoke',
      ],
    })
    process.exitCode = 2
    return
  }

  const prisma = getPrismaClient()
  const index = new IndiceConocimientoPrisma(prisma as unknown as ClientePrismaAsistente)
  try {
    if (command === 'ingest') await ingest(index)
    else if (command === 'search') await search(index)
    else if (command === 'smoke') await smoke(index)
    else await stats(index)
  } finally {
    await disconnectPrisma()
  }
}

async function ingest(index: IndiceConocimientoPrisma) {
  const embeddings = crearProveedorEmbeddings(env)
  const result = await indexarConocimiento({
    files: cargarArchivosConocimiento(),
    index,
    embeddings,
    dryRun: process.argv.includes('--dry-run'),
  })
  out('rag.ingest.completed', {
    ...result,
    embeddingProvider: embeddings?.id ?? 'none',
    embeddingVersion: embeddings?.version ?? null,
  })
}

async function search(index: IndiceConocimientoPrisma) {
  const query =
    readOption('--query') ??
    process.argv
      .slice(3)
      .filter((value) => !value.startsWith('--'))
      .join(' ')
      .trim()
  if (!query) {
    out('rag.search_refused', { reason: '--query <text> is required' })
    process.exitCode = 2
    return
  }
  const embeddings = crearProveedorEmbeddings(env)
  const retriever = new RecuperadorConocimiento(index, embeddings, {
    topK: leerLimites(env).topK,
    minVectorScore: 0.35,
    minLexicalScore: UMBRAL_LEXICO,
  })
  const result = await retriever.buscar(redactarPii(query), {
    linked: process.argv.includes('--linked'),
    isProvider: process.argv.includes('--provider'),
  })
  out('rag.search.completed', {
    query: redactarPii(query).slice(0, 200),
    confidence: result.confidence,
    strategy: result.strategy,
    results: result.results.map((item) => ({
      documentId: item.chunk.documentId,
      version: item.chunk.documentVersion,
      heading: item.chunk.heading,
      score: item.score,
      text: redactarPii(item.chunk.text).slice(0, 1000),
    })),
    promptData: formatearFragmentosParaPrompt(result.results).slice(0, 5000),
  })
}

// Smoke de solo lectura sobre la base configurada: índice no vacío, respuestas públicas conocidas y
// abstención ante un dato vivo de negocio. Exit 1 si algo falla. No escribe ni reindexa.
const SMOKE_CASOS: { question: string; expect: 'answered' | 'low_confidence'; document?: string }[] = [
  { question: '¿Qué es TUS?', expect: 'answered', document: 'que-es-tus' },
  { question: '¿Puedo cancelar un trabajo?', expect: 'answered', document: 'cancelaciones' },
  { question: '¿Cómo acepto un presupuesto?', expect: 'answered', document: 'presupuestos' },
  { question: '¿Cuánto debo cobrarle a Juan?', expect: 'low_confidence' },
]

async function smoke(index: IndiceConocimientoPrisma) {
  const statistics = await index.estadisticas()
  if (statistics.activeDocuments === 0) {
    out('rag.smoke.failed', { reason: 'index is empty; run tus:rag:ingest', statistics })
    process.exitCode = 1
    return
  }
  const embeddings = crearProveedorEmbeddings(env)
  const ayuda = new ServicioAyudaPublica(
    new RecuperadorConocimiento(index, embeddings, { topK: leerLimites(env).topK, minVectorScore: 0.35, minLexicalScore: UMBRAL_LEXICO })
  )
  const checks = []
  for (const item of SMOKE_CASOS) {
    const result = await ayuda.responder(item.question)
    const top = result.status === 'answered' ? result.answers[0]?.documentId ?? null : null
    checks.push({ question: item.question, expected: item.expect, status: result.status, top, ok: result.status === item.expect && (!item.document || top === item.document) })
  }
  const passed = checks.every((check) => check.ok)
  out(passed ? 'rag.smoke.passed' : 'rag.smoke.failed', { statistics, strategy: embeddings ? 'hybrid' : 'lexical', checks })
  if (!passed) process.exitCode = 1
}

async function stats(index: IndiceConocimientoPrisma) {
  out('rag.stats.completed', await index.estadisticas())
}

function cargarArchivosConocimiento(): ArchivoConocimiento[] {
  return readdirSync(knowledgeDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      path: `docs/conocimiento/${entry.name}`,
      content: readFileSync(join(knowledgeDirectory, entry.name), 'utf8'),
    }))
}

function readOption(name: string): string | null {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return value && !value.startsWith('--') ? value.trim() || null : null
}

main().catch((error: unknown) => {
  out('rag.cli_failed', { reason: error instanceof Error ? error.name : 'unexpected_error' })
  process.exitCode = 1
})
