-- Phase 6 is additive. Payment correlation, intermediary policy, and provider
-- event ordering are added without rewriting existing financial history.
ALTER TABLE "TusPaymentIntent"
  ADD COLUMN IF NOT EXISTS "orderId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "posOperationId" TEXT,
  ADD COLUMN IF NOT EXISTS "merchantOfRecord" TEXT NOT NULL DEFAULT 'tus-intermediary',
  ADD COLUMN IF NOT EXISTS "collectionModel" TEXT NOT NULL DEFAULT 'intermediary',
  ADD COLUMN IF NOT EXISTS "splitPolicy" JSONB,
  ADD COLUMN IF NOT EXISTS "releaseAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "providerEventAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "providerError" TEXT;

CREATE INDEX IF NOT EXISTS "TusPaymentIntent_tenantId_orderId_idx"
  ON "TusPaymentIntent"("tenantId", "orderId");

COMMENT ON COLUMN "TusPaymentIntent"."merchantOfRecord" IS
  'Explicit intermediary boundary; not a custody, legal, tax, or provider approval claim';
COMMENT ON COLUMN "TusPaymentIntent"."splitPolicy" IS
  'Versioned five-day policy snapshot; activation remains evidence-gated';
