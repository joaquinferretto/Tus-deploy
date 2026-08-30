-- Expand the existing readiness records without deleting evidence or decisions.
ALTER TABLE "TusReadinessEvidence"
  ADD COLUMN "issuedAt" TIMESTAMP(3);

UPDATE "TusReadinessEvidence"
SET "issuedAt" = "createdAt"
WHERE "issuedAt" IS NULL;

ALTER TABLE "TusReadinessEvidence"
  ALTER COLUMN "issuedAt" SET NOT NULL;

UPDATE "TusReadinessEvidence"
SET "source" = 'authorized-external'
WHERE "source" = 'authorized';

UPDATE "TusReadinessEvidence"
SET "source" = 'local-deterministic'
WHERE "source" = 'deterministic-test-only';

ALTER TABLE "TusReadinessDecision"
  ADD COLUMN "conflicts" JSONB;

-- Rollback disables affected gates and preserves these append-only records.
