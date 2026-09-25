-- Solicitudes de servicio publicadas por clientes (mapa público de la home).
-- Forward-only y aditiva: una tabla nueva. Privacidad: solo barrio y un punto aproximado
-- (3 decimales) derivado del barrio; nunca dirección, teléfono ni coordenadas exactas.

CREATE TABLE public."solicitudes_servicio" (
  "id" text NOT NULL,
  "cuenta_id" text NOT NULL,
  "categoria" text NOT NULL,
  "titulo" text NOT NULL,
  "descripcion" text,
  "nombre_publico" text NOT NULL,
  "zona" text NOT NULL,
  "latitud" double precision NOT NULL,
  "longitud" double precision NOT NULL,
  "presupuesto_maximo" integer,
  "urgencia" text NOT NULL,
  "estado" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  "expira_en" timestamp(3) NOT NULL,
  CONSTRAINT "solicitudes_servicio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_solicitudes_servicio_cuenta" FOREIGN KEY ("cuenta_id") REFERENCES public."Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "ck_solicitudes_servicio_categoria" CHECK ("categoria" IN ('plomeria', 'electricidad', 'mecanica', 'pintura', 'aire', 'otros')),
  CONSTRAINT "ck_solicitudes_servicio_urgencia" CHECK ("urgencia" IN ('urgente', 'hoy_manana', 'esta_semana', 'sin_apuro')),
  CONSTRAINT "ck_solicitudes_servicio_estado" CHECK ("estado" IN ('abierta', 'cerrada')),
  CONSTRAINT "ck_solicitudes_servicio_titulo" CHECK (length("titulo") BETWEEN 5 AND 90),
  CONSTRAINT "ck_solicitudes_servicio_descripcion" CHECK ("descripcion" IS NULL OR length("descripcion") <= 500),
  CONSTRAINT "ck_solicitudes_servicio_presupuesto" CHECK ("presupuesto_maximo" IS NULL OR "presupuesto_maximo" > 0),
  CONSTRAINT "ck_solicitudes_servicio_coordenadas" CHECK ("latitud" BETWEEN -90 AND 90 AND "longitud" BETWEEN -180 AND 180)
);
-- Listado público: abiertas más recientes primero.
CREATE INDEX "ix_solicitudes_servicio_estado_fecha" ON public."solicitudes_servicio"("estado", "fecha_creacion" DESC);
-- "Mis solicitudes" y límites por cuenta.
CREATE INDEX "ix_solicitudes_servicio_cuenta_fecha" ON public."solicitudes_servicio"("cuenta_id", "fecha_creacion");
