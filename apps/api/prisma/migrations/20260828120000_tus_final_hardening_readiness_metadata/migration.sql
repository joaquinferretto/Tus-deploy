-- Preserve canonical readiness evidence while adding runtime decision attribution.
ALTER TABLE "TusReadinessEvidence"
  ADD COLUMN IF NOT EXISTS "contractVersion" TEXT NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS "profile" TEXT NOT NULL DEFAULT 'legacy-unscoped',
  ADD COLUMN IF NOT EXISTS "execution" TEXT NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS "evidenceClass" TEXT NOT NULL DEFAULT 'deferred',
  ADD COLUMN IF NOT EXISTS "liveConformance" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "TusReadinessDecision"
  ADD COLUMN IF NOT EXISTS "actorId" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS "jobId" TEXT,
  ADD COLUMN IF NOT EXISTS "correlationId" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS "profile" TEXT NOT NULL DEFAULT 'legacy-unscoped',
  ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS "outcome" TEXT NOT NULL DEFAULT 'blocked';

UPDATE "TusReadinessDecision"
SET "outcome" = CASE WHEN "enabled" = TRUE THEN 'authorized' ELSE 'blocked' END
WHERE "outcome" = 'blocked' AND "enabled" = TRUE;

CREATE INDEX IF NOT EXISTS "TusReadinessDecision_tenantId_correlationId_idx"
  ON "TusReadinessDecision" ("tenantId", "correlationId");

-- Rollback is additive: remove only the new columns and index after disabling runtime enforcement.
