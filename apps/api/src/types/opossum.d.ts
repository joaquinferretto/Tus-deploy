declare module 'opossum' {
  interface CircuitBreakerOptions {
    timeout?: number
    errorThresholdPercentage?: number
    resetTimeout?: number
    [key: string]: unknown
  }

  class CircuitBreaker<TArgs extends unknown[] = unknown[], TResult = unknown> {
    constructor(action: (...args: TArgs) => Promise<TResult>, options?: CircuitBreakerOptions)
    readonly opened: boolean
    fire(...args: TArgs): Promise<TResult>
    on(event: string, listener: (...args: unknown[]) => void): this
  }

  export default CircuitBreaker
}
