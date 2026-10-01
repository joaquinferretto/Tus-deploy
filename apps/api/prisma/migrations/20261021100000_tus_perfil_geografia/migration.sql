-- PERFIL-GEO-01: normalized geography (País -> Provincia -> Localidad with a reference point) and
-- the personal profile of a person (names, document, residence). Forward-only and additive:
-- existing users keep every value they had and start with profile_complete = false (no personal
-- data is invented or back-filled).

-- ---- geography ---------------------------------------------------------------------------------
CREATE TABLE public."paises" (
  "id" text NOT NULL,
  "nombre" text NOT NULL,
  "codigo_iso" text NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "orden" integer NOT NULL DEFAULT 0,
  "creado_en" timestamp(3) NOT NULL,
  "actualizado_en" timestamp(3) NOT NULL,
  CONSTRAINT "paises_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_paises_nombre" CHECK (length(btrim("nombre")) BETWEEN 2 AND 60),
  CONSTRAINT "ck_paises_codigo_iso" CHECK ("codigo_iso" ~ '^[A-Z]{2}$')
);
CREATE UNIQUE INDEX "uq_paises_codigo_iso" ON public."paises"("codigo_iso");

CREATE TABLE public."provincias" (
  "id" text NOT NULL,
  "pais_id" text NOT NULL,
  "nombre" text NOT NULL,
  "codigo" text,
  "activo" boolean NOT NULL DEFAULT true,
  "orden" integer NOT NULL DEFAULT 0,
  "creado_en" timestamp(3) NOT NULL,
  "actualizado_en" timestamp(3) NOT NULL,
  CONSTRAINT "provincias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_provincias_pais" FOREIGN KEY ("pais_id") REFERENCES public."paises"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ck_provincias_nombre" CHECK (length(btrim("nombre")) BETWEEN 2 AND 60)
);
CREATE INDEX "ix_provincias_pais" ON public."provincias"("pais_id");
CREATE UNIQUE INDEX "uq_provincias_pais_nombre_ci" ON public."provincias"("pais_id", lower("nombre"));

-- localidades already exists (service catalog: zonas and barrios hang from it). It gains its
-- province and a reference point; the text column "provincia" is kept (existing code and the
-- unique index use it) and holds the province name.
ALTER TABLE public."localidades" ADD COLUMN "provincia_id" text;
ALTER TABLE public."localidades" ADD COLUMN "latitud" double precision;
ALTER TABLE public."localidades" ADD COLUMN "longitud" double precision;
-- cobertura: TUS operates in the locality (it is part of the service catalog: zonas, barrios,
-- directory). Every locality that existed is one; the country-wide rows seeded below are not.
ALTER TABLE public."localidades" ADD COLUMN "cobertura" boolean NOT NULL DEFAULT false;
UPDATE public."localidades" SET "cobertura" = true;
ALTER TABLE public."localidades"
  ADD CONSTRAINT "fk_localidades_provincia" FOREIGN KEY ("provincia_id") REFERENCES public."provincias"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE public."localidades"
  ADD CONSTRAINT "ck_localidades_punto" CHECK (
    ("latitud" IS NULL AND "longitud" IS NULL)
    OR ("latitud" BETWEEN -90 AND 90 AND "longitud" BETWEEN -180 AND 180)
  );
CREATE INDEX "ix_localidades_provincia" ON public."localidades"("provincia_id", "nombre");

-- ---- seed: Argentina, its 24 jurisdictions and the localities TUS needs today --------------------
INSERT INTO public."paises" ("id", "nombre", "codigo_iso", "activo", "orden", "creado_en", "actualizado_en")
VALUES ('ar', 'Argentina', 'AR', true, 1, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z');

INSERT INTO public."provincias" ("id", "pais_id", "nombre", "codigo", "activo", "orden", "creado_en", "actualizado_en") VALUES
  ('ar-c', 'ar', 'Ciudad Autónoma de Buenos Aires', 'AR-C', true, 1, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-b', 'ar', 'Buenos Aires', 'AR-B', true, 2, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-k', 'ar', 'Catamarca', 'AR-K', true, 3, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-h', 'ar', 'Chaco', 'AR-H', true, 4, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-u', 'ar', 'Chubut', 'AR-U', true, 5, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-x', 'ar', 'Córdoba', 'AR-X', true, 6, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w', 'ar', 'Corrientes', 'AR-W', true, 7, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-e', 'ar', 'Entre Ríos', 'AR-E', true, 8, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-p', 'ar', 'Formosa', 'AR-P', true, 9, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-y', 'ar', 'Jujuy', 'AR-Y', true, 10, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-l', 'ar', 'La Pampa', 'AR-L', true, 11, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-f', 'ar', 'La Rioja', 'AR-F', true, 12, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-m', 'ar', 'Mendoza', 'AR-M', true, 13, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-n', 'ar', 'Misiones', 'AR-N', true, 14, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-q', 'ar', 'Neuquén', 'AR-Q', true, 15, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-r', 'ar', 'Río Negro', 'AR-R', true, 16, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-a', 'ar', 'Salta', 'AR-A', true, 17, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-j', 'ar', 'San Juan', 'AR-J', true, 18, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-d', 'ar', 'San Luis', 'AR-D', true, 19, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-z', 'ar', 'Santa Cruz', 'AR-Z', true, 20, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-s', 'ar', 'Santa Fe', 'AR-S', true, 21, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-g', 'ar', 'Santiago del Estero', 'AR-G', true, 22, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-v', 'ar', 'Tierra del Fuego', 'AR-V', true, 23, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-t', 'ar', 'Tucumán', 'AR-T', true, 24, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z');

-- Localities that already existed are matched to their province by name (nothing is guessed: a
-- row whose text does not name a seeded province keeps provincia_id NULL until an admin sets it).
UPDATE public."localidades" l
   SET "provincia_id" = p."id"
  FROM public."provincias" p
 WHERE p."pais_id" = 'ar' AND lower(btrim(l."provincia")) = lower(p."nombre");

UPDATE public."localidades"
   SET "latitud" = -27.4692, "longitud" = -58.8306
 WHERE "id" = 'corrientes-capital' AND "latitud" IS NULL;

INSERT INTO public."localidades" ("id", "nombre", "provincia", "provincia_id", "latitud", "longitud", "activo", "orden", "creado_en", "actualizado_en") VALUES
  ('ar-c-ciudad-autonoma-de-buenos-aires', 'Ciudad Autónoma de Buenos Aires', 'Ciudad Autónoma de Buenos Aires', 'ar-c', -34.6037, -58.3816, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-b-la-plata', 'La Plata', 'Buenos Aires', 'ar-b', -34.9214, -57.9545, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-b-mar-del-plata', 'Mar del Plata', 'Buenos Aires', 'ar-b', -38.0055, -57.5426, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-b-bahia-blanca', 'Bahía Blanca', 'Buenos Aires', 'ar-b', -38.7183, -62.2663, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-b-tandil', 'Tandil', 'Buenos Aires', 'ar-b', -37.3217, -59.1332, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-b-san-nicolas-de-los-arroyos', 'San Nicolás de los Arroyos', 'Buenos Aires', 'ar-b', -33.3342, -60.211, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-k-san-fernando-del-valle-de-catamarca', 'San Fernando del Valle de Catamarca', 'Catamarca', 'ar-k', -28.4696, -65.7852, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-h-resistencia', 'Resistencia', 'Chaco', 'ar-h', -27.4514, -58.9867, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-h-barranqueras', 'Barranqueras', 'Chaco', 'ar-h', -27.4813, -58.9393, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-h-fontana', 'Fontana', 'Chaco', 'ar-h', -27.4167, -59.0333, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-h-presidencia-roque-saenz-pena', 'Presidencia Roque Sáenz Peña', 'Chaco', 'ar-h', -26.7852, -60.4388, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-u-rawson', 'Rawson', 'Chubut', 'ar-u', -43.3002, -65.1023, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-u-comodoro-rivadavia', 'Comodoro Rivadavia', 'Chubut', 'ar-u', -45.8641, -67.4966, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-u-puerto-madryn', 'Puerto Madryn', 'Chubut', 'ar-u', -42.7692, -65.0385, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-u-trelew', 'Trelew', 'Chubut', 'ar-u', -43.249, -65.3051, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-x-cordoba', 'Córdoba', 'Córdoba', 'ar-x', -31.4201, -64.1888, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-x-rio-cuarto', 'Río Cuarto', 'Córdoba', 'ar-x', -33.1307, -64.3499, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-x-villa-carlos-paz', 'Villa Carlos Paz', 'Córdoba', 'ar-x', -31.4241, -64.4978, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-goya', 'Goya', 'Corrientes', 'ar-w', -29.14, -59.2626, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-mercedes', 'Mercedes', 'Corrientes', 'ar-w', -29.184, -58.0747, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-curuzu-cuatia', 'Curuzú Cuatiá', 'Corrientes', 'ar-w', -29.7917, -58.0546, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-paso-de-los-libres', 'Paso de los Libres', 'Corrientes', 'ar-w', -29.7125, -57.0877, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-santo-tome', 'Santo Tomé', 'Corrientes', 'ar-w', -28.5494, -56.0408, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-ituzaingo', 'Ituzaingó', 'Corrientes', 'ar-w', -27.5816, -56.6868, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-bella-vista', 'Bella Vista', 'Corrientes', 'ar-w', -28.5073, -59.044, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-esquina', 'Esquina', 'Corrientes', 'ar-w', -30.0144, -59.5272, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-monte-caseros', 'Monte Caseros', 'Corrientes', 'ar-w', -30.2536, -57.6364, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-saladas', 'Saladas', 'Corrientes', 'ar-w', -28.2536, -58.6259, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-empedrado', 'Empedrado', 'Corrientes', 'ar-w', -27.9517, -58.8056, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-itati', 'Itatí', 'Corrientes', 'ar-w', -27.2704, -58.2444, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-san-luis-del-palmar', 'San Luis del Palmar', 'Corrientes', 'ar-w', -27.5078, -58.5546, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-paso-de-la-patria', 'Paso de la Patria', 'Corrientes', 'ar-w', -27.3167, -58.5667, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-santa-lucia', 'Santa Lucía', 'Corrientes', 'ar-w', -28.9872, -59.1029, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-gobernador-virasoro', 'Gobernador Virasoro', 'Corrientes', 'ar-w', -28.05, -56.0333, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-riachuelo', 'Riachuelo', 'Corrientes', 'ar-w', -27.5797, -58.7436, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-san-cosme', 'San Cosme', 'Corrientes', 'ar-w', -27.3713, -58.5121, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-santa-rosa', 'Santa Rosa', 'Corrientes', 'ar-w', -28.2667, -58.1167, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-san-roque', 'San Roque', 'Corrientes', 'ar-w', -28.5733, -58.7086, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-alvear', 'Alvear', 'Corrientes', 'ar-w', -29.0983, -56.5522, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-la-cruz', 'La Cruz', 'Corrientes', 'ar-w', -29.1744, -56.6436, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-sauce', 'Sauce', 'Corrientes', 'ar-w', -30.0867, -58.7883, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-mburucuya', 'Mburucuyá', 'Corrientes', 'ar-w', -28.0453, -58.2281, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-caa-cati', 'Caá Catí', 'Corrientes', 'ar-w', -27.7506, -57.6208, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-concepcion', 'Concepción', 'Corrientes', 'ar-w', -28.3922, -57.8872, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-san-miguel', 'San Miguel', 'Corrientes', 'ar-w', -27.9958, -57.5894, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-loreto', 'Loreto', 'Corrientes', 'ar-w', -27.7697, -57.2756, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-yapeyu', 'Yapeyú', 'Corrientes', 'ar-w', -29.4697, -56.8169, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-w-santa-ana', 'Santa Ana', 'Corrientes', 'ar-w', -27.4553, -58.6544, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-e-parana', 'Paraná', 'Entre Ríos', 'ar-e', -31.7333, -60.5297, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-e-concordia', 'Concordia', 'Entre Ríos', 'ar-e', -31.3929, -58.0209, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-e-gualeguaychu', 'Gualeguaychú', 'Entre Ríos', 'ar-e', -33.0094, -58.5172, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-p-formosa', 'Formosa', 'Formosa', 'ar-p', -26.1775, -58.1781, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-p-clorinda', 'Clorinda', 'Formosa', 'ar-p', -25.2848, -57.7185, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-y-san-salvador-de-jujuy', 'San Salvador de Jujuy', 'Jujuy', 'ar-y', -24.1858, -65.2995, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-y-san-pedro-de-jujuy', 'San Pedro de Jujuy', 'Jujuy', 'ar-y', -24.2313, -64.8661, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-l-santa-rosa', 'Santa Rosa', 'La Pampa', 'ar-l', -36.6167, -64.2833, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-l-general-pico', 'General Pico', 'La Pampa', 'ar-l', -35.6566, -63.7568, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-f-la-rioja', 'La Rioja', 'La Rioja', 'ar-f', -29.4131, -66.8558, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-f-chilecito', 'Chilecito', 'La Rioja', 'ar-f', -29.1619, -67.4974, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-m-mendoza', 'Mendoza', 'Mendoza', 'ar-m', -32.8895, -68.8458, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-m-san-rafael', 'San Rafael', 'Mendoza', 'ar-m', -34.6177, -68.3301, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-n-posadas', 'Posadas', 'Misiones', 'ar-n', -27.3671, -55.8961, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-n-obera', 'Oberá', 'Misiones', 'ar-n', -27.4871, -55.1199, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-n-eldorado', 'Eldorado', 'Misiones', 'ar-n', -26.4084, -54.6946, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-n-puerto-iguazu', 'Puerto Iguazú', 'Misiones', 'ar-n', -25.5972, -54.5786, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-q-neuquen', 'Neuquén', 'Neuquén', 'ar-q', -38.9516, -68.0591, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-q-san-martin-de-los-andes', 'San Martín de los Andes', 'Neuquén', 'ar-q', -40.1579, -71.3534, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-r-viedma', 'Viedma', 'Río Negro', 'ar-r', -40.8135, -62.9967, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-r-san-carlos-de-bariloche', 'San Carlos de Bariloche', 'Río Negro', 'ar-r', -41.1335, -71.3103, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-r-general-roca', 'General Roca', 'Río Negro', 'ar-r', -39.0333, -67.5833, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-r-cipolletti', 'Cipolletti', 'Río Negro', 'ar-r', -38.9339, -67.9903, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-a-salta', 'Salta', 'Salta', 'ar-a', -24.7821, -65.4232, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-a-san-ramon-de-la-nueva-oran', 'San Ramón de la Nueva Orán', 'Salta', 'ar-a', -23.137, -64.3243, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-a-tartagal', 'Tartagal', 'Salta', 'ar-a', -22.5164, -63.8013, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-j-san-juan', 'San Juan', 'San Juan', 'ar-j', -31.5375, -68.5364, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-d-san-luis', 'San Luis', 'San Luis', 'ar-d', -33.295, -66.3356, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-d-villa-mercedes', 'Villa Mercedes', 'San Luis', 'ar-d', -33.6757, -65.4579, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-z-rio-gallegos', 'Río Gallegos', 'Santa Cruz', 'ar-z', -51.623, -69.2168, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-z-caleta-olivia', 'Caleta Olivia', 'Santa Cruz', 'ar-z', -46.4393, -67.5281, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-z-el-calafate', 'El Calafate', 'Santa Cruz', 'ar-z', -50.3379, -72.2648, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-s-santa-fe', 'Santa Fe', 'Santa Fe', 'ar-s', -31.6333, -60.7, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-s-rosario', 'Rosario', 'Santa Fe', 'ar-s', -32.9442, -60.6505, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-s-rafaela', 'Rafaela', 'Santa Fe', 'ar-s', -31.2503, -61.4867, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-g-santiago-del-estero', 'Santiago del Estero', 'Santiago del Estero', 'ar-g', -27.7951, -64.2615, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-g-la-banda', 'La Banda', 'Santiago del Estero', 'ar-g', -27.735, -64.2433, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-v-ushuaia', 'Ushuaia', 'Tierra del Fuego', 'ar-v', -54.8019, -68.303, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-v-rio-grande', 'Río Grande', 'Tierra del Fuego', 'ar-v', -53.7877, -67.7095, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z'),
  ('ar-t-san-miguel-de-tucuman', 'San Miguel de Tucumán', 'Tucumán', 'ar-t', -26.8083, -65.2176, true, 100, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z')
ON CONFLICT DO NOTHING;

-- ---- personal profile of the person ("User") ----------------------------------------------------
ALTER TABLE public."User" ADD COLUMN "firstName" text;
ALTER TABLE public."User" ADD COLUMN "lastName" text;
ALTER TABLE public."User" ADD COLUMN "documentType" text;
ALTER TABLE public."User" ADD COLUMN "documentNumber" text;
ALTER TABLE public."User" ADD COLUMN "localidadId" text;
ALTER TABLE public."User" ADD COLUMN "addressStreet" text;
ALTER TABLE public."User" ADD COLUMN "addressNumber" text;
ALTER TABLE public."User" ADD COLUMN "addressUnit" text;
ALTER TABLE public."User" ADD COLUMN "postalCode" text;
ALTER TABLE public."User" ADD COLUMN "profileComplete" boolean NOT NULL DEFAULT false;
ALTER TABLE public."User" ADD COLUMN "profileUpdatedAt" timestamp(3);

ALTER TABLE public."User"
  ADD CONSTRAINT "fk_user_localidad" FOREIGN KEY ("localidadId") REFERENCES public."localidades"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE public."User"
  ADD CONSTRAINT "ck_user_documento" CHECK (
    -- type and number are both set or both NULL (a NULL type must not make the rule "unknown").
    (("documentType" IS NULL) = ("documentNumber" IS NULL))
    AND (
      "documentType" IS NULL
      OR ("documentType" IN ('DNI', 'LC', 'LE') AND "documentNumber" ~ '^[0-9]{6,8}$')
      OR ("documentType" = 'PASAPORTE' AND "documentNumber" ~ '^[A-Z0-9]{6,12}$')
    )
  );
ALTER TABLE public."User"
  ADD CONSTRAINT "ck_user_nombres" CHECK (
    ("firstName" IS NULL OR length(btrim("firstName")) BETWEEN 2 AND 60)
    AND ("lastName" IS NULL OR length(btrim("lastName")) BETWEEN 2 AND 60)
  );
ALTER TABLE public."User"
  ADD CONSTRAINT "ck_user_domicilio" CHECK (
    ("addressStreet" IS NULL OR length(btrim("addressStreet")) BETWEEN 2 AND 120)
    AND ("addressNumber" IS NULL OR length(btrim("addressNumber")) BETWEEN 1 AND 12)
    AND ("addressUnit" IS NULL OR length(btrim("addressUnit")) BETWEEN 1 AND 30)
    AND ("postalCode" IS NULL OR "postalCode" ~ '^[A-Z0-9]{4,8}$')
  );
-- A complete profile really has every required field (the flag can never be set on its own).
ALTER TABLE public."User"
  ADD CONSTRAINT "ck_user_perfil_completo" CHECK (
    NOT "profileComplete"
    OR ("firstName" IS NOT NULL AND "lastName" IS NOT NULL AND "documentNumber" IS NOT NULL
        AND "localidadId" IS NOT NULL AND "addressStreet" IS NOT NULL AND "addressNumber" IS NOT NULL AND "postalCode" IS NOT NULL)
  );
-- One person per document.
CREATE UNIQUE INDEX "uq_user_documento" ON public."User"("documentType", "documentNumber") WHERE "documentNumber" IS NOT NULL;
CREATE INDEX "ix_user_localidad" ON public."User"("localidadId");
CREATE INDEX "ix_user_perfil_completo" ON public."User"("profileComplete");
