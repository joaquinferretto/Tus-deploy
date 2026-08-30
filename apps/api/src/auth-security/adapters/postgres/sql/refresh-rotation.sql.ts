export const LOCK_REFRESH_FAMILY_SQL = `
SELECT "id", "accountId", "tenantId", "deviceId", "sessionId",
       "currentTokenDigest", "usedTokenDigests", "generation", "expiresAt",
       "revokedAt", "compromisedAt", "lastRotationIdempotencyKey",
       "lastPresentedTokenDigest", "lastReplacementAccessTokenDigest"
FROM "RefreshTokenFamily"
WHERE "currentTokenDigest" = $1
   OR $1 = ANY("usedTokenDigests")
FOR UPDATE
`

export const UPDATE_REFRESH_FAMILY_SQL = `
UPDATE "RefreshTokenFamily"
SET "currentTokenDigest" = $1,
    "usedTokenDigests" = array_append("usedTokenDigests", $2),
    "generation" = "generation" + 1,
    "updatedAt" = $3,
    "lastRotationIdempotencyKey" = $5,
    "lastPresentedTokenDigest" = $6,
    "lastReplacementAccessTokenDigest" = $7
WHERE "id" = $4
  AND "currentTokenDigest" = $2
  AND "revokedAt" IS NULL
RETURNING "id", "accountId", "tenantId", "deviceId", "sessionId", "generation"
`

export const REVOKE_REFRESH_FAMILY_SQL = `
UPDATE "RefreshTokenFamily"
SET "revokedAt" = $1, "compromisedAt" = $1, "updatedAt" = $1
WHERE "id" = $2 AND "revokedAt" IS NULL
`

export const REVOKE_DEVICE_SESSIONS_SQL = `
UPDATE "Session"
SET "revokedAt" = $1
WHERE "accountId" = $2 AND "deviceId" = $3 AND "revokedAt" IS NULL
`

export const APPEND_REFRESH_OUTBOX_EVENT_SQL = `
INSERT INTO "OutboxEvent" ("id", "eventType", "aggregateType", "aggregateId", "occurredAt", "payload")
VALUES ($1, $2, $3, $4, $5, $6)
`
