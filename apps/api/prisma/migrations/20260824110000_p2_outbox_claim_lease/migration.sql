ALTER TABLE "OutboxEvent" ADD COLUMN "claimId" TEXT;
ALTER TABLE "OutboxEvent" ADD COLUMN "claimUntil" TIMESTAMP(3);

CREATE INDEX "OutboxEvent_status_availableAt_claimUntil_idx"
  ON "OutboxEvent"("status", "availableAt", "claimUntil");
CREATE INDEX "OutboxEvent_tenantId_status_claimUntil_idx"
  ON "OutboxEvent"("tenantId", "status", "claimUntil");
