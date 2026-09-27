-- Second factor (TOTP) for platform administration. Forward-only and additive: new tables only.
-- The TOTP secret is stored only as an AES-256-GCM envelope; recovery codes and challenge tokens
-- only as sha256 digests.

CREATE TABLE public."mfa_enrollments" (
  "id" text NOT NULL,
  "account_id" text NOT NULL,
  "label" text NOT NULL,
  "secret_ciphertext" text NOT NULL,
  "status" text NOT NULL,
  "last_used_step" bigint,
  "created_at" timestamp(3) NOT NULL,
  "confirmed_at" timestamp(3),
  "disabled_at" timestamp(3),
  CONSTRAINT "mfa_enrollments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_mfa_enrollments_account" FOREIGN KEY ("account_id") REFERENCES public."Account"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ck_mfa_enrollments_status" CHECK ("status" IN ('pending', 'active', 'disabled')),
  CONSTRAINT "ck_mfa_enrollments_secret" CHECK ("secret_ciphertext" ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);
CREATE INDEX "ix_mfa_enrollments_account_status" ON public."mfa_enrollments"("account_id", "status");
-- At most one active second factor per account.
CREATE UNIQUE INDEX "uq_mfa_enrollments_account_active" ON public."mfa_enrollments"("account_id") WHERE "status" = 'active';

CREATE TABLE public."mfa_recovery_codes" (
  "id" text NOT NULL,
  "account_id" text NOT NULL,
  "enrollment_id" text NOT NULL,
  "code_digest" text NOT NULL,
  "consumed_at" timestamp(3),
  "invalidated_at" timestamp(3),
  "created_at" timestamp(3) NOT NULL,
  CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_mfa_recovery_codes_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES public."mfa_enrollments"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ck_mfa_recovery_codes_digest" CHECK ("code_digest" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "uq_mfa_recovery_codes_digest" ON public."mfa_recovery_codes"("code_digest");
CREATE INDEX "ix_mfa_recovery_codes_account" ON public."mfa_recovery_codes"("account_id");

CREATE TABLE public."mfa_challenges" (
  "id" text NOT NULL,
  "account_id" text NOT NULL,
  "enrollment_id" text NOT NULL,
  "token_digest" text NOT NULL,
  "expires_at" timestamp(3) NOT NULL,
  "consumed_at" timestamp(3),
  CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_mfa_challenges_enrollment" FOREIGN KEY ("enrollment_id") REFERENCES public."mfa_enrollments"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ck_mfa_challenges_token" CHECK ("token_digest" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "uq_mfa_challenges_token" ON public."mfa_challenges"("token_digest");

CREATE TABLE public."mfa_session_elevations" (
  "session_id" text NOT NULL,
  "account_id" text NOT NULL,
  "method" text NOT NULL,
  "verified_at" timestamp(3) NOT NULL,
  "expires_at" timestamp(3) NOT NULL,
  "revoked_at" timestamp(3),
  CONSTRAINT "mfa_session_elevations_pkey" PRIMARY KEY ("session_id"),
  CONSTRAINT "fk_mfa_session_elevations_session" FOREIGN KEY ("session_id") REFERENCES public."Session"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ck_mfa_session_elevations_method" CHECK ("method" IN ('enrollment', 'totp', 'recovery_code')),
  CONSTRAINT "ck_mfa_session_elevations_window" CHECK ("expires_at" > "verified_at")
);
CREATE INDEX "ix_mfa_session_elevations_account" ON public."mfa_session_elevations"("account_id");
