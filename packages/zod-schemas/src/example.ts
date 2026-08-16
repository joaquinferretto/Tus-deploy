import { z } from 'zod'

/**
 * Example schema structure - NOT dummy business logic.
 * This demonstrates the pattern for E2E type safety between frontend and backend.
 */
export const exampleSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export type Example = z.infer<typeof exampleSchema>

// Health check response schema
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  timestamp: z.string().datetime(),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

// Ready check response schema
export const readyResponseSchema = z.object({
  ready: z.boolean(),
  checks: z.object({
    postgres: z.boolean(),
    mongodb: z.boolean(),
    redis: z.boolean(),
  }),
  timestamp: z.string().datetime(),
})

export type ReadyResponse = z.infer<typeof readyResponseSchema>
