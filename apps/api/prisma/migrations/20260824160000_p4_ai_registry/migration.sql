CREATE TABLE "PromptDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PromptDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "template" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "deprecatedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModelDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelAvailability" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModelAvailability_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Rollout" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "modelId" TEXT NOT NULL,
    "percentage" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "rolloutVersion" INTEGER NOT NULL,
    "previousRolloutId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Rollout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "approverId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RegistryAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "version" INTEGER,
    "outcome" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegistryAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromptDefinition_tenantId_key_key"
  ON "PromptDefinition"("tenantId", "key");
CREATE UNIQUE INDEX "PromptVersion_tenantId_promptId_version_key"
  ON "PromptVersion"("tenantId", "promptId", "version");
CREATE UNIQUE INDEX "ModelDefinition_tenantId_key_key"
  ON "ModelDefinition"("tenantId", "key");
CREATE UNIQUE INDEX "ModelAvailability_tenantId_modelId_key"
  ON "ModelAvailability"("tenantId", "modelId");
CREATE INDEX "PromptDefinition_tenantId_updatedAt_idx"
  ON "PromptDefinition"("tenantId", "updatedAt");
CREATE INDEX "PromptVersion_tenantId_promptId_status_idx"
  ON "PromptVersion"("tenantId", "promptId", "status");
CREATE INDEX "ModelDefinition_tenantId_provider_status_idx"
  ON "ModelDefinition"("tenantId", "provider", "status");
CREATE INDEX "ModelAvailability_tenantId_status_observedAt_idx"
  ON "ModelAvailability"("tenantId", "status", "observedAt");
CREATE INDEX "Rollout_tenantId_promptId_state_idx"
  ON "Rollout"("tenantId", "promptId", "state");
CREATE INDEX "Rollout_tenantId_modelId_state_idx"
  ON "Rollout"("tenantId", "modelId", "state");
CREATE INDEX "Approval_tenantId_resourceType_resourceId_status_idx"
  ON "Approval"("tenantId", "resourceType", "resourceId", "status");
CREATE INDEX "RegistryAudit_tenantId_occurredAt_idx"
  ON "RegistryAudit"("tenantId", "occurredAt");
CREATE INDEX "RegistryAudit_tenantId_resourceType_resourceId_occurredAt_idx"
  ON "RegistryAudit"("tenantId", "resourceType", "resourceId", "occurredAt");
CREATE INDEX "RegistryAudit_correlationId_idx"
  ON "RegistryAudit"("correlationId");

ALTER TABLE "PromptVersion" ADD CONSTRAINT "PromptVersion_promptId_fkey"
  FOREIGN KEY ("promptId") REFERENCES "PromptDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelAvailability" ADD CONSTRAINT "ModelAvailability_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "ModelDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Rollout" ADD CONSTRAINT "Rollout_promptId_fkey"
  FOREIGN KEY ("promptId") REFERENCES "PromptDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Rollout" ADD CONSTRAINT "Rollout_modelId_fkey"
  FOREIGN KEY ("modelId") REFERENCES "ModelDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
