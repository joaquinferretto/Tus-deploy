import { fileURLToPath } from 'node:url'

import {
  REPAIR_MIGRATION_NAME,
  parseRepairArguments,
  redactText,
  runRepair,
} from './tus-migration-repair-lib.mjs'

export async function main(argumentsList = process.argv.slice(2)) {
  const parsed = parseRepairArguments(argumentsList)
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
  const result = await runRepair({ confirmed: parsed.confirmed, backupId: parsed.backupId })
  const blockedRisk = result.reason ? [result.reason] : []
  return {
    status: result.status,
    executive_summary: result.status === 'partial'
      ? 'The additive baseline completed; durable POS rerun remains bounded to the next phase.'
      : result.status === 'success'
        ? 'The additive baseline and all requested bounded verification completed.'
        : 'The additive migration repair stopped before an unsafe or unproven operation.',
    artifacts: [
      'apps/api/prisma/migrations/20260831180000_tus_additive_migration_repair/migration.sql',
      'scripts/tus-migration-repair-lib.mjs',
      'scripts/tus-migration-repair.mjs',
      'tests/integration/tus/migration-repair.test.mjs',
    ],
    migration_inventory: summarizeInventory(result.inventory),
    safety_gate: { status: result.safetyGate === 'passed' ? 'passed' : 'blocked', reason: result.reason ?? 'passed' },
    connection_attempts: result.connectionAttempts,
    migration_result: result.migrationResult,
    schema_verification: result.schemaVerification,
    pos_verification: result.posVerification,
    side_effects: result.sideEffects,
    cleanup_state: result.cleanupState,
    risks: blockedRisk,
    next_recommended: result.status === 'partial' ? 'bounded-pos-rerun' : result.status === 'success' ? 'none' : 'provide-restorable-backup-handle',
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

function skillResolution() {
  return {
    apply: 'C:\\Users\\mmmau\\.config\\opencode\\skills\\sdd-apply\\SKILL.md',
    shared: 'C:\\Users\\mmmau\\.config\\opencode\\skills\\_shared\\SKILL.md',
    typescript: 'C:\\Users\\mmmau\\.config\\opencode\\skills\\curated\\typescript\\SKILL.md',
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
