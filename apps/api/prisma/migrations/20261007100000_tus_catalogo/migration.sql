-- Administered catalog of TUS: categories, trades (with synonyms and icon) and locations
-- (locality -> zone -> neighbourhood). Forward-only and additive: new tables, seeded with the values
-- that were hard-coded until now (same ids, so profiles and requests keep pointing to them), plus
-- Cerrajería and Albañilería split out of "Otros". The CHECK constraints that pinned the trade ids
-- are replaced by foreign keys: new trades can be created from the admin panel without a migration
-- and no row can point to a trade that does not exist. Nothing is deleted: activo = false.

CREATE TABLE public."categorias_servicio" (
  "id" text NOT NULL,
  "nombre" text NOT NULL,
  "slug" text NOT NULL,
  "descripcion" text,
  "activo" boolean NOT NULL DEFAULT true,
  "orden" integer NOT NULL DEFAULT 0,
  "creado_en" timestamp(3) NOT NULL,
  "actualizado_en" timestamp(3) NOT NULL,
  CONSTRAINT "categorias_servicio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_categorias_servicio_nombre" CHECK (length(btrim("nombre")) BETWEEN 2 AND 60),
  CONSTRAINT "ck_categorias_servicio_slug" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{0,59}$')
);
CREATE UNIQUE INDEX "uq_categorias_servicio_slug" ON public."categorias_servicio"("slug");
CREATE UNIQUE INDEX "uq_categorias_servicio_nombre_ci" ON public."categorias_servicio"(lower("nombre"));

CREATE TABLE public."oficios_servicio" (
  "id" text NOT NULL,
  "categoria_id" text,
  "nombre" text NOT NULL,
  "profesion" text NOT NULL,
  "slug" text NOT NULL,
  "descripcion" text,
  "icono" text NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "orden" integer NOT NULL DEFAULT 0,
  "creado_en" timestamp(3) NOT NULL,
  "actualizado_en" timestamp(3) NOT NULL,
  CONSTRAINT "oficios_servicio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_oficios_servicio_categoria" FOREIGN KEY ("categoria_id") REFERENCES public."categorias_servicio"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_oficios_servicio_id" CHECK ("id" ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  CONSTRAINT "ck_oficios_servicio_nombre" CHECK (length(btrim("nombre")) BETWEEN 2 AND 60),
  CONSTRAINT "ck_oficios_servicio_slug" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{0,59}$')
);
CREATE UNIQUE INDEX "uq_oficios_servicio_slug" ON public."oficios_servicio"("slug");
CREATE UNIQUE INDEX "uq_oficios_servicio_nombre_ci" ON public."oficios_servicio"(lower("nombre"));
CREATE INDEX "ix_oficios_servicio_categoria" ON public."oficios_servicio"("categoria_id");

CREATE TABLE public."sinonimos_oficio" (
  "id" text NOT NULL,
  "oficio_id" text NOT NULL,
  "termino" text NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  CONSTRAINT "sinonimos_oficio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_sinonimos_oficio_oficio" FOREIGN KEY ("oficio_id") REFERENCES public."oficios_servicio"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ck_sinonimos_oficio_termino" CHECK (length(btrim("termino")) BETWEEN 2 AND 40)
);
CREATE UNIQUE INDEX "uq_sinonimos_oficio_termino" ON public."sinonimos_oficio"("oficio_id", "termino");

CREATE TABLE public."localidades" (
  "id" text NOT NULL,
  "nombre" text NOT NULL,
  "provincia" text NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "orden" integer NOT NULL DEFAULT 0,
  "creado_en" timestamp(3) NOT NULL,
  "actualizado_en" timestamp(3) NOT NULL,
  CONSTRAINT "localidades_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_localidades_nombre" CHECK (length(btrim("nombre")) BETWEEN 2 AND 60)
);
CREATE UNIQUE INDEX "uq_localidades_nombre_ci" ON public."localidades"(lower("nombre"), lower("provincia"));

CREATE TABLE public."zonas_ubicacion" (
  "id" text NOT NULL,
  "localidad_id" text NOT NULL,
  "nombre" text NOT NULL,
  "slug" text NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "orden" integer NOT NULL DEFAULT 0,
  "creado_en" timestamp(3) NOT NULL,
  "actualizado_en" timestamp(3) NOT NULL,
  CONSTRAINT "zonas_ubicacion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_zonas_ubicacion_localidad" FOREIGN KEY ("localidad_id") REFERENCES public."localidades"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_zonas_ubicacion_nombre" CHECK (length(btrim("nombre")) BETWEEN 2 AND 60)
);
CREATE UNIQUE INDEX "uq_zonas_ubicacion_nombre_ci" ON public."zonas_ubicacion"("localidad_id", lower("nombre"));
CREATE INDEX "ix_zonas_ubicacion_localidad" ON public."zonas_ubicacion"("localidad_id");

CREATE TABLE public."barrios" (
  "id" text NOT NULL,
  "localidad_id" text NOT NULL,
  "zona_id" text,
  "nombre" text NOT NULL,
  "slug" text NOT NULL,
  "latitud" double precision,
  "longitud" double precision,
  "activo" boolean NOT NULL DEFAULT true,
  "orden" integer NOT NULL DEFAULT 0,
  "creado_en" timestamp(3) NOT NULL,
  "actualizado_en" timestamp(3) NOT NULL,
  CONSTRAINT "barrios_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_barrios_localidad" FOREIGN KEY ("localidad_id") REFERENCES public."localidades"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fk_barrios_zona" FOREIGN KEY ("zona_id") REFERENCES public."zonas_ubicacion"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_barrios_nombre" CHECK (length(btrim("nombre")) BETWEEN 2 AND 60),
  CONSTRAINT "ck_barrios_punto" CHECK (("latitud" IS NULL) = ("longitud" IS NULL) AND ("latitud" IS NULL OR ("latitud" BETWEEN -90 AND 90 AND "longitud" BETWEEN -180 AND 180)))
);
CREATE UNIQUE INDEX "uq_barrios_nombre_ci" ON public."barrios"("localidad_id", lower("nombre"));
CREATE INDEX "ix_barrios_localidad" ON public."barrios"("localidad_id");
CREATE INDEX "ix_barrios_zona" ON public."barrios"("zona_id");

-- Seed: the catalog that was hard-coded until this migration.
INSERT INTO public."categorias_servicio" ("id", "nombre", "slug", "descripcion", "activo", "orden", "creado_en", "actualizado_en") VALUES ('hogar', 'Hogar y reparaciones', 'hogar', 'Arreglos e instalaciones de la casa.', true, 1, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."categorias_servicio" ("id", "nombre", "slug", "descripcion", "activo", "orden", "creado_en", "actualizado_en") VALUES ('construccion', 'Construcción', 'construccion', 'Obra, paredes y terminaciones.', true, 2, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."categorias_servicio" ("id", "nombre", "slug", "descripcion", "activo", "orden", "creado_en", "actualizado_en") VALUES ('climatizacion', 'Climatización', 'climatizacion', 'Aire acondicionado y calefacción.', true, 3, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."categorias_servicio" ("id", "nombre", "slug", "descripcion", "activo", "orden", "creado_en", "actualizado_en") VALUES ('vehiculos', 'Vehículos', 'vehiculos', 'Autos y motos.', true, 4, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."categorias_servicio" ("id", "nombre", "slug", "descripcion", "activo", "orden", "creado_en", "actualizado_en") VALUES ('otros', 'Otros', 'otros', 'Servicios que todavía no tienen categoría propia.', true, 99, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."oficios_servicio" ("id", "categoria_id", "nombre", "profesion", "slug", "descripcion", "icono", "activo", "orden", "creado_en", "actualizado_en") VALUES ('plomeria', 'hogar', 'Plomería', 'Plomero/a', 'plomeria', NULL, 'plomeria', true, 1, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:plomero', 'plomeria', 'plomero', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:plomera', 'plomeria', 'plomera', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:plomeria', 'plomeria', 'plomeria', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:caneria', 'plomeria', 'caneria', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:cano', 'plomeria', 'cano', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:canilla', 'plomeria', 'canilla', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:agua', 'plomeria', 'agua', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:perdida', 'plomeria', 'perdida', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:perdida de agua', 'plomeria', 'perdida de agua', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:gotea', 'plomeria', 'gotea', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:pierde', 'plomeria', 'pierde', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:bacha', 'plomeria', 'bacha', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:sifon', 'plomeria', 'sifon', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:inodoro', 'plomeria', 'inodoro', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:deposito', 'plomeria', 'deposito', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:termotanque', 'plomeria', 'termotanque', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:calefon', 'plomeria', 'calefon', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:destapacion', 'plomeria', 'destapacion', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:destapar', 'plomeria', 'destapar', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:cloaca', 'plomeria', 'cloaca', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:desague', 'plomeria', 'desague', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:griferia', 'plomeria', 'griferia', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('plomeria:bomba', 'plomeria', 'bomba', true);
INSERT INTO public."oficios_servicio" ("id", "categoria_id", "nombre", "profesion", "slug", "descripcion", "icono", "activo", "orden", "creado_en", "actualizado_en") VALUES ('electricidad', 'hogar', 'Electricidad', 'Electricista', 'electricidad', NULL, 'electricidad', true, 2, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:electricista', 'electricidad', 'electricista', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:electricidad', 'electricidad', 'electricidad', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:luz', 'electricidad', 'luz', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:enchufe', 'electricidad', 'enchufe', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:tomacorriente', 'electricidad', 'tomacorriente', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:termica', 'electricidad', 'termica', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:disyuntor', 'electricidad', 'disyuntor', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:tablero', 'electricidad', 'tablero', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:cable', 'electricidad', 'cable', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:cortocircuito', 'electricidad', 'cortocircuito', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:corto', 'electricidad', 'corto', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:lampara', 'electricidad', 'lampara', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:instalacion', 'electricidad', 'instalacion', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:electrica', 'electricidad', 'electrica', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:instalacion electrica', 'electricidad', 'instalacion electrica', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:ventilador', 'electricidad', 'ventilador', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:techo', 'electricidad', 'techo', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('electricidad:ventilador de techo', 'electricidad', 'ventilador de techo', true);
INSERT INTO public."oficios_servicio" ("id", "categoria_id", "nombre", "profesion", "slug", "descripcion", "icono", "activo", "orden", "creado_en", "actualizado_en") VALUES ('aire', 'climatizacion', 'Aire acondicionado', 'Técnico/a de aire acondicionado', 'aire', NULL, 'aire', true, 3, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:aire', 'aire', 'aire', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:aire acondicionado', 'aire', 'aire acondicionado', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:split', 'aire', 'split', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:frio', 'aire', 'frio', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:enfria', 'aire', 'enfria', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:calor', 'aire', 'calor', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:calefaccion', 'aire', 'calefaccion', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:refrigeracion', 'aire', 'refrigeracion', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:gas', 'aire', 'gas', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:carga', 'aire', 'carga', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:climatizacion', 'aire', 'climatizacion', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:equipo', 'aire', 'equipo', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('aire:equipo de aire', 'aire', 'equipo de aire', true);
INSERT INTO public."oficios_servicio" ("id", "categoria_id", "nombre", "profesion", "slug", "descripcion", "icono", "activo", "orden", "creado_en", "actualizado_en") VALUES ('pintura', 'construccion', 'Pintura', 'Pintor/a', 'pintura', NULL, 'pintura', true, 4, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('pintura:pintor', 'pintura', 'pintor', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('pintura:pintora', 'pintura', 'pintora', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('pintura:pintura', 'pintura', 'pintura', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('pintura:pintar', 'pintura', 'pintar', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('pintura:humedad', 'pintura', 'humedad', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('pintura:enduido', 'pintura', 'enduido', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('pintura:techo', 'pintura', 'techo', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('pintura:fachada', 'pintura', 'fachada', true);
INSERT INTO public."oficios_servicio" ("id", "categoria_id", "nombre", "profesion", "slug", "descripcion", "icono", "activo", "orden", "creado_en", "actualizado_en") VALUES ('albanileria', 'construccion', 'Albañilería', 'Albañil', 'albanileria', NULL, 'albanileria', true, 5, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('albanileria:albanil', 'albanileria', 'albanil', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('albanileria:albanileria', 'albanileria', 'albanileria', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('albanileria:pared', 'albanileria', 'pared', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('albanileria:paredes', 'albanileria', 'paredes', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('albanileria:revoque', 'albanileria', 'revoque', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('albanileria:mamposteria', 'albanileria', 'mamposteria', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('albanileria:ladrillo', 'albanileria', 'ladrillo', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('albanileria:contrapiso', 'albanileria', 'contrapiso', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('albanileria:construccion', 'albanileria', 'construccion', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('albanileria:obra', 'albanileria', 'obra', true);
INSERT INTO public."oficios_servicio" ("id", "categoria_id", "nombre", "profesion", "slug", "descripcion", "icono", "activo", "orden", "creado_en", "actualizado_en") VALUES ('cerrajeria', 'hogar', 'Cerrajería', 'Cerrajero/a', 'cerrajeria', NULL, 'cerrajeria', true, 6, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('cerrajeria:cerrajero', 'cerrajeria', 'cerrajero', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('cerrajeria:cerrajera', 'cerrajeria', 'cerrajera', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('cerrajeria:cerrajeria', 'cerrajeria', 'cerrajeria', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('cerrajeria:cerradura', 'cerrajeria', 'cerradura', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('cerrajeria:llave', 'cerrajeria', 'llave', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('cerrajeria:llaves', 'cerrajeria', 'llaves', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('cerrajeria:puerta trabada', 'cerrajeria', 'puerta trabada', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('cerrajeria:me quede afuera', 'cerrajeria', 'me quede afuera', true);
INSERT INTO public."oficios_servicio" ("id", "categoria_id", "nombre", "profesion", "slug", "descripcion", "icono", "activo", "orden", "creado_en", "actualizado_en") VALUES ('mecanica', 'vehiculos', 'Mecánica', 'Mecánico/a', 'mecanica', NULL, 'mecanica', true, 7, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('mecanica:mecanico', 'mecanica', 'mecanico', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('mecanica:mecanica', 'mecanica', 'mecanica', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('mecanica:auto', 'mecanica', 'auto', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('mecanica:moto', 'mecanica', 'moto', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('mecanica:freno', 'mecanica', 'freno', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('mecanica:frenos', 'mecanica', 'frenos', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('mecanica:motor', 'mecanica', 'motor', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('mecanica:bateria', 'mecanica', 'bateria', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('mecanica:cubierta', 'mecanica', 'cubierta', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('mecanica:aceite', 'mecanica', 'aceite', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('mecanica:embrague', 'mecanica', 'embrague', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('mecanica:arranca', 'mecanica', 'arranca', true);
INSERT INTO public."oficios_servicio" ("id", "categoria_id", "nombre", "profesion", "slug", "descripcion", "icono", "activo", "orden", "creado_en", "actualizado_en") VALUES ('otros', 'otros', 'Otros oficios', 'Oficios varios', 'otros', NULL, 'herramienta', true, 99, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('otros:carpintero', 'otros', 'carpintero', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('otros:carpinteria', 'otros', 'carpinteria', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('otros:mueble', 'otros', 'mueble', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('otros:placard', 'otros', 'placard', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('otros:armado', 'otros', 'armado', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('otros:jardin', 'otros', 'jardin', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('otros:jardinero', 'otros', 'jardinero', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('otros:mudanza', 'otros', 'mudanza', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('otros:tecnico', 'otros', 'tecnico', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('otros:reparacion', 'otros', 'reparacion', true);
INSERT INTO public."sinonimos_oficio" ("id", "oficio_id", "termino", "activo") VALUES ('otros:porton', 'otros', 'porton', true);
INSERT INTO public."localidades" ("id", "nombre", "provincia", "activo", "orden", "creado_en", "actualizado_en") VALUES ('corrientes-capital', 'Corrientes Capital', 'Corrientes', true, 1, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."barrios" ("id", "localidad_id", "zona_id", "nombre", "slug", "latitud", "longitud", "activo", "orden", "creado_en", "actualizado_en") VALUES ('barrio-centro', 'corrientes-capital', NULL, 'Centro', 'centro', -27.4695, -58.8295, true, 1, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."barrios" ("id", "localidad_id", "zona_id", "nombre", "slug", "latitud", "longitud", "activo", "orden", "creado_en", "actualizado_en") VALUES ('barrio-camba-cua', 'corrientes-capital', NULL, 'Camba Cuá', 'camba-cua', -27.4765, -58.8215, true, 2, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."barrios" ("id", "localidad_id", "zona_id", "nombre", "slug", "latitud", "longitud", "activo", "orden", "creado_en", "actualizado_en") VALUES ('barrio-la-rosada', 'corrientes-capital', NULL, 'La Rosada', 'la-rosada', -27.4805, -58.8345, true, 3, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."barrios" ("id", "localidad_id", "zona_id", "nombre", "slug", "latitud", "longitud", "activo", "orden", "creado_en", "actualizado_en") VALUES ('barrio-barrio-sur', 'corrientes-capital', NULL, 'Barrio Sur', 'barrio-sur', -27.4755, -58.8415, true, 4, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."barrios" ("id", "localidad_id", "zona_id", "nombre", "slug", "latitud", "longitud", "activo", "orden", "creado_en", "actualizado_en") VALUES ('barrio-san-geronimo', 'corrientes-capital', NULL, 'San Gerónimo', 'san-geronimo', -27.4795, -58.8155, true, 5, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."barrios" ("id", "localidad_id", "zona_id", "nombre", "slug", "latitud", "longitud", "activo", "orden", "creado_en", "actualizado_en") VALUES ('barrio-1000-viviendas', 'corrientes-capital', NULL, '1000 Viviendas', '1000-viviendas', -27.4855, -58.829, true, 6, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."barrios" ("id", "localidad_id", "zona_id", "nombre", "slug", "latitud", "longitud", "activo", "orden", "creado_en", "actualizado_en") VALUES ('barrio-libertad', 'corrientes-capital', NULL, 'Libertad', 'libertad', -27.4835, -58.8005, true, 7, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."barrios" ("id", "localidad_id", "zona_id", "nombre", "slug", "latitud", "longitud", "activo", "orden", "creado_en", "actualizado_en") VALUES ('barrio-san-benito', 'corrientes-capital', NULL, 'San Benito', 'san-benito', -27.4905, -58.8165, true, 8, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."barrios" ("id", "localidad_id", "zona_id", "nombre", "slug", "latitud", "longitud", "activo", "orden", "creado_en", "actualizado_en") VALUES ('barrio-laguna-seca', 'corrientes-capital', NULL, 'Laguna Seca', 'laguna-seca', -27.4945, -58.7855, true, 9, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."barrios" ("id", "localidad_id", "zona_id", "nombre", "slug", "latitud", "longitud", "activo", "orden", "creado_en", "actualizado_en") VALUES ('barrio-pirayui', 'corrientes-capital', NULL, 'Pirayuí', 'pirayui', -27.5035, -58.7735, true, 10, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');
INSERT INTO public."barrios" ("id", "localidad_id", "zona_id", "nombre", "slug", "latitud", "longitud", "activo", "orden", "creado_en", "actualizado_en") VALUES ('barrio-molina-punta', 'corrientes-capital', NULL, 'Molina Punta', 'molina-punta', -27.5135, -58.7905, true, 11, TIMESTAMP '2026-10-07 00:00:00', TIMESTAMP '2026-10-07 00:00:00');

-- Trades are no longer pinned by CHECK: a foreign key keeps every profile and request pointing to
-- an existing trade (existing values are all seeded above).
ALTER TABLE public."perfiles_publicos_prestador" DROP CONSTRAINT IF EXISTS "ck_perfiles_publicos_prestador_oficio";
ALTER TABLE public."perfiles_publicos_prestador" ADD CONSTRAINT "fk_perfiles_publicos_prestador_oficio" FOREIGN KEY ("oficio") REFERENCES public."oficios_servicio"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE public."solicitudes_servicio" DROP CONSTRAINT IF EXISTS "ck_solicitudes_servicio_categoria";
ALTER TABLE public."solicitudes_servicio" ADD CONSTRAINT "fk_solicitudes_servicio_categoria" FOREIGN KEY ("categoria") REFERENCES public."oficios_servicio"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
