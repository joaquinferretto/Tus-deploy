CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT,
    "correlationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "retentionUntil" TIMESTAMP(3),
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "payload" JSONB,
    "sourceVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SearchRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AggregateSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AggregateSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotaAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "limit" INTEGER NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuotaAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotaReservation" (
    "id" TEXT NOT NULL,
    "quotaAccountId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuotaReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RunLedger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "runType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RunLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OwnershipRecord" (
    "id" TEXT NOT NULL,
    "dataClass" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "rebuildStrategy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OwnershipRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workspace_organizationId_slug_key"
  ON "Workspace"("organizationId", "slug");
CREATE INDEX "Organization_createdAt_idx" ON "Organization"("createdAt");
CREATE INDEX "Workspace_organizationId_idx" ON "Workspace"("organizationId");
CREATE UNIQUE INDEX "Membership_workspaceId_userId_key"
  ON "Membership"("workspaceId", "userId");
CREATE INDEX "Membership_organizationId_userId_idx"
  ON "Membership"("organizationId", "userId");
CREATE INDEX "Membership_workspaceId_status_idx"
  ON "Membership"("workspaceId", "status");
CREATE INDEX "AuditEvent_tenantId_occurredAt_idx"
  ON "AuditEvent"("tenantId", "occurredAt");
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");
CREATE INDEX "AuditEvent_eventType_occurredAt_idx"
  ON "AuditEvent"("eventType", "occurredAt");
CREATE UNIQUE INDEX "SearchRecord_tenantId_entityType_entityId_key"
  ON "SearchRecord"("tenantId", "entityType", "entityId");
CREATE INDEX "SearchRecord_tenantId_entityType_idx"
  ON "SearchRecord"("tenantId", "entityType");
CREATE INDEX "SearchRecord_updatedAt_idx" ON "SearchRecord"("updatedAt");
CREATE UNIQUE INDEX "AggregateSnapshot_tenantId_aggregateType_aggregateId_key"
  ON "AggregateSnapshot"("tenantId", "aggregateType", "aggregateId");
CREATE INDEX "AggregateSnapshot_tenantId_aggregateType_version_idx"
  ON "AggregateSnapshot"("tenantId", "aggregateType", "version");
CREATE UNIQUE INDEX "QuotaAccount_tenantId_metric_key"
  ON "QuotaAccount"("tenantId", "metric");
CREATE INDEX "QuotaAccount_tenantId_updatedAt_idx"
  ON "QuotaAccount"("tenantId", "updatedAt");
CREATE UNIQUE INDEX "QuotaReservation_quotaAccountId_idempotencyKey_key"
  ON "QuotaReservation"("quotaAccountId", "idempotencyKey");
CREATE INDEX "QuotaReservation_quotaAccountId_status_idx"
  ON "QuotaReservation"("quotaAccountId", "status");
CREATE INDEX "QuotaReservation_expiresAt_status_idx"
  ON "QuotaReservation"("expiresAt", "status");
CREATE UNIQUE INDEX "IdempotencyRecord_tenantId_key_key"
  ON "IdempotencyRecord"("tenantId", "key");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
CREATE INDEX "OutboxEvent_status_availableAt_idx"
  ON "OutboxEvent"("status", "availableAt");
CREATE INDEX "OutboxEvent_tenantId_aggregateType_aggregateId_idx"
  ON "OutboxEvent"("tenantId", "aggregateType", "aggregateId");
CREATE INDEX "OutboxEvent_createdAt_idx" ON "OutboxEvent"("createdAt");
CREATE UNIQUE INDEX "RunLedger_tenantId_idempotencyKey_key"
  ON "RunLedger"("tenantId", "idempotencyKey");
CREATE INDEX "RunLedger_tenantId_status_updatedAt_idx"
  ON "RunLedger"("tenantId", "status", "updatedAt");
CREATE UNIQUE INDEX "OwnershipRecord_dataClass_key"
  ON "OwnershipRecord"("dataClass");

ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuotaReservation" ADD CONSTRAINT "QuotaReservation_quotaAccountId_fkey"
  FOREIGN KEY ("quotaAccountId") REFERENCES "QuotaAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
