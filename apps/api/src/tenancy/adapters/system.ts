import type { TenancyClock } from '../ports.js'

export class SystemTenancyClock implements TenancyClock {
  now(): number {
    return Date.now()
  }
}
