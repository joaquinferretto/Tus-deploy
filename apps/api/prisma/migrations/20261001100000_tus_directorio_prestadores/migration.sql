-- Directorio "Buscar trabajador", solicitudes dirigidas a un prestador e imágenes de solicitudes.
-- Forward-only y aditiva: dos tablas nuevas y columnas/constraints nuevos en solicitudes_servicio.
-- No se modifican constraints ni datos existentes.

-- Perfil público del prestador: lo que el prestador elige mostrar en el directorio. Nunca contiene
-- dirección, teléfono, email, documento ni coordenadas: solo barrio (zona aproximada).
CREATE TABLE public."perfiles_publicos_prestador" (
  "id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "prestador_id" text NOT NULL,
  "nombre_publico" text NOT NULL,
  "oficio" text NOT NULL,
  "zona" text NOT NULL,
  "descripcion" text,
  "anios_experiencia" integer,
  "visible" boolean NOT NULL DEFAULT true,
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "perfiles_publicos_prestador_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_perfiles_publicos_prestador_prestador" FOREIGN KEY ("tenant_id", "prestador_id") REFERENCES public."prestadores"("tenant_id", "prestador_id") ON DELETE RESTRICT,
  CONSTRAINT "ck_perfiles_publicos_prestador_oficio" CHECK ("oficio" IN ('plomeria', 'electricidad', 'mecanica', 'pintura', 'aire', 'otros')),
  CONSTRAINT "ck_perfiles_publicos_prestador_nombre" CHECK (length("nombre_publico") BETWEEN 2 AND 60),
  CONSTRAINT "ck_perfiles_publicos_prestador_zona" CHECK (length("zona") BETWEEN 1 AND 60),
  CONSTRAINT "ck_perfiles_publicos_prestador_descripcion" CHECK ("descripcion" IS NULL OR length("descripcion") <= 600),
  CONSTRAINT "ck_perfiles_publicos_prestador_experiencia" CHECK ("anios_experiencia" IS NULL OR "anios_experiencia" BETWEEN 0 AND 70)
);
-- Un perfil público por prestador.
CREATE UNIQUE INDEX "uq_perfiles_publicos_prestador_prestador" ON public."perfiles_publicos_prestador"("tenant_id", "prestador_id");
-- Directorio: visibles por oficio.
CREATE INDEX "ix_perfiles_publicos_prestador_oficio" ON public."perfiles_publicos_prestador"("visible", "oficio");

-- Solicitudes dirigidas: la misma solicitud TUS, con origen y, si el cliente eligió un prestador,
-- el prestador destino y el estado de su respuesta. "Elegido" no es "confirmado": la asignación
-- queda 'pendiente' hasta que el prestador la acepta.
ALTER TABLE public."solicitudes_servicio"
  ADD COLUMN "origen" text NOT NULL DEFAULT 'web_publica',
  ADD COLUMN "visibilidad" text NOT NULL DEFAULT 'publica',
  ADD COLUMN "prestador_tenant_id" text,
  ADD COLUMN "prestador_id" text,
  ADD COLUMN "estado_asignacion" text,
  ADD COLUMN "respondida_en" timestamp(3);
ALTER TABLE public."solicitudes_servicio"
  ADD CONSTRAINT "ck_solicitudes_servicio_origen" CHECK ("origen" IN ('web_publica', 'web_assistant', 'web_directory', 'whatsapp')),
  ADD CONSTRAINT "ck_solicitudes_servicio_visibilidad" CHECK ("visibilidad" IN ('publica', 'dirigida')),
  ADD CONSTRAINT "ck_solicitudes_servicio_asignacion" CHECK ("estado_asignacion" IS NULL OR "estado_asignacion" IN ('pendiente', 'aceptada', 'rechazada', 'cancelada')),
  ADD CONSTRAINT "ck_solicitudes_servicio_dirigida" CHECK (
    ("visibilidad" = 'publica' AND "prestador_tenant_id" IS NULL AND "prestador_id" IS NULL AND "estado_asignacion" IS NULL)
    OR ("visibilidad" = 'dirigida' AND "prestador_tenant_id" IS NOT NULL AND "prestador_id" IS NOT NULL AND "estado_asignacion" IS NOT NULL)
  ),
  ADD CONSTRAINT "fk_solicitudes_servicio_prestador" FOREIGN KEY ("prestador_tenant_id", "prestador_id") REFERENCES public."prestadores"("tenant_id", "prestador_id") ON DELETE RESTRICT;
-- Bandeja del prestador: solicitudes dirigidas por estado.
CREATE INDEX "ix_solicitudes_servicio_prestador_asignacion" ON public."solicitudes_servicio"("prestador_tenant_id", "estado_asignacion", "fecha_creacion");

-- Hasta 2 fotos por solicitud, sin metadata (EXIF/GPS eliminados antes de guardar).
CREATE TABLE public."imagenes_solicitud" (
  "id" text NOT NULL,
  "solicitud_id" text NOT NULL,
  "orden" integer NOT NULL,
  "tipo_mime" text NOT NULL,
  "tamano_bytes" integer NOT NULL,
  "sha256" text NOT NULL,
  "contenido" bytea NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "imagenes_solicitud_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_imagenes_solicitud_solicitud" FOREIGN KEY ("solicitud_id") REFERENCES public."solicitudes_servicio"("id") ON DELETE RESTRICT,
  CONSTRAINT "ck_imagenes_solicitud_orden" CHECK ("orden" IN (1, 2)),
  CONSTRAINT "ck_imagenes_solicitud_tipo" CHECK ("tipo_mime" IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "ck_imagenes_solicitud_tamano" CHECK ("tamano_bytes" BETWEEN 1 AND 3145728),
  CONSTRAINT "ck_imagenes_solicitud_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "uq_imagenes_solicitud_orden" ON public."imagenes_solicitud"("solicitud_id", "orden");
