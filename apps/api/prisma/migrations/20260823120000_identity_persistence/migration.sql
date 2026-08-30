CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PasswordCredential" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "PasswordCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecoveryToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    CONSTRAINT "RecoveryToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "accessTokenDigest" TEXT NOT NULL,
    "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_normalizedEmail_key" ON "User"("normalizedEmail");
CREATE UNIQUE INDEX "Account_userId_tenantId_key" ON "Account"("userId", "tenantId");
CREATE INDEX "Account_tenantId_idx" ON "Account"("tenantId");
CREATE UNIQUE INDEX "PasswordCredential_accountId_key" ON "PasswordCredential"("accountId");
CREATE UNIQUE INDEX "VerificationToken_tokenDigest_key" ON "VerificationToken"("tokenDigest");
CREATE INDEX "VerificationToken_accountId_idx" ON "VerificationToken"("accountId");
CREATE UNIQUE INDEX "RecoveryToken_tokenDigest_key" ON "RecoveryToken"("tokenDigest");
CREATE INDEX "RecoveryToken_accountId_idx" ON "RecoveryToken"("accountId");
CREATE UNIQUE INDEX "Device_accountId_deviceId_key" ON "Device"("accountId", "deviceId");
CREATE INDEX "Device_accountId_idx" ON "Device"("accountId");
CREATE UNIQUE INDEX "Session_accessTokenDigest_key" ON "Session"("accessTokenDigest");
CREATE INDEX "Session_accountId_revokedAt_idx" ON "Session"("accountId", "revokedAt");
CREATE INDEX "Session_tenantId_idx" ON "Session"("tenantId");

ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordCredential" ADD CONSTRAINT "PasswordCredential_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecoveryToken" ADD CONSTRAINT "RecoveryToken_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
