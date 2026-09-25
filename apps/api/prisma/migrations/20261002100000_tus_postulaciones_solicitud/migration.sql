-- Postulaciones a solicitudes públicas: un prestador (de cualquier oficio) se ofrece para una
-- solicitud del mapa y el cliente decide a quién acepta. Aceptar convierte la solicitud en
-- dirigida y 'aceptada' para ese prestador (mismas columnas de 20261001100000).
-- Forward-only y aditiva: una tabla nueva. No se modifican constraints ni datos existentes.

CREATE TABLE public."postulaciones_solicitud" (
  "id" text NOT NULL,
  "solicitud_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "prestador_id" text NOT NULL,
  "mensaje" text,
  "estado" text NOT NULL DEFAULT 'pendiente',
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "postulaciones_solicitud_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_postulaciones_solicitud_solicitud" FOREIGN KEY ("solicitud_id") REFERENCES public."solicitudes_servicio"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_postulaciones_solicitud_prestador" FOREIGN KEY ("prestador_tenant_id", "prestador_id") REFERENCES public."prestadores"("tenant_id", "prestador_id") ON DELETE RESTRICT,
  CONSTRAINT "ck_postulaciones_solicitud_estado" CHECK ("estado" IN ('pendiente', 'aceptada', 'rechazada', 'retirada')),
  CONSTRAINT "ck_postulaciones_solicitud_mensaje" CHECK ("mensaje" IS NULL OR length("mensaje") BETWEEN 1 AND 300)
);
-- Un prestador se postula una sola vez por solicitud.
CREATE UNIQUE INDEX "uq_postulaciones_solicitud_prestador" ON public."postulaciones_solicitud"("solicitud_id", "prestador_tenant_id");
-- Como máximo un postulante aceptado por solicitud (también frena dos aceptaciones concurrentes).
CREATE UNIQUE INDEX "uq_postulaciones_solicitud_aceptada" ON public."postulaciones_solicitud"("solicitud_id") WHERE "estado" = 'aceptada';
-- "Mis postulaciones" del prestador.
CREATE INDEX "ix_postulaciones_solicitud_prestador_fecha" ON public."postulaciones_solicitud"("prestador_tenant_id", "fecha_creacion");
