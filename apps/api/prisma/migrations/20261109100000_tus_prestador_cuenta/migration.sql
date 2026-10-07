-- PRESTADOR-CUENTA-01: a provider belongs to ONE account, by id.
-- Until now the account of a provider was "an account of its tenant" (the oldest active one when
-- there were several): an inference. "prestadores"."cuenta_id" makes it a persisted relation, and
-- it is the one every notice, the administration and WhatsApp resolve the provider with.
--
-- Backfill: ONLY where there is nothing to choose (the tenant has exactly one account and exactly
-- one provider row). Every other row keeps NULL and is reconciled by hand from the
-- administration: nothing is guessed. scripts/db/auditoria-prestadores.sql lists them.
-- Forward-only and additive: one nullable column, its foreign key and a partial unique index.

ALTER TABLE public."prestadores" ADD COLUMN IF NOT EXISTS "cuenta_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_prestadores_cuenta') THEN
    ALTER TABLE public."prestadores"
      ADD CONSTRAINT "fk_prestadores_cuenta" FOREIGN KEY ("cuenta_id")
      REFERENCES public."Account" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
  END IF;
END $$;

-- One account is the account of at most one provider.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_prestadores_cuenta"
  ON public."prestadores" ("cuenta_id") WHERE "cuenta_id" IS NOT NULL;

UPDATE public."prestadores" p
   SET "cuenta_id" = a."id"
  FROM public."Account" a
 WHERE p."cuenta_id" IS NULL
   AND a."tenantId" = p."tenant_id"
   AND (SELECT count(*) FROM public."Account" x WHERE x."tenantId" = p."tenant_id") = 1
   AND (SELECT count(*) FROM public."prestadores" y WHERE y."tenant_id" = p."tenant_id") = 1
   AND NOT EXISTS (SELECT 1 FROM public."prestadores" z WHERE z."cuenta_id" = a."id");
