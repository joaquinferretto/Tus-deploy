ALTER TABLE "TusWhatsAppMessage" ADD COLUMN IF NOT EXISTS "variables" JSONB;
ALTER TABLE "TusWhatsAppMessage" ADD COLUMN IF NOT EXISTS "requestHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TusWhatsAppMessage" ADD COLUMN IF NOT EXISTS "retentionUntil" TIMESTAMP(3);
ALTER TABLE "TusWhatsAppAudit" ADD COLUMN IF NOT EXISTS "retentionUntil" TIMESTAMP(3);
ALTER TABLE "TusWhatsAppConsent" ADD COLUMN IF NOT EXISTS "recipientType" TEXT NOT NULL DEFAULT 'customer';

CREATE TABLE IF NOT EXISTS "TusWhatsAppOutbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "retentionUntil" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusWhatsAppOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TusWhatsAppOutbox_tenantId_eventId_key" ON "TusWhatsAppOutbox" ("tenantId", "eventId");
CREATE INDEX IF NOT EXISTS "TusWhatsAppOutbox_tenantId_status_createdAt_idx" ON "TusWhatsAppOutbox" ("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "TusWhatsAppOutbox_tenantId_correlationId_idx" ON "TusWhatsAppOutbox" ("tenantId", "correlationId");

ALTER TABLE "TusDeliveryTask" ADD COLUMN IF NOT EXISTS "sla" JSONB;
ALTER TABLE "TusDeliveryTask" ADD COLUMN IF NOT EXISTS "pickup" JSONB;
ALTER TABLE "TusDeliveryTask" ADD COLUMN IF NOT EXISTS "dropoff" JSONB;
ALTER TABLE "TusDeliveryTask" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "TusDeliveryTask" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
