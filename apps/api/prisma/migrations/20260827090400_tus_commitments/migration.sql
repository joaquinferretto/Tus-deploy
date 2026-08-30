-- TUS PR5 durable commitment lifecycle.
-- Expand-only: status history and compensation are append-only; rollback disables
-- consumers and preserves commitments, audit, outbox, and compensation evidence.
ALTER TABLE "TusCommitment"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "TusAuditReference"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE TABLE IF NOT EXISTS "TusCommitmentTransition" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "fromStatus" TEXT NOT NULL,
  "toStatus" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusCommitmentTransition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TusCommitmentTransition_tenantId_commitmentId_version_key"
  ON "TusCommitmentTransition"("tenantId", "commitmentId", "version");
CREATE INDEX IF NOT EXISTS "TusCommitmentTransition_tenantId_commitmentId_createdAt_idx"
  ON "TusCommitmentTransition"("tenantId", "commitmentId", "createdAt");

CREATE TABLE IF NOT EXISTS "TusCommitmentCompensation" (
  "id" TEXT NOT NULL,
  "compensationId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusCommitmentCompensation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TusCommitmentCompensation_tenantId_compensationId_key"
  ON "TusCommitmentCompensation"("tenantId", "compensationId");
CREATE UNIQUE INDEX IF NOT EXISTS "TusCommitmentCompensation_tenantId_commitmentId_key"
  ON "TusCommitmentCompensation"("tenantId", "commitmentId");
CREATE INDEX IF NOT EXISTS "TusCommitmentCompensation_tenantId_commitmentId_createdAt_idx"
  ON "TusCommitmentCompensation"("tenantId", "commitmentId", "createdAt");

CREATE INDEX IF NOT EXISTS "OutboxEvent_tus_commitment_recovery_idx"
  ON "OutboxEvent"("tenantId", "status", "availableAt", "claimUntil");

-- Rollback boundary: stop commitment lifecycle consumers and quarantine pending
-- outbox work; never delete or rewrite aggregate, audit, transition, or
-- compensation history.
