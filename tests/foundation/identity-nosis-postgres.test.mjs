import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'
import { IDENTITY_SETUP } from './fixtures/identidad.mjs'

// Runs only against a DISPOSABLE PostgreSQL 16 database with every migration applied:
//   TUS_IDENTITY_PG_URL=postgresql://user@127.0.0.1:55471/tus_fresh node --test <this file>
// Never point it to a shared or real database: it writes fictitious rows.
const url = process.env.TUS_IDENTITY_PG_URL

test(
  'IDENTITY-NOSIS PostgreSQL: atomic lease across workers, 7/hour under concurrent reservations, unique verified DNI, append-only',
  { skip: !url && 'TUS_IDENTITY_PG_URL not set (disposable PostgreSQL only)' },
  () => {
    const result = runTypeScriptScenario(`${IDENTITY_SETUP}
    const { PrismaClient } = await import('./apps/api/node_modules/@prisma/client/index.js')
    const { TransaccionIdentidadPrisma } = await import('./apps/api/src/tus/adapters/prisma-identidad.ts')
    const prisma = new PrismaClient({ datasourceUrl: ${JSON.stringify(url ?? '')}, log: [] })
    try {
      const run = 'r' + Date.now().toString(36)
      const pgTx = new TransaccionIdentidadPrisma(prisma)
      const pgIdentity = new ServicioVerificacionIdentidad(pgTx, documentsVault, { providerId: 'pg-' + run, maxChecksPerHour: 7 }, identityClock)
      const pgWorker = (owner) => new WorkerVerificacionIdentidad(pgTx, { provider: demo, ocr: fakeReader('ocr'), vision: fakeReader('vision'), boveda: documentsVault, config: { providerId: 'pg-' + run, maxChecksPerHour: 7 }, owner, now: identityClock })
      const tenant = (n) => ({ tenantId: run + '-prestador-' + n, actorId: 'user-' + n, correlationId: 'corr-' + n })
      async function submitPg(n, tag) {
        const c = tenant(n)
        await pgIdentity.aceptarConsentimiento(c, { accepted: true, consentVersion: VERSION_CONSENTIMIENTO_IDENTIDAD })
        await pgIdentity.subirDocumento(c, 'front', png(tag))
        await pgIdentity.subirDocumento(c, 'back', png(tag))
        await pgIdentity.enviar(c)
        advance(10)
      }
      for (let n = 1; n <= 10; n += 1) await submitPg(n, '30111223|PRUEBA DEMO|JUAN')
      // Three workers race over the same queue until it is empty or rate limited.
      const workers = [pgWorker('pg-a'), pgWorker('pg-b'), pgWorker('pg-c')]
      const outcomes = []
      let quietRounds = 0
      for (let round = 0; round < 80 && quietRounds < 3; round += 1) {
        const results = await Promise.all(workers.map((w) => w.procesarSiguiente()))
        outcomes.push(...results.map((r) => r.outcome))
        quietRounds = results.every((r) => r.outcome === 'idle') ? quietRounds + 1 : 0
      }
      const consultas = await prisma.consultaProveedorIdentidad.count({ where: { proveedorId: 'pg-' + run } })
      const perVerification = await prisma.consultaProveedorIdentidad.groupBy({ by: ['verificacionId'], where: { proveedorId: 'pg-' + run }, _count: true })
      const status = await pgIdentity.estadoWorker()
      const pending = await prisma.colaVerificacionIdentidad.count({ where: { estado: { in: ['queued', 'leased'] }, verificacionId: { in: (await prisma.verificacionIdentidad.findMany({ where: { tenantId: { startsWith: run } } })).map((v) => v.id) } } })
      // Partial unique index: the same DNI cannot be verified for two providers.
      const rows = await prisma.verificacionIdentidad.findMany({ where: { tenantId: { startsWith: run } }, orderBy: { fechaCreacion: 'asc' }, take: 2 })
      const uniqueDni = String(40000000 + (Date.now() % 9000000))
      const verify = (row) => prisma.verificacionIdentidad.update({ where: { id: row.id }, data: { estado: 'verified', numeroDocumento: uniqueDni, metodoVerificacion: 'manual', verificadaEn: new Date() } })
      await verify(rows[0])
      let uniqueCode = 'none'
      try { await verify(rows[1]) } catch (error) { uniqueCode = error.code }
      let appendOnly = 'none'
      try { await prisma.auditoriaIdentidad.deleteMany({ where: { tenantId: rows[0].tenantId } }) } catch (error) { appendOnly = /append-only/.test(String(error.message)) ? 'append-only' : 'other' }
      let appendOnlyConsultas = 'none'
      try { await prisma.consultaProveedorIdentidad.updateMany({ where: { proveedorId: 'pg-' + run }, data: { consumidaEn: new Date(0) } }) } catch (error) { appendOnlyConsultas = /append-only/.test(String(error.message)) ? 'append-only' : 'other' }
      const docRow = await prisma.documentoIdentidad.findFirst({ where: { tenantId: rows[0].tenantId } })
      const plainInDb = docRow.contenidoCifrado.includes(png('30111223|PRUEBA DEMO|JUAN').toString('base64').slice(0, 24))
      console.log(JSON.stringify({ consultas, maxPerVerification: Math.max(...perVerification.map((row) => row._count)), status: [status.status, status.used], pending, uniqueCode, appendOnly, appendOnlyConsultas, plainInDb, leaseLost: outcomes.filter((o) => o === 'lease_lost').length }))
    } finally { await prisma.$disconnect() }
  `)
    assert.equal(
      result.consultas,
      7,
      'never more than 7 searches in the window, even with 3 workers'
    )
    assert.equal(result.maxPerVerification, 1, 'no verification is searched twice')
    assert.deepEqual(result.status, ['rate_limited', 7])
    assert.equal(result.pending, 3)
    assert.equal(result.uniqueCode, 'P2002')
    assert.equal(result.appendOnly, 'append-only')
    assert.equal(result.appendOnlyConsultas, 'append-only')
    assert.equal(result.plainInDb, false)
    assert.equal(result.leaseLost, 0)
  }
)
