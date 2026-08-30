-- PR8 adds tenant-scoped support, governed-action, and reporting projections.
-- It is additive: disabling a capability preserves transcripts, evidence,
-- audit records, confirmations, and financial history.
CREATE TABLE "TusSupportCase" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "disputeId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "openedBy" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "outcome" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "TusSupportCase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusSupportCase_tenantId_caseId_key" ON "TusSupportCase"("tenantId", "caseId");
CREATE INDEX "TusSupportCase_tenantId_status_createdAt_idx" ON "TusSupportCase"("tenantId", "status", "createdAt");
CREATE INDEX "TusSupportCase_tenantId_commitmentId_idx" ON "TusSupportCase"("tenantId", "commitmentId");

CREATE TABLE "TusSupportEvidence" (
  "id" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "party" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "submittedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusSupportEvidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusSupportEvidence_tenantId_evidenceId_key" ON "TusSupportEvidence"("tenantId", "evidenceId");
CREATE INDEX "TusSupportEvidence_tenantId_caseId_party_idx" ON "TusSupportEvidence"("tenantId", "caseId", "party");

CREATE TABLE "TusSupportTimeline" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusSupportTimeline_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusSupportTimeline_tenantId_entryId_key" ON "TusSupportTimeline"("tenantId", "entryId");
CREATE INDEX "TusSupportTimeline_tenantId_caseId_createdAt_idx" ON "TusSupportTimeline"("tenantId", "caseId", "createdAt");

CREATE TABLE "TusSupportCompensation" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "settlement" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TusSupportCompensation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusSupportCompensation_tenantId_entryId_key" ON "TusSupportCompensation"("tenantId", "entryId");
CREATE UNIQUE INDEX "TusSupportCompensation_tenantId_caseId_key" ON "TusSupportCompensation"("tenantId", "caseId");

CREATE TABLE "TusWhatsAppAction" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusWhatsAppAction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusWhatsAppAction_tenantId_idempotencyKey_key" ON "TusWhatsAppAction"("tenantId", "idempotencyKey");
CREATE INDEX "TusWhatsAppAction_tenantId_createdAt_idx" ON "TusWhatsAppAction"("tenantId", "createdAt");

CREATE TABLE "TusWhatsAppConfirmation" (
  "id" TEXT NOT NULL,
  "confirmationId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "items" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TusWhatsAppConfirmation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusWhatsAppConfirmation_tenantId_confirmationId_key" ON "TusWhatsAppConfirmation"("tenantId", "confirmationId");
CREATE INDEX "TusWhatsAppConfirmation_tenantId_senderId_expiresAt_idx" ON "TusWhatsAppConfirmation"("tenantId", "senderId", "expiresAt");

CREATE TABLE "TusWhatsAppAudit" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusWhatsAppAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TusWhatsAppAudit_tenantId_createdAt_idx" ON "TusWhatsAppAudit"("tenantId", "createdAt");
CREATE INDEX "TusWhatsAppAudit_tenantId_correlationId_idx" ON "TusWhatsAppAudit"("tenantId", "correlationId");

CREATE TABLE "TusOperationsRecord" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "geography" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL,
  "ledgerStatus" TEXT NOT NULL,
  "whatsappActions" INTEGER NOT NULL,
  "disputes" INTEGER NOT NULL,
  "posOffline" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusOperationsRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TusOperationsRecord_tenantId_createdAt_idx" ON "TusOperationsRecord"("tenantId", "createdAt");
CREATE INDEX "TusOperationsRecord_tenantId_context_channel_geography_idx" ON "TusOperationsRecord"("tenantId", "context", "channel", "geography");
