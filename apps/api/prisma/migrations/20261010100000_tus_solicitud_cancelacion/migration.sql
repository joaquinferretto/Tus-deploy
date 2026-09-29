-- Cancelling a request is an explicit, audited operation of its owner. Forward-only and
-- additive: a cancelled request is a closed request ('cerrada', as before) that also records WHEN
-- and BY WHOM it was cancelled. Rows are never deleted; an existing closed request keeps both
-- columns NULL (it was closed before this history existed).
--
-- The rule "a request with a chosen provider / a work cannot be cancelled" is enforced by the
-- conditional UPDATE of the application (no provider, no work, still open) and by the work FK
-- fk_trabajos_solicitud_asignada, which already forbids deleting or re-assigning such a request.

ALTER TABLE public."solicitudes_servicio" ADD COLUMN "cancelada_en" timestamp(3);
ALTER TABLE public."solicitudes_servicio" ADD COLUMN "cancelada_por" text;

ALTER TABLE public."solicitudes_servicio" ADD CONSTRAINT "ck_solicitudes_servicio_cancelacion" CHECK (
  ("cancelada_en" IS NULL) = ("cancelada_por" IS NULL)
  AND ("cancelada_en" IS NULL OR "estado" = 'cerrada')
);
