import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// Web side of "Buscar servicios" (assistant) and "Buscar trabajador" (directory).
const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')
const web = (path) => readFileSync(join(root, 'apps/web/src', path), 'utf8')

function run(source) {
  const output = execFileSync(process.execPath, [tsxCli, '--eval', `(async () => {\n${source}\n})()`], { cwd: root, encoding: 'utf8' })
  return JSON.parse(output.trim())
}

test('NAV: header offers both paths and the pages exist', () => {
  const header = web('features/home/public-header.tsx')
  assert.match(header, /href: '\/asistente', label: 'Buscar servicios'/)
  assert.match(header, /href: '\/trabajadores', label: 'Buscar trabajador'/)
  assert.match(header, /aria-current=/)
  assert.match(header, /withReturnTo\('\/sign-in', back\)/)
  for (const page of ['asistente/page.tsx', 'trabajadores/page.tsx', 'trabajadores/[id]/page.tsx', 'mis-solicitudes/page.tsx', 'prestador/perfil-publico/page.tsx', 'prestador/solicitudes/page.tsx'])
    assert.ok(existsSync(join(root, 'apps/web/src/app', page)), page)
  assert.match(web('app/tus/tus-prestador.tsx'), /href="\/prestador\/solicitudes"/)
})

test('DIRECTORY client: public reads without credentials, candidates with the session, typed errors', () => {
  const result = run(`
    process.env.NEXT_PUBLIC_API_URL = 'https://api.tusservicios.shop'
    const mod = await import('./apps/web/src/features/directory/directory-client.ts')
    const { createDirectoryClient, directoryQuery, apiUrl, DirectoryRequestError } = mod.default ?? mod
    const calls = []
    const ok = (body) => async (url, init = {}) => { calls.push({ url, method: init.method ?? 'GET', auth: init.headers?.Authorization ?? null, body: init.body ?? null }); return { ok: true, status: 200, json: async () => body } }
    const session = { accessToken: 'tok', correlationId: 'corr' }
    await createDirectoryClient(ok({ items: [], total: 0, page: 1, hasMore: false })).list({ oficio: 'electricidad', q: ' electricista ', verificados: true, hoy: false, orden: 'trabajos', pagina: 2 })
    await createDirectoryClient(ok({})).profile('abc-123')
    await createDirectoryClient(ok({})).interpret('pierde agua')
    await createDirectoryClient(ok({ items: [], reason: 'no_providers' })).candidates(session, { profession: 'plomeria', zone: null })
    let error = null
    try {
      await createDirectoryClient(async () => ({ ok: false, status: 422, json: async () => ({ code: 'INVALID_PROFILE', fields: ['zone'] }) })).saveProfile(session, { displayName: 'x', profession: 'plomeria', zone: '', description: '', yearsOfExperience: null, visible: true })
    } catch (caught) { error = { isTyped: caught instanceof DirectoryRequestError, status: caught.status, code: caught.code, fields: caught.fields } }
    console.log(JSON.stringify({ calls, error, empty: directoryQuery({}), image: apiUrl('/tus/v1/public/solicitudes/a/imagenes/1'), external: apiUrl('https://evil.example/x.png') }))
  `)
  assert.equal(result.calls[0].url, 'https://api.tusservicios.shop/tus/v1/public/prestadores?oficio=electricidad&q=electricista&verificados=1&orden=trabajos&pagina=2')
  assert.equal(result.calls[0].auth, null)
  assert.equal(result.calls[1].url, 'https://api.tusservicios.shop/tus/v1/public/prestadores/abc-123')
  assert.deepEqual([result.calls[2].method, result.calls[2].auth], ['POST', null])
  assert.deepEqual([result.calls[3].url, result.calls[3].auth], ['https://api.tusservicios.shop/tus/v1/asistente/candidatos', 'Bearer tok'])
  assert.deepEqual(result.error, { isTyped: true, status: 422, code: 'INVALID_PROFILE', fields: ['zone'] })
  assert.equal(result.empty, '')
  assert.equal(result.image, 'https://api.tusservicios.shop/tus/v1/public/solicitudes/a/imagenes/1')
  assert.equal(result.external, '')
})

test('RETURN: after sign-in or sign-up the user comes back to the assistant or the worker, never to an external URL', () => {
  const result = run(`
    const mod = await import('./apps/web/src/features/auth/auth-validation.ts')
    const { safeInternalPath, withReturnTo } = mod.default ?? mod
    console.log(JSON.stringify({
      paths: ['/asistente', '/trabajadores/abc?solicitar=1', '//evil.example', 'https://evil.example', '/\\\\evil', ' /mis-solicitudes '].map(safeInternalPath),
      signIn: withReturnTo('/sign-in', '/trabajadores/abc?solicitar=1'),
      plain: withReturnTo('/registro', null),
    }))
  `)
  assert.deepEqual(result.paths, ['/asistente', '/trabajadores/abc?solicitar=1', null, null, null, '/mis-solicitudes'])
  assert.equal(result.signIn, '/sign-in?returnTo=%2Ftrabajadores%2Fabc%3Fsolicitar%3D1')
  assert.equal(result.plain, '/registro')
  assert.match(web('features/auth/login-form.tsx'), /takeReturnTo\(\)/)
  assert.match(web('features/auth/google-flow.tsx'), /takeReturnTo\(\) \?\? '\/tus'/)
  assert.match(web('features/auth/register-form.tsx'), /rememberReturnTo\(requested\)/)
})

test('REQUESTS client: directed request carries only the chosen provider and origin; status never says confirmed before acceptance', () => {
  const result = run(`
    process.env.NEXT_PUBLIC_API_URL = 'https://api.tusservicios.shop'
    const mod = await import('./apps/web/src/features/requests/requests-client.ts')
    const { createRequestsClient, requestStatusLabel } = mod.default ?? mod
    const calls = []
    const respond = (status, body) => async (url, init) => { calls.push({ url, headers: init.headers, body: init.body }); return { ok: status < 300, status, json: async () => body } }
    const session = { accessToken: 'tok', correlationId: 'corr' }
    const input = { category: 'plomeria', title: 'Pierde agua la canilla', description: '', zone: 'Centro', budgetMax: null, urgency: 'urgente', providerId: 'perfil-1', origin: 'web_directory' }
    await createRequestsClient(session, respond(201, { id: 's1' })).publish(input)
    const unavailable = await createRequestsClient(session, respond(409, { code: 'PROVIDER_NOT_AVAILABLE' })).publish(input)
    const self = await createRequestsClient(session, respond(409, { code: 'SELF_REQUEST' })).publish(input)
    const upload = await createRequestsClient(session, respond(201, { images: 1 })).uploadImage('s1', new Blob([new Uint8Array(10)]))
    const tooMany = await createRequestsClient(session, respond(409, {})).uploadImage('s1', new Blob([new Uint8Array(10)]))
    const base = { status: 'abierta', provider: { id: 'p', displayName: 'Carlos M.' } }
    console.log(JSON.stringify({
      body: JSON.parse(calls[0].body), unavailable, self, upload, tooMany, uploadCall: calls.at(-2),
      labels: ['pendiente', 'aceptada', 'rechazada', 'cancelada'].map((assignment) => requestStatusLabel({ ...base, assignment })),
      publica: requestStatusLabel({ status: 'abierta', provider: null, assignment: null }),
    }))
  `)
  assert.deepEqual(Object.keys(result.body).sort(), ['budgetMax', 'category', 'description', 'origin', 'providerId', 'title', 'urgency', 'zone'])
  assert.equal(result.unavailable.kind, 'provider_unavailable')
  assert.equal(result.self.kind, 'self_request')
  assert.deepEqual(result.upload, { ok: true })
  assert.deepEqual(result.tooMany, { ok: false, kind: 'limit' })
  assert.equal(result.uploadCall.url, 'https://api.tusservicios.shop/tus/v1/solicitudes/s1/imagenes')
  assert.equal(result.uploadCall.headers['Content-Type'], 'application/octet-stream')
  assert.match(result.labels[0], /pendiente de aceptación/)
  assert.doesNotMatch(result.labels[0], /confirm|acept[oó]/i)
  // Confirmed only after the answer (provider accepted, or the client chose an applicant).
  assert.match(result.labels[1], /^Confirmado con /)
  assert.equal(result.publica, 'Publicada en el mapa')
})

test('ASSISTANT: guided chat, auth gate before searching, client chooses, same request workflow, no invented data', () => {
  const chat = web('features/assistant/assistant-chat.tsx')
  assert.match(chat, /Hola, soy el asistente de TUS\. Contame qué necesitás resolver\./)
  assert.match(chat, /Para buscar prestadores disponibles y guardar tu solicitud necesitás iniciar sesión o crear una cuenta\./)
  assert.match(chat, /No encontré prestadores disponibles para esa búsqueda en este momento\./)
  assert.match(chat, /withReturnTo\('\/sign-in', RETURN_TO\)/)
  assert.match(chat, /withReturnTo\('\/registro', RETURN_TO\)/)
  // Context survives the sign-in round trip.
  assert.match(chat, /sessionStorage\.setItem\(STORAGE_KEY/)
  // The AI never picks: candidates are shown and the client presses "Elegir".
  assert.match(chat, /onChoose=\{\(\) => choose\(candidate\)\}/)
  assert.match(chat, /origin="web_assistant"/)
  assert.match(chat, /Cambiar barrio[\s\S]*Cambiar oficio[\s\S]*Cambiar urgencia/)
  assert.doesNotMatch(chat, /alert\(|confirm\(/)
})

test('DIRECTORY UI: list first, chips from the API catalog, honest cards, profile requests keep context', () => {
  const directory = web('features/directory/worker-directory.tsx')
  const card = web('features/directory/worker-card.tsx')
  const profile = web('features/directory/worker-profile.tsx')
  assert.match(directory, /Encontrá al profesional que necesitás/)
  assert.match(directory, /Explorá profesionales disponibles por oficio y encontrá el indicado para tu trabajo\./)
  assert.match(directory, /¿Qué profesional buscás\?/)
  assert.match(directory, /catalog\.data\?\.items/)
  assert.match(directory, /aria-pressed=\{profession === item\.id\}/)
  assert.match(directory, /Cargar más/)
  // No invented ratings or stock photos: initials and real facts only.
  assert.doesNotMatch(card, /⭐|rating\b.*toFixed|unsplash|picsum|randomuser/)
  assert.match(card, /worker\.initials/)
  assert.match(card, /Todavía sin trabajos en TUS/)
  assert.doesNotMatch(card + profile, /phone|telefono|email|address|direccion|lat\b|lng\b/i)
  assert.match(profile, /Solicitar servicio/)
  assert.match(profile, /solicitar=1/)
  assert.match(profile, /origin="web_directory"/)
  assert.match(profile, /Sin reseñas todavía/)
})
