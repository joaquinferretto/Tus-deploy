CREATE TABLE "TusDeliveryZone" (
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
CREATE UNIQUE INDEX "TusDeliveryZone_tenantId_zoneId_key" ON "TusDeliveryZone"("tenantId", "zoneId");
CREATE INDEX "TusDeliveryZone_tenantId_active_idx" ON "TusDeliveryZone"("tenantId", "active");

CREATE TABLE "TusDeliveryShift" (
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
CREATE UNIQUE INDEX "TusDeliveryShift_tenantId_shiftId_key" ON "TusDeliveryShift"("tenantId", "shiftId");
CREATE INDEX "TusDeliveryShift_tenantId_zoneId_status_idx" ON "TusDeliveryShift"("tenantId", "zoneId", "status");

CREATE TABLE "TusDeliveryTask" (
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
CREATE UNIQUE INDEX "TusDeliveryTask_tenantId_taskId_key" ON "TusDeliveryTask"("tenantId", "taskId");
CREATE INDEX "TusDeliveryTask_tenantId_commitmentId_idx" ON "TusDeliveryTask"("tenantId", "commitmentId");
CREATE INDEX "TusDeliveryTask_tenantId_shiftId_status_idx" ON "TusDeliveryTask"("tenantId", "shiftId", "status");

CREATE TABLE "TusDeliveryProof" (
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
CREATE UNIQUE INDEX "TusDeliveryProof_tenantId_proofId_key" ON "TusDeliveryProof"("tenantId", "proofId");
CREATE INDEX "TusDeliveryProof_tenantId_taskId_idx" ON "TusDeliveryProof"("tenantId", "taskId");

CREATE TABLE "TusDeliveryIncident" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusDeliveryIncident_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusDeliveryIncident_tenantId_incidentId_key" ON "TusDeliveryIncident"("tenantId", "incidentId");
CREATE INDEX "TusDeliveryIncident_tenantId_taskId_status_idx" ON "TusDeliveryIncident"("tenantId", "taskId", "status");

CREATE TABLE "TusDeliveryAudit" (
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
CREATE UNIQUE INDEX "TusDeliveryAudit_tenantId_auditId_key" ON "TusDeliveryAudit"("tenantId", "auditId");
CREATE INDEX "TusDeliveryAudit_tenantId_createdAt_idx" ON "TusDeliveryAudit"("tenantId", "createdAt");

CREATE TABLE "TusPosOperation" (
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
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL,
  "response" JSONB,
  CONSTRAINT "TusPosOperation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusPosOperation_tenantId_operationId_key" ON "TusPosOperation"("tenantId", "operationId");
CREATE UNIQUE INDEX "TusPosOperation_tenantId_idempotencyKey_key" ON "TusPosOperation"("tenantId", "idempotencyKey");
CREATE INDEX "TusPosOperation_tenantId_shiftId_createdAt_idx" ON "TusPosOperation"("tenantId", "shiftId", "createdAt");

CREATE TABLE "TusPosReceipt" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "providerCapture" TEXT NOT NULL,
  "settlement" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusPosReceipt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusPosReceipt_tenantId_receiptId_key" ON "TusPosReceipt"("tenantId", "receiptId");
CREATE INDEX "TusPosReceipt_tenantId_operationId_idx" ON "TusPosReceipt"("tenantId", "operationId");

CREATE TABLE "TusPosAudit" (
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
CREATE UNIQUE INDEX "TusPosAudit_tenantId_auditId_key" ON "TusPosAudit"("tenantId", "auditId");
CREATE INDEX "TusPosAudit_tenantId_operationId_createdAt_idx" ON "TusPosAudit"("tenantId", "operationId", "createdAt");
