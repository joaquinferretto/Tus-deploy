CREATE TABLE "TusReadinessEvidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "gate" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "evidenceType" TEXT NOT NULL,
    "evidenceRef" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TusReadinessEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TusReadinessDecision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "disposition" TEXT NOT NULL,
    "failedGates" JSONB NOT NULL,
    "evidenceIds" TEXT[] NOT NULL,
    "deterministic" BOOLEAN NOT NULL,
    "reason" TEXT,
    "evidencePreserved" BOOLEAN,
    "auditPreserved" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TusReadinessDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TusReadinessEvidence_tenantId_capability_gate_evidenceRef_key"
  ON "TusReadinessEvidence"("tenantId", "capability", "gate", "evidenceRef");
CREATE INDEX "TusReadinessEvidence_tenantId_capability_gate_revoked_idx"
  ON "TusReadinessEvidence"("tenantId", "capability", "gate", "revoked");
CREATE INDEX "TusReadinessEvidence_expiresAt_idx"
  ON "TusReadinessEvidence"("expiresAt");
CREATE INDEX "TusReadinessDecision_tenantId_capability_evaluatedAt_idx"
  ON "TusReadinessDecision"("tenantId", "capability", "evaluatedAt");
CREATE INDEX "TusReadinessDecision_tenantId_capability_enabled_idx"
  ON "TusReadinessDecision"("tenantId", "capability", "enabled");
