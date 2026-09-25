-- Forward-only repair for the missing delivery/POS indexes and constraints.
-- The launch baseline and its ledger marker are prerequisites; historical
-- migrations are never replayed and existing rows are never rewritten.

CREATE INDEX IF NOT EXISTS "TusDeliveryZone_tenantId_active_idx"
  ON "TusDeliveryZone" ("tenantId", "active");
CREATE INDEX IF NOT EXISTS "TusDeliveryShift_tenantId_zoneId_status_idx"
  ON "TusDeliveryShift" ("tenantId", "zoneId", "status");
CREATE INDEX IF NOT EXISTS "TusDeliveryTask_tenantId_commitmentId_idx"
  ON "TusDeliveryTask" ("tenantId", "commitmentId");
CREATE INDEX IF NOT EXISTS "TusDeliveryTask_tenantId_shiftId_status_idx"
  ON "TusDeliveryTask" ("tenantId", "shiftId", "status");
CREATE INDEX IF NOT EXISTS "TusDeliveryTask_tenantId_commitmentId_status_idx"
  ON "TusDeliveryTask" ("tenantId", "commitmentId", "status");
CREATE INDEX IF NOT EXISTS "TusDeliveryProof_tenantId_taskId_idx"
  ON "TusDeliveryProof" ("tenantId", "taskId");
CREATE INDEX IF NOT EXISTS "TusDeliveryIncident_tenantId_taskId_status_idx"
  ON "TusDeliveryIncident" ("tenantId", "taskId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "TusDeliveryAudit_tenantId_auditId_key"
  ON "TusDeliveryAudit" ("tenantId", "auditId");
CREATE INDEX IF NOT EXISTS "TusDeliveryAudit_tenantId_createdAt_idx"
  ON "TusDeliveryAudit" ("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "TusPosOperation_tenantId_shiftId_createdAt_idx"
  ON "TusPosOperation" ("tenantId", "shiftId", "createdAt");
CREATE INDEX IF NOT EXISTS "TusPosOperation_tenantId_context_kind_idx"
  ON "TusPosOperation" ("tenantId", "context", "kind");
CREATE INDEX IF NOT EXISTS "TusPosReceipt_tenantId_operationId_idx"
  ON "TusPosReceipt" ("tenantId", "operationId");
CREATE INDEX IF NOT EXISTS "TusPosReceipt_tenantId_operationId_createdAt_idx"
  ON "TusPosReceipt" ("tenantId", "operationId", "createdAt");
CREATE INDEX IF NOT EXISTS "TusPosDevice_tenantId_status_idx"
  ON "TusPosDevice" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "TusPosSession_tenantId_deviceId_shiftId_status_idx"
  ON "TusPosSession" ("tenantId", "deviceId", "shiftId", "status");
CREATE INDEX IF NOT EXISTS "TusPosConflict_tenantId_operationId_status_idx"
  ON "TusPosConflict" ("tenantId", "operationId", "status");
CREATE INDEX IF NOT EXISTS "TusPosConflict_tenantId_status_createdAt_idx"
  ON "TusPosConflict" ("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "TusPosVersion_tenantId_shiftId_version_idx"
  ON "TusPosVersion" ("tenantId", "shiftId", "version");
CREATE INDEX IF NOT EXISTS "TusDeliveryOutbox_tenantId_status_createdAt_idx"
  ON "TusDeliveryOutbox" ("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "TusPosOutbox_tenantId_status_createdAt_idx"
  ON "TusPosOutbox" ("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "TusPosOutbox_tenantId_aggregateId_status_idx"
  ON "TusPosOutbox" ("tenantId", "aggregateId", "status");
CREATE INDEX IF NOT EXISTS "TusPosAudit_tenantId_operationId_createdAt_idx"
  ON "TusPosAudit" ("tenantId", "operationId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'TusPosConflict'
      AND con.conname = 'TusPosConflict_tenant_operation_fk'
  ) THEN
    ALTER TABLE "TusPosConflict"
      ADD CONSTRAINT "TusPosConflict_tenant_operation_fk"
      FOREIGN KEY ("tenantId", "operationId")
      REFERENCES "TusPosOperation" ("tenantId", "operationId") NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'TusPosOperation'
      AND con.conname = 'TusPosOperation_amount_non_negative_check'
  ) THEN
    ALTER TABLE "TusPosOperation"
      ADD CONSTRAINT "TusPosOperation_amount_non_negative_check"
      CHECK ("amount" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'TusPosVersion'
      AND con.conname = 'TusPosVersion_version_non_negative_check'
  ) THEN
    ALTER TABLE "TusPosVersion"
      ADD CONSTRAINT "TusPosVersion_version_non_negative_check"
      CHECK ("version" >= 0);
  END IF;
END $$;

INSERT INTO "_prisma_migrations" (
  "id", "checksum", "finished_at", "migration_name", "logs",
  "rolled_back_at", "started_at", "applied_steps_count"
)
SELECT
  'tus-pos-index-constraint-repair-marker',
  'pos-index-constraint-repair-checksum',
  CURRENT_TIMESTAMP,
  '20260911120000_tus_pos_index_constraint_repair',
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  1
WHERE NOT EXISTS (
  SELECT 1
  FROM "_prisma_migrations"
  WHERE "migration_name" = '20260911120000_tus_pos_index_constraint_repair'
);
