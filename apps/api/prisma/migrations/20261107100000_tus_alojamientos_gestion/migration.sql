-- ALOJAMIENTOS-GESTION-01: what the lodging module needs to work end to end.
-- 1. "archivos_imagen_alojamiento": the bytes of a photo uploaded for an alojamiento (validated by
--    magic bytes and re-emitted without metadata by the API). One row per image; an image that is
--    only an external URL has no row here.
-- 2. "historial_reservas_alojamiento": every change of state of a reservation, with the previous
--    state and who did it. A cancellation is a row here and a state, never a deleted reservation.
-- Forward-only and additive: two new tables, nothing existing changes.

CREATE TABLE IF NOT EXISTS public."archivos_imagen_alojamiento" (
  "imagen_id"    TEXT PRIMARY KEY,
  "tipo_mime"    TEXT NOT NULL,
  "tamano_bytes" INTEGER NOT NULL,
  "ancho"        INTEGER NOT NULL,
  "alto"         INTEGER NOT NULL,
  "sha256"       TEXT NOT NULL,
  "contenido"    BYTEA NOT NULL,
  "creado_en"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_archivos_imagen_alojamiento_imagen" FOREIGN KEY ("imagen_id")
    REFERENCES public."imagenes_alojamiento" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ck_archivos_imagen_alojamiento_tipo" CHECK ("tipo_mime" IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "ck_archivos_imagen_alojamiento_tamano" CHECK ("tamano_bytes" > 0 AND "tamano_bytes" <= 2097152)
);

CREATE TABLE IF NOT EXISTS public."historial_reservas_alojamiento" (
  "id"              TEXT PRIMARY KEY,
  "reserva_id"      TEXT NOT NULL,
  "estado_anterior" TEXT,
  "estado_nuevo"    TEXT NOT NULL,
  "actor_id"        TEXT,
  "actor_rol"       TEXT NOT NULL,
  "motivo"          TEXT,
  "creado_en"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_historial_reservas_alojamiento_reserva" FOREIGN KEY ("reserva_id")
    REFERENCES public."reservas_alojamiento" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_historial_reservas_alojamiento_rol" CHECK ("actor_rol" IN ('cliente', 'propietario', 'admin', 'sistema'))
);

CREATE INDEX IF NOT EXISTS "ix_historial_reservas_alojamiento_reserva"
  ON public."historial_reservas_alojamiento" ("reserva_id", "creado_en");

-- "Mis reservas": the reservations of an account, newest stay first.
CREATE INDEX IF NOT EXISTS "ix_reservas_alojamiento_cliente"
  ON public."reservas_alojamiento" ("cliente_id", "fecha_inicio");
