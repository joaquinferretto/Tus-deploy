import { Pool } from 'pg'
import type { PoolConfig } from 'pg'

let pool: Pool

function createPool(): Pool {
  const config: PoolConfig = {
    connectionString: process.env['DATABASE_URL'],
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  }

  return new Pool(config)
}

export function getPostgresPool(): Pool {
  if (!pool) {
    pool = createPool()

    pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err)
    })
  }
  return pool
}

export async function checkPostgres(): Promise<boolean> {
  try {
    const pool = getPostgresPool()
    const result = await pool.query('SELECT 1')
    return result.rowCount === 1
  } catch (error) {
    console.error('PostgreSQL health check failed:', error)
    return false
  }
}

export async function closePostgresPool(): Promise<void> {
  if (pool) {
    await pool.end()
  }
}
