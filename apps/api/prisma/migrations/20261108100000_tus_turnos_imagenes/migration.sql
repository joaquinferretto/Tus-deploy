-- TURNOS-WHATSAPP-01: up to two optional pictures a client attaches to its request of turno (what
-- has to be repaired, the place). Validated by the API (magic bytes, no metadata, bounded size) and
-- stored like the pictures of the public requests ("fotos_solicitud"): the repository has no
-- external object storage. Only the client and the provider of that turno read them.
-- Forward-only and additive: one new table.

CREATE TABLE IF NOT EXISTS public."imagenes_reserva" (
  "id"           TEXT PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "reserva_id"   TEXT NOT NULL,
  "orden"        SMALLINT NOT NULL,
  "tipo_mime"    TEXT NOT NULL,
  "tamano_bytes" INTEGER NOT NULL,
  "ancho"        INTEGER NOT NULL,
  "alto"         INTEGER NOT NULL,
  "sha256"       TEXT NOT NULL,
  "contenido"    BYTEA NOT NULL,
  "creado_en"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_imagenes_reserva_reserva" FOREIGN KEY ("reserva_id")
    REFERENCES public."reservas" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "uq_imagenes_reserva_orden" UNIQUE ("reserva_id", "orden"),
  -- At most two pictures per request: positions 0 and 1.
  CONSTRAINT "ck_imagenes_reserva_orden" CHECK ("orden" IN (0, 1)),
  CONSTRAINT "ck_imagenes_reserva_tipo" CHECK ("tipo_mime" IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "ck_imagenes_reserva_tamano" CHECK ("tamano_bytes" > 0 AND "tamano_bytes" <= 2097152)
);
