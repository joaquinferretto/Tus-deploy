-- Phase 9 billing persistence: tenant-scoped ARS billing records and append-only controls.
ALTER TABLE "TusInvoice"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "paymentId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "orderId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "posOperationId" TEXT,
  ADD COLUMN IF NOT EXISTS "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "feeMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "number" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceType" TEXT NOT NULL DEFAULT 'commercial',
  ADD COLUMN IF NOT EXISTS "taxSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "snapshotVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "TusInvoiceLine"
  ADD COLUMN IF NOT EXISTS "lineId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'ARS',
  ADD COLUMN IF NOT EXISTS "snapshot" JSONB;

ALTER TABLE "TusCreditNote"
  ADD COLUMN IF NOT EXISTS "paymentId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "orderId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "posOperationId" TEXT;

ALTER TABLE "TusSubscription"
  ADD COLUMN IF NOT EXISTS "planId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "planSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "dunningAttempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;

ALTER TABLE "TusTaxProfile"
  ADD COLUMN IF NOT EXISTS "authority" TEXT NOT NULL DEFAULT 'ARCA/AFIP-external',
  ADD COLUMN IF NOT EXISTS "ivaTreatment" TEXT,
  ADD COLUMN IF NOT EXISTS "withholdingTreatment" TEXT,
  ADD COLUMN IF NOT EXISTS "externalApprovalReference" TEXT;

DO $$ BEGIN
  ALTER TABLE "TusInvoiceLine" ADD CONSTRAINT "TusInvoiceLine_tenant_invoice_fk"
    FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "TusInvoice" ("tenantId", "invoiceId") NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TusBillingAccount" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "partyId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusBillingAccount_tenantId_billingAccountId_key" UNIQUE ("tenantId", "billingAccountId")
);
CREATE INDEX IF NOT EXISTS "TusBillingAccount_tenantId_partyId_status_idx" ON "TusBillingAccount" ("tenantId", "partyId", "status");

CREATE TABLE IF NOT EXISTS "TusSubscriptionPlan" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "interval" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusSubscriptionPlan_tenantId_planId_key" UNIQUE ("tenantId", "planId")
);
CREATE INDEX IF NOT EXISTS "TusSubscriptionPlan_tenantId_status_idx" ON "TusSubscriptionPlan" ("tenantId", "status");

CREATE TABLE IF NOT EXISTS "TusBillingRefund" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "posOperationId" TEXT,
  "currency" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusBillingRefund_tenantId_refundId_key" UNIQUE ("tenantId", "refundId")
);
CREATE INDEX IF NOT EXISTS "TusBillingRefund_tenantId_invoiceId_idx" ON "TusBillingRefund" ("tenantId", "invoiceId");

CREATE TABLE IF NOT EXISTS "TusBillingLedger" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "entryType" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "linkedEntryId" TEXT,
  "creditNoteId" TEXT,
  "refundId" TEXT,
  "paymentId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "posOperationId" TEXT,
  "immutable" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusBillingLedger_tenantId_entryId_key" UNIQUE ("tenantId", "entryId")
);
CREATE INDEX IF NOT EXISTS "TusBillingLedger_tenantId_invoiceId_createdAt_idx" ON "TusBillingLedger" ("tenantId", "invoiceId", "createdAt");

CREATE TABLE IF NOT EXISTS "TusBillingIdempotency" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "response" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TusBillingIdempotency_tenantId_key_key" UNIQUE ("tenantId", "key")
);
CREATE INDEX IF NOT EXISTS "TusBillingIdempotency_tenantId_createdAt_idx" ON "TusBillingIdempotency" ("tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS "TusBillingAudit" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "auditId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusBillingAudit_tenantId_auditId_key" UNIQUE ("tenantId", "auditId")
);
CREATE INDEX IF NOT EXISTS "TusBillingAudit_tenantId_correlationId_createdAt_idx" ON "TusBillingAudit" ("tenantId", "correlationId", "createdAt");

CREATE TABLE IF NOT EXISTS "TusBillingOutbox" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "availableAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusBillingOutbox_tenantId_eventId_key" UNIQUE ("tenantId", "eventId")
);
CREATE INDEX IF NOT EXISTS "TusBillingOutbox_tenantId_status_availableAt_idx" ON "TusBillingOutbox" ("tenantId", "status", "availableAt");

CREATE TABLE IF NOT EXISTS "TusBillingDunning" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "dunningId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "retryAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusBillingDunning_tenantId_dunningId_key" UNIQUE ("tenantId", "dunningId")
);
CREATE INDEX IF NOT EXISTS "TusBillingDunning_tenantId_subscriptionId_createdAt_idx" ON "TusBillingDunning" ("tenantId", "subscriptionId", "createdAt");

CREATE TABLE IF NOT EXISTS "TusBillingNumberSequence" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL UNIQUE,
  "nextNumber" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "TusAccountingExport" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "exportId" TEXT NOT NULL,
  "invoiceIds" TEXT[] NOT NULL,
  "ledgerEntryIds" TEXT[] NOT NULL,
  "externalApprovalReference" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "postedExternally" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusAccountingExport_tenantId_exportId_key" UNIQUE ("tenantId", "exportId")
);
CREATE INDEX IF NOT EXISTS "TusAccountingExport_tenantId_createdAt_idx" ON "TusAccountingExport" ("tenantId", "createdAt");

CREATE OR REPLACE FUNCTION "tus_reject_billing_history_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'TusInvoice' AND OLD.status = 'draft' AND NEW.status = 'issued' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'billing history is append-only';
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'TusInvoice_append_only') THEN
    CREATE TRIGGER "TusInvoice_append_only" BEFORE UPDATE OR DELETE ON "TusInvoice"
      FOR EACH ROW EXECUTE FUNCTION "tus_reject_billing_history_mutation"();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'TusInvoiceLine_append_only') THEN
    CREATE TRIGGER "TusInvoiceLine_append_only" BEFORE UPDATE OR DELETE ON "TusInvoiceLine"
      FOR EACH ROW EXECUTE FUNCTION "tus_reject_billing_history_mutation"();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'TusBillingLedger_append_only') THEN
    CREATE TRIGGER "TusBillingLedger_append_only" BEFORE UPDATE OR DELETE ON "TusBillingLedger"
      FOR EACH ROW EXECUTE FUNCTION "tus_reject_billing_history_mutation"();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'TusCreditNote_append_only') THEN
    CREATE TRIGGER "TusCreditNote_append_only" BEFORE UPDATE OR DELETE ON "TusCreditNote"
      FOR EACH ROW EXECUTE FUNCTION "tus_reject_billing_history_mutation"();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'TusBillingRefund_append_only') THEN
    CREATE TRIGGER "TusBillingRefund_append_only" BEFORE UPDATE OR DELETE ON "TusBillingRefund"
      FOR EACH ROW EXECUTE FUNCTION "tus_reject_billing_history_mutation"();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'TusBillingAudit_append_only') THEN
    CREATE TRIGGER "TusBillingAudit_append_only" BEFORE UPDATE OR DELETE ON "TusBillingAudit"
      FOR EACH ROW EXECUTE FUNCTION "tus_reject_billing_history_mutation"();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'TusBillingIdempotency_append_only') THEN
    CREATE TRIGGER "TusBillingIdempotency_append_only" BEFORE UPDATE OR DELETE ON "TusBillingIdempotency"
      FOR EACH ROW EXECUTE FUNCTION "tus_reject_billing_history_mutation"();
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'TusAccountingExport_append_only') THEN
    CREATE TRIGGER "TusAccountingExport_append_only" BEFORE UPDATE OR DELETE ON "TusAccountingExport"
      FOR EACH ROW EXECUTE FUNCTION "tus_reject_billing_history_mutation"();
  END IF;
END $$;
