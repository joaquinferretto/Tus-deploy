import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const terraformRoot = join(root, 'infra', 'terraform')
const modulesRoot = join(terraformRoot, 'modules')

const requiredServices = {
  network: ['vpc', 'subnets', 'security_groups'],
  compute: ['ecs_fargate', 'ecr'],
  data: ['rds_aurora', 'mongo_decision_adapter'],
  cache: ['elasticache'],
  storage: ['s3'],
  edge: ['cloudfront', 'waf', 'route53_acm'],
  queue: ['sqs_dlq', 'eventbridge', 'lambda'],
  observability: ['cloudwatch_otel'],
  security: ['iam_sts_kms', 'cloudtrail', 'guardduty', 'security_hub', 'inspector'],
  backup: ['backup'],
  governance: ['budgets', 'service_quotas'],
}

const serviceMetadata = [
  'profile_gate',
  'activation',
  'owner',
  'configuration',
  'rollback',
  'security',
  'data',
  'cost',
  'local_fake',
]

function readTerraform(...segments) {
  return readFileSync(join(terraformRoot, ...segments), 'utf8')
}

function declaredServiceCount(serviceName) {
  return readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(modulesRoot, entry.name, 'main.tf'), 'utf8'))
    .reduce(
      (count, content) =>
        count + (content.match(new RegExp(`^\\s*${serviceName}\\s*=\\s*{`, 'gm')) ?? []).length,
      0
    )
}

test('AWS Terraform critical catalog has one owned declaration for every required service', () => {
  const moduleFiles = Object.entries(requiredServices)

  for (const [moduleName, services] of moduleFiles) {
    const content = readTerraform('modules', moduleName, 'main.tf')
    assert.match(content, /local\.service_catalog/, `${moduleName}: service catalog local`)
    assert.match(content, /output\s+"service_catalog"/, `${moduleName}: service catalog output`)

    for (const serviceName of services) {
      assert.equal(
        declaredServiceCount(serviceName),
        1,
        `${serviceName}: exactly one module declaration`
      )
      const serviceStart = content.indexOf(`${serviceName} = {`)
      assert.notEqual(serviceStart, -1, `${moduleName}: ${serviceName} declaration`)
      const serviceBlock = content.slice(serviceStart, content.indexOf('\n  }', serviceStart) + 4)
      for (const metadata of serviceMetadata) {
        assert.match(serviceBlock, new RegExp(`\\b${metadata}\\s*=`), `${serviceName}: ${metadata}`)
      }
      assert.match(
        serviceBlock,
        /enabled\s*=\s*var\.enabled/,
        `${serviceName}: activation follows profile flag`
      )
    }
  }
})

test('AWS profile wires every catalog module without profile drift or duplicate stores', () => {
  const content = readTerraform('environments', 'aws', 'main.tf')
  const variables = readTerraform('environments', 'aws', 'variables.tf')
  const moduleNames = Object.keys(requiredServices)

  for (const moduleName of moduleNames) {
    assert.match(content, new RegExp(`module\\s+"${moduleName}"`), `${moduleName}: module wiring`)
    assert.match(
      content,
      new RegExp(`enabled\\s*=\\s*local\\.capabilities\\.${moduleName}`),
      `${moduleName}: profile gate`
    )
    assert.match(
      content,
      new RegExp(`module\\.${moduleName}\\.service_catalog`),
      `${moduleName}: catalog aggregation`
    )
  }

  assert.match(content, /output\s+"critical_service_catalog"/)
  assert.match(content, /output\s+"data_store_decision"/)
  assert.match(content, /source_of_truth\s*=\s*"postgresql"/)
  assert.match(content, /document_store_mode\s*=\s*"read-model-only"/)
  assert.match(content, /duplicate_store\s*=\s*false/)
  assert.match(variables, /enabled_capabilities/)
  assert.match(content, /merge\(local\.default_capabilities, var\.enabled_capabilities\)/)
  assert.doesNotMatch(content + variables, /(^|\n)\s*(resource|provider|backend)\s+"/i)
})

test('AWS catalog defaults are activation-gated and free of credentials or live apply claims', () => {
  const content = readTerraform('environments', 'aws', 'main.tf')
  const variables = readTerraform('environments', 'aws', 'variables.tf')
  const moduleContents = Object.keys(requiredServices)
    .map((moduleName) => readTerraform('modules', moduleName, 'main.tf'))
    .join('\n')
  const allTerraform = content + variables + moduleContents

  for (const moduleName of Object.keys(requiredServices)) {
    assert.match(content, new RegExp(`${moduleName}\\s*=\\s*false`), `${moduleName}: safe default`)
  }
  assert.match(allTerraform, /profile_gate\s*=\s*"aws-terraform"/)
  assert.match(allTerraform, /activation\s*=\s*"disabled-until-approved"/)
  assert.match(allTerraform, /infrastructure_state\s*=\s*"contract-only-no-provisioning"/)
  assert.doesNotMatch(
    allTerraform,
    /AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|(?:postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s`]+:[^\s`]+@/i
  )
})
