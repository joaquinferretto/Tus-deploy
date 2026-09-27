import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import type { Request, Response, Router as ExpressRouter } from 'express'

// GET /version: qué build está corriendo, para verificar un deploy sin adivinar por comportamiento.
// Solo el SHA compilado (dist/build-info.json, generado por scripts/build-api.mjs), la hora del
// build y la hora en que arrancó ESTE proceso (si es anterior al deploy, el runtime no se
// reinició). Nunca variables de entorno, rutas, hosts ni secretos.

export interface VersionApi {
  service: 'tus-api'
  commit: string
  builtAt: string | null
  startedAt: string
}

const STARTED_AT = new Date().toISOString()
const SHA = /^[0-9a-f]{7,40}$/u
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u

// `node dist/index.js` corre con cwd apps/api; se aceptan también la raíz del repo (despliegues que
// arrancan desde ahí) y un override explícito.
export function leerVersionApi(
  environment: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
  read: (path: string) => string | null = leerArchivo
): VersionApi {
  const candidates = [environment['TUS_BUILD_INFO_PATH'], join(cwd, 'dist', 'build-info.json'), join(cwd, 'apps', 'api', 'dist', 'build-info.json')].filter(
    (path): path is string => typeof path === 'string' && path.length > 0
  )
  for (const path of candidates) {
    const raw = read(path)
    if (!raw) continue
    try {
      const info = JSON.parse(raw) as { commit?: unknown; builtAt?: unknown }
      if (typeof info.commit === 'string' && SHA.test(info.commit))
        return { service: 'tus-api', commit: info.commit, builtAt: typeof info.builtAt === 'string' && ISO.test(info.builtAt) ? info.builtAt : null, startedAt: STARTED_AT }
    } catch {
      // Archivo inválido: se prueba el siguiente candidato.
    }
  }
  const fromEnv = environment['TUS_BUILD_SHA']?.trim()
  return { service: 'tus-api', commit: fromEnv && SHA.test(fromEnv) ? fromEnv : 'unknown', builtAt: null, startedAt: STARTED_AT }
}

function leerArchivo(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

export function createVersionRouter(version: VersionApi = leerVersionApi()): ExpressRouter {
  const router = express.Router()
  router.get('/version', (_request: Request, response: Response) => {
    response.setHeader('cache-control', 'no-store')
    response.status(200).json(version)
  })
  return router
}
