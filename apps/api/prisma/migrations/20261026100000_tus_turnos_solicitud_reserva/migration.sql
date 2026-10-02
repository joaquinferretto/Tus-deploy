-- TURNOS-SOLICITUD-01: a client does not confirm a turno, it REQUESTS it.
--
-- The request is a row of public."reservas" (no parallel table: provider, service, date, time and
-- client are already there) in the new state 'pending'. It holds its time until the provider
-- answers or its validity runs out:
--   pending   -> confirmed   the provider accepted
--   pending   -> rejected    the provider rejected it (or the time was no longer free on accepting)
--   pending   -> expired     nobody answered before "solicitud_expira_en"
--   pending   -> cancelled   the client withdrew it
-- 'rejected' and 'expired' give the time back, exactly like the cancelled states.
-- Forward-only. No row is deleted or rewritten.

-- 1. Until when a pending request holds its time. NULL for every reservation that is not a request.
ALTER TABLE public."reservas" ADD COLUMN "solicitud_expira_en" timestamp(3);

-- 2. The overlap rule keeps being the final authority. Its predicate gains the two new states that
--    release the time. Every existing row is in a state the previous predicate already knew, so
--    the set of rows it protects is exactly the same: the constraint cannot fail to be re-created.
ALTER TABLE public."reservas" DROP CONSTRAINT "ex_reservas_sin_solapamiento";

ALTER TABLE public."reservas"
  ADD CONSTRAINT "ex_reservas_sin_solapamiento"
  EXCLUDE USING gist (
    "calendario_id" WITH =,
    tsrange("fecha_inicio", "fecha_fin", '[)') WITH &&
  )
  WHERE ("estado" NOT IN ('cancelled', 'cancelled-late', 'no-show', 'rejected', 'expired'));

-- 3. The state is one of the known ones. NOT VALID: enforced on every new or updated row without
--    re-checking historical rows (see scripts/db/diagnostico-not-valid.mjs before validating).
ALTER TABLE public."reservas"
  ADD CONSTRAINT "ck_reservas_estado" CHECK (
    "estado" IN ('pending', 'confirmed', 'rejected', 'expired', 'cancelled', 'cancelled-late', 'no-show', 'completed')
  ) NOT VALID;

-- 4. A pending request always says until when it holds its time (no request stays open forever).
ALTER TABLE public."reservas"
  ADD CONSTRAINT "ck_reservas_solicitud_vigencia" CHECK (
    "estado" <> 'pending' OR "solicitud_expira_en" IS NOT NULL
  ) NOT VALID;

-- 5. Requests waiting in an agenda (provider panel, expiry of overdue requests).
CREATE INDEX "ix_reservas_solicitudes_pendientes"
  ON public."reservas"("calendario_id", "solicitud_expira_en")
  WHERE "estado" = 'pending';
