-- PR2 adds a durable tenant/shift version aggregate for atomic POS commands.
-- This migration is additive and intentionally contains no reset or drop operation.
CREATE TABLE "TusPosVersion" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TusPosVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TusPosVersion_tenantId_shiftId_key" ON "TusPosVersion"("tenantId", "shiftId");
CREATE INDEX "TusPosVersion_tenantId_shiftId_version_idx" ON "TusPosVersion"("tenantId", "shiftId", "version");
