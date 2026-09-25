import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Solicitudes de servicio del mapa público: publicación por cuentas verificadas, vista pública
// sin datos personales y ubicación solo aproximada (barrio de Corrientes).
const root = join(import.meta.dirname, '..', '..')
const SETUP = `
  const { createInMemoryAuthService } = await import('./apps/api/src/auth-security/composition.ts')
  const { DurableIdentitySessionResolver } = await import('./apps/api/src/auth-security/adapters/durable-session-resolver.ts')
  const { crearServicioSolicitudes } = await import('./apps/api/src/tus/solicitudes/composicion.ts')
  const modelo = await import('./apps/api/src/tus/solicitudes/modelo.ts')
  let now = Date.parse('2026-09-25T12:00:00.000Z')
  const clock = () => now
  const auth = createInMemoryAuthService({ now: clock })
  const sessions = new DurableIdentitySessionResolver(auth.store, clock)
  let seq = 0
  const solicitudes = crearServicioSolicitudes({ cuentas: auth.store, now: clock, newId: () => 'sol-' + ++seq })
  async function cuenta(email, displayName = 'Laura Martínez', verificar = true) {
    const registered = await auth.register({ email, password: 'Contrasena-Segura-2026', displayName })
    if (verificar) await auth.verifyEmail({ token: registered.verificationToken })
    return registered.account
  }
  const valida = { category: 'plomeria', title: 'Pierde agua la canilla de la cocina', description: 'Gotea todo el día.', zone: 'Camba Cuá', budgetMax: 25000, urgency: 'hoy_manana' }
`

test('SOLICITUDES validation rejects bad fields, unknown zones and contact data in public text', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const v = modelo.validarNuevaSolicitud
    console.log(JSON.stringify({
      ok: v(valida),
      bad: v({ category: 'jardin', title: 'x', zone: 'Palermo', budgetMax: -3, urgency: 'ya' }),
      phone: v({ ...valida, description: 'Llamame al 379 4123456' }),
      email: v({ ...valida, title: 'Escribime a laura@example.com' }),
      link: v({ ...valida, description: 'Mirá https://example.com/foto' }),
      noBudget: v({ ...valida, budgetMax: null }).ok,
      decimal: v({ ...valida, budgetMax: 10.5 }).ok,
      names: [modelo.nombrePublico('Laura Martínez'), modelo.nombrePublico('laura'), modelo.nombrePublico('  '), modelo.nombrePublico('Ana <script> Pérez')],
    }))
  `)
  assert.equal(result.ok.ok, true)
  assert.equal(result.ok.valor.zona, 'Camba Cuá')
  assert.deepEqual(result.bad.campos.sort(), ['budgetMax', 'category', 'title', 'urgency', 'zone'])
  assert.deepEqual(result.phone.campos, ['description'])
  assert.deepEqual(result.email.campos, ['title'])
  assert.deepEqual(result.link.campos, ['description'])
  assert.equal(result.noBudget, true)
  assert.equal(result.decimal, false)
  assert.deepEqual(result.names, ['Laura M.', 'laura', 'Vecino/a', 'Ana S.'])
})

test('SOLICITUDES approximate location: Corrientes barrio centre, deterministic, 3 decimals, within ~300 m', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const zona = modelo.ZONAS_CORRIENTES.find((z) => z.nombre === 'Centro')
    const puntos = ['a', 'b', 'c', 'd', 'e'].map((id) => modelo.ubicacionAproximada('Centro', id))
    console.log(JSON.stringify({ zona, puntos, repetido: modelo.ubicacionAproximada('Centro', 'a'), zonas: modelo.ZONAS_CORRIENTES.map((z) => z.nombre) }))
  `)
  assert.deepEqual(result.repetido, result.puntos[0])
  for (const punto of result.puntos) {
    assert.ok(Math.abs(punto.lat - result.zona.lat) <= 0.0036 && Math.abs(punto.lng - result.zona.lng) <= 0.0036)
    assert.equal(Math.round(punto.lat * 1000) / 1000, punto.lat)
    assert.equal(Math.round(punto.lng * 1000) / 1000, punto.lng)
  }
  // The Web offers the same barrios as the API.
  const webTypes = readFileSync(join(root, 'apps/web/src/features/home/types.ts'), 'utf8')
  for (const zona of result.zonas) assert.match(webTypes, new RegExp(`'${zona}'`))
})

test('SOLICITUDES publish: verified active accounts only, public view without personal data, limits, expiry and closing', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const laura = await cuenta('laura@example.com')
    const sinVerificar = await cuenta('nuevo@example.com', 'Nuevo', false)
    const otra = await cuenta('otra@example.com', 'Marta Díaz')
    const noVerificada = await solicitudes.publicar(sinVerificar.id, valida)
    const invalida = await solicitudes.publicar(laura.id, { ...valida, zone: 'Palermo' })
    const publicada = await solicitudes.publicar(laura.id, valida)
    now += 60_000
    await solicitudes.publicar(otra.id, { ...valida, category: 'electricidad', title: 'Salta la térmica con el horno' })
    const publicas = await solicitudes.listarPublicas()
    const soloElectricidad = await solicitudes.listarPublicas({ categoria: 'electricidad' })
    const categoriaInvalida = await solicitudes.listarPublicas({ categoria: 'DROP TABLE' })
    for (let i = 0; i < 4; i++) await solicitudes.publicar(laura.id, valida)
    const limite = await solicitudes.publicar(laura.id, valida)
    const cerrarAjena = await solicitudes.cerrar(otra.id, publicada.solicitud.id)
    const cerrarPropia = await solicitudes.cerrar(laura.id, publicada.solicitud.id)
    const cerrarDeNuevo = await solicitudes.cerrar(laura.id, publicada.solicitud.id)
    const trasCerrar = (await solicitudes.listarPublicas()).map((s) => s.id)
    const mias = await solicitudes.mias(laura.id)
    now += 31 * 24 * 60 * 60 * 1000
    const vencidas = await solicitudes.listarPublicas()
    const despuesDelDia = await solicitudes.publicar(laura.id, valida)
    console.log(JSON.stringify({ noVerificada, invalida, publicada, publicas, soloElectricidad: soloElectricidad.map((s) => s.category), categoriaInvalida: categoriaInvalida.length, limite, cerrarAjena, cerrarPropia, cerrarDeNuevo, trasCerrar, mias: mias.map((s) => s.status), vencidas, despuesDelDia: despuesDelDia.ok, lauraId: laura.id }))
  `)
  assert.equal(result.noVerificada.code, 'ACCOUNT_NOT_ALLOWED')
  assert.deepEqual(result.invalida.fields, ['zone'])
  assert.equal(result.publicada.ok, true)
  assert.equal(result.publicada.solicitud.requesterName, 'Laura M.')
  assert.equal(result.publicada.solicitud.approximateLocation.label, 'Camba Cuá')
  assert.equal(result.publicada.solicitud.status, 'abierta')
  assert.equal(result.publicas.length, 2)
  assert.equal(result.publicas[0].title, 'Salta la térmica con el horno')
  const texto = JSON.stringify(result.publicas)
  assert.doesNotMatch(texto, /laura@example\.com|Martínez|cuentaId|accountId/)
  assert.ok(!texto.includes(result.lauraId))
  assert.deepEqual(Object.keys(result.publicas[0]).sort(), ['approximateLocation', 'budgetMax', 'category', 'createdAt', 'description', 'id', 'images', 'requesterName', 'title', 'urgency'])
  assert.deepEqual(result.soloElectricidad, ['electricidad'])
  assert.equal(result.categoriaInvalida, 2)
  assert.equal(result.limite.code, 'RATE_LIMITED')
  assert.equal(result.cerrarAjena.code, 'NOT_FOUND')
  assert.equal(result.cerrarPropia.ok, true)
  assert.equal(result.cerrarDeNuevo.code, 'NOT_FOUND')
  assert.ok(!result.trasCerrar.includes(result.publicada.solicitud.id))
  assert.ok(result.mias.includes('cerrada'))
  assert.deepEqual(result.vencidas, [])
  assert.equal(result.despuesDelDia, true)
})

test('SOLICITUDES HTTP: public list without auth or PII; publishing needs a session, rejects spoofed fields and reports invalid fields', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const express = (await import('./apps/api/node_modules/express/index.js')).default
    const { crearRouterSolicitudes } = await import('./apps/api/src/tus/solicitudes/http.ts')
    const app = express(); app.use(express.json()); app.use(crearRouterSolicitudes({ servicio: solicitudes, sessions }))
    const server = app.listen(0)
    const base = 'http://127.0.0.1:' + server.address().port
    await cuenta('laura@example.com')
    const signed = await auth.signIn({ email: 'laura@example.com', password: 'Contrasena-Segura-2026' })
    const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + signed.session.accessToken, 'x-correlation-id': 'corr-1' }
    const post = (body, h = headers) => fetch(base + '/tus/v1/solicitudes', { method: 'POST', headers: h, body: JSON.stringify(body) })
    try {
      const anon = await post(valida, { 'content-type': 'application/json' })
      const spoofed = await post({ ...valida, lat: -27.1, lng: -58.1 })
      const spoofedOwner = await post({ ...valida, accountId: 'otra' })
      const invalid = await post({ ...valida, urgency: 'ya' })
      const created = await post(valida)
      const createdBody = await created.json()
      const list = await fetch(base + '/tus/v1/public/solicitudes')
      const listBody = await list.json()
      const mine = await fetch(base + '/tus/v1/solicitudes/mias', { headers })
      const mineAnon = await fetch(base + '/tus/v1/solicitudes/mias')
      const close = await fetch(base + '/tus/v1/solicitudes/' + createdBody.id + '/cerrar', { method: 'POST', headers })
      const after = await (await fetch(base + '/tus/v1/public/solicitudes')).json()
      console.log(JSON.stringify({
        anon: anon.status, spoofed: spoofed.status, spoofedOwner: spoofedOwner.status,
        invalid: [invalid.status, await invalid.json()],
        created: [created.status, createdBody.requesterName, created.headers.get('cache-control')],
        list: [list.status, list.headers.get('cache-control'), listBody.items.length],
        listText: JSON.stringify(listBody),
        mine: [mine.status, (await mine.json()).items.length], mineAnon: mineAnon.status,
        close: close.status, after: after.items.length,
      }))
    } finally { server.close() }
  `)
  assert.equal(result.anon, 401)
  assert.equal(result.spoofed, 403)
  assert.equal(result.spoofedOwner, 403)
  assert.equal(result.invalid[0], 422)
  assert.deepEqual(result.invalid[1].fields, ['urgency'])
  assert.deepEqual(result.created, [201, 'Laura M.', 'no-store'])
  assert.deepEqual(result.list, [200, 'public, max-age=30', 1])
  assert.doesNotMatch(result.listText, /laura@example\.com|Martínez|accessToken/)
  assert.deepEqual(result.mine, [200, 1])
  assert.equal(result.mineAnon, 401)
  assert.equal(result.close, 200)
  assert.equal(result.after, 0)
})

test('SOLICITUDES are mounted with the TUS routes and persisted through Prisma (same PostgreSQL)', () => {
  const server = readFileSync(join(root, 'apps/api/src/server.ts'), 'utf8')
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20260930100000_tus_solicitudes_servicio/migration.sql'), 'utf8')
  assert.match(server, /if \(tusRoutesEnabled\) \{\s*app\.use\(crearRouterSolicitudes/)
  assert.match(server, /crearServicioSolicitudes\(\{ cuentas: auth\.store, destinos: directorio, prisma:/)
  assert.match(schema, /model SolicitudServicio \{[\s\S]*@@map\("solicitudes_servicio"\)/)
  assert.match(migration, /REFERENCES public\."Account"\("id"\) ON DELETE RESTRICT/)
  assert.doesNotMatch(migration, /\b(DROP|CASCADE|ALTER TABLE)\b/i)
  for (const column of ['direccion', 'telefono', 'email']) assert.doesNotMatch(migration, new RegExp(`"${column}`))
})
