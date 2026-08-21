import { createContextMiddleware } from '@factory/observability'

export const correlationMiddleware = createContextMiddleware({
  telemetry: {
    logger: { emit: () => undefined },
    metrics: { increment: () => undefined },
    tracer: { startSpan: () => ({ setStatus: () => undefined, end: () => undefined }) },
  },
})
