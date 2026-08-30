import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import {
  DELIVERY_PROFILES as CLOUD_DELIVERY_PROFILES,
  validatePlanFixture,
} from '../cloud-native/contracts.mjs'
import { scanContamination } from '../contamination.ts'

export const PORTABILITY_VALIDATION_VERSION = 'portability.v1'
export const CLEAN_ENVIRONMENT_FIXTURE_VERSION = 'clean-environment.v1'
export const REQUIRED_PROFILES = Object.freeze(['render-native', 'aws-terraform'])
export const REQUIRED_BOUNDARIES = Object.freeze([
  'postgresql',
  'mongodb',
  'redis',
  'object-storage',
  'queues',
])

export const DELIVERY_PROFILES = structuredClone(CLOUD_DELIVERY_PROFILES)

const SHARED_BOUNDARY_FIELDS = Object.freeze(['owner', 'rollbackRef', 'fakeMode', 'activationGate'])

function repositoryRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
}

export function loadCleanEnvironmentFixture(rootDirectory = repositoryRoot()) {
  const fixturePath = join(
    rootDirectory,
    'scripts/validation/portability/fixtures/clean-environment.json'
  )
  return JSON.parse(readFileSync(fixturePath, 'utf8'))
}

function unsupportedResult(errors, details = {}) {
  return {
    valid: false,
    status: 'unsupported-profile',
    liveConformance: false,
    errors,
    ...details,
  }
}

export function validateCleanEnvironmentFixture(fixture) {
  const errors = []
  const checkout = fixture?.checkout ?? {}
  const native = fixture?.native ?? {}
  const cloudNative = fixture?.cloudNative ?? {}

  if (fixture?.version !== CLEAN_ENVIRONMENT_FIXTURE_VERSION) {
    errors.push(`Unsupported clean-environment fixture version: ${fixture?.version ?? 'missing'}`)
  }
  if (checkout.profileSelection !== 'explicit') {
    errors.push('Cloud profile selection must be explicit')
  }
  if (checkout.maintainerKnowledgeRequired !== false) {
    errors.push('Fresh-checkout bootstrap cannot require maintainer-only knowledge')
  }
  for (const field of ['envFilesRead', 'secretValuesPresent', 'cloudCalls', 'provisioned']) {
    if (checkout[field] !== false) errors.push(`Fresh-checkout fixture must keep ${field} false`)
  }
  if (
    JSON.stringify(native.commands) !==
    JSON.stringify(['cd backend && pnpm run dev', 'cd frontend && pnpm run dev'])
  ) {
    errors.push('Native bootstrap must document both canonical wrapper commands')
  }
  if (native.databaseKey !== 'DATABASE_URL' || native.postgresqlRequired !== true) {
    errors.push('Native bootstrap must require PostgreSQL through DATABASE_URL')
  }
  if (native.limitationsDocumented !== true) {
    errors.push('Native limitations must be documented before cloud bootstrap')
  }
  if (JSON.stringify(cloudNative.profiles) !== JSON.stringify([...REQUIRED_PROFILES])) {
    errors.push('Cloud bootstrap must select render-native or aws-terraform explicitly')
  }
  if (cloudNative.planOnly !== true || cloudNative.authorizationRequired !== true) {
    errors.push('Cloud bootstrap must separate plan-only checks from authorized smoke')
  }
  if (cloudNative.composeFallback !== false) {
    errors.push('Compose fallback is forbidden; Compose remains deferred')
  }
  if (cloudNative.fallback !== 'deterministic-fakes-until-authorized') {
    errors.push('Unavailable cloud resources must retain deterministic fakes until authorized')
  }
  if (cloudNative.liveConformance !== false) {
    errors.push('Clean-environment bootstrap cannot claim live conformance')
  }

  if (errors.length > 0) return unsupportedResult(errors, { checkout, native, cloudNative })
  return {
    valid: true,
    status: 'pass',
    liveConformance: false,
    cloudCalls: false,
    provisioned: false,
    errors: [],
    checkout,
    native,
    cloudNative,
  }
}

function boundarySnapshot(boundary) {
  if (!boundary) return null
  return Object.fromEntries(SHARED_BOUNDARY_FIELDS.map((field) => [field, boundary[field]]))
}

export function evaluateProfileParity(profiles = DELIVERY_PROFILES) {
  const divergences = []
  const render = profiles['render-native']
  const aws = profiles['aws-terraform']

  for (const profile of REQUIRED_PROFILES) {
    if (!profiles[profile]) {
      divergences.push({
        profile,
        boundary: '*',
        reason: `${profile} is missing from the active profile matrix`,
      })
    }
  }

  if (!render || !aws) {
    return {
      valid: false,
      status: 'unsupported-profile',
      liveConformance: false,
      unsupportedProfiles: [...new Set(divergences.map((item) => item.profile))],
      divergences,
      matrix: [],
    }
  }

  const matrix = REQUIRED_BOUNDARIES.map((boundaryName) => {
    const renderBoundary = render.boundaries?.[boundaryName]
    const awsBoundary = aws.boundaries?.[boundaryName]
    if (!renderBoundary || !awsBoundary) {
      const missingProfiles = [
        !renderBoundary ? 'render-native' : null,
        !awsBoundary ? 'aws-terraform' : null,
      ].filter(Boolean)
      for (const profile of missingProfiles) {
        divergences.push({
          profile,
          boundary: boundaryName,
          reason: `${profile} is missing required ${boundaryName} ownership boundary`,
        })
      }
    } else {
      for (const field of SHARED_BOUNDARY_FIELDS) {
        if (renderBoundary[field] !== awsBoundary[field]) {
          divergences.push({
            profile: 'aws-terraform',
            boundary: boundaryName,
            reason: `${boundaryName} ${field} diverges from render-native parity`,
          })
        }
      }
    }
    return {
      boundary: boundaryName,
      renderNative: boundarySnapshot(renderBoundary),
      awsTerraform: boundarySnapshot(awsBoundary),
      sharedContract: !divergences.some((item) => item.boundary === boundaryName),
    }
  })

  const unsupportedProfiles = [...new Set(divergences.map((item) => item.profile))]
  return {
    valid: divergences.length === 0,
    status: divergences.length === 0 ? 'pass' : 'unsupported-profile',
    liveConformance: false,
    unsupportedProfiles,
    divergences,
    matrix,
  }
}

function cloudPlanEvidence(rootDirectory) {
  const profiles = REQUIRED_PROFILES.map((profile) => {
    const fixturePath = join(
      rootDirectory,
      'scripts/validation/cloud-native/fixtures',
      `${profile}.json`
    )
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
    return validatePlanFixture(fixture)
  })
  return {
    kind: 'cloud-plan-validation',
    liveConformance: false,
    profiles,
    reason:
      'Only committed synthetic fixtures were evaluated; cloud credentials, resources, and authorized smoke were not used',
  }
}

export async function runPortabilityValidation(rootDirectory = repositoryRoot()) {
  const normalizedRoot = resolve(rootDirectory)
  const bootstrap = validateCleanEnvironmentFixture(loadCleanEnvironmentFixture(normalizedRoot))
  const parity = evaluateProfileParity()
  const cloud = cloudPlanEvidence(normalizedRoot)
  const contamination = scanContamination(normalizedRoot)
  const compose = {
    status: 'deferred',
    liveConformance: false,
    reason: 'Compose/P0.6b remains an optional, unchecked, non-blocking future integration slice',
  }

  return {
    version: PORTABILITY_VALIDATION_VERSION,
    valid:
      bootstrap.valid &&
      parity.valid &&
      cloud.profiles.every((profile) => profile.valid) &&
      contamination.valid,
    liveConformance: false,
    bootstrap,
    cloud,
    parity,
    contamination,
    compose,
  }
}

export default {
  DELIVERY_PROFILES,
  REQUIRED_PROFILES,
  REQUIRED_BOUNDARIES,
  evaluateProfileParity,
  loadCleanEnvironmentFixture,
  runPortabilityValidation,
  validateCleanEnvironmentFixture,
}

const invokedFile = process.argv[1] === fileURLToPath(import.meta.url)
if (invokedFile) {
  void runPortabilityValidation().then((evidence) => {
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
    if (!evidence.valid) process.exitCode = 1
  })
}
