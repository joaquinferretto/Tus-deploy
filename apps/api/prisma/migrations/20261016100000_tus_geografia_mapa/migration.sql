-- Editable geography for the map (FASE directorio y mapa). Forward-only and additive; existing rows
-- keep every value (new columns are NULL or false).
--
-- Resolution of a provider on the public map (deterministic):
--   1. its exact point, only when the provider chose to show it (mostrar_ubicacion_exacta);
--   2. a point INSIDE the polygon of its neighbourhood (barrio);
--   3. a point INSIDE the polygon of its zone;
--   4. the reference point of its neighbourhood, else of its zone;
--   5. nothing (never an invented coordinate).
-- The stored polygons are the geographic authority; an external reverse geocoder is only used to
-- MATCH existing localities/zones/neighbourhoods by name when no polygon contains a point.

-- Zones: optional polygon (same GeoJSON Polygon format as barrios.poligono) and reference point.
ALTER TABLE public."zonas_ubicacion" ADD COLUMN "poligono" jsonb;
ALTER TABLE public."zonas_ubicacion" ADD COLUMN "latitud" double precision;
ALTER TABLE public."zonas_ubicacion" ADD COLUMN "longitud" double precision;
ALTER TABLE public."zonas_ubicacion" ADD CONSTRAINT "ck_zonas_ubicacion_poligono_geojson" CHECK (
  "poligono" IS NULL OR (
    "poligono"->>'type' = 'Polygon'
    AND jsonb_typeof("poligono"->'coordinates') = 'array'
    AND jsonb_array_length("poligono"->'coordinates') = 1
    AND jsonb_array_length("poligono"->'coordinates'->0) >= 4
  )
);
ALTER TABLE public."zonas_ubicacion" ADD CONSTRAINT "ck_zonas_ubicacion_punto" CHECK (
  ("latitud" IS NULL) = ("longitud" IS NULL)
  AND ("latitud" IS NULL OR ("latitud" BETWEEN -90 AND 90 AND "longitud" BETWEEN -180 AND 180))
);

-- Neighbourhoods: the polygon becomes optional (an administrator can remove it; the reference
-- point stays as fallback). The GeoJSON check keeps validating any stored polygon.
ALTER TABLE public."barrios" ALTER COLUMN "poligono" DROP NOT NULL;
ALTER TABLE public."barrios" DROP CONSTRAINT "ck_barrios_poligono_geojson";
ALTER TABLE public."barrios" ADD CONSTRAINT "ck_barrios_poligono_geojson" CHECK (
  "poligono" IS NULL OR (
    "poligono"->>'type' = 'Polygon'
    AND jsonb_typeof("poligono"->'coordinates') = 'array'
    AND jsonb_array_length("poligono"->'coordinates') = 1
    AND jsonb_array_length("poligono"->'coordinates'->0) >= 4
  )
);

-- Provider: exact point chosen on the map (by the provider or an administrator), whether it may be
-- shown publicly, and the internal neighbourhood/zone it is associated with (by polygon, by the
-- geocoder name match or manually). The exact point is never published unless allowed.
ALTER TABLE public."perfiles_publicos_prestador" ADD COLUMN "latitud" double precision;
ALTER TABLE public."perfiles_publicos_prestador" ADD COLUMN "longitud" double precision;
ALTER TABLE public."perfiles_publicos_prestador" ADD COLUMN "mostrar_ubicacion_exacta" boolean NOT NULL DEFAULT false;
ALTER TABLE public."perfiles_publicos_prestador" ADD COLUMN "barrio_id" text;
ALTER TABLE public."perfiles_publicos_prestador" ADD COLUMN "zona_id" text;
ALTER TABLE public."perfiles_publicos_prestador" ADD COLUMN "ubicacion_asociacion" text;
ALTER TABLE public."perfiles_publicos_prestador" ADD CONSTRAINT "ck_perfiles_publicos_prestador_punto" CHECK (
  ("latitud" IS NULL) = ("longitud" IS NULL)
  AND ("latitud" IS NULL OR ("latitud" BETWEEN -90 AND 90 AND "longitud" BETWEEN -180 AND 180))
);
ALTER TABLE public."perfiles_publicos_prestador" ADD CONSTRAINT "ck_perfiles_publicos_prestador_asociacion" CHECK (
  "ubicacion_asociacion" IS NULL
  OR "ubicacion_asociacion" IN ('poligono_barrio', 'poligono_zona', 'geocodificador', 'manual', 'sin_asociar')
);
ALTER TABLE public."perfiles_publicos_prestador" ADD CONSTRAINT "fk_perfiles_publicos_prestador_barrio"
  FOREIGN KEY ("barrio_id") REFERENCES public."barrios"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE public."perfiles_publicos_prestador" ADD CONSTRAINT "fk_perfiles_publicos_prestador_zona"
  FOREIGN KEY ("zona_id") REFERENCES public."zonas_ubicacion"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "ix_perfiles_publicos_prestador_barrio" ON public."perfiles_publicos_prestador"("barrio_id");
CREATE INDEX "ix_perfiles_publicos_prestador_zona" ON public."perfiles_publicos_prestador"("zona_id");
