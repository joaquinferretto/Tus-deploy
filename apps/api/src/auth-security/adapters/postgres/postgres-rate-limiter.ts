import { createHash } from 'node:crypto'
import type { RateLimiter } from '../../ports/security.js'

// Fixed-window limiter in PostgreSQL (table auth_rate_limits): survives restarts and is shared by
// every API process. One atomic upsert per attempt. Keys are stored as sha256 (no email in clear).
export interface RawQueryClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

const UPSERT = `
INSERT INTO public."auth_rate_limits" ("key", "window_started_at", "attempts", "updated_at")
VALUES ($1, $2, 1, $2)
ON CONFLICT ("key") DO UPDATE SET
  "attempts" = CASE WHEN public."auth_rate_limits"."window_started_at" <= $3 THEN 1 ELSE public."auth_rate_limits"."attempts" + 1 END,
  "window_started_at" = CASE WHEN public."auth_rate_limits"."window_started_at" <= $3 THEN EXCLUDED."window_started_at" ELSE public."auth_rate_limits"."window_started_at" END,
  "updated_at" = EXCLUDED."updated_at"
RETURNING "attempts"`

export class PostgresRateLimiter implements RateLimiter {
  constructor(
    private readonly client: RawQueryClient,
    private readonly scope: string,
    private readonly maxAttempts: number,
    private readonly windowMs: number
  ) {}

  async allow(key: string, now: number): Promise<boolean> {
    const digest = `${this.scope}:${createHash('sha256').update(key).digest('hex')}`
    const rows = await this.client.$queryRawUnsafe<{ attempts: number | bigint }[]>(UPSERT, digest, new Date(now), new Date(now - this.windowMs))
    const attempts = Number(rows[0]?.attempts ?? Number.POSITIVE_INFINITY)
    // Housekeeping: rarely drop windows idle for more than a day.
    if (Math.random() < 0.01)
      await this.client.$queryRawUnsafe(`DELETE FROM public."auth_rate_limits" WHERE "updated_at" < $1 RETURNING 1`, new Date(now - 86_400_000)).catch(() => undefined)
    return attempts <= this.maxAttempts
  }
}
