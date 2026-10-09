-- ADMIN-CONTRASENA-TEMPORAL-01. Two facts about an account, additive and forward-only:
--   "origin": who created it — 'self' (the person registered) or 'admin' (the administration).
--   "mustChangePassword": its password was set by the administration and the person must choose
--   its own before anything else.
-- Nothing is dropped; no existing column is rewritten.
ALTER TABLE public."Account" ADD COLUMN "origin" text NOT NULL DEFAULT 'self';
ALTER TABLE public."Account" ADD COLUMN "mustChangePassword" boolean NOT NULL DEFAULT false;
ALTER TABLE public."Account" ADD CONSTRAINT "ck_account_origin" CHECK ("origin" IN ('self', 'admin'));

-- Existing accounts: the origin is taken ONLY from what the audit recorded when each account was
-- created (never from a name, an email or a turno):
--   'account.admin_created'  -> created from Admin -> Usuarios (metadata.targetAccountId);
--   'account.registered' with reason 'managed_provider_account_created' -> a provider account the
--   administration loaded (the event's actor is that account).
-- An account with no such record stays 'self' (the safe side: it keeps the stronger protection).
UPDATE public."Account" AS a SET "origin" = 'admin'
WHERE EXISTS (
  SELECT 1 FROM public."AuditEvent" e
  WHERE (e."eventType" = 'account.admin_created' AND e."metadata"->>'targetAccountId' = a."id")
     OR (e."eventType" = 'account.registered' AND e."metadata"->>'reason' = 'managed_provider_account_created' AND e."actorId" = a."id")
);
