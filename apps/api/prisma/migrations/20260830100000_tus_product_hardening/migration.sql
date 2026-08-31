-- TUS Product Hardening: additive integrity and tenant access paths.
-- Existing rows remain authoritative; this migration only adds checks/indexes.

CREATE TABLE IF NOT EXISTS "TusHardeningFixture" (
  "id" TEXT NOT NULL,
  "tag" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "productListingId" TEXT NOT NULL,
  "serviceListingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusHardeningFixture_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TusHardeningFixture_tag_version_runId_key"
  ON "TusHardeningFixture" ("tag", "version", "runId");
CREATE INDEX IF NOT EXISTS "TusHardeningFixture_tenantId_idx"
  ON "TusHardeningFixture" ("tenantId");

CREATE INDEX IF NOT EXISTS "TusPosOperation_tenantId_idempotencyKey_idx"
  ON "TusPosOperation" ("tenantId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "TusPosOperation_tenantId_context_kind_idx"
  ON "TusPosOperation" ("tenantId", "context", "kind");
CREATE INDEX IF NOT EXISTS "TusPosReceipt_tenantId_operationId_createdAt_idx"
  ON "TusPosReceipt" ("tenantId", "operationId", "createdAt");
CREATE INDEX IF NOT EXISTS "TusPosOutbox_tenantId_status_createdAt_idx"
  ON "TusPosOutbox" ("tenantId", "status", "createdAt");
ALTER TABLE "TusPosOutbox" ADD COLUMN IF NOT EXISTS "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "TusPosOutbox" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "TusPosOutbox" ADD COLUMN IF NOT EXISTS "claimId" TEXT;
ALTER TABLE "TusPosOutbox" ADD COLUMN IF NOT EXISTS "claimUntil" TIMESTAMP(3);
ALTER TABLE "TusPosOutbox" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "TusPosOutbox_tenantId_status_availableAt_idx"
  ON "TusPosOutbox" ("tenantId", "status", "availableAt", "claimUntil");
CREATE INDEX IF NOT EXISTS "TusPosAudit_tenantId_operationId_createdAt_idx"
  ON "TusPosAudit" ("tenantId", "operationId", "createdAt");
CREATE INDEX IF NOT EXISTS "TusPosConflict_tenantId_status_createdAt_idx"
  ON "TusPosConflict" ("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "TusDeliveryTask_tenantId_commitmentId_status_idx"
  ON "TusDeliveryTask" ("tenantId", "commitmentId", "status");

DO $$
BEGIN
  ALTER TABLE "TusPosOperation"
    ADD CONSTRAINT "TusPosOperation_context_kind_check"
    CHECK (("kind" = 'manual-sale' AND "context" = 'product') OR ("kind" = 'manual-service' AND "context" = 'service'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TusPosOperation"
    ADD CONSTRAINT "TusPosOperation_amount_non_negative_check"
    CHECK ("amount" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TusPosVersion"
    ADD CONSTRAINT "TusPosVersion_version_non_negative_check"
    CHECK ("version" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TusPosReceipt"
    ADD CONSTRAINT "TusPosReceipt_provider_settlement_unclaimed_check"
    CHECK ("providerCapture" = 'not-claimed' AND "settlement" = 'not-claimed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TusPosOutbox"
    ADD CONSTRAINT "TusPosOutbox_status_check"
    CHECK ("status" IN ('pending', 'published', 'dead-letter') AND "attempts" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TusDeliveryTask"
    ADD CONSTRAINT "TusDeliveryTask_settlement_claim_check"
    CHECK ("settlementClaim" = 'not-claimed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tenant-scoped foreign keys are installed NOT VALID so existing data is not
-- rewritten; the smoke preflight reports historical orphans before validation.
DO $$
BEGIN
  ALTER TABLE "TusDeliveryShift"
    ADD CONSTRAINT "TusDeliveryShift_tenant_zone_fk"
    FOREIGN KEY ("tenantId", "zoneId") REFERENCES "TusDeliveryZone" ("tenantId", "zoneId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TusDeliveryTask"
    ADD CONSTRAINT "TusDeliveryTask_tenant_shift_fk"
    FOREIGN KEY ("tenantId", "shiftId") REFERENCES "TusDeliveryShift" ("tenantId", "shiftId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TusDeliveryProof"
    ADD CONSTRAINT "TusDeliveryProof_tenant_task_fk"
    FOREIGN KEY ("tenantId", "taskId") REFERENCES "TusDeliveryTask" ("tenantId", "taskId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TusDeliveryIncident"
    ADD CONSTRAINT "TusDeliveryIncident_tenant_task_fk"
    FOREIGN KEY ("tenantId", "taskId") REFERENCES "TusDeliveryTask" ("tenantId", "taskId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TusPosSession"
    ADD CONSTRAINT "TusPosSession_tenant_device_fk"
    FOREIGN KEY ("tenantId", "deviceId") REFERENCES "TusPosDevice" ("tenantId", "deviceId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TusPosReceipt"
    ADD CONSTRAINT "TusPosReceipt_tenant_operation_fk"
    FOREIGN KEY ("tenantId", "operationId") REFERENCES "TusPosOperation" ("tenantId", "operationId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "TusPosConflict"
    ADD CONSTRAINT "TusPosConflict_tenant_operation_fk"
    FOREIGN KEY ("tenantId", "operationId") REFERENCES "TusPosOperation" ("tenantId", "operationId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
