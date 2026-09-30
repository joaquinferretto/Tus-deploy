import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { root, runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

// A provider offers MANY services (Categoría -> Servicio = categorias_servicio -> oficios_servicio;
// Prestador N:M Servicio = perfil_servicios). The principal service is shown first and always
// belongs to the set. Filters match ANY of the provider's services and never duplicate it.
const SETUP = `
  const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
  const { validarPerfil } = await import('./apps/api/src/tus/directorio/modelo.ts')
  const contratos = await import('./packages/contracts/src/tus-directorio.ts')
  const merchants = new Map()
  const application = { marketplace: { store: { merchant: { find: async (t) => merchants.get(t) ?? null, findMany: async (ids) => ids.map((t) => merchants.get(t)).filter(Boolean) }, listings: { forTenant: async () => [] } } }, identity: { identidadVerificada: async () => false, resumenDeTenants: async () => new Map() } }
  let seq = 0
  const directorio = crearServicioDirectorio({ application, contarCompletados: async () => 0, now: () => Date.parse('2026-09-28T13:00:00.000Z'), newId: () => 'perfil-' + String(++seq).padStart(8, '0') })
  const ctx = (tenantId) => ({ tenantId, subjectId: 'a-' + tenantId, sessionId: 's', roles: ['merchant'], permissions: ['tus:marketplace:write'], correlationId: 'c' })
  async function prestador(tenantId, professions, extra = {}) {
    merchants.set(tenantId, { tenantId, merchantId: 'm-' + tenantId, status: 'approved' })
    return directorio.guardarPerfil(ctx(tenantId), { displayName: 'Prestador ' + tenantId, profession: professions[0], professions, zone: 'Centro', description: 'Trabajo prolijo', ...extra })
  }
`

test('MULTISERVICIO validation: one or many services, principal first, no duplicates, only current services, at most 20', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const ok = (body) => { const v = validarPerfil({ displayName: 'Juan Pérez', zone: 'Centro', ...body }); return v.ok ? [v.valor.oficio, v.valor.oficios] : v.campos }
    console.log(JSON.stringify({
      legacy: ok({ profession: 'plomeria' }),
      five: ok({ profession: 'electricidad', professions: ['plomeria', 'electricidad', 'pintura', 'albanileria', 'mecanica'] }),
      principalFromList: ok({ professions: ['pintura', 'plomeria'] }),
      duplicates: ok({ profession: 'plomeria', professions: ['plomeria', 'plomeria', 'electricidad'] }),
      unknown: ok({ profession: 'plomeria', professions: ['no-existe'] }),
      none: ok({ professions: [] }),
      notArray: ok({ profession: 'plomeria', professions: 'electricidad' }),
    }))
  `)
  assert.deepEqual(r.legacy, ['plomeria', ['plomeria']])
  assert.deepEqual(r.five, ['electricidad', ['electricidad', 'plomeria', 'pintura', 'albanileria', 'mecanica']])
  assert.deepEqual(r.principalFromList, ['pintura', ['pintura', 'plomeria']])
  assert.deepEqual(r.duplicates, ['plomeria', ['plomeria', 'electricidad']])
  assert.ok(r.unknown.includes('profession'))
  assert.ok(r.none.includes('profession'))
  assert.ok(r.notArray.includes('profession'))
})

test('MULTISERVICIO directory: a provider appears in EVERY service and category filter it offers, once; services can be added and removed', () => {
  const r = runTypeScriptScenario(`${SETUP}
    const multi = await prestador('t-multi', ['electricidad', 'plomeria', 'pintura'])
    await prestador('t-uno', ['mecanica'])
    const ids = async (filtros) => (await directorio.listar(filtros)).items.map((item) => item.displayName)
    const byService = { electricidad: await ids({ oficio: 'electricidad' }), plomeria: await ids({ oficio: 'plomeria' }), pintura: await ids({ oficio: 'pintura' }), mecanica: await ids({ oficio: 'mecanica' }) }
    const byCategory = { hogar: await ids({ categoria: 'hogar' }), construccion: await ids({ categoria: 'construccion' }), vehiculos: await ids({ categoria: 'vehiculos' }), inexistente: await ids({ categoria: 'no-existe' }) }
    const all = (await directorio.listar({})).items
    const publico = all.find((item) => item.displayName === 'Prestador t-multi')
    const text = await ids({ q: 'pintor' })
    // Remove pintura, add aire; principal changes to plomeria.
    await prestador('t-multi', ['plomeria', 'electricidad', 'aire'])
    const after = { pintura: await ids({ oficio: 'pintura' }), aire: await ids({ oficio: 'aire' }), perfil: (await directorio.perfil(multi.perfil.id)).professions.map((p) => p.id) }
    const admin = (await directorio.listarParaAdmin()).find((row) => row.tenantId === 't-multi')
    console.log(JSON.stringify({ byService, byCategory, allNames: all.map((item) => item.displayName), professions: publico.professions, principal: publico.profession.id, valid: all.every(contratos.esPrestadorPublico), text, after, admin: admin.oficios.map((o) => o.id) }))
  `)
  for (const service of ['electricidad', 'plomeria', 'pintura']) assert.deepEqual(r.byService[service], ['Prestador t-multi'], service)
  assert.deepEqual(r.byService.mecanica, ['Prestador t-uno'])
  assert.deepEqual(r.byCategory.hogar, ['Prestador t-multi'])
  assert.deepEqual(r.byCategory.construccion, ['Prestador t-multi'])
  assert.deepEqual(r.byCategory.vehiculos, ['Prestador t-uno'])
  assert.deepEqual(r.byCategory.inexistente, [])
  // One entry per provider, never one per service.
  assert.equal(r.allNames.filter((name) => name === 'Prestador t-multi').length, 1)
  assert.deepEqual(r.professions.map((p) => [p.id, p.categoryId]), [['electricidad', 'hogar'], ['plomeria', 'hogar'], ['pintura', 'construccion']])
  assert.equal(r.principal, 'electricidad')
  assert.equal(r.valid, true)
  assert.deepEqual(r.text, ['Prestador t-multi'])
  assert.deepEqual(r.after.pintura, [])
  assert.deepEqual(r.after.aire, ['Prestador t-multi'])
  assert.deepEqual(r.after.perfil, ['plomeria', 'electricidad', 'aire'])
  assert.deepEqual(r.admin, ['plomeria', 'electricidad', 'aire'])
})

test('MULTISERVICIO migration: N:M table with PK (perfil, servicio), backfill of the current trade and principal always in the set', () => {
  const sql = readFileSync(join(root, 'apps/api/prisma/migrations/20261015100000_tus_perfil_servicios/migration.sql'), 'utf8')
  assert.match(sql, /PRIMARY KEY \("perfil_id", "oficio_id"\)/u)
  assert.match(sql, /INSERT INTO public\."perfil_servicios"[\s\S]+SELECT "id", "oficio", 0, "fecha_creacion" FROM public\."perfiles_publicos_prestador"/u)
  assert.match(sql, /FOREIGN KEY \("id", "oficio"\)\s+REFERENCES public\."perfil_servicios"\("perfil_id", "oficio_id"\)[\s\S]+DEFERRABLE INITIALLY DEFERRED/u)
  assert.doesNotMatch(sql, /DROP |DELETE FROM|^\s*UPDATE /imu)
})
