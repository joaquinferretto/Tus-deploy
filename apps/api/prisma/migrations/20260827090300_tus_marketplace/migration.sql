-- TUS PR4 marketplace completion hardening.
-- Expand-only rollout: publication can be disabled without deleting listings,
-- commitments, audit history, or outbox records.
ALTER TABLE "TusListing"
  ADD COLUMN IF NOT EXISTS "contractVersion" TEXT NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS "policyVersion" TEXT NOT NULL DEFAULT 'stage-1-v1';

ALTER TABLE "TusMarketplaceCommitment"
  ADD COLUMN IF NOT EXISTS "policyVersion" TEXT NOT NULL DEFAULT 'stage-1-v1';

CREATE INDEX IF NOT EXISTS "TusListing_tenantId_kind_locationId_published_idx"
  ON "TusListing"("tenantId", "kind", "locationId", "published");

CREATE INDEX IF NOT EXISTS "TusMarketplaceCommitment_tenantId_listingId_idx"
  ON "TusMarketplaceCommitment"("tenantId", "listingId");

CREATE INDEX IF NOT EXISTS "TusMarketplaceCommitment_listingId_status_slot_idx"
  ON "TusMarketplaceCommitment"("listingId", "status", "slotStart", "slotEnd");

CREATE INDEX IF NOT EXISTS "OutboxEvent_tenantId_marketplace_idx"
  ON "OutboxEvent"("tenantId", "aggregateType", "aggregateId", "createdAt");

-- Rollback boundary: unpublish affected listings and disable marketplace routes;
-- preserve commitments, audit, idempotency, and outbox history.
