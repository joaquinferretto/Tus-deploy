-- GeoJSON coverage for administered neighbourhoods. The existing point remains the approximate
-- centre used by current maps; no private address or exact provider location is stored.
ALTER TABLE "barrios" ADD COLUMN "poligono" JSONB;

UPDATE "barrios"
SET "poligono" = jsonb_build_object(
  'type', 'Polygon',
  'coordinates', jsonb_build_array(jsonb_build_array(
    jsonb_build_array(COALESCE("longitud", -58.8295) - 0.003, COALESCE("latitud", -27.4695) - 0.003),
    jsonb_build_array(COALESCE("longitud", -58.8295) + 0.003, COALESCE("latitud", -27.4695) - 0.003),
    jsonb_build_array(COALESCE("longitud", -58.8295) + 0.003, COALESCE("latitud", -27.4695) + 0.003),
    jsonb_build_array(COALESCE("longitud", -58.8295) - 0.003, COALESCE("latitud", -27.4695) + 0.003),
    jsonb_build_array(COALESCE("longitud", -58.8295) - 0.003, COALESCE("latitud", -27.4695) - 0.003)
  ));

ALTER TABLE "barrios" ALTER COLUMN "poligono" SET NOT NULL;
ALTER TABLE "barrios" ADD CONSTRAINT "ck_barrios_poligono_geojson" CHECK (
  "poligono"->>'type' = 'Polygon'
  AND jsonb_typeof("poligono"->'coordinates') = 'array'
  AND jsonb_array_length("poligono"->'coordinates') = 1
  AND jsonb_array_length("poligono"->'coordinates'->0) >= 4
);
