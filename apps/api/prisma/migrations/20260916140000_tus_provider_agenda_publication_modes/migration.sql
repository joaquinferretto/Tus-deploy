-- WEB-04D1: canonical provider agenda metadata and publication reservation modes.
-- Legacy service/calendar references remain preserved and are not reinterpreted.

ALTER TABLE public."publicaciones"
  ADD COLUMN "modalidad_reserva" text,
  ADD COLUMN "duracion_estimada_minutos" integer,
  ADD COLUMN "modalidad_precio" text;

ALTER TABLE public."calendarios"
  ADD COLUMN "prestador_id" text,
  ADD COLUMN "granularidad_minutos" integer NOT NULL DEFAULT 15,
  ADD COLUMN "buffer_minutos" integer NOT NULL DEFAULT 0;

ALTER TABLE public."reservas"
  ALTER COLUMN "servicio_id" DROP NOT NULL,
  ADD COLUMN "publicacion_id" text;

-- Existing marketplace prices are fixed-price facts. Existing service durations
-- are fixed only when the source contains a positive duration.
UPDATE public."publicaciones"
SET "modalidad_precio" = 'precio_fijo'
WHERE "modalidad_precio" IS NULL;

UPDATE public."publicaciones"
SET "modalidad_reserva" = 'turno_fijo'
WHERE "modalidad_reserva" IS NULL
  AND "tipo" = 'service'
  AND "duracion_minutos" IS NOT NULL
  AND "duracion_minutos" > 0;

ALTER TABLE public."publicaciones"
  ADD CONSTRAINT "ck_publicaciones_duracion_estimada_positiva"
    CHECK ("duracion_estimada_minutos" IS NULL OR "duracion_estimada_minutos" > 0),
  ADD CONSTRAINT "ck_publicaciones_modalidad_reserva"
    CHECK ("modalidad_reserva" IS NULL OR "modalidad_reserva" IN ('turno_fijo', 'visita_diagnostico', 'duracion_estimada', 'requiere_presupuesto')),
  ADD CONSTRAINT "ck_publicaciones_modalidad_precio"
    CHECK ("modalidad_precio" IS NULL OR "modalidad_precio" IN ('precio_fijo', 'precio_desde', 'por_hora', 'presupuesto'));

ALTER TABLE public."calendarios"
  ADD CONSTRAINT "ck_calendarios_granularidad_positiva"
    CHECK ("granularidad_minutos" > 0),
  ADD CONSTRAINT "ck_calendarios_buffer_no_negativo"
    CHECK ("buffer_minutos" >= 0);

CREATE UNIQUE INDEX "uq_calendarios_tenant_prestador"
  ON public."calendarios" ("tenant_id", "prestador_id");

CREATE INDEX "idx_calendarios_tenant_prestador_estado"
  ON public."calendarios" ("tenant_id", "prestador_id", "estado");

CREATE INDEX "idx_reservas_tenant_publicacion_franja"
  ON public."reservas" ("tenant_id", "publicacion_id", "fecha_inicio", "fecha_fin");

ALTER TABLE public."calendarios"
  ADD CONSTRAINT "fk_calendarios_prestadores"
  FOREIGN KEY ("tenant_id", "prestador_id")
  REFERENCES public."prestadores" ("tenant_id", "prestador_id")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION
  NOT VALID;

ALTER TABLE public."reservas"
  ADD CONSTRAINT "fk_reservas_publicaciones"
  FOREIGN KEY ("tenant_id", "publicacion_id")
  REFERENCES public."publicaciones" ("tenant_id", "id")
  ON DELETE RESTRICT
  ON UPDATE NO ACTION
  NOT VALID;

ALTER TABLE public."calendarios"
  VALIDATE CONSTRAINT "fk_calendarios_prestadores";

ALTER TABLE public."reservas"
  VALIDATE CONSTRAINT "fk_reservas_publicaciones";
