CREATE TABLE "TusMerchant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "staffRoles" TEXT[] NOT NULL,
    "operatingPolicyVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TusMerchant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TusMerchant_tenantId_key" ON "TusMerchant"("tenantId");
CREATE INDEX "TusMerchant_tenantId_status_idx" ON "TusMerchant"("tenantId", "status");

CREATE TABLE "TusListing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "availabilityVersion" INTEGER NOT NULL,
    "published" BOOLEAN NOT NULL,
    "stock" INTEGER,
    "durationMinutes" INTEGER,
    "capacity" INTEGER,
    "workingHours" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TusListing_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TusListing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "TusMerchant"("tenantId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TusListing_tenantId_published_idx" ON "TusListing"("tenantId", "published");
CREATE INDEX "TusListing_tenantId_availabilityVersion_idx" ON "TusListing"("tenantId", "availabilityVersion");
CREATE INDEX "TusListing_merchantId_kind_idx" ON "TusListing"("merchantId", "kind");

CREATE TABLE "TusMarketplaceCommitment" (
    "id" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "lineIds" TEXT[] NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "availabilityVersion" INTEGER NOT NULL,
    "slotStart" TIMESTAMP(3),
    "slotEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TusMarketplaceCommitment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TusMarketplaceCommitment_tenantId_commitmentId_key" ON "TusMarketplaceCommitment"("tenantId", "commitmentId");
CREATE INDEX "TusMarketplaceCommitment_tenantId_createdAt_idx" ON "TusMarketplaceCommitment"("tenantId", "createdAt");
CREATE INDEX "TusMarketplaceCommitment_listingId_slotStart_slotEnd_idx" ON "TusMarketplaceCommitment"("listingId", "slotStart", "slotEnd");
CREATE INDEX "TusMarketplaceCommitment_merchantId_context_status_idx" ON "TusMarketplaceCommitment"("merchantId", "context", "status");

CREATE TABLE "TusMarketplaceAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TusMarketplaceAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TusMarketplaceAudit_tenantId_createdAt_idx" ON "TusMarketplaceAudit"("tenantId", "createdAt");
CREATE INDEX "TusMarketplaceAudit_tenantId_resourceType_resourceId_idx" ON "TusMarketplaceAudit"("tenantId", "resourceType", "resourceId");
