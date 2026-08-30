-- TUS PR3 identity/tenant bootstrap hardening.
-- This migration is additive: existing users, sessions, memberships, and audit
-- records remain intact while tenant-scoped recovery becomes index-backed.
CREATE INDEX IF NOT EXISTS "Account_tenantId_status_idx"
  ON "Account"("tenantId", "status");

CREATE INDEX IF NOT EXISTS "Session_tenantId_revokedAt_expiresAt_idx"
  ON "Session"("tenantId", "revokedAt", "expiresAt");

CREATE INDEX IF NOT EXISTS "Membership_organizationId_userId_status_idx"
  ON "Membership"("organizationId", "userId", "status");

CREATE INDEX IF NOT EXISTS "AuditEvent_tenantId_actorId_occurredAt_idx"
  ON "AuditEvent"("tenantId", "actorId", "occurredAt");

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "slug" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "defaultWorkspaceId" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Membership"
  ADD COLUMN IF NOT EXISTS "roleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "TenantRole" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "permissions" TEXT[] NOT NULL,
  "resourceScopes" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TenantRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantRole_tenantId_name_key"
  ON "TenantRole"("tenantId", "name");

CREATE TABLE IF NOT EXISTS "Invitation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "roleIds" TEXT[] NOT NULL,
  "tokenDigest" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Invitation_tokenDigest_key" ON "Invitation"("tokenDigest");

CREATE TABLE IF NOT EXISTS "TenantResource" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  CONSTRAINT "TenantResource_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TenantResource_tenantId_type_idx"
  ON "TenantResource"("tenantId", "type");

-- Rollback boundary: disable identity/tenant routes and retain all records.
-- Do not delete sessions, memberships, or audit history during route rollback.
