import {
  DATABASE_ATTEMPT_TIMEOUT_MS,
  DATABASE_MAX_ATTEMPTS,
  type ApiRuntimeConfig,
} from '../../platform/configuration/domain.ts'
import {
  closePostgresPool,
  createPostgresPool,
  type PostgresPoolLike,
  withBoundedDatabaseStartupRetry,
} from './postgres/pool.ts'
import { connectPrisma, disconnectPrisma } from './prisma/client.ts'

export const REQUIRED_API_SCHEMA_TABLES = [
  'evidencias_habilitacion',
  'decisiones_habilitacion',
  'configuraciones_pagos_servicio',
  'reembolsos_servicio',
] as const

export interface SchemaReadiness {
  compatible: boolean
  activation: 'active' | 'incomplete-schema' | 'incompatible' | 'unverified'
  missing: string[]
  migration: 'forward-only' | 'unverified'
}

export interface DatabaseLifecycle {
  connect: () => Promise<void>
  checkSchema: () => Promise<SchemaReadiness>
  close: () => Promise<void>
}

export interface DatabaseLifecycleOptions {
  config: Pick<ApiRuntimeConfig, 'databaseUrl' | 'dbAttemptTimeoutMs' | 'dbMaxAttempts'>
  poolFactory?: (databaseUrl: string) => PostgresPoolLike
  prismaConnector?: (databaseUrl: string) => Promise<void>
  prismaDisconnector?: () => Promise<void>
  schemaChecker?: (pool: PostgresPoolLike) => Promise<SchemaReadiness>
  closePool?: (pool: PostgresPoolLike | undefined) => Promise<void>
  sleep?: (durationMs: number) => Promise<void>
}

export function createDatabaseLifecycle(options: DatabaseLifecycleOptions): DatabaseLifecycle {
  let activePool: PostgresPoolLike | undefined
  let connected = false

  const poolFactory = options.poolFactory ?? createPostgresPool
  const prismaConnector = options.prismaConnector ?? connectPrisma
  const prismaDisconnector = options.prismaDisconnector ?? (() => disconnectPrisma())
  const closePool = options.closePool ?? closePostgresPool
  const schemaChecker = options.schemaChecker ?? checkPostgresSchema

  return {
    async connect() {
      if (connected) return

      const result = await withBoundedDatabaseStartupRetry(
        async ({ registerResource }) => {
          const candidate = poolFactory(options.config.databaseUrl)
          registerResource(candidate)
          await candidate.query('SELECT 1')
          await prismaConnector(options.config.databaseUrl)
          const schema = await schemaChecker(candidate)
          if (!schema.compatible) throw Object.assign(new Error('Required PostgreSQL schema is incompatible'), { missingTables: schema.missing })
          return candidate
        },
        {
          attemptTimeoutMs: Math.min(options.config.dbAttemptTimeoutMs, DATABASE_ATTEMPT_TIMEOUT_MS),
          backoffMs: 250,
          sleep: options.sleep,
          onAttemptFailure: async () => {
            await prismaDisconnector()
          },
        },
      )

      activePool = result.value
      connected = true
    },
    async checkSchema() {
      if (!activePool) return incompatibleSchema('database-not-connected')
      return schemaChecker(activePool)
    },
    async close() {
      if (!activePool && !connected) {
        await prismaDisconnector()
        return
      }

      connected = false
      const poolToClose = activePool
      activePool = undefined
      try {
        await prismaDisconnector()
      } finally {
        await closePool(poolToClose)
      }
    },
  }
}

export async function checkPostgresSchema(
  pool: PostgresPoolLike,
  requiredTables: readonly string[] = REQUIRED_API_SCHEMA_TABLES,
): Promise<SchemaReadiness> {
  try {
    const result = await pool.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])',
      ['public', requiredTables],
    )
    const present = new Set((result.rows ?? []).map((row) => String(row['table_name'] ?? '')))
    const missing = requiredTables.filter((table) => !present.has(table))
    return missing.length === 0
      ? { compatible: true, activation: 'active', missing: [], migration: 'forward-only' }
      : incompleteSchema(missing)
  } catch {
    return incompleteSchema(['schema-check-failed'])
  }
}

function incompatibleSchema(reason: string): SchemaReadiness {
  return {
    compatible: false,
    activation: reason === 'database-not-connected' ? 'unverified' : 'incompatible',
    missing: [reason],
    migration: 'unverified',
  }
}

export function incompleteSchema(missing: readonly string[]): SchemaReadiness {
  return {
    compatible: false,
    activation: 'incomplete-schema',
    missing: [...missing],
    migration: 'unverified',
  }
}

export { DATABASE_ATTEMPT_TIMEOUT_MS, DATABASE_MAX_ATTEMPTS }
