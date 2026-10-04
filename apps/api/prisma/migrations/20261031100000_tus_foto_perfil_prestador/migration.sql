-- Profile photo of a provider (the avatar of the directory, the map and the public profile).
--
-- Additive and forward-only: one new nullable column and one new table; no existing row, column
-- or constraint changes. One row per profile, so a new photo overwrites the previous one. The
-- bytes are stored already sanitized (no metadata); the CHECKs repeat the limits the application
-- enforces, so nothing else can be stored even by a writer that skipped it.

ALTER TABLE public."perfiles_publicos_prestador"
  ADD COLUMN "foto_sha256" text,
  ADD CONSTRAINT "ck_perfiles_publicos_prestador_foto_sha256" CHECK ("foto_sha256" IS NULL OR "foto_sha256" ~ '^[a-f0-9]{64}$');

CREATE TABLE public."fotos_perfil_prestador" (
  "perfil_id" text NOT NULL,
  "tipo_mime" text NOT NULL,
  "tamano_bytes" integer NOT NULL,
  "ancho" integer NOT NULL,
  "alto" integer NOT NULL,
  "sha256" text NOT NULL,
  "contenido" bytea NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "fotos_perfil_prestador_pkey" PRIMARY KEY ("perfil_id"),
  CONSTRAINT "fk_fotos_perfil_prestador_perfil" FOREIGN KEY ("perfil_id") REFERENCES public."perfiles_publicos_prestador"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_fotos_perfil_prestador_tipo" CHECK ("tipo_mime" IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "ck_fotos_perfil_prestador_tamano" CHECK ("tamano_bytes" BETWEEN 1 AND 2097152 AND octet_length("contenido") = "tamano_bytes"),
  CONSTRAINT "ck_fotos_perfil_prestador_dimensiones" CHECK ("ancho" BETWEEN 96 AND 4096 AND "alto" BETWEEN 96 AND 4096),
  CONSTRAINT "ck_fotos_perfil_prestador_sha256" CHECK ("sha256" ~ '^[a-f0-9]{64}$')
);
