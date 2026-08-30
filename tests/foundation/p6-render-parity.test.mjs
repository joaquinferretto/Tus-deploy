import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..', '..')
const renderBlueprint = readFileSync(join(root, 'render.yaml'), 'utf8')
const renderTerraform = readFileSync(
  join(root, 'infra', 'terraform', 'environments', 'render', 'main.tf'),
  'utf8'
)
const renderDocs = readFileSync(join(root, 'docs', 'deployment', 'render.md'), 'utf8')
const awsDocs = readFileSync(join(root, 'docs', 'deployment', 'aws.md'), 'utf8')

const requiredBoundaries = ['postgresql', 'mongodb', 'redis', 'object-storage', 'queues']

test('Render blueprint declares native API, web, and Python worker services', () => {
  for (const service of ['factory-api', 'factory-web', 'factory-workflow-worker']) {
    assert.match(renderBlueprint, new RegExp(`name:\\s*${service}`))
  }

  assert.match(renderBlueprint, /type:\s*web[\s\S]*runtime:\s*node/)
  assert.match(renderBlueprint, /type:\s*worker[\s\S]*runtime:\s*python/)
  assert.match(renderBlueprint, /buildCommand:\s*pnpm install --frozen-lockfile/)
  assert.match(renderBlueprint, /startCommand:\s*python -m worker\.main/)
  assert.match(renderBlueprint, /FACTORY_PROFILE[\s\S]*value:\s*render/)
})

test('Render declares the same five managed boundaries as the AWS profile', () => {
  for (const boundary of requiredBoundaries) {
    assert.match(
      renderTerraform,
      new RegExp(`^\\s{4}"?${boundary.replace('-', '[-]')}"?\\s*=\\s*{`, 'm'),
      `${boundary}: Terraform boundary`
    )
    assert.match(
      renderDocs,
      new RegExp(boundary.replace('-', '[- ]'), 'i'),
      `${boundary}: Render docs`
    )
    assert.match(awsDocs, new RegExp(boundary.replace('-', '[- ]'), 'i'), `${boundary}: AWS docs`)
  }

  assert.match(renderTerraform, /output\s+"managed_boundaries"/)
  assert.match(renderTerraform, /output\s+"profile_parity"/)
  assert.match(renderTerraform, /profile\s*=\s*"render-native"/)
  assert.match(renderTerraform, /duplicate_store\s*=\s*false/)
})

test('Render has no production Docker path and keeps AWS Terraform as the IaC shape', () => {
  assert.doesNotMatch(renderBlueprint, /dockerCommand|dockerfile|docker build/i)
  assert.match(renderDocs, /does not use production Docker/i)
  assert.match(renderDocs, /never silently falls\s+back to Compose/i)
  assert.match(awsDocs, /infrastructure authority is\s+Terraform/i)
  assert.match(awsDocs, /aws-terraform/i)
})

test('Profile validation records dry-run and unavailable/live disposition without provisioning', () => {
  for (const docs of [renderDocs, awsDocs]) {
    assert.match(docs, /dry-run|plan\/validation/i)
    assert.match(docs, /authorized-cloud-smoke/i)
    assert.match(docs, /unavailable-deferred/i)
    assert.match(docs, /live conformance[\s\S]*not claimed/i)
  }

  assert.match(renderTerraform, /infrastructure_state\s*=\s*"contract-only-no-provisioning"/)
  assert.doesNotMatch(renderTerraform, /(^|\n)\s*(provider|resource|backend)\s+"/i)
})
