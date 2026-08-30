CREATE TABLE "RefreshTokenFamily" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "currentTokenDigest" TEXT NOT NULL,
    "usedTokenDigests" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "generation" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "compromisedAt" TIMESTAMP(3),
    "lastRotationIdempotencyKey" TEXT,
    "lastPresentedTokenDigest" TEXT,
    "lastReplacementAccessTokenDigest" TEXT,
    CONSTRAINT "RefreshTokenFamily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefreshTokenFamily_currentTokenDigest_key"
  ON "RefreshTokenFamily"("currentTokenDigest");
CREATE INDEX "RefreshTokenFamily_accountId_deviceId_idx"
  ON "RefreshTokenFamily"("accountId", "deviceId");
CREATE INDEX "RefreshTokenFamily_expiresAt_revokedAt_idx"
  ON "RefreshTokenFamily"("expiresAt", "revokedAt");

ALTER TABLE "RefreshTokenFamily" ADD CONSTRAINT "RefreshTokenFamily_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
