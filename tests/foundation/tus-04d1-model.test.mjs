import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const schema = readFileSync(join(root, 'apps/api/prisma/schema.prisma'), 'utf8')
const migration = readFileSync(
  join(root, 'apps/api/prisma/migrations/20260916140000_tus_provider_agenda_publication_modes/migration.sql'),
  'utf8',
)
const der = readFileSync(join(root, 'docs/database/DER_TUS.dbml'), 'utf8')
const dictionary = readFileSync(join(root, 'docs/database/DICCIONARIO_DATOS_TUS.md'), 'utf8')

test('WEB-04D1 models nullable provider agendas and publication reservation metadata', () => {
  assert.match(schema, /model Calendario[\s\S]*?prestadorId\s+String\?/u)
  assert.match(schema, /model Calendario[\s\S]*?granularidadMinutos\s+Int\s+@default\(15\)/u)
  assert.match(schema, /model Calendario[\s\S]*?bufferMinutos\s+Int\s+@default\(0\)/u)
  assert.match(schema, /model Publicacion[\s\S]*?modalidadReserva\s+String\?/u)
  assert.match(schema, /model Publicacion[\s\S]*?duracionEstimadaMinutos\s+Int\?/u)
  assert.match(schema, /model Publicacion[\s\S]*?modalidadPrecio\s+String\?/u)
  assert.match(schema, /model Reserva[\s\S]*?publicacionId\s+String\?/u)
  assert.match(schema, /@@unique\(\[tenantId, prestadorId\]/u)
})

test('WEB-04D1 migration is additive, tenant-safe, and preserves legacy identifiers', () => {
  assert.match(migration, /ALTER TABLE public\."calendarios"[\s\S]*ADD COLUMN "prestador_id" text/u)
  assert.match(migration, /ALTER COLUMN "servicio_id" DROP NOT NULL/u)
  assert.match(migration, /ADD COLUMN "publicacion_id" text/u)
  assert.match(migration, /fk_calendarios_prestadores[\s\S]*FOREIGN KEY \("tenant_id", "prestador_id"\)/u)
  assert.match(migration, /fk_reservas_publicaciones[\s\S]*FOREIGN KEY \("tenant_id", "publicacion_id"\)/u)
  assert.match(migration, /uq_calendarios_tenant_prestador/u)
  assert.match(migration, /modalidad_reserva.*turno_fijo/u)
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/u)
  assert.doesNotMatch(migration, /TusService.*FOREIGN KEY|FOREIGN KEY.*TusService/u)
})

test('WEB-04D1 documentation records canonical and legacy boundaries', () => {
  assert.match(der, /Prestador 1:0\.\.1/u)
  assert.match(der, /servicio_id.*LEGACY/u)
  assert.match(der, /publicacion_id.*identidad canónica nueva/u)
  assert.match(dictionary, /granularidad_minutos/u)
  assert.match(dictionary, /modalidad_reserva/u)
  assert.match(dictionary, /calendarios.*servicio_id.*LEGACY/u)
})
