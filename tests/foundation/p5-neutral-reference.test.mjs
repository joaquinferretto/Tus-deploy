import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tsxCli = join(root, 'apps/api/node_modules/tsx/dist/cli.mjs')

function runTypeScriptScenario(source) {
  const wrapped = `(async () => {\n${source}\n})()`
  const output = execFileSync(process.execPath, [tsxCli, '--eval', wrapped], {
    cwd: root,
    encoding: 'utf8',
  })
  return JSON.parse(output.trim())
}

function context(tenantId = 'tenant-a', actorId = 'user-a') {
  return { tenantId, actorId, correlationId: `corr-${tenantId}-${actorId}` }
}

test('P5.4 exposes one versioned neutral contract and an explicit unavailable cloud disposition', () => {
  const result = runTypeScriptScenario(`
    const { NEUTRAL_CONTRACT_VERSION, createUnavailableCloudNativeDisposition, InMemoryNeutralContractApi } = (await import('./apps/reference/api/src/index.ts')).default
    const disposition = createUnavailableCloudNativeDisposition('fixture credentials are not configured')
    const api = new InMemoryNeutralContractApi()
    console.log(JSON.stringify({
      version: NEUTRAL_CONTRACT_VERSION,
      disposition,
      fakeMode: api.profile.mode,
      profile: api.profile.name,
    }))
  `)

  assert.equal(result.version, 'neutral-reference.v1')
  assert.deepEqual(result.disposition, {
    kind: 'unavailable-deferred',
    liveConformance: false,
    reason: 'fixture credentials are not configured',
  })
  assert.equal(result.fakeMode, 'fake')
  assert.equal(result.profile, 'aws-terraform')
})

test('P5.4 completes signup, verification, membership, CRUD/search, and assets through web and mobile clients', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryNeutralContractApi } = (await import('./apps/reference/api/src/index.ts')).default
    const { createNeutralWebClients } = (await import('./apps/reference/web/src/index.ts')).default
    const { createNeutralMobileClients } = (await import('./apps/reference/mobile/src/index.ts')).default
    const api = new InMemoryNeutralContractApi()
    const web = createNeutralWebClients(api)
    const mobile = createNeutralMobileClients(api)
    const ctx = ${JSON.stringify(context())}
    const signup = await web.intent.signup({ ...ctx, email: 'user-a@example.test' })
    const verified = await mobile.intent.verify({ ...ctx, userId: signup.userId, token: signup.verificationToken })
    const membership = await web.intent.createMembership({ ...ctx, role: 'owner' })
    const created = await web.intent.createRecord({ ...ctx, collection: 'notes', value: { title: 'Neutral note', body: 'portable' } })
    const search = await mobile.state.searchRecords({ ...ctx, collection: 'notes', query: 'portable' })
    const asset = await mobile.intent.uploadAsset({ ...ctx, name: 'knowledge.txt', contentType: 'text/plain', content: 'tenant knowledge' })
    const assets = await web.state.listAssets(ctx)
    console.log(JSON.stringify({ signup, verified, membership, created, search, asset, assets }))
  `)

  assert.equal(result.signup.userId, 'user-1')
  assert.equal(result.verified.status, 'verified')
  assert.equal(result.membership.role, 'owner')
  assert.equal(result.created.value.title, 'Neutral note')
  assert.equal(result.search.records.length, 1)
  assert.equal(result.asset.assetId, 'asset-1')
  assert.equal(result.assets.assets.length, 1)
})

test('P5.4 proves notifications, jobs, AI/RAG, audit, and telemetry are observable and idempotent', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryNeutralContractApi } = (await import('./apps/reference/api/src/index.ts')).default
    const { createNeutralWebClients } = (await import('./apps/web/src/lib/neutral-contract-client.ts')).default
    const api = new InMemoryNeutralContractApi()
    const client = createNeutralWebClients(api)
    const ctx = ${JSON.stringify(context())}
    await client.intent.signup({ ...ctx, email: 'user-a@example.test' })
    const notification = await client.intent.createNotification({ ...ctx, message: 'Verification ready', idempotencyKey: 'notification-1' })
    const replay = await client.intent.createNotification({ ...ctx, message: 'Verification ready', idempotencyKey: 'notification-1' })
    const job = await client.intent.submitJob({ ...ctx, kind: 'neutral-index', idempotencyKey: 'job-1' })
    const ai = await client.intent.runAi({ ...ctx, prompt: 'Summarize the knowledge', idempotencyKey: 'ai-1' })
    const document = await client.intent.ingestKnowledge({ ...ctx, assetId: 'asset-1', text: 'The neutral factory is portable.' })
    const answer = await client.state.searchKnowledge({ ...ctx, question: 'What is the factory?' })
    await client.intent.recordTelemetry({ ...ctx, name: 'reference.flow.completed', value: 1 })
    const notifications = await client.state.listNotifications(ctx)
    const audit = await client.state.listAudit(ctx)
    const telemetry = await client.state.listTelemetry(ctx)
    console.log(JSON.stringify({ notification, replay, job, ai, document, answer, notifications, audit, telemetry }))
  `)

  assert.equal(result.notification.notificationId, result.replay.notificationId)
  assert.equal(result.notifications.notifications.length, 1)
  assert.equal(result.job.status, 'completed')
  assert.equal(result.ai.provider, 'deterministic-fake')
  assert.equal(result.document.status, 'indexed')
  assert.equal(result.answer.citations.length, 1)
  assert.ok(result.audit.events.length >= 5)
  assert.equal(result.telemetry.points[0].name, 'reference.flow.completed')
})

test('P5.4 keeps superadmin intent separate and denies cross-tenant state reads', () => {
  const result = runTypeScriptScenario(`
    const { InMemoryNeutralContractApi } = (await import('./apps/reference/api/src/index.ts')).default
    const { createNeutralMobileClients } = (await import('./apps/mobile/src/application/neutral-contract-client.ts')).default
    const api = new InMemoryNeutralContractApi()
    const client = createNeutralMobileClients(api)
    const owner = ${JSON.stringify(context())}
    const foreign = ${JSON.stringify(context('tenant-b', 'user-b'))}
    const state = await client.state.getSuperadminState(owner)
    const intent = await client.intent.setSuperadminIntent({ ...owner, intent: 'disable-feature', target: 'neutral-search' })
    const denied = await client.state.listAudit(foreign)
    console.log(JSON.stringify({ state, intent, denied }))
  `)

  assert.equal(result.state.product, 'neutral-reference')
  assert.equal(result.intent.status, 'recorded')
  assert.equal(result.intent.target, 'neutral-search')
  assert.equal(result.denied.events.length, 0)
  assert.equal(result.denied.denied, true)
})

test('P5.4 reference clients contain no live provider, cloud, secret, or environment loading', () => {
  const paths = [
    'apps/reference/api',
    'apps/reference/web',
    'apps/reference/mobile',
    'apps/web/src/lib/neutral-contract-client.ts',
    'apps/mobile/src/application/neutral-contract-client.ts',
  ]
  const result = runTypeScriptScenario(`
    const { readFileSync, statSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const paths = ${JSON.stringify(paths)}
    function files(path) {
      const stat = statSync(join(process.cwd(), path))
      if (stat.isFile()) return [path]
      return readdirSync(join(process.cwd(), path), { withFileTypes: true }).flatMap((entry) => files(join(path, entry.name)))
    }
    const all = paths.flatMap(files).filter((path) => /\\.(ts|tsx)$/.test(path))
    const source = all.map((path) => readFileSync(join(process.cwd(), path), 'utf8')).join('\\n')
    console.log(JSON.stringify({ files: all.length, forbidden: /\\b(Bedrock|Prisma|Mongo|Redis|SQS|fetch\\s*\\(|axios|process\\.env|dotenv)\\b/i.test(source) }))
  `)

  assert.ok(result.files >= 5)
  assert.equal(result.forbidden, false)
})
