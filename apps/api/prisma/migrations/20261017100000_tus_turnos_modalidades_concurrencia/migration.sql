-- Turnos: modalidades por prestador + servicio, tarifas y concurrencia sin solapamiento (PostgreSQL 16 btree_gist)

-- 1. Switches en perfiles de prestadores
ALTER TABLE public."perfiles_publicos_prestador"
  ADD COLUMN IF NOT EXISTS "acepta_turnos" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "acepta_solicitudes" boolean NOT NULL DEFAULT true;

-- 2. Modalidades y configuración por servicio de prestador
ALTER TABLE public."perfil_servicios"
  ADD COLUMN IF NOT EXISTS "turnos_habilitados" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "solicitudes_habilitadas" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "precio_base" bigint,
  ADD COLUMN IF NOT EXISTS "duracion_minutos" integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "buffer_minutos" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "modalidad" text NOT NULL DEFAULT 'presencial';

-- 3. Tarifas por prestador + servicio
CREATE TABLE IF NOT EXISTS public."tarifas_servicio_prestador" (
  "id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "perfil_id" text NOT NULL,
  "oficio_id" text NOT NULL,
  "nombre" text NOT NULL,
  "duracion_minutos" integer NOT NULL,
  "precio" bigint NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "orden" integer NOT NULL DEFAULT 0,
  "fecha_creacion" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fecha_actualizacion" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tarifas_servicio_prestador_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_tarifas_servicio_perfil" FOREIGN KEY ("perfil_id")
    REFERENCES public."perfiles_publicos_prestador"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_tarifas_servicio_oficio" FOREIGN KEY ("oficio_id")
    REFERENCES public."oficios_servicio"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "ix_tarifas_servicio_perfil_oficio"
  ON public."tarifas_servicio_prestador"("perfil_id", "oficio_id");

-- 4. Snapshot de precio, datos de cliente/invitado y auditoría admin en reservas
ALTER TABLE public."reservas"
  ADD COLUMN IF NOT EXISTS "tarifa_id" text,
  ADD COLUMN IF NOT EXISTS "tarifa_nombre" text,
  ADD COLUMN IF NOT EXISTS "duracion_minutos" integer,
  ADD COLUMN IF NOT EXISTS "precio_lista" bigint,
  ADD COLUMN IF NOT EXISTS "precio_final" bigint,
  ADD COLUMN IF NOT EXISTS "moneda" text DEFAULT 'ARS',
  ADD COLUMN IF NOT EXISTS "cliente_nombre" text,
  ADD COLUMN IF NOT EXISTS "cliente_telefono" text,
  ADD COLUMN IF NOT EXISTS "cliente_email" text,
  ADD COLUMN IF NOT EXISTS "es_invitado" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "modificado_por_admin_id" text,
  ADD COLUMN IF NOT EXISTS "motivo_modificacion_precio" text,
  ADD COLUMN IF NOT EXISTS "forzado_fuera_horario" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "motivo_forzado" text,
  ADD COLUMN IF NOT EXISTS "notas" text;

-- 5. Extensión btree_gist y exclusión física contra solapamiento de reservas en el mismo calendario
-- reservas.fecha_inicio/fecha_fin son timestamp WITHOUT time zone: el rango debe ser tsrange.
-- tstzrange forzaría una conversión dependiente de TimeZone (STABLE) y PostgreSQL rechaza la
-- expresión de índice con 42P17 (falló así en producción el 2026-09-30).
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ex_reservas_sin_solapamiento'
  ) THEN
    ALTER TABLE public."reservas"
      ADD CONSTRAINT "ex_reservas_sin_solapamiento"
      EXCLUDE USING gist (
        "calendario_id" WITH =,
        tsrange("fecha_inicio", "fecha_fin", '[)') WITH &&
      )
      WHERE ("estado" NOT IN ('cancelled', 'cancelled-late', 'no-show'));
  END IF;
END $$;
