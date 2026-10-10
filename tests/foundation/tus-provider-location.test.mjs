import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

const root = join(import.meta.dirname, '..', '..')

const SETUP = `
  const { crearServicioDirectorio } = await import('./apps/api/src/tus/directorio/composicion.ts')
  let sequence = 0
  const now = () => Date.parse('2026-09-28T13:00:00.000Z')
  const merchants = new Map()
  const listings = new Map()
  const fallbackAreas = new Map()
  const application = {
    marketplace: { store: { merchant: { find: async (tenantId) => merchants.get(tenantId) ?? null }, listings: { forTenant: async (tenantId) => listings.get(tenantId) ?? [] } } },
    identity: {
      identidadVerificada: async (tenantId) => fallbackAreas.has(tenantId),
      ubicacionPublicaVerificada: async (tenantId) => fallbackAreas.get(tenantId) ?? null,
    },
  }
  const directorio = crearServicioDirectorio({ application, now, newId: () => 'profile-' + String(++sequence).padStart(8, '0') })
  const context = (tenantId) => ({ tenantId, subjectId: 'actor-' + tenantId, sessionId: 'session', roles: ['merchant'], permissions: ['tus:marketplace:write'], correlationId: 'corr' })
  async function provider(tenantId, input, area = null) {
    merchants.set(tenantId, { merchantId: 'merchant-' + tenantId, status: 'approved' })
    if (area) fallbackAreas.set(tenantId, area)
    return directorio.guardarPerfil(context(tenantId), input)
  }
`

test('provider location priority uses configured zones, identity fallback, then no location', () => {
  const result = runTypeScriptScenario(`${SETUP}
    const configured = await provider('configured', { displayName: 'Ana Configurada', profession: 'plomeria', zone: 'Centro', serviceZones: ['Centro', 'Camba Cuá'], serviceMode: 'mixto', coverageRadiusKm: 10, placeAddress: 'Junín 1234' })
    const fallback = await provider('fallback', { displayName: 'Bruno Fallback', profession: 'electricidad', zone: '', serviceZones: [], serviceMode: 'domicilio', coverageRadiusKm: null }, { barrio: 'Camba Cuá', localidad: 'Corrientes Capital', provincia: 'Corrientes' })
    const empty = await provider('empty', { displayName: 'Carla Sin Zona', profession: 'pintura', zone: '', serviceZones: [], serviceMode: 'domicilio', coverageRadiusKm: null })
    const configuredList = await directorio.listar({ q: 'Centro' })
    const fallbackList = await directorio.listar({ zona: 'Camba Cuá' })
    const emptyProfile = await directorio.perfil(empty.perfil.id)
    const replaced = await directorio.guardarPerfil(context('fallback'), { displayName: 'Bruno Fallback', profession: 'electricidad', zone: 'Centro', serviceZones: ['Centro'], serviceMode: 'local', coverageRadiusKm: null, placeAddress: 'Junín 1234' })
    const restored = await directorio.guardarPerfil(context('fallback'), { displayName: 'Bruno Fallback', profession: 'electricidad', zone: '', serviceZones: [], serviceMode: 'domicilio', coverageRadiusKm: null })
    console.log(JSON.stringify({ configured: configured.perfil, fallback: fallback.perfil, empty: emptyProfile, configuredList, fallbackList, replaced: replaced.perfil, restored: restored.perfil }))
  `)

  assert.equal(result.configured.locationSource, 'configured')
  assert.equal(result.configured.publicArea, 'Centro')
  assert.deepEqual(result.configured.serviceZones, ['Centro', 'Camba Cuá'])
  // Coverage keeps both zones, but the map draws ONE point per provider (DIR-06).
  assert.equal(result.configured.mapLocations.length, 1)
  assert.equal(result.configured.mapPoint.label, result.configured.mapLocations[0].label)
  assert.deepEqual(result.configured.coverage, { mode: 'mixto', radiusKm: 10 })
  assert.equal(result.fallback.locationSource, 'identity_fallback')
  assert.equal(result.fallback.publicArea, 'Camba Cuá')
  assert.deepEqual(result.fallback.serviceZones, ['Camba Cuá'])
  assert.equal(result.fallback.mapLocations[0].precision, 'zone')
  assert.equal(result.empty.locationSource, 'none')
  assert.equal(result.empty.publicArea, 'Zona no informada')
  assert.deepEqual(result.empty.mapLocations, [])
  assert.equal(result.configuredList.items[0].displayName, 'Ana Configurada')
  assert.equal(result.fallbackList.items[0].displayName, 'Bruno Fallback')
  assert.equal(result.replaced.locationSource, 'configured')
  assert.equal(result.restored.locationSource, 'identity_fallback')
  assert.doesNotMatch(JSON.stringify(result), /documentAddress|street|houseNumber|dni|cuil|tenantId|prestadorId|exactLatitude|exactLongitude/i)
})

test('provider public location migration is additive and keeps exact identity address out of the profile table', () => {
  const migration = readFileSync(join(root, 'apps/api/prisma/migrations/20261003100000_tus_directorio_ubicaciones/migration.sql'), 'utf8')
  const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
  assert.match(migration, /ADD COLUMN "zonas_cobertura" text\[\]/u)
  assert.match(migration, /ALTER COLUMN "zona" DROP NOT NULL/u)
  assert.match(migration, /modalidad_atencion/u)
  assert.doesNotMatch(migration, /direccion|calle|altura|documento|dni|cuil/iu)
  assert.match(schema, /zonasCobertura\s+String\[\]/u)
  assert.match(schema, /modalidadAtencion\s+String/u)
  // LUGAR-FIJO-01 (2026-10-10): the profile now carries the address of the PLACE where the provider
  // attends (lugar_*: its business, private, given only after a confirmed turno). The address of
  // the IDENTITY (the home of the person) still never enters the profile: nothing else names one.
  const modeloPerfil = schema.slice(schema.indexOf('model PerfilPublicoPrestador'), schema.indexOf('model ImagenSolicitud')).split(/\r?\n/u).filter((linea) => !/^\s*(\/\/|lugar(Nombre|Direccion|Descripcion)\s)/u.test(linea)).join(' ')
  assert.doesNotMatch(modeloPerfil, /direccion|calle|altura|dni|cuil/iu)
})
