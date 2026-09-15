import { fileURLToPath } from 'node:url'

import {
  generateIsolatedRestoreProof,
  LIVE_SCHEMA_CONFORMANCE_REPAIR_PATH,
  parseRepairArguments,
  redactText,
  runRepair,
} from './tus-migration-repair-lib.mjs'

export async function main(argumentsList = process.argv.slice(2)) {
  const parsed = parseRepairArguments(argumentsList)
  if (parsed.intent === 'create-restore-proof') {
    if (parsed.invalidArguments.length > 0) return blockedCliResult('unsupported-argument', 'Unsupported arguments were rejected before database access.', parsed.invalidArguments)
    const result = await generateIsolatedRestoreProof({
      confirmed: parsed.confirmed,
      backupId: parsed.backupId,
      proofPath: parsed.restoreProofPath,
    })
    return {
      status: result.status,
      executive_summary: result.status === 'passed'
        ? 'A fresh schema-only isolated restore proof was generated and bound to the backup fingerprint.'
        : 'The isolated restore proof stopped before an unproven repair could proceed.',
      proof: result.proof ?? null,
      target: result.target ?? null,
      backup: result.backup ?? null,
      restore: result.restore ?? null,
      safety_gate: { status: result.status === 'passed' || result.safetyGate === 'passed' ? 'passed' : 'blocked', reason: result.reason ?? 'passed' },
      side_effects: result.sideEffects,
      cleanup_state: result.cleanupState,
      risks: result.reason ? [result.reason] : [],
      next_recommended: result.status === 'passed' ? 'apply' : 'create-restore-proof',
      skill_resolution: skillResolution(),
    }
  }
  if (parsed.intent !== 'apply') {
    return {
      status: 'blocked',
      executive_summary: 'Only the explicit additive repair apply operation is available.',
      artifacts: [],
      migration_inventory: null,
      safety_gate: { status: 'blocked', reason: 'apply-intent-required' },
      connection_attempts: [],
      migration_result: { status: 'not-started' },
      schema_verification: { status: 'not-started' },
      side_effects: zeroSideEffects(),
      cleanup_state: 'not-started',
      risks: ['No database operation was selected.'],
      next_recommended: 'apply',
      skill_resolution: skillResolution(),
    }
  }
  if (parsed.invalidArguments.length > 0) {
    return {
      status: 'blocked',
      executive_summary: 'Unsupported arguments were rejected before database access.',
      artifacts: [],
      migration_inventory: null,
      safety_gate: { status: 'blocked', reason: 'unsupported-argument', invalidArguments: parsed.invalidArguments.map((argument) => redactText(argument)) },
      connection_attempts: [],
      migration_result: { status: 'not-started' },
      schema_verification: { status: 'not-started' },
      side_effects: zeroSideEffects(),
      cleanup_state: 'not-started',
      risks: ['Unsupported arguments were not executed.'],
      next_recommended: 'apply',
      skill_resolution: skillResolution(),
    }
  }
  const result = await runRepair({
    confirmed: parsed.confirmed,
    backupId: parsed.backupId,
    restoreProofPath: parsed.restoreProofPath,
    repairUnit: 'live-schema-conformance',
  })
  const blockedRisk = result.reason ? [result.reason] : []
  return {
    status: result.status,
    executive_summary: result.status === 'success'
      ? 'The additive live schema conformance repair and metadata verification completed.'
      : 'The live schema conformance repair stopped before an unsafe or unproven operation.',
    artifacts: [
      LIVE_SCHEMA_CONFORMANCE_REPAIR_PATH,
      'scripts/tus-migration-repair-lib.mjs',
      'scripts/tus-migration-repair.mjs',
      'tests/integration/tus/migration-repair.test.mjs',
    ],
    migration_inventory: summarizeInventory(result.inventory),
    safety_gate: { status: result.safetyGate === 'passed' ? 'passed' : 'blocked', reason: result.reason ?? 'passed' },
    connection_attempts: result.connectionAttempts,
    preflight: result.preflight ?? { status: 'not-run' },
    migration_result: result.migrationResult,
    schema_verification: result.schemaVerification,
    pos_verification: result.posVerification,
    side_effects: result.sideEffects,
    cleanup_state: result.cleanupState,
    risks: blockedRisk,
    next_recommended: result.status === 'success' ? 'none' : 'provide-restorable-backup-handle',
    skill_resolution: skillResolution(),
  }
}

function summarizeInventory(inventory) {
  if (!inventory) return null
  return {
    totalMigrationFiles: inventory.migrations.length,
    pendingMigrationCount: inventory.pendingMigrations.length,
    destructiveStatementCount: inventory.destructiveStatementCount,
    destructiveTokens: inventory.destructiveTokens,
    ambiguousStatementCount: inventory.ambiguousStatementCount,
    commentOnlyTokenCount: inventory.commentOnlyTokenCount,
    pendingNames: inventory.pendingMigrations.map((migration) => migration.name),
  }
}

function zeroSideEffects() {
  return { connections: 0, writes: 0, deletes: 0, migrationInvocations: 0, providerCalls: 0 }
}

function blockedCliResult(reason, summary, invalidArguments = []) {
  return {
    status: 'blocked',
    executive_summary: summary,
    artifacts: [],
    migration_inventory: null,
    safety_gate: { status: 'blocked', reason, invalidArguments: invalidArguments.map((argument) => redactText(argument)) },
    connection_attempts: [],
    migration_result: { status: 'not-started' },
    schema_verification: { status: 'not-started' },
    side_effects: zeroSideEffects(),
    cleanup_state: 'not-started',
    risks: [reason],
    next_recommended: 'create-restore-proof',
    skill_resolution: skillResolution(),
  }
}

function skillResolution() {
  return {
    apply: 'C:\\Users\\mmmau\\.config\\opencode\\skills\\sdd-apply\\SKILL.md',
    shared: 'C:\\Users\\mmmau\\.config\\opencode\\skills\\_shared\\SKILL.md',
    typescript: 'C:\\Users\\mmmau\\.config\\opencode\\skills\\curated\\typescript\\SKILL.md',
    workUnitCommits: 'C:\\Users\\mmmau\\.config\\opencode\\skills\\work-unit-commits\\SKILL.md',
    mode: 'Strict TDD',
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`)
      if (result.status === 'blocked') process.exitCode = 1
    })
    .catch(() => {
      process.stdout.write(`${JSON.stringify({ status: 'blocked', reason: 'repair-cli-failed-redacted' })}\n`)
      process.exitCode = 1
    })
}
