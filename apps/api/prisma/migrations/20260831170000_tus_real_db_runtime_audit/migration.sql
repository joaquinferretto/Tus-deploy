-- TUS Real Database Runtime Audit: additive seed identity indexes.
-- Existing rows remain authoritative; no destructive operation is permitted.

CREATE TABLE IF NOT EXISTS "TusHardeningFixture" (
  "id" TEXT NOT NULL,
  "tag" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "productListingId" TEXT NOT NULL,
  "serviceListingId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusHardeningFixture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TusHardeningFixture_tag_version_runId_key"
  ON "TusHardeningFixture" ("tag", "version", "runId");

CREATE INDEX IF NOT EXISTS "TusHardeningFixture_tenantId_tag_version_idx"
  ON "TusHardeningFixture" ("tenantId", "tag", "version");
