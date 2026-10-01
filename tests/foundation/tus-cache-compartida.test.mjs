import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Política de caché de las respuestas públicas de la API.
//
// Producción (2026-10-01): una caché de Hostinger delante de la API guardó respuestas marcadas
// `cache-control: public` generadas para peticiones SIN Origin (por lo tanto sin
// Access-Control-Allow-Origin) y las reprodujo a los navegadores ignorando `Vary: Origin`; la
// home falló con "No 'Access-Control-Allow-Origin' header is present". La aplicación no puede
// corregir esa caché, pero sí impedir que sus respuestas sean almacenables por una caché compartida.

const require = createRequire(import.meta.url)
const express = require('../../apps/api/node_modules/express')

// Sin Redis: el limitador usa su almacén en memoria (mismo middleware que producción).
process.env['NATIVE_PROFILE'] = '1'
const { createCorrelationMiddleware } = await import('../../apps/api/src/presentation/middleware/correlation.ts')
const { createCorsMiddleware } = await import('../../apps/api/src/presentation/middleware/cors.ts')
const { rateLimitMiddleware } = await import('../../apps/api/src/presentation/middleware/rate-limit.ts')
const { crearRouterDirectorio } = await import('../../apps/api/src/tus/directorio/http.ts')
const { crearRouterSolicitudes } = await import('../../apps/api/src/tus/solicitudes/http.ts')
const { crearRouterTurnos } = await import('../../apps/api/src/tus/calendar/turnos-http.ts')
const { crearRouterTelefono } = await import('../../apps/api/src/auth-security/phone/http.ts')

const WEB = 'https://tusservicios.shop'
const SESION = { subjectId: 'acct-1', sessionId: 'ses-1', tenantId: 'tenant-1', roles: ['owner'], permissions: ['tus:marketplace:read'] }
const sessions = { resolve: async (token, correlationId) => (token === 'tok-1' ? { ...SESION, correlationId } : null) }

// Mismo orden que apps/api/src/server.ts: correlación, CORS, rate limit y después los routers.
function crearApp() {
  const app = express()
  app.use(createCorrelationMiddleware())
  app.use(createCorsMiddleware({ CORS_ORIGINS: `${WEB},https://www.tusservicios.shop` }))
  app.use(rateLimitMiddleware)
  app.use(crearRouterDirectorio({
    sessions,
    servicio: {
      listar: async () => ({ items: [], total: 0, page: 1, hasMore: false }),
      perfil: async (id) => (id === 'perfil-1' ? { id: 'perfil-1', displayName: 'Prestador' } : null),
    },
  }))
  app.use(crearRouterSolicitudes({
    sessions,
    servicio: {
      listarPublicas: async () => [],
      imagenPublica: async () => ({ tipoMime: 'image/png', contenido: Buffer.from([137, 80, 78, 71]) }),
    },
  }))
  app.use(crearRouterTurnos({ sessions, servicio: { disponibilidadPublica: async () => ({ slots: [], tarifas: [] }) } }))
  app.use(crearRouterTelefono({
    sessions,
    servicio: {
      numeroOficial: '+5493794000000',
      estadoCuenta: async () => ({ verified: false, phoneMasked: null, verifiedAt: null, pendingMasked: null }),
    },
  }))
  return app
}

async function conServidor(fn) {
  const server = crearApp().listen(0)
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.close()
  }
}

const pedir = (base, path, headers = {}) => fetch(`${base}${path}`, { headers })
const cache = (response) => response.headers.get('cache-control') ?? ''

// Respuestas JSON públicas que antes eran `public, max-age=N`.
const JSON_PUBLICOS = [
  '/tus/v1/public/oficios',
  '/tus/v1/public/prestadores',
  '/tus/v1/public/prestadores?mapa=1',
  '/tus/v1/public/prestadores/perfil-1',
  '/tus/v1/public/solicitudes',
  '/tus/v1/public/prestadores/perfil-1/turnos/disponibilidad?oficioId=plomeria&fecha=2026-11-20',
  '/auth/phone/config',
]

test('CACHE API: las respuestas JSON públicas no son almacenables por una caché compartida', async () => {
  await conServidor(async (base) => {
    for (const path of JSON_PUBLICOS) {
      const response = await pedir(base, path, { Origin: WEB })
      assert.equal(response.status, 200, path)
      assert.doesNotMatch(cache(response), /public/u, `${path}: no debe ser public`)
      assert.match(cache(response), /private/u, path)
      assert.match(cache(response), /no-store/u, path)
    }
  })
})

test('CACHE API: con Origin permitido el CORS sigue intacto (ACAO, credenciales y Vary: Origin)', async () => {
  await conServidor(async (base) => {
    for (const path of JSON_PUBLICOS) {
      const response = await pedir(base, path, { Origin: WEB })
      assert.equal(response.headers.get('access-control-allow-origin'), WEB, path)
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true', path)
      assert.match(response.headers.get('vary') ?? '', /Origin/u, `${path}: Vary: Origin`)
    }
    // El otro origen permitido recibe su propio valor, no el del primero.
    const www = await pedir(base, '/tus/v1/public/oficios', { Origin: 'https://www.tusservicios.shop' })
    assert.equal(www.headers.get('access-control-allow-origin'), 'https://www.tusservicios.shop')
  })
})

test('CACHE API regresión: la respuesta a una petición sin Origin no puede reutilizarse para otra con Origin', async () => {
  await conServidor(async (base) => {
    for (const path of JSON_PUBLICOS) {
      // A: sin Origin (un script, un monitor, alguien abriendo la URL): no lleva ACAO.
      const a = await pedir(base, path)
      assert.equal(a.status, 200, path)
      assert.equal(a.headers.get('access-control-allow-origin'), null, `${path}: sin Origin no hay ACAO`)
      // Esa respuesta es justamente la que no debe guardar una caché compartida.
      assert.doesNotMatch(cache(a), /public/u, path)
      assert.match(cache(a), /private/u, path)
      assert.match(cache(a), /no-store/u, path)
      assert.match(a.headers.get('vary') ?? '', /Origin/u, `${path}: declara que varía por Origin`)

      // B: el navegador de la Web recibe su propia respuesta, con CORS.
      const b = await pedir(base, path, { Origin: WEB })
      assert.equal(b.headers.get('access-control-allow-origin'), WEB, path)
      assert.doesNotMatch(cache(b), /public/u, path)
    }
  })
})

test('CACHE API: cada respuesta lleva su propio X-Correlation-Id y su propio estado de rate limit', async () => {
  await conServidor(async (base) => {
    const path = '/tus/v1/public/oficios'
    const a = await pedir(base, path, { Origin: WEB })
    const b = await pedir(base, path, { Origin: WEB })
    const idA = a.headers.get('x-correlation-id')
    const idB = b.headers.get('x-correlation-id')
    assert.match(idA, /^corr-[0-9a-f-]{36}$/u)
    assert.match(idB, /^corr-[0-9a-f-]{36}$/u)
    assert.notEqual(idA, idB, 'el identificador no es estático ni compartido')

    // El que envía el cliente se devuelve tal cual: es de esa petición, no de otra.
    const propio = await pedir(base, path, { Origin: WEB, 'X-Correlation-Id': 'cliente-123' })
    assert.equal(propio.headers.get('x-correlation-id'), 'cliente-123')

    // Estado de rate limit por cliente en la misma respuesta: otro motivo para no compartirla.
    const restanteA = Number(a.headers.get('ratelimit-remaining'))
    const restanteB = Number(b.headers.get('ratelimit-remaining'))
    assert.ok(Number.isFinite(restanteA) && Number.isFinite(restanteB))
    assert.equal(restanteB, restanteA - 1)
    assert.match(cache(b), /no-store/u)
  })
})

test('CACHE API: el teléfono de la cuenta depende de la sesión y nunca se cachea', async () => {
  await conServidor(async (base) => {
    const sinSesion = await pedir(base, '/auth/phone', { Origin: WEB })
    assert.equal(sinSesion.status, 401)
    assert.match(cache(sinSesion), /no-store/u)
    assert.doesNotMatch(cache(sinSesion), /public/u)

    const conSesion = await pedir(base, '/auth/phone', { Origin: WEB, Authorization: 'Bearer tok-1', 'X-Correlation-Id': 'corr-test-1' })
    assert.equal(conSesion.status, 200)
    assert.match(cache(conSesion), /no-store/u)
    assert.doesNotMatch(cache(conSesion), /public/u)
    assert.equal(conSesion.headers.get('access-control-allow-origin'), WEB)
  })
})

test('CACHE API: las fotos públicas de solicitudes solo usan la caché del navegador', async () => {
  await conServidor(async (base) => {
    const imagen = await pedir(base, '/tus/v1/public/solicitudes/sol-1/imagenes/1')
    assert.equal(imagen.status, 200)
    assert.equal(cache(imagen), 'private, max-age=300')
  })
})

test('CACHE API: ningún handler de la API declara una respuesta como `public`', () => {
  const raiz = fileURLToPath(new URL('../../apps/api/src', import.meta.url))
  const archivos = []
  const recorrer = (dir) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre)
      if (statSync(ruta).isDirectory()) recorrer(ruta)
      else if (/\.ts$/u.test(nombre) && !/\.test\.|\.d\.ts$/u.test(nombre)) archivos.push(ruta)
    }
  }
  recorrer(raiz)
  const infractores = []
  for (const archivo of archivos) {
    readFileSync(archivo, 'utf8').split('\n').forEach((linea, indice) => {
      // setHeader('cache-control', 'public…') o un valor de caché público pasado a un helper.
      if (/['"`]public\s*,\s*(?:s-)?max-age/iu.test(linea)) infractores.push(`${archivo.slice(raiz.length + 1)}:${indice + 1}`)
    })
  }
  assert.deepEqual(infractores, [])
})
