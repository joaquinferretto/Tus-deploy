-- PR7 expands the provider-free operational boundary without rewriting prior records.
ALTER TABLE "TusPosReceipt"
  ADD COLUMN IF NOT EXISTS "integrityHash" TEXT NOT NULL DEFAULT '';

CREATE TABLE "TusPosDevice" (
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
CREATE UNIQUE INDEX "TusPosDevice_tenantId_deviceId_key" ON "TusPosDevice"("tenantId", "deviceId");
CREATE INDEX "TusPosDevice_tenantId_status_idx" ON "TusPosDevice"("tenantId", "status");

CREATE TABLE "TusPosSession" (
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
CREATE UNIQUE INDEX "TusPosSession_tenantId_sessionId_key" ON "TusPosSession"("tenantId", "sessionId");
CREATE INDEX "TusPosSession_tenantId_deviceId_shiftId_status_idx" ON "TusPosSession"("tenantId", "deviceId", "shiftId", "status");

CREATE TABLE "TusPosConflict" (
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
CREATE UNIQUE INDEX "TusPosConflict_tenantId_conflictId_key" ON "TusPosConflict"("tenantId", "conflictId");
CREATE INDEX "TusPosConflict_tenantId_operationId_status_idx" ON "TusPosConflict"("tenantId", "operationId", "status");

CREATE TABLE "TusDeliveryOutbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusDeliveryOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusDeliveryOutbox_tenantId_eventId_key" ON "TusDeliveryOutbox"("tenantId", "eventId");
CREATE INDEX "TusDeliveryOutbox_tenantId_status_createdAt_idx" ON "TusDeliveryOutbox"("tenantId", "status", "createdAt");

CREATE TABLE "TusPosOutbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusPosOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusPosOutbox_tenantId_eventId_key" ON "TusPosOutbox"("tenantId", "eventId");
CREATE INDEX "TusPosOutbox_tenantId_status_createdAt_idx" ON "TusPosOutbox"("tenantId", "status", "createdAt");
