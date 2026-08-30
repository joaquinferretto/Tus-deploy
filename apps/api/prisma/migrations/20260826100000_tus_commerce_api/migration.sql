CREATE TABLE "TusCommitment" (
    "id" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lineIds" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TusCommitment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TusCommitment_tenantId_commitmentId_key" ON "TusCommitment"("tenantId", "commitmentId");
CREATE INDEX "TusCommitment_tenantId_createdAt_idx" ON "TusCommitment"("tenantId", "createdAt");
CREATE INDEX "TusCommitment_tenantId_cartId_idx" ON "TusCommitment"("tenantId", "cartId");

CREATE TABLE "TusAuditReference" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TusAuditReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TusAuditReference_tenantId_referenceId_key" ON "TusAuditReference"("tenantId", "referenceId");
CREATE INDEX "TusAuditReference_tenantId_commitmentId_createdAt_idx" ON "TusAuditReference"("tenantId", "commitmentId", "createdAt");
CREATE INDEX "TusAuditReference_tenantId_correlationId_idx" ON "TusAuditReference"("tenantId", "correlationId");
