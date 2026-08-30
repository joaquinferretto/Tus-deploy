-- PR4 preserves cross-context correlation and support outbox facts.
-- Existing rows receive a legacy correlation marker; no financial history is rewritten.
ALTER TABLE "TusDeliveryOutbox" ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "TusSupportCase" ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "TusSupportEvidence" ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "TusSupportTimeline" ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "TusSupportCompensation" ADD COLUMN "correlationId" TEXT NOT NULL DEFAULT 'legacy';

CREATE TABLE "TusSupportOutbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusSupportOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TusSupportOutbox_tenantId_eventId_key" ON "TusSupportOutbox"("tenantId", "eventId");
CREATE INDEX "TusSupportOutbox_tenantId_status_createdAt_idx" ON "TusSupportOutbox"("tenantId", "status", "createdAt");
CREATE INDEX "TusSupportOutbox_tenantId_correlationId_idx" ON "TusSupportOutbox"("tenantId", "correlationId");
