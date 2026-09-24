import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REQUIRED_SCAN_COMMANDS = [
  'scripts/security/scan-secrets.mjs --tracked',
  'scripts/security/scan-secrets.mjs --staged',
]

const SENSITIVE_RENDER_KEYS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'MONGODB_URL',
  'REDIS_URL',
  'B2_ENDPOINT',
  'B2_BUCKET',
  'B2_KEY_ID',
  'B2_APPLICATION_KEY',
  'API_BASE_URL',
  'SECRET_STORE_REF',
]

const FORBIDDEN_PRINT_PATTERNS = [
  /(?:echo|printf|printenv|set\s+-x)[^\n]*(?:secret|token|password|credential|api[_-]?key|\$\{\{\s*secrets)/i,
  /(?:cat|more|type)\s+[^\n]*(?:\.env|secret|credential)/i,
]

const BOOTSTRAP_ACTION = 'sts:AssumeRole'

export function validateBootstrapPolicy(policy) {
  const findings = []
  if (policy.credentialSource !== 'secret-store-reference') {
    findings.push('bootstrap credential source must be a secret-store reference')
  }

  if (
    !Array.isArray(policy.allowedActions) ||
    policy.allowedActions.length !== 1 ||
    policy.allowedActions[0] !== BOOTSTRAP_ACTION
  ) {
    findings.push('bootstrap policy must allow only sts:AssumeRole')
  }

  if (
    !Number.isInteger(policy.roleSessionDurationSeconds) ||
    policy.roleSessionDurationSeconds < 900 ||
    policy.roleSessionDurationSeconds > 3600
  ) {
    findings.push('bootstrap role sessions must be between 900 and 3600 seconds')
  }

  return { ok: findings.length === 0, findings }
}

export function validateSecurityPolicy({
  securityWorkflow,
  ciWorkflow,
  incidentResponse,
  renderBlueprint,
}) {
  const findings = []
  for (const command of REQUIRED_SCAN_COMMANDS) {
    if (!securityWorkflow.includes(command))
      findings.push(`security workflow is missing ${command}`)
  }

  if (!/permissions:\r?\n\s+contents:\s*read/u.test(securityWorkflow)) {
    findings.push('security workflow must use read-only repository permissions')
  }
  if (!ciWorkflow.includes('pnpm install --frozen-lockfile')) {
    findings.push('CI must install from the lockfile')
  }
  if (!ciWorkflow.includes('pnpm test')) findings.push('CI must run the deterministic test suite')
  if (!ciWorkflow.includes('pnpm run security:scan')) {
    findings.push('CI must run the tracked-secret blocking scan')
  }

  for (const content of [securityWorkflow, ciWorkflow]) {
    for (const pattern of FORBIDDEN_PRINT_PATTERNS) {
      if (pattern.test(content)) findings.push('CI must not print credentials or secret files')
    }
  }

  if (!/revoke|rotate/i.test(incidentResponse) || !/secret store/i.test(incidentResponse)) {
    findings.push('incident response must require revocation, rotation, and secret-store ownership')
  }

  for (const key of SENSITIVE_RENDER_KEYS) {
    const keyIndex = renderBlueprint.indexOf(`key: ${key}`)
    if (keyIndex < 0 || !/sync:\s*false/.test(renderBlueprint.slice(keyIndex, keyIndex + 120))) {
      findings.push(`${key} must be supplied by the Render secret store`)
    }
  }

  const bootstrapResult = validateBootstrapPolicy({
    credentialSource: 'secret-store-reference',
    allowedActions: [BOOTSTRAP_ACTION],
    roleSessionDurationSeconds: 900,
  })
  if (!bootstrapResult.ok) findings.push(...bootstrapResult.findings)
  if (!incidentResponse.includes(BOOTSTRAP_ACTION)) {
    findings.push('incident response must document the minimum STS AssumeRole bootstrap')
  }

  return { ok: findings.length === 0, findings }
}

function readPolicyFiles(root) {
  return {
    securityWorkflow: readFileSync(join(root, '.github', 'workflows', 'security.yml'), 'utf8'),
    ciWorkflow: readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8'),
    incidentResponse: readFileSync(join(root, 'docs', 'security', 'incident-response.md'), 'utf8'),
    renderBlueprint: readFileSync(join(root, 'render.yaml'), 'utf8'),
  }
}

if (import.meta.main) {
  const result = validateSecurityPolicy(readPolicyFiles(process.cwd()))
  if (!result.ok) {
    for (const finding of result.findings) console.error(`Security policy violation: ${finding}`)
  }
  process.exit(result.ok ? 0 : 1)
}
