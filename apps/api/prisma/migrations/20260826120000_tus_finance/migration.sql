CREATE TABLE "TusPaymentIntent" (
  "id" TEXT NOT NULL,
  "contractVersion" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerReference" TEXT,
  "providerStatus" TEXT NOT NULL,
  "commercialStatus" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "credentialsCollected" BOOLEAN NOT NULL,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusPaymentIntent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusPaymentIntent_tenantId_paymentId_key" ON "TusPaymentIntent"("tenantId", "paymentId");
CREATE UNIQUE INDEX "TusPaymentIntent_tenantId_commitmentId_key" ON "TusPaymentIntent"("tenantId", "commitmentId");
CREATE UNIQUE INDEX "TusPaymentIntent_tenantId_idempotencyKey_key" ON "TusPaymentIntent"("tenantId", "idempotencyKey");
CREATE INDEX "TusPaymentIntent_tenantId_providerStatus_idx" ON "TusPaymentIntent"("tenantId", "providerStatus");
CREATE INDEX "TusPaymentIntent_tenantId_commercialStatus_idx" ON "TusPaymentIntent"("tenantId", "commercialStatus");

CREATE TABLE "TusFinanceIdempotency" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusFinanceIdempotency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusFinanceIdempotency_tenantId_idempotencyKey_key" ON "TusFinanceIdempotency"("tenantId", "idempotencyKey");
CREATE INDEX "TusFinanceIdempotency_tenantId_updatedAt_idx" ON "TusFinanceIdempotency"("tenantId", "updatedAt");

CREATE TABLE "TusCommissionSnapshot" (
  "id" TEXT NOT NULL,
  "contractVersion" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "grossAmount" DOUBLE PRECISION NOT NULL,
  "deductions" DOUBLE PRECISION NOT NULL,
  "commissionableBase" DOUBLE PRECISION NOT NULL,
  "rateBps" INTEGER NOT NULL,
  "ruleVersion" TEXT NOT NULL,
  "commissionAmount" DOUBLE PRECISION NOT NULL,
  "netAmount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL,
  "providerReference" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "ledgerStatus" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusCommissionSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusCommissionSnapshot_tenantId_snapshotId_key" ON "TusCommissionSnapshot"("tenantId", "snapshotId");
CREATE UNIQUE INDEX "TusCommissionSnapshot_tenantId_commitmentId_key" ON "TusCommissionSnapshot"("tenantId", "commitmentId");
CREATE INDEX "TusCommissionSnapshot_tenantId_ruleVersion_idx" ON "TusCommissionSnapshot"("tenantId", "ruleVersion");

CREATE TABLE "TusLedgerEntry" (
  "id" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "entryType" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL,
  "linkedEntryId" TEXT,
  "reason" TEXT NOT NULL,
  "immutable" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusLedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusLedgerEntry_tenantId_entryId_key" ON "TusLedgerEntry"("tenantId", "entryId");
CREATE INDEX "TusLedgerEntry_tenantId_commitmentId_createdAt_idx" ON "TusLedgerEntry"("tenantId", "commitmentId", "createdAt");
CREATE INDEX "TusLedgerEntry_tenantId_linkedEntryId_idx" ON "TusLedgerEntry"("tenantId", "linkedEntryId");

CREATE TABLE "TusFinancialEvidence" (
  "id" TEXT NOT NULL,
  "contractVersion" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusFinancialEvidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusFinancialEvidence_tenantId_evidenceId_key" ON "TusFinancialEvidence"("tenantId", "evidenceId");
CREATE INDEX "TusFinancialEvidence_tenantId_commitmentId_kind_idx" ON "TusFinancialEvidence"("tenantId", "commitmentId", "kind");

CREATE TABLE "TusFinancialConfirmation" (
  "id" TEXT NOT NULL,
  "confirmationId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusFinancialConfirmation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusFinancialConfirmation_tenantId_confirmationId_key" ON "TusFinancialConfirmation"("tenantId", "confirmationId");
CREATE UNIQUE INDEX "TusFinancialConfirmation_tenantId_commitmentId_key" ON "TusFinancialConfirmation"("tenantId", "commitmentId");
CREATE INDEX "TusFinancialConfirmation_tenantId_commitmentId_confirmedAt_idx" ON "TusFinancialConfirmation"("tenantId", "commitmentId", "confirmedAt");

CREATE TABLE "TusFinancialFreeze" (
  "id" TEXT NOT NULL,
  "freezeId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusFinancialFreeze_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusFinancialFreeze_tenantId_freezeId_key" ON "TusFinancialFreeze"("tenantId", "freezeId");
CREATE UNIQUE INDEX "TusFinancialFreeze_tenantId_commitmentId_key" ON "TusFinancialFreeze"("tenantId", "commitmentId");
CREATE INDEX "TusFinancialFreeze_tenantId_reason_active_idx" ON "TusFinancialFreeze"("tenantId", "reason", "active");

CREATE TABLE "TusReconciliationRecord" (
  "id" TEXT NOT NULL,
  "reconciliationId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "commitmentId" TEXT NOT NULL,
  "providerReference" TEXT NOT NULL,
  "providerAmount" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "deterministic" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusReconciliationRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusReconciliationRecord_tenantId_reconciliationId_key" ON "TusReconciliationRecord"("tenantId", "reconciliationId");
CREATE UNIQUE INDEX "TusReconciliationRecord_tenantId_commitmentId_key" ON "TusReconciliationRecord"("tenantId", "commitmentId");
CREATE INDEX "TusReconciliationRecord_tenantId_status_createdAt_idx" ON "TusReconciliationRecord"("tenantId", "status", "createdAt");
