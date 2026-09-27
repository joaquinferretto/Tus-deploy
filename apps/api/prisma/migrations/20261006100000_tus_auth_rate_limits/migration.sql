-- Durable fixed-window limits for sensitive authentication (sign-in per email, password reset,
-- verification re-send, MFA). Forward-only and additive. Keys are "<scope>:<sha256>": no email in
-- clear. Survives restarts and is shared by every API process.
CREATE TABLE public."auth_rate_limits" (
  "key" text NOT NULL,
  "window_started_at" timestamp(3) NOT NULL,
  "attempts" integer NOT NULL,
  "updated_at" timestamp(3) NOT NULL,
  CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "ck_auth_rate_limits_key" CHECK ("key" ~ '^[a-z0-9-]+:[0-9a-f]{64}$'),
  CONSTRAINT "ck_auth_rate_limits_attempts" CHECK ("attempts" >= 1)
);
CREATE INDEX "ix_auth_rate_limits_updated" ON public."auth_rate_limits"("updated_at");
