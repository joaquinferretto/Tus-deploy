import type { SessionRevocationPort, SessionRevocationSnapshot } from '../ports/refresh-rotation.js'

export class InMemorySessionRevocation implements SessionRevocationPort {
  readonly revoked: SessionRevocationSnapshot[] = []

  async revokeDeviceSessions(
    accountId: string,
    deviceId: string,
    revokedAt: number
  ): Promise<void> {
    const alreadyRevoked = this.revoked.some(
      (entry) => entry.accountId === accountId && entry.deviceId === deviceId
    )
    if (!alreadyRevoked) this.revoked.push({ accountId, deviceId, revokedAt })
  }

  snapshot(): SessionRevocationSnapshot[] {
    return this.revoked.map((entry) => ({ ...entry }))
  }

  restore(snapshot: SessionRevocationSnapshot[]): void {
    this.revoked.splice(0, this.revoked.length, ...snapshot.map((entry) => ({ ...entry })))
  }
}
