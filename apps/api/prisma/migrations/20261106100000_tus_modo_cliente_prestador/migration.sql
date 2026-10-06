-- MODOS-01: one account, two ways of using TUS (client / provider).
-- "Session"."activeMode": how THIS session is using TUS right now. "Account"."lastMode": the
-- preference for the next sign-in. Neither is an authorization: the API derives what an account
-- can do from its real state and ignores a stored mode that is no longer valid.
-- Forward-only and additive: two nullable columns; existing rows keep NULL and keep working.

ALTER TABLE public."Session" ADD COLUMN IF NOT EXISTS "activeMode" TEXT;
ALTER TABLE public."Account" ADD COLUMN IF NOT EXISTS "lastMode" TEXT;

ALTER TABLE public."Session"
  ADD CONSTRAINT "ck_session_active_mode" CHECK ("activeMode" IS NULL OR "activeMode" IN ('CLIENT', 'PROVIDER')) NOT VALID;
ALTER TABLE public."Account"
  ADD CONSTRAINT "ck_account_last_mode" CHECK ("lastMode" IS NULL OR "lastMode" IN ('CLIENT', 'PROVIDER')) NOT VALID;
