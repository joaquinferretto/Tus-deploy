-- TURNOS-AGENDA-01: own interval of a day on the EXISTING weekly rules (no parallel table).
-- Forward-only and additive.
--
-- The general interval of an agenda already exists: calendarios.granularidad_minutos (how often a
-- turno may start). A day may now carry its own interval; NULL means "use the general one", so
-- every existing rule keeps behaving exactly as before.
ALTER TABLE public."reglas_calendario" ADD COLUMN "intervalo_minutos" integer;

ALTER TABLE public."reglas_calendario"
  ADD CONSTRAINT "ck_reglas_calendario_intervalo" CHECK (
    "intervalo_minutos" IS NULL OR "intervalo_minutos" IN (15, 30, 60, 90, 120)
  );
