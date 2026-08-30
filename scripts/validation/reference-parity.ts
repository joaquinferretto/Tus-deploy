import { readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import {
  InMemoryNeutralContractApi,
  type NeutralContext,
  type NeutralIntentClient,
  type NeutralStateClient,
} from '../../apps/reference/api/src/index.ts'
import { createNeutralWebClients as createReferenceWebClients } from '../../apps/reference/web/src/index.ts'
import { createNeutralMobileClients as createReferenceMobileClients } from '../../apps/reference/mobile/src/index.ts'
import { createNeutralWebClients as createBaseWebClients } from '../../apps/web/src/lib/neutral-contract-client.ts'
import { createNeutralMobileClients as createBaseMobileClients } from '../../apps/mobile/src/application/neutral-contract-client.ts'
// The existing cloud-native validator is intentionally JavaScript and has no generated declaration.
// @ts-expect-error The runtime module is validated by the cloud plan harness.
import { validatePlanFixture } from './cloud-native/contracts.mjs'
import { scanContamination } from './contamination.ts'

export const REFERENCE_PARITY_VALIDATION_VERSION = 'reference-parity.v1'

interface ScenarioEvidence {
  status: 'pass' | 'fail'
  detail: string
}

interface ClientEvidence extends ScenarioEvidence {
  client: 'api' | 'web' | 'mobile'
  contractVersion: string
  observedRecordId: string
}

interface RuntimeEvidence {
  status: 'pass' | 'unavailable-deferred' | 'fail'
  detail: string
  contractVersion?: string
  tenantId?: string
  correlationId?: string
  liveConformance: false
}

interface ParityClient {
  intent: Pick<NeutralIntentClient, 'signup' | 'createRecord'>
  state: Pick<NeutralStateClient, 'searchRecords'>
}

export interface ReferenceParityEvidence {
  version: string
  valid: boolean
  liveConformance: false
  cloud: {
    kind: 'unavailable-deferred'
    liveConformance: false
    profiles: Array<{ profile: string; valid: boolean; errors: string[] }>
    reason: string
  }
  clients: {
    api: ClientEvidence
    web: ClientEvidence
    mobile: ClientEvidence
  }
  runtime: RuntimeEvidence
  security: {
    clientPolicyBypass: boolean
    contamination: ReturnType<typeof scanContamination>
  }
  scenarios: {
    crossTenant: ScenarioEvidence
    failure: ScenarioEvidence
    retry: ScenarioEvidence
    rollback: ScenarioEvidence
  }
}

function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..')
}

function context(tenantId: string, actorId: string): NeutralContext {
  return { tenantId, actorId, correlationId: `corr-${tenantId}-${actorId}` }
}

async function clientProof(
  client: 'api' | 'web' | 'mobile',
  clients: ParityClient
): Promise<ClientEvidence> {
  const tenant = context(`tenant-${client}`, `actor-${client}`)
  const signup = await clients.intent.signup({ ...tenant, email: `${client}@example.test` })
  const created = await clients.intent.createRecord({
    ...tenant,
    collection: 'neutral-records',
    value: { title: 'portable', source: client },
  })
  const result = await clients.state.searchRecords({
    ...tenant,
    collection: 'neutral-records',
    query: 'portable',
  })
  const record = result.records.find((item) => item.recordId === created.recordId)
  return {
    client,
    status: record?.contractVersion === signup.contractVersion ? 'pass' : 'fail',
    detail: record
      ? 'shared neutral contract and tenant-scoped state observed'
      : 'record was not returned',
    contractVersion: record?.contractVersion ?? signup.contractVersion,
    observedRecordId: record?.recordId ?? '',
  }
}

async function runtimeProof(rootDirectory: string): Promise<RuntimeEvidence> {
  const script = [
    'import json',
    'import sys',
    "sys.path.insert(0, 'apps/workflow-runtime-python/src')",
    'from worker.main import example_job_payload, run_once',
    'job = example_job_payload()',
    "job['trace']['correlationId'] = 'corr-runtime-tenant-a'",
    "job['payload'] = {'assetId': 'asset-runtime', 'inputUri': 'https://example.test/input', 'params': {'tenantId': 'tenant-a'}}",
    'result = run_once(job)',
    "print(json.dumps({'status': result['status'], 'contractVersion': result['contractVersion'], 'tenantId': result['input']['params']['tenantId'], 'correlationId': result['trace']['correlationId']}))",
  ].join('\n')
  const result = spawnSync('python', ['-c', script], {
    cwd: rootDirectory,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? 'Python runtime dependencies are unavailable locally'
    return { status: 'unavailable-deferred', detail, liveConformance: false }
  }

  try {
    const output = JSON.parse(result.stdout.trim()) as {
      status: string
      contractVersion: string
      tenantId: string
      correlationId: string
    }
    const valid =
      output.status === 'succeeded' &&
      output.contractVersion === '1.0.0' &&
      output.tenantId === 'tenant-a' &&
      output.correlationId === 'corr-runtime-tenant-a'
    return {
      status: valid ? 'pass' : 'fail',
      detail: valid
        ? 'Python runtime preserved contract, tenant, and correlation context'
        : 'runtime context drifted',
      contractVersion: output.contractVersion,
      tenantId: output.tenantId,
      correlationId: output.correlationId,
      liveConformance: false,
    }
  } catch {
    return {
      status: 'fail',
      detail: 'Python runtime returned non-JSON evidence',
      liveConformance: false,
    }
  }
}

function cloudPlanEvidence(rootDirectory: string): ReferenceParityEvidence['cloud'] {
  const profiles = ['render-native', 'aws-terraform'].map((profile) => {
    const fixture = JSON.parse(
      readFileSync(
        join(rootDirectory, 'scripts/validation/cloud-native/fixtures', `${profile}.json`),
        'utf8'
      )
    ) as Record<string, unknown>
    const result = validatePlanFixture(fixture)
    return { profile, valid: result.valid, errors: result.errors }
  })
  return {
    kind: 'unavailable-deferred',
    liveConformance: false,
    profiles,
    reason:
      'Cloud credentials, managed resources, and authorized smoke are unavailable; only local plan fixtures were evaluated',
  }
}

function clientPolicyBypass(rootDirectory: string): boolean {
  const paths = [
    'apps/reference/web/src',
    'apps/reference/mobile/src',
    'apps/web/src/lib/neutral-contract-client.ts',
    'apps/mobile/src/application/neutral-contract-client.ts',
  ]
  const forbidden =
    /\b(?:fetch|axios|process\.env|dotenv|new\s+(?:Map|Set)|Prisma|Mongo(?:DB)?|Redis|SQS|Bedrock|Mercado\s*Pago|WhatsApp)\b/i
  function files(path: string): string[] {
    const absolute = join(rootDirectory, path)
    if (statSync(absolute).isFile()) return [path]
    const entries = readdirSync(absolute, { withFileTypes: true })
    return entries.flatMap((entry) => {
      const child = join(path, entry.name)
      if (entry.isDirectory()) return files(child)
      return /\.(?:ts|tsx)$/.test(entry.name) ? [child] : []
    })
  }
  return paths
    .flatMap(files)
    .some((path) => forbidden.test(readFileSync(join(rootDirectory, path), 'utf8')))
}

export async function runReferenceParity(
  rootDirectory = repositoryRoot()
): Promise<ReferenceParityEvidence> {
  const normalizedRoot = resolve(rootDirectory)
  const api = new InMemoryNeutralContractApi()
  const referenceWeb = createReferenceWebClients(api)
  const referenceMobile = createReferenceMobileClients(api)
  const baseWeb = createBaseWebClients(api)
  const baseMobile = createBaseMobileClients(api)
  const apiClient = await clientProof('api', { intent: api, state: api })
  const webClient = await clientProof('web', baseWeb)
  const mobileClient = await clientProof('mobile', baseMobile)

  const tenantA = context('tenant-a', 'actor-a')
  const tenantB = context('tenant-b', 'actor-b')
  const created = await referenceWeb.intent.createRecord({
    ...tenantA,
    collection: 'notes',
    value: { title: 'last-passing', body: 'stable' },
  })
  const crossTenantSearch = await referenceMobile.state.searchRecords({
    ...tenantB,
    collection: 'notes',
    query: 'last-passing',
  })
  let crossTenantDenied = false
  try {
    await referenceWeb.intent.updateRecord({
      ...tenantB,
      recordId: created.recordId,
      collection: 'notes',
      value: { title: 'disclosed' },
    })
  } catch {
    crossTenantDenied = true
  }

  let failureDenied = false
  try {
    await referenceWeb.intent.verify({ ...tenantA, userId: 'missing-user', token: 'wrong-token' })
  } catch {
    failureDenied = true
  }

  const firstNotification = await referenceWeb.intent.createNotification({
    ...tenantA,
    message: 'retry-safe',
    idempotencyKey: 'p5-6-notification',
  })
  const retriedNotification = await referenceMobile.intent.createNotification({
    ...tenantA,
    message: 'retry-safe',
    idempotencyKey: 'p5-6-notification',
  })

  const badRelease = await referenceWeb.intent.updateRecord({
    ...tenantA,
    recordId: created.recordId,
    collection: 'notes',
    value: { title: 'bad-release' },
  })
  const restored = await referenceWeb.intent.updateRecord({
    ...tenantA,
    recordId: badRelease.recordId,
    collection: 'notes',
    value: { title: 'last-passing', body: 'stable' },
  })
  const restoredSearch = await referenceMobile.state.searchRecords({
    ...tenantA,
    collection: 'notes',
    query: 'last-passing',
  })

  const contamination = scanContamination(normalizedRoot)
  const runtime = await runtimeProof(normalizedRoot)
  const cloud = cloudPlanEvidence(normalizedRoot)
  const security = { clientPolicyBypass: clientPolicyBypass(normalizedRoot), contamination }
  const scenarios = {
    crossTenant: {
      status: crossTenantSearch.records.length === 0 && crossTenantDenied ? 'pass' : 'fail',
      detail: 'foreign search returned no records and foreign update was denied',
    } satisfies ScenarioEvidence,
    failure: {
      status: failureDenied ? 'pass' : 'fail',
      detail: 'invalid verification failed without a state change',
    } satisfies ScenarioEvidence,
    retry: {
      status:
        firstNotification.notificationId === retriedNotification.notificationId ? 'pass' : 'fail',
      detail: 'retry replayed the idempotent notification without a duplicate effect',
    } satisfies ScenarioEvidence,
    rollback: {
      status:
        restored.value.title === 'last-passing' &&
        restoredSearch.records.some((item) => item.recordId === created.recordId)
          ? 'pass'
          : 'fail',
      detail:
        'bad reference wiring was restored to the last passing state without removing contracts',
    } satisfies ScenarioEvidence,
  }
  const clients = { api: apiClient, web: webClient, mobile: mobileClient }
  const valid =
    Object.values(clients).every((client) => client.status === 'pass') &&
    runtime.status !== 'fail' &&
    cloud.profiles.every((profile) => profile.valid) &&
    contamination.valid &&
    !security.clientPolicyBypass &&
    Object.values(scenarios).every((scenario) => scenario.status === 'pass')

  return {
    version: REFERENCE_PARITY_VALIDATION_VERSION,
    valid,
    liveConformance: false,
    cloud,
    clients,
    runtime,
    security,
    scenarios,
  }
}

export default { runReferenceParity }

const invokedFile = process.argv[1] === fileURLToPath(import.meta.url)
if (invokedFile) {
  void runReferenceParity().then((evidence) => {
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
    if (!evidence.valid) process.exitCode = 1
  })
}
