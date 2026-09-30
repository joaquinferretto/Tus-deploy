-- A provider offers many services (Categoria -> Servicio = categorias_servicio -> oficios_servicio).
-- Forward-only and additive: one new relation table, backfilled from the single trade every profile
-- has today. perfiles_publicos_prestador.oficio stays as the PRINCIPAL service (shown first, used
-- by the requests of that profile) and a deferred FK guarantees it is always one of the profile's
-- services, so there is a single source of truth for "which services does this provider offer".

CREATE TABLE public."perfil_servicios" (
  "perfil_id" text NOT NULL,
  "oficio_id" text NOT NULL,
  "orden" integer NOT NULL DEFAULT 0,
  "creado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "perfil_servicios_pkey" PRIMARY KEY ("perfil_id", "oficio_id"),
  CONSTRAINT "ck_perfil_servicios_orden" CHECK ("orden" BETWEEN 0 AND 99),
  CONSTRAINT "fk_perfil_servicios_perfil" FOREIGN KEY ("perfil_id")
    REFERENCES public."perfiles_publicos_prestador"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_perfil_servicios_oficio" FOREIGN KEY ("oficio_id")
    REFERENCES public."oficios_servicio"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "ix_perfil_servicios_oficio" ON public."perfil_servicios"("oficio_id");

-- Backfill: every current profile keeps its trade as its first (principal) service.
INSERT INTO public."perfil_servicios" ("perfil_id", "oficio_id", "orden", "creado_en")
SELECT "id", "oficio", 0, "fecha_creacion" FROM public."perfiles_publicos_prestador"
ON CONFLICT DO NOTHING;

-- The principal service must be one of the profile's services. Deferred: a profile and its set
-- are written in one transaction and checked at commit.
ALTER TABLE public."perfiles_publicos_prestador"
  ADD CONSTRAINT "fk_perfiles_servicio_principal" FOREIGN KEY ("id", "oficio")
  REFERENCES public."perfil_servicios"("perfil_id", "oficio_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
