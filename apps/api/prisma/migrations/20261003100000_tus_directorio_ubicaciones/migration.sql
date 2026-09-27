-- Public provider coverage is an additive extension of the existing provider profile.
-- It stores only public zones and delivery mode; private identity address data never enters this table.

ALTER TABLE public."perfiles_publicos_prestador"
  ADD COLUMN "zonas_cobertura" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN "modalidad_atencion" text NOT NULL DEFAULT 'domicilio',
  ADD COLUMN "radio_cobertura_km" integer;

UPDATE public."perfiles_publicos_prestador"
SET "zonas_cobertura" = ARRAY["zona"]::text[]
WHERE "zona" IS NOT NULL AND cardinality("zonas_cobertura") = 0;

ALTER TABLE public."perfiles_publicos_prestador"
  ALTER COLUMN "zona" DROP NOT NULL;

ALTER TABLE public."perfiles_publicos_prestador"
  DROP CONSTRAINT "ck_perfiles_publicos_prestador_zona",
  ADD CONSTRAINT "ck_perfiles_publicos_prestador_zona"
    CHECK ("zona" IS NULL OR length("zona") BETWEEN 1 AND 60),
  ADD CONSTRAINT "ck_perfiles_publicos_prestador_zonas_cobertura"
    CHECK (cardinality("zonas_cobertura") BETWEEN 0 AND 8),
  ADD CONSTRAINT "ck_perfiles_publicos_prestador_modalidad"
    CHECK ("modalidad_atencion" IN ('local', 'domicilio', 'mixto')),
  ADD CONSTRAINT "ck_perfiles_publicos_prestador_radio"
    CHECK ("radio_cobertura_km" IS NULL OR "radio_cobertura_km" BETWEEN 1 AND 100);

CREATE INDEX "ix_perfiles_publicos_prestador_modalidad"
  ON public."perfiles_publicos_prestador"("visible", "modalidad_atencion");
