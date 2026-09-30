import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// Directory, multi-service profiles and geography on a DISPOSABLE PostgreSQL 16 database with every
// migration applied (TUS_DIRECTORIO_PG_URL, or TUS_E2E_PG_URL). Never a shared or real database.
const url = process.env.TUS_DIRECTORIO_PG_URL ?? process.env.TUS_E2E_PG_URL

const PRISMA = `
  const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
  const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, log: [{ emit: 'event', level: 'query' }], errorFormat: 'minimal' })
  let queries = 0
  prisma.$on('query', () => { queries += 1 })
  const run = 'd' + Date.now().toString(36)
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
        try { await prisma.perfilPublicoPrestador.update({ where: { id: T('perfil-a') }, data: { oficio: 'aire' } }) } catch (e) { broken = /fk_perfiles_servicio_principal/.test(String(e.message)) ? 'fk' : String(e.message).slice(0, 80) }
        for (let i = 0; i < 12; i++) { const p = await provider('n' + i); await store.guardar(base(p, i % 2 ? ['electricidad', 'plomeria'] : ['plomeria'], T('perfil-n' + i))) }
        queries = 0
        const electricidad = await store.visibles({ oficios: ['electricidad', 'plomeria'], limite: 300 })
        const listQueries = queries
        const mine = electricidad.filter((p) => p.tenantId.startsWith(run))
        console.log(JSON.stringify({ five, two, rows: rows.map((r) => [r.oficioId, r.orden]), principal, broken, unique: new Set(mine.map((p) => p.id)).size === mine.length, count: mine.length, listQueries }))
      } finally { await prisma.$disconnect() }
    `)
    assert.deepEqual(r.five, ['electricidad', 'plomeria', 'pintura', 'albanileria', 'mecanica'])
    assert.deepEqual(r.two, ['pintura', 'electricidad'])
    assert.deepEqual(r.rows, [['pintura', 0], ['electricidad', 1]])
    assert.equal(r.principal, 'pintura')
    assert.equal(r.broken, 'fk')
    assert.equal(r.unique, true)
    assert.equal(r.count, 13)
    // One query for the profiles and one batched read of their services, whatever the size.
    assert.ok(r.listQueries <= 2, `queries: ${r.listQueries}`)
  }
)
