-- TUS Product Hardening: additive integrity and tenant access paths.
-- Existing rows remain authoritative; this migration only adds checks/indexes.

CREATE INDEX IF NOT EXISTS "TusPosOperation_tenantId_idempotencyKey_idx"
  ON "TusPosOperation" ("tenantId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "TusPosOperation_tenantId_context_kind_idx"
  ON "TusPosOperation" ("tenantId", "context", "kind");
CREATE INDEX IF NOT EXISTS "TusPosReceipt_tenantId_operationId_createdAt_idx"
  ON "TusPosReceipt" ("tenantId", "operationId", "createdAt");
CREATE INDEX IF NOT EXISTS "TusPosOutbox_tenantId_status_createdAt_idx"
  ON "TusPosOutbox" ("tenantId", "status", "createdAt");
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
