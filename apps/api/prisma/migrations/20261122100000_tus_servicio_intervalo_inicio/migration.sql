-- TURNOS-INTERVALO-01. "Every how long a turno can start" is its own datum, apart from how long the
-- service lasts. Additive and forward-only: one nullable column on the service a provider offers.
--
-- NULL (every existing row) keeps the behaviour there was: a turno starts when the previous one
-- ends (duration + rest). A value makes the starts every 15, 30, 45 or 60 minutes from the opening
-- time; a turno still occupies its whole duration and two turnos never overlap.
ALTER TABLE public."perfil_servicios" ADD COLUMN "intervalo_inicio_minutos" integer;
ALTER TABLE public."perfil_servicios"
  ADD CONSTRAINT "ck_perfil_servicios_intervalo_inicio" CHECK ("intervalo_inicio_minutos" IS NULL OR "intervalo_inicio_minutos" IN (15, 30, 45, 60));
