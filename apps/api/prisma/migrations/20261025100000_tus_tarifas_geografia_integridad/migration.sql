-- INTEGRIDAD-01 (tarifas de prestadores y geografía). Forward-only. Nothing is dropped; no column
-- or table is added. New CHECK / FOREIGN KEY constraints are NOT VALID (see
-- docs/database/AUDITORIA_INTEGRIDAD_2026-10.md for the read-only checks before validating them).

-- 1. A tarifa belongs to a service the profile really offers. The application removes the tarifas
--    of a service together with the service (same transaction); the database never deletes them on
--    its own and refuses to leave a tarifa without its service.
ALTER TABLE public."tarifas_servicio_prestador"
  ADD CONSTRAINT "ck_tarifas_servicio_prestador_duracion" CHECK ("duracion_minutos" >= 1) NOT VALID;

ALTER TABLE public."tarifas_servicio_prestador"
  ADD CONSTRAINT "ck_tarifas_servicio_prestador_precio" CHECK ("precio" >= 0) NOT VALID;

ALTER TABLE public."tarifas_servicio_prestador"
  ADD CONSTRAINT "fk_tarifas_servicio_perfil_servicio" FOREIGN KEY ("perfil_id", "oficio_id")
    REFERENCES public."perfil_servicios"("perfil_id", "oficio_id") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID;

-- 2. A barrio and its zona belong to the same locality.
CREATE UNIQUE INDEX "uq_zonas_ubicacion_id_localidad" ON public."zonas_ubicacion"("id", "localidad_id");

ALTER TABLE public."barrios"
  ADD CONSTRAINT "fk_barrios_zona_localidad" FOREIGN KEY ("zona_id", "localidad_id")
    REFERENCES public."zonas_ubicacion"("id", "localidad_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;

-- 3. localidades.provincia (legacy text read by the service catalog) can no longer contradict
--    provincia_id: when the reference exists, the text is the name of that province.
CREATE FUNCTION public."tus_localidad_provincia_derivada"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  nombre_provincia text;
BEGIN
  IF NEW."provincia_id" IS NOT NULL THEN
    SELECT p."nombre" INTO nombre_provincia FROM public."provincias" p WHERE p."id" = NEW."provincia_id";
    -- An unknown province is refused by fk_localidades_provincia, not here.
    IF FOUND THEN
      NEW."provincia" := nombre_provincia;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tr_localidades_provincia_derivada"
  BEFORE INSERT OR UPDATE OF "provincia", "provincia_id" ON public."localidades"
  FOR EACH ROW EXECUTE FUNCTION public."tus_localidad_provincia_derivada"();

-- Renaming a province renames it in its localities.
CREATE FUNCTION public."tus_provincia_renombrada"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public."localidades" SET "provincia" = NEW."nombre" WHERE "provincia_id" = NEW."id" AND "provincia" IS DISTINCT FROM NEW."nombre";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tr_provincias_renombrada"
  AFTER UPDATE OF "nombre" ON public."provincias"
  FOR EACH ROW WHEN (OLD."nombre" IS DISTINCT FROM NEW."nombre")
  EXECUTE FUNCTION public."tus_provincia_renombrada"();

-- Existing rows whose text already differs from their province.
UPDATE public."localidades" l
   SET "provincia" = p."nombre"
  FROM public."provincias" p
 WHERE p."id" = l."provincia_id" AND l."provincia" IS DISTINCT FROM p."nombre";
