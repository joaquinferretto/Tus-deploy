CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "finished_at" TIMESTAMP(3),
  "migration_name" TEXT NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TusDeliveryZone" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "postalCodes" TEXT[] NOT NULL,
  "active" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusDeliveryZone_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "TusDeliveryShift" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "operatorIds" TEXT[] NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusDeliveryShift_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "TusDeliveryTask" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "operatorId" TEXT,
  "status" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "proof" JSONB,
  "incident" JSONB,
  "settlementClaim" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusDeliveryTask_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "TusDeliveryProof" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "proofId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "recipientName" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "evidenceSource" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusDeliveryProof_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "TusDeliveryIncident" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusDeliveryIncident_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "TusDeliveryAudit" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "auditId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusDeliveryAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TusPosOperation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "expectedVersion" INTEGER,
  "kind" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "response" JSONB,
  CONSTRAINT "TusPosOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TusPosOperation_currency_iso_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "TusPosOperation_amount_non_negative_check" CHECK ("amount" >= 0)
);
CREATE TABLE IF NOT EXISTS "TusPosReceipt" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "providerCapture" TEXT NOT NULL,
  "settlement" TEXT NOT NULL,
  "integrityHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusPosReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TusPosReceipt_currency_iso_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "TusPosReceipt_amount_non_negative_check" CHECK ("amount" >= 0)
);
CREATE TABLE IF NOT EXISTS "TusPosDevice" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusPosDevice_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "TusPosSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "TusPosSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "TusPosConflict" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conflictId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "expectedVersion" INTEGER,
  "actualVersion" INTEGER,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusPosConflict_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "TusPosVersion" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusPosVersion_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "TusDeliveryOutbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL DEFAULT 'legacy',
  "eventType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusDeliveryOutbox_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "TusPosOutbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "claimId" TEXT,
  "claimUntil" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusPosOutbox_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "TusPosAudit" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "auditId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusPosAudit_pkey" PRIMARY KEY ("id")
);
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

CREATE UNIQUE INDEX IF NOT EXISTS "TusDeliveryZone_tenantId_zoneId_key" ON "TusDeliveryZone" ("tenantId", "zoneId");
CREATE INDEX IF NOT EXISTS "TusDeliveryZone_tenantId_active_idx" ON "TusDeliveryZone" ("tenantId", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "TusDeliveryShift_tenantId_shiftId_key" ON "TusDeliveryShift" ("tenantId", "shiftId");
CREATE INDEX IF NOT EXISTS "TusDeliveryShift_tenantId_zoneId_status_idx" ON "TusDeliveryShift" ("tenantId", "zoneId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "TusDeliveryTask_tenantId_taskId_key" ON "TusDeliveryTask" ("tenantId", "taskId");
CREATE INDEX IF NOT EXISTS "TusDeliveryTask_tenantId_commitmentId_idx" ON "TusDeliveryTask" ("tenantId", "commitmentId");
CREATE INDEX IF NOT EXISTS "TusDeliveryTask_tenantId_shiftId_status_idx" ON "TusDeliveryTask" ("tenantId", "shiftId", "status");
CREATE INDEX IF NOT EXISTS "TusDeliveryTask_tenantId_commitmentId_status_idx" ON "TusDeliveryTask" ("tenantId", "commitmentId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "TusDeliveryProof_tenantId_proofId_key" ON "TusDeliveryProof" ("tenantId", "proofId");
CREATE INDEX IF NOT EXISTS "TusDeliveryProof_tenantId_taskId_idx" ON "TusDeliveryProof" ("tenantId", "taskId");
CREATE UNIQUE INDEX IF NOT EXISTS "TusDeliveryIncident_tenantId_incidentId_key" ON "TusDeliveryIncident" ("tenantId", "incidentId");
CREATE INDEX IF NOT EXISTS "TusDeliveryIncident_tenantId_taskId_status_idx" ON "TusDeliveryIncident" ("tenantId", "taskId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "TusDeliveryAudit_tenantId_auditId_key" ON "TusDeliveryAudit" ("tenantId", "auditId");
CREATE INDEX IF NOT EXISTS "TusDeliveryAudit_tenantId_createdAt_idx" ON "TusDeliveryAudit" ("tenantId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TusPosOperation_tenantId_operationId_key" ON "TusPosOperation" ("tenantId", "operationId");
CREATE UNIQUE INDEX IF NOT EXISTS "TusPosOperation_tenantId_idempotencyKey_key" ON "TusPosOperation" ("tenantId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "TusPosOperation_tenantId_shiftId_createdAt_idx" ON "TusPosOperation" ("tenantId", "shiftId", "createdAt");
CREATE INDEX IF NOT EXISTS "TusPosOperation_tenantId_context_kind_idx" ON "TusPosOperation" ("tenantId", "context", "kind");
CREATE UNIQUE INDEX IF NOT EXISTS "TusPosReceipt_tenantId_receiptId_key" ON "TusPosReceipt" ("tenantId", "receiptId");
CREATE INDEX IF NOT EXISTS "TusPosReceipt_tenantId_operationId_idx" ON "TusPosReceipt" ("tenantId", "operationId");
CREATE INDEX IF NOT EXISTS "TusPosReceipt_tenantId_operationId_createdAt_idx" ON "TusPosReceipt" ("tenantId", "operationId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TusPosDevice_tenantId_deviceId_key" ON "TusPosDevice" ("tenantId", "deviceId");
CREATE INDEX IF NOT EXISTS "TusPosDevice_tenantId_status_idx" ON "TusPosDevice" ("tenantId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "TusPosSession_tenantId_sessionId_key" ON "TusPosSession" ("tenantId", "sessionId");
CREATE INDEX IF NOT EXISTS "TusPosSession_tenantId_deviceId_shiftId_status_idx" ON "TusPosSession" ("tenantId", "deviceId", "shiftId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "TusPosConflict_tenantId_conflictId_key" ON "TusPosConflict" ("tenantId", "conflictId");
CREATE INDEX IF NOT EXISTS "TusPosConflict_tenantId_operationId_status_idx" ON "TusPosConflict" ("tenantId", "operationId", "status");
CREATE INDEX IF NOT EXISTS "TusPosConflict_tenantId_status_createdAt_idx" ON "TusPosConflict" ("tenantId", "status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TusPosVersion_tenantId_shiftId_key" ON "TusPosVersion" ("tenantId", "shiftId");
CREATE INDEX IF NOT EXISTS "TusPosVersion_tenantId_shiftId_version_idx" ON "TusPosVersion" ("tenantId", "shiftId", "version");
CREATE UNIQUE INDEX IF NOT EXISTS "TusDeliveryOutbox_tenantId_eventId_key" ON "TusDeliveryOutbox" ("tenantId", "eventId");
CREATE INDEX IF NOT EXISTS "TusDeliveryOutbox_tenantId_status_createdAt_idx" ON "TusDeliveryOutbox" ("tenantId", "status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TusPosOutbox_tenantId_eventId_key" ON "TusPosOutbox" ("tenantId", "eventId");
CREATE INDEX IF NOT EXISTS "TusPosOutbox_tenantId_status_createdAt_idx" ON "TusPosOutbox" ("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "TusPosOutbox_tenantId_aggregateId_status_idx" ON "TusPosOutbox" ("tenantId", "aggregateId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "TusPosAudit_tenantId_auditId_key" ON "TusPosAudit" ("tenantId", "auditId");
CREATE INDEX IF NOT EXISTS "TusPosAudit_tenantId_operationId_createdAt_idx" ON "TusPosAudit" ("tenantId", "operationId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "TusHardeningFixture_tag_version_runId_key" ON "TusHardeningFixture" ("tag", "version", "runId");
CREATE INDEX IF NOT EXISTS "TusHardeningFixture_tenantId_idx" ON "TusHardeningFixture" ("tenantId");
CREATE INDEX IF NOT EXISTS "TusHardeningFixture_tenantId_tag_version_idx" ON "TusHardeningFixture" ("tenantId", "tag", "version");

DO $$
BEGIN
  ALTER TABLE "TusDeliveryShift" ADD CONSTRAINT "TusDeliveryShift_tenant_zone_fk"
    FOREIGN KEY ("tenantId", "zoneId") REFERENCES "TusDeliveryZone" ("tenantId", "zoneId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE "TusDeliveryTask" ADD CONSTRAINT "TusDeliveryTask_tenant_shift_fk"
    FOREIGN KEY ("tenantId", "shiftId") REFERENCES "TusDeliveryShift" ("tenantId", "shiftId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE "TusDeliveryProof" ADD CONSTRAINT "TusDeliveryProof_tenant_task_fk"
    FOREIGN KEY ("tenantId", "taskId") REFERENCES "TusDeliveryTask" ("tenantId", "taskId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE "TusDeliveryIncident" ADD CONSTRAINT "TusDeliveryIncident_tenant_task_fk"
    FOREIGN KEY ("tenantId", "taskId") REFERENCES "TusDeliveryTask" ("tenantId", "taskId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE "TusPosSession" ADD CONSTRAINT "TusPosSession_tenant_device_fk"
    FOREIGN KEY ("tenantId", "deviceId") REFERENCES "TusPosDevice" ("tenantId", "deviceId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE "TusPosReceipt" ADD CONSTRAINT "TusPosReceipt_tenant_operation_fk"
    FOREIGN KEY ("tenantId", "operationId") REFERENCES "TusPosOperation" ("tenantId", "operationId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE "TusPosConflict" ADD CONSTRAINT "TusPosConflict_tenant_operation_fk"
    FOREIGN KEY ("tenantId", "operationId") REFERENCES "TusPosOperation" ("tenantId", "operationId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE "TusPosVersion" ADD CONSTRAINT "TusPosVersion_version_non_negative_check" CHECK ("version" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
SELECT 'tus-additive-repair-marker', 'repair-migration-checksum', CURRENT_TIMESTAMP, '20260831180000_tus_additive_migration_repair', NULL, NULL, CURRENT_TIMESTAMP, 1
WHERE NOT EXISTS (
  SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20260831180000_tus_additive_migration_repair'
);
