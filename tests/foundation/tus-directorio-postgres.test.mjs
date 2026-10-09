import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Directory, multi-service profiles and geography on a DISPOSABLE PostgreSQL 16 database with every
// migration applied (TUS_DIRECTORIO_PG_URL, or TUS_E2E_PG_URL). Never a shared or real database.
const url = process.env.TUS_DIRECTORIO_PG_URL ?? process.env.TUS_E2E_PG_URL

const PRISMA = `
  const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
  const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, log: [{ emit: 'event', level: 'query' }], errorFormat: 'minimal' })
  // Every SQL statement the client sends, in the order the engine ran them.
  const sentencias = []
  prisma.$on('query', (e) => { sentencias.push(e.query) })
  const run = 'd' + Date.now().toString(36)
  // The DATA statements one operation runs. The operation is delimited by two marker statements
  // and the events of both are awaited, so the count never depends on when an event is delivered
  // to JavaScript; what the driver adds around a statement (transaction control, the DEALLOCATE of
  // a pooled connection) is not a read of the application and is not counted.
  const CONTROL = /^(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|DEALLOCATE|SET )/iu
  let mediciones = 0
  async function medir(operacion) {
    const marca = 'tus_medicion_' + run + '_' + (mediciones += 1)
    const marcar = async (lado) => {
      await prisma.$queryRawUnsafe('SELECT 1 AS "' + marca + '_' + lado + '"')
      for (let i = 0; i < 1000 && !sentencias.some((q) => q.includes(marca + '_' + lado)); i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
      const en = sentencias.findIndex((q) => q.includes(marca + '_' + lado))
      if (en < 0) throw new Error('the event of the ' + lado + ' marker was not delivered')
      return en
    }
    const inicio = await marcar('inicio')
    const valor = await operacion()
    const fin = await marcar('fin')
    return { valor, consultas: sentencias.slice(inicio + 1, fin).filter((q) => !CONTROL.test(q.trim())) }
  }
  const T = (s) => run + '-' + s
  const sql = (q) => prisma.$executeRawUnsafe(q)
  async function provider(key) {
    await sql("INSERT INTO \\"TusTenant\\"(id, slug, name, status, \\"createdAt\\", \\"updatedAt\\") VALUES ('" + T(key) + "','" + T(key) + "','" + key + "','active',now(),now())")
    await sql("INSERT INTO prestadores(id, tenant_id, prestador_id, cohorte, ubicacion_id, zona_horaria, roles_personal, version_politica_operativa, estado, fecha_creacion, fecha_actualizacion) VALUES ('" + T('pr' + key) + "','" + T(key) + "','p-" + key + "','repairs-trades','loc','America/Argentina/Buenos_Aires',ARRAY['owner'],'v1','approved',now(),now())")
    return { tenantId: T(key), prestadorId: 'p-' + key }
  }
`

test(
  'MULTISERVICIO PostgreSQL: profile + service set written atomically, principal always in the set, filters return each provider once with bounded queries',
  { skip: !url && 'TUS_DIRECTORIO_PG_URL not set (disposable PostgreSQL only)', timeout: 120000 },
  () => {
    const r = runTypeScriptScenario(`${PRISMA}
      const { AlmacenPerfilesPrisma } = await import('./apps/api/src/tus/directorio/almacenes.ts')
      const store = new AlmacenPerfilesPrisma(prisma)
      try {
        const base = (p, oficios, id) => ({ id, tenantId: p.tenantId, prestadorId: p.prestadorId, nombrePublico: 'Multi ' + id, oficio: oficios[0], oficios, zona: 'Centro', zonasCobertura: ['Centro'], modalidadAtencion: 'domicilio', radioCoberturaKm: null, descripcion: null, aniosExperiencia: null, visible: true, creadoEn: Date.now(), actualizadoEn: Date.now() })
        const pa = await provider('a')
        await store.guardar(base(pa, ['electricidad', 'plomeria', 'pintura', 'albanileria', 'mecanica'], T('perfil-a')))
        const five = (await store.porTenant(pa.tenantId)).oficios
        await store.guardar(base(pa, ['pintura', 'electricidad'], T('perfil-a')))
        const two = (await store.porTenant(pa.tenantId)).oficios
        const rows = await prisma.perfilServicio.findMany({ where: { perfilId: T('perfil-a') }, orderBy: { orden: 'asc' } })
        const principal = (await prisma.perfilPublicoPrestador.findFirst({ where: { id: T('perfil-a') } })).oficio
        let broken = 'none'
        try { await prisma.perfilPublicoPrestador.update({ where: { id: T('perfil-a') }, data: { oficio: 'aire' } }) } catch (e) {
          // fk_perfiles_servicio_principal is DEFERRABLE INITIALLY DEFERRED: it fires at COMMIT and
          // Prisma reports that violation (P2003) without the constraint name. PostgreSQL names it
          // when the same write is checked immediately, so the constraint is asked for by name there.
          broken = /fk_perfiles_servicio_principal/.test(String(e.message)) ? 'fk' : e.code !== 'P2003' ? String(e.message).slice(0, 80) : await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe('SET CONSTRAINTS "fk_perfiles_servicio_principal" IMMEDIATE')
            await tx.$executeRawUnsafe('UPDATE "perfiles_publicos_prestador" SET "oficio" = $1 WHERE "id" = $2', 'aire', T('perfil-a'))
            return 'accepted'
          }).catch((raw) => (/fk_perfiles_servicio_principal/.test(String(raw.message) + JSON.stringify(raw.meta ?? {})) ? 'fk' : String(raw.message).slice(0, 80)))
        }
        const principalAfter = (await prisma.perfilPublicoPrestador.findFirst({ where: { id: T('perfil-a') } })).oficio
        for (let i = 0; i < 12; i++) { const p = await provider('n' + i); await store.guardar(base(p, i % 2 ? ['electricidad', 'plomeria'] : ['plomeria'], T('perfil-n' + i))) }
        const medicion = await medir(() => store.visibles({ oficios: ['electricidad', 'plomeria'], limite: 300 }))
        const electricidad = medicion.valor
        const listQueries = medicion.consultas.length
        const mine = electricidad.filter((p) => p.tenantId.startsWith(run))
        console.log(JSON.stringify({ five, two, rows: rows.map((r) => [r.oficioId, r.orden]), principal, principalAfter, broken, unique: new Set(mine.map((p) => p.id)).size === mine.length, count: mine.length, listQueries }))
      } finally { await prisma.$disconnect() }
    `)
    assert.deepEqual(r.five, ['electricidad', 'plomeria', 'pintura', 'albanileria', 'mecanica'])
    assert.deepEqual(r.two, ['pintura', 'electricidad'])
    assert.deepEqual(r.rows, [['pintura', 0], ['electricidad', 1]])
    assert.equal(r.principal, 'pintura')
    assert.equal(r.broken, 'fk', 'a principal outside the set is rejected by fk_perfiles_servicio_principal')
    assert.equal(r.principalAfter, 'pintura', 'and the principal did not change')
    assert.equal(r.unique, true)
    assert.equal(r.count, 13)
    // One query for the profiles and one batched read of their services, whatever the size.
    assert.ok(r.listQueries <= 2, `queries: ${r.listQueries}`)
  }
)

test(
  'GEO PostgreSQL: zone and neighbourhood polygons saved and removed with the real catalog adapter; provider pin and association persisted',
  { skip: !url && 'TUS_DIRECTORIO_PG_URL not set (disposable PostgreSQL only)', timeout: 120000 },
  () => {
    const r = runTypeScriptScenario(`${PRISMA}
      const { AlmacenCatalogoPrisma } = await import('./apps/api/src/tus/catalogo/almacen.ts')
      const { AlmacenPerfilesPrisma } = await import('./apps/api/src/tus/directorio/almacenes.ts')
      try {
        const catalogo = new AlmacenCatalogoPrisma(prisma)
        const poligono = { type: 'Polygon', coordinates: [[[-58.72, -27.42], [-58.68, -27.42], [-58.68, -27.38], [-58.72, -27.38], [-58.72, -27.42]]] }
        const zona = { id: T('zona'), localidadId: 'corrientes-capital', nombre: 'Zona ' + run, slug: 'zona-' + run, activo: true, orden: 1, poligono, lat: -27.40, lng: -58.70 }
        await catalogo.guardarZona(zona)
        const conPoligono = (await catalogo.cargar()).zonas.find((z) => z.id === zona.id)
        await catalogo.guardarZona({ ...zona, poligono: null })
        const sinPoligono = (await catalogo.cargar()).zonas.find((z) => z.id === zona.id)
        const barrio = { id: T('barrio'), localidadId: 'corrientes-capital', zonaId: zona.id, nombre: 'Barrio ' + run, slug: 'barrio-' + run, lat: -27.40, lng: -58.70, poligono, activo: true, orden: 1 }
        await catalogo.guardarBarrio(barrio)
        await catalogo.guardarBarrio({ ...barrio, poligono: null })
        const barrioSin = (await catalogo.cargar()).barrios.find((b) => b.id === barrio.id)
        const p = await provider('geo')
        const store = new AlmacenPerfilesPrisma(prisma)
        await store.guardar({ id: T('perfil-geo'), tenantId: p.tenantId, prestadorId: p.prestadorId, nombrePublico: 'Geo', oficio: 'plomeria', oficios: ['plomeria'], zona: null, zonasCobertura: [], modalidadAtencion: 'domicilio', radioCoberturaKm: null, descripcion: null, aniosExperiencia: null, visible: true, creadoEn: Date.now(), actualizadoEn: Date.now(), latitud: -27.401, longitud: -58.701, mostrarUbicacionExacta: true, barrioId: barrio.id, zonaId: zona.id, ubicacionAsociacion: 'poligono_barrio' })
        const perfil = await store.porTenant(p.tenantId)
        console.log(JSON.stringify({ conPoligono: [conPoligono.poligono?.coordinates[0].length, conPoligono.lat], sinPoligono: [sinPoligono.poligono, sinPoligono.lat], barrioSin: [barrioSin.poligono, barrioSin.lat], perfil: [perfil.latitud, perfil.longitud, perfil.mostrarUbicacionExacta, perfil.barrioId === barrio.id, perfil.zonaId === zona.id, perfil.ubicacionAsociacion] }))
      } finally { await prisma.$disconnect() }
    `)
    assert.deepEqual(r.conPoligono, [5, -27.4])
    assert.deepEqual(r.sinPoligono, [null, -27.4])
    assert.deepEqual(r.barrioSin, [null, -27.4])
    assert.deepEqual(r.perfil, [-27.401, -58.701, true, true, true, 'poligono_barrio'])
  }
)

test(
  'MAP N+1 PostgreSQL: the public map runs the same number of SQL queries for 1 and for 40 providers (real Prisma adapters)',
  { skip: !url && 'TUS_DIRECTORIO_PG_URL not set (disposable PostgreSQL only)', timeout: 180000 },
  () => {
    const r = runTypeScriptScenario(`${PRISMA}
      const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
      const { PrismaMarketplaceStore } = await import('./apps/api/src/tus/adapters/prisma-marketplace.ts')
      try {
        const directorio = crearServicioDirectorio({ application: { marketplace: { store: new PrismaMarketplaceStore(prisma) } }, prisma })
        const ctx = (tenantId) => ({ tenantId, subjectId: 'a-' + tenantId, sessionId: 's', roles: ['merchant'], permissions: ['tus:marketplace:write'], correlationId: 'c' })
        async function add(i) {
          const p = await provider('m' + i)
          const saved = await directorio.guardarPerfil(ctx(p.tenantId), { displayName: 'Mapa ' + i, profession: 'plomeria', professions: ['plomeria', 'electricidad'], zone: 'Centro' })
          if (!saved.ok) throw new Error('profile ' + JSON.stringify(saved))
        }
        await add(0)
        const uno = await medir(() => directorio.listar({ q: 'Mapa' }))
        for (let i = 1; i < 40; i++) await add(i)
        const cuarenta = await medir(() => directorio.listar({ q: 'Mapa' }))
        const one = uno.valor
        const forty = cuarenta.valor
        const mine = (page) => page.items.filter((w) => w.displayName.startsWith('Mapa ')).length
        // Which tables each measurement read (the same ones, each once: no read per provider).
        const tablas = (consultas) => consultas.map((q) => (q.match(/FROM "public"\."([a-z_]+)"/u) ?? [])[1] ?? 'otra').sort()
        console.log(JSON.stringify({ withOne: uno.consultas.length, withForty: cuarenta.consultas.length, tablasUno: tablas(uno.consultas), tablasCuarenta: tablas(cuarenta.consultas), one: one.total >= 1, forty: forty.total >= 40, pageMine: mine(forty) > 0 }))
      } finally { await prisma.$disconnect() }
    `)
    assert.equal(r.one, true)
    assert.equal(r.forty, true)
    assert.equal(r.pageMine, true)
    assert.equal(r.withForty, r.withOne, `1 provider: ${r.withOne} queries, 40 providers: ${r.withForty}`)
    assert.ok(r.withOne <= 6, `queries: ${r.withOne}`)
    // The same reads in both cases, one per table: profiles, their services, listings, providers
    // and completed works.
    assert.deepEqual(r.tablasCuarenta, r.tablasUno)
    assert.deepEqual(r.tablasUno, ['perfil_servicios', 'perfiles_publicos_prestador', 'prestadores', 'publicaciones', 'trabajos'])
  }
)

test(
  'ADMIN USUARIO PostgreSQL: the admin email change persists normalized, resets verification, and the unique email decides conflicts',
  { skip: !url && 'TUS_DIRECTORIO_PG_URL not set (disposable PostgreSQL only)', timeout: 120000 },
  () => {
    const r = runTypeScriptScenario(`${PRISMA}
      const { createPrismaAuthService } = await import('./apps/api/src/auth-security/composition.ts')
      try {
        const auth = createPrismaAuthService(prisma, { platformAdminEmails: [run + '-admin@example.com'] })
        const PASSWORD = 'una frase larga y segura 2026'
        const a = await auth.service.register({ email: run + '-a@example.com', password: PASSWORD, displayName: 'Cuenta A' })
        await auth.service.register({ email: run + '-b@example.com', password: PASSWORD, displayName: 'Cuenta B' })
        await auth.service.verifyEmail({ token: a.verificationToken })
        const actor = 'admin-actor'
        const conflicto = await auth.service.updateAccountAsAdmin({ actorId: actor, accountId: a.account.id, email: run.toUpperCase() + '-B@example.com' })
        const escalada = await auth.service.updateAccountAsAdmin({ actorId: actor, accountId: a.account.id, email: run + '-admin@example.com' })
        const cambio = await auth.service.updateAccountAsAdmin({ actorId: actor, accountId: a.account.id, email: '  ' + run.toUpperCase() + '-Nueva@Example.com ' })
        const fila = await prisma.account.findUnique({ where: { id: a.account.id }, include: { user: true } })
        const detalle = await auth.service.getAccountAsAdmin(a.account.id)
        const verificar = await auth.service.updateAccountAsAdmin({ actorId: actor, accountId: a.account.id, emailVerified: true })
        const filaVerificada = await prisma.account.findUnique({ where: { id: a.account.id } })
        console.log(JSON.stringify({
          conflicto: conflicto.ok ? 'ok' : conflicto.code, escalada: escalada.ok ? 'ok' : escalada.code, cambio: cambio.ok,
          email: fila.user.email, normalized: fila.user.normalizedEmail, verificado: fila.emailVerifiedAt, detalle: Object.keys(detalle).sort(),
          verificar: verificar.ok, verificadoDespues: filaVerificada.emailVerifiedAt !== null,
        }))
      } finally { await prisma.$disconnect() }
    `)
    assert.equal(r.conflicto, 'CONFLICT')
    assert.equal(r.escalada, 'FORBIDDEN')
    assert.equal(r.cambio, true)
    assert.match(r.email, /^d[a-z0-9]+-nueva@example\.com$/)
    assert.equal(r.normalized, r.email)
    assert.equal(r.verificado, null)
    // Phone identity fields are raw here; the admin router masks them (IDN-06).
    assert.deepEqual(r.detalle, ['createdAt', 'displayName', 'email', 'emailVerifiedAt', 'hasPassword', 'id', 'mustChangePassword', 'origin', 'phoneNumber', 'phonePending', 'phoneVerifiedAt', 'platformAdmin', 'roles', 'status', 'tenantId', 'updatedAt'])
    assert.equal(r.verificar, true)
    assert.equal(r.verificadoDespues, true)
  }
)
