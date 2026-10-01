-- TURNOS-ADMIN-01: turnos created by the platform administration on the EXISTING calendar /
-- reservations domain (no parallel table). Forward-only and additive.

-- The provider agenda (one calendar per provider) is not tied to a legacy service: the column has
-- been optional in the application since 20260916140000 but was still NOT NULL here, so creating
-- the agenda of a provider failed.
ALTER TABLE public."calendarios" ALTER COLUMN "servicio_id" DROP NOT NULL;

-- Who created the reservation when it was the administration (general or forced turno).
ALTER TABLE public."reservas" ADD COLUMN "creado_por_admin_id" text;
UPDATE public."reservas"
   SET "creado_por_admin_id" = "modificado_por_admin_id"
 WHERE "forzado_fuera_horario" AND "creado_por_admin_id" IS NULL AND "modificado_por_admin_id" IS NOT NULL;

-- A turno forced outside the published hours always carries its reason and its author. NOT VALID:
-- the rule applies to every new or updated row without re-checking historical rows.
ALTER TABLE public."reservas"
  ADD CONSTRAINT "ck_reservas_forzado_auditado" CHECK (
    NOT "forzado_fuera_horario"
    OR ("motivo_forzado" IS NOT NULL AND length(btrim("motivo_forzado")) >= 5
        AND ("creado_por_admin_id" IS NOT NULL OR "modificado_por_admin_id" IS NOT NULL))
  ) NOT VALID;

-- Turnos of a registered client (agenda of the person, admin search).
CREATE INDEX "idx_reservas_cliente_inicio" ON public."reservas"("cliente_id", "fecha_inicio");
