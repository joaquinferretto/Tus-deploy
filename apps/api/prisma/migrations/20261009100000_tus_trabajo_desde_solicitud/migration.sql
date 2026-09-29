-- A work can now be born from a directory request (client chose one provider) besides the
-- marketplace commitment. Forward-only and additive: existing marketplace works keep every value
-- (origen defaults to 'marketplace') and every constraint they had.
--
-- origen = 'marketplace': compromiso_id and publicacion_id required, solicitud_id NULL (as before).
-- origen = 'solicitud'  : solicitud_id required, compromiso_id and publicacion_id NULL.
--
-- The composite FK below ties the work to the request's ASSIGNED provider, so the database itself
-- guarantees that a request-born work belongs to the provider the client chose, and the unique
-- partial index guarantees at most one work per request.

ALTER TABLE public."trabajos" ADD COLUMN "origen" text NOT NULL DEFAULT 'marketplace';
ALTER TABLE public."trabajos" ADD COLUMN "solicitud_id" text;

ALTER TABLE public."trabajos" ALTER COLUMN "compromiso_id" DROP NOT NULL;
ALTER TABLE public."trabajos" ALTER COLUMN "publicacion_id" DROP NOT NULL;

ALTER TABLE public."trabajos" ADD CONSTRAINT "ck_trabajos_origen" CHECK ("origen" IN ('marketplace', 'solicitud'));
ALTER TABLE public."trabajos" ADD CONSTRAINT "ck_trabajos_origen_coherente" CHECK (
  ("origen" = 'marketplace' AND "compromiso_id" IS NOT NULL AND "publicacion_id" IS NOT NULL AND "solicitud_id" IS NULL)
  OR ("origen" = 'solicitud' AND "solicitud_id" IS NOT NULL AND "compromiso_id" IS NULL AND "publicacion_id" IS NULL)
);

-- Target of the composite FK (id is already the primary key, so this never rejects a row).
CREATE UNIQUE INDEX "uq_solicitudes_servicio_asignacion" ON public."solicitudes_servicio"("id", "prestador_tenant_id", "prestador_id");

ALTER TABLE public."trabajos" ADD CONSTRAINT "fk_trabajos_solicitud_asignada"
  FOREIGN KEY ("solicitud_id", "prestador_tenant_id", "prestador_id")
  REFERENCES public."solicitudes_servicio"("id", "prestador_tenant_id", "prestador_id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE UNIQUE INDEX "uq_trabajos_solicitud" ON public."trabajos"("solicitud_id") WHERE "solicitud_id" IS NOT NULL;
