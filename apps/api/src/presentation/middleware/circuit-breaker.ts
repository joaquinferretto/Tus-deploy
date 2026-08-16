import CircuitBreaker from 'opossum'
import { Request, Response, NextFunction } from 'express'

interface CircuitBreakerOptions {
  timeout: number // Time in ms before timing out
  errorThresholdPercentage: number // % of failures before opening circuit
  resetTimeout: number // Time in ms before attempting to close circuit
}

const defaultOptions: CircuitBreakerOptions = {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
}

export function createCircuitBreaker<T>(
  asyncFunction: (...args: any[]) => Promise<T>,
  options: Partial<CircuitBreakerOptions> = {}
): CircuitBreaker<any[], T> {
  const breaker = new CircuitBreaker(asyncFunction, {
    ...defaultOptions,
    ...options,
  })

  breaker.on('open', () => {
    console.warn('[Circuit Breaker] Circuit opened - too many failures')
  })

  breaker.on('halfOpen', () => {
    console.info('[Circuit Breaker] Circuit half-open - testing service')
  })

  breaker.on('close', () => {
    console.info('[Circuit Breaker] Circuit closed - service recovered')
  })

  return breaker
}

export function circuitBreakerMiddleware(
  asyncFunction: (req: Request, res: Response) => Promise<void>,
  options?: Partial<CircuitBreakerOptions>
) {
  const breaker = createCircuitBreaker(asyncFunction, options)

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await breaker.fire(req, res)
    } catch (error) {
      if (breaker.opened) {
        res.status(503).json({ error: 'Service temporarily unavailable' })
      } else {
        next(error)
      }
    }
  }
}
