import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runTypeScriptScenario } from './fixtures/web-09-servicio.mjs'

test('Supabase pg configuration loads its public CA and preserves certificate and hostname verification', () => {
  const result = runTypeScriptScenario(`
    const { postgresConnectionString } = await import('./apps/api/src/infrastructure/database/postgres/pool.ts')
    const { createRequire } = await import('node:module')
    const { resolve } = await import('node:path')
    const { X509Certificate } = await import('node:crypto')
    const requireApi = createRequire(resolve('apps/api/package.json'))
    const { Client } = requireApi('pg')
    const input = 'postgresql://postgres.project:p%40ss@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require&application_name=tus'
    const connectionString = postgresConnectionString(input)
    const client = new Client({ connectionString })
    const ssl = client.connectionParameters.ssl
    const cert = new X509Certificate(ssl.ca)
    const original = process.cwd()
    process.chdir('apps/api')
    const independentOfCwd = postgresConnectionString(input) === connectionString
    process.chdir(original)
    const untouched = [
      'postgresql://u:p@localhost:5432/db',
      'postgresql://u:p@db.example.com/db?sslmode=require',
      'postgresql://u:p@aws-0-sa-east-1.pooler.supabase.com.attacker.test/db?sslmode=require',
    ].every(url => postgresConnectionString(url) === url)
    const custom = new URL(postgresConnectionString(input + '&sslrootcert=custom.crt'))
    const direct = new URL(postgresConnectionString('postgresql://u:p@db.project.supabase.co/db?sslmode=require'))
    console.log(JSON.stringify({
      mode: new URL(connectionString).searchParams.get('sslmode'),
      ca: cert.ca, fingerprint: cert.fingerprint256,
      verificationEnabled: ssl.rejectUnauthorized !== false && ssl.checkServerIdentity === undefined,
      user: client.user, password: client.password, database: client.database,
      app: client.connectionParameters.application_name,
      independentOfCwd, untouched, custom: custom.searchParams.get('sslrootcert'),
      direct: direct.searchParams.get('sslmode'),
    }))
  `)
  assert.deepEqual(result, {
    mode: 'verify-full', ca: true,
    fingerprint: '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
    verificationEnabled: true, user: 'postgres.project', password: 'p@ss', database: 'postgres',
    app: 'tus', independentOfCwd: true, untouched: true, custom: 'custom.crt', direct: 'verify-full',
  })
})
