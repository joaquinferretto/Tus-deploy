-- Módulo de Alojamientos: catálogo, alojamientos, unidades, imágenes, tarifas, reservas y concurrencia PG16 (btree_gist)

-- 1. Catálogo administrable de tipos de alojamiento
CREATE TABLE IF NOT EXISTS public."tipos_alojamiento" (
  "id" text NOT NULL,
  "slug" text NOT NULL,
  "nombre" text NOT NULL,
  "descripcion" text,
  "icono" text,
  "orden" integer NOT NULL DEFAULT 0,
  "activo" boolean NOT NULL DEFAULT true,
  "creado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tipos_alojamiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_tipos_alojamiento_slug" UNIQUE ("slug")
);

-- Seed canónico de tipos iniciales
INSERT INTO public."tipos_alojamiento" ("id", "slug", "nombre", "descripcion", "orden", "activo")
VALUES
  ('tipo-hotel', 'hotel', 'Hotel', 'Establecimiento con habitaciones privadas y servicios completos', 1, true),
  ('tipo-apart-hotel', 'apart_hotel', 'Apart Hotel', 'Departamentos con servicios hoteleros', 2, true),
  ('tipo-departamento', 'departamento', 'Departamento', 'Vivienda independiente completa para estadías', 3, true),
  ('tipo-motel', 'motel', 'Motel', 'Alojamiento con reserva por horas, turnos o noche', 4, true),
  ('tipo-hostel', 'hostel', 'Hostel', 'Alojamiento compartido o privado de ambiente social', 5, true),
  ('tipo-cabana', 'cabana', 'Cabaña', 'Unidades independientes en entornos naturales o turísticos', 6, true),
  ('tipo-casa', 'casa', 'Casa', 'Inmueble unifamiliar completo', 7, true),
  ('tipo-habitacion', 'habitacion', 'Habitación', 'Habitación privada dentro de una propiedad', 8, true)
ON CONFLICT ("slug") DO UPDATE SET
  "nombre" = EXCLUDED."nombre",
  "descripcion" = EXCLUDED."descripcion",
  "orden" = EXCLUDED."orden",
  "activo" = EXCLUDED."activo";

-- 2. Alojamientos principales
CREATE TABLE IF NOT EXISTS public."alojamientos" (
  "id" text NOT NULL,
  "propietario_id" text,
  "tipo_id" text NOT NULL,
  "nombre" text NOT NULL,
  "slug" text NOT NULL,
  "descripcion" text,
  "direccion" text NOT NULL,
  "latitud" double precision NOT NULL,
  "longitud" double precision NOT NULL,
  "barrio_id" text,
  "zona_id" text,
  "check_in_hora" text NOT NULL DEFAULT '14:00',
  "check_out_hora" text NOT NULL DEFAULT '10:00',
  "politicas" text,
  "comodidades" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "estado" text NOT NULL DEFAULT 'publicado',
  "publicado" boolean NOT NULL DEFAULT true,
  "rating_promedio" double precision,
  "rating_cantidad" integer NOT NULL DEFAULT 0,
  "creado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alojamientos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_alojamiento_tipo" FOREIGN KEY ("tipo_id")
    REFERENCES public."tipos_alojamiento"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fk_alojamiento_barrio" FOREIGN KEY ("barrio_id")
    REFERENCES public."barrios"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fk_alojamiento_zona" FOREIGN KEY ("zona_id")
    REFERENCES public."zonas_ubicacion"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "ix_alojamientos_tipo" ON public."alojamientos"("tipo_id");
CREATE INDEX IF NOT EXISTS "ix_alojamientos_zona" ON public."alojamientos"("zona_id");
CREATE INDEX IF NOT EXISTS "ix_alojamientos_barrio" ON public."alojamientos"("barrio_id");
CREATE INDEX IF NOT EXISTS "ix_alojamientos_propietario" ON public."alojamientos"("propietario_id");
CREATE INDEX IF NOT EXISTS "ix_alojamientos_publicado" ON public."alojamientos"("publicado", "estado");

-- 3. Imágenes generales del alojamiento
CREATE TABLE IF NOT EXISTS public."imagenes_alojamiento" (
  "id" text NOT NULL,
  "alojamiento_id" text NOT NULL,
  "url" text NOT NULL,
  "alt" text,
  "categoria" text NOT NULL DEFAULT 'general',
  "orden" integer NOT NULL DEFAULT 0,
  "es_principal" boolean NOT NULL DEFAULT false,
  "creado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "imagenes_alojamiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_imagenes_alojamiento_alojamiento" FOREIGN KEY ("alojamiento_id")
    REFERENCES public."alojamientos"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "ix_imagenes_alojamiento_orden"
  ON public."imagenes_alojamiento"("alojamiento_id", "orden");

-- 4. Unidades / Habitaciones de cada alojamiento
CREATE TABLE IF NOT EXISTS public."unidades_alojamiento" (
  "id" text NOT NULL,
  "alojamiento_id" text NOT NULL,
  "nombre" text NOT NULL,
  "descripcion" text,
  "capacidad_personas" integer NOT NULL DEFAULT 2,
  "camas_detalle" text,
  "banos_cantidad" integer NOT NULL DEFAULT 1,
  "comodidades" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "estado" text NOT NULL DEFAULT 'activa',
  "orden" integer NOT NULL DEFAULT 0,
  "creado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unidades_alojamiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_unidades_alojamiento_alojamiento" FOREIGN KEY ("alojamiento_id")
    REFERENCES public."alojamientos"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "ix_unidades_alojamiento_orden"
  ON public."unidades_alojamiento"("alojamiento_id", "orden");

-- 5. Imágenes propias por unidad
CREATE TABLE IF NOT EXISTS public."imagenes_unidad_alojamiento" (
  "id" text NOT NULL,
  "unidad_id" text NOT NULL,
  "url" text NOT NULL,
  "alt" text,
  "orden" integer NOT NULL DEFAULT 0,
  "es_principal" boolean NOT NULL DEFAULT false,
  "creado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "imagenes_unidad_alojamiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_imagenes_unidad_unidad" FOREIGN KEY ("unidad_id")
    REFERENCES public."unidades_alojamiento"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "ix_imagenes_unidad_orden"
  ON public."imagenes_unidad_alojamiento"("unidad_id", "orden");

-- 6. Tarifas por unidad (por hora, bloque de horas, noche, día, semana)
CREATE TABLE IF NOT EXISTS public."tarifas_alojamiento" (
  "id" text NOT NULL,
  "unidad_id" text NOT NULL,
  "modalidad" text NOT NULL DEFAULT 'noche',
  "duracion_horas" integer,
  "precio" bigint NOT NULL,
  "moneda" text NOT NULL DEFAULT 'ARS',
  "dias_semana" integer[] NOT NULL DEFAULT ARRAY[0, 1, 2, 3, 4, 5, 6]::integer[],
  "temporada" text,
  "minimo_estadia" integer NOT NULL DEFAULT 1,
  "maximo_estadia" integer,
  "activa" boolean NOT NULL DEFAULT true,
  "creado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tarifas_alojamiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_tarifas_alojamiento_unidad" FOREIGN KEY ("unidad_id")
    REFERENCES public."unidades_alojamiento"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "ix_tarifas_alojamiento_unidad"
  ON public."tarifas_alojamiento"("unidad_id", "activa");

-- 7. Bloqueos manuales de unidades (propietario / admin)
CREATE TABLE IF NOT EXISTS public."bloqueos_unidad_alojamiento" (
  "id" text NOT NULL,
  "unidad_id" text NOT NULL,
  "fecha_inicio" timestamp(3) with time zone NOT NULL,
  "fecha_fin" timestamp(3) with time zone NOT NULL,
  "motivo" text NOT NULL,
  "creado_por_usuario_id" text,
  "creado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bloqueos_unidad_alojamiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_bloqueos_unidad_alojamiento_unidad" FOREIGN KEY ("unidad_id")
    REFERENCES public."unidades_alojamiento"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "ix_bloqueos_unidad_rango"
  ON public."bloqueos_unidad_alojamiento"("unidad_id", "fecha_inicio", "fecha_fin");

-- 8. Reservas de alojamiento con snapshot de precios y hold temporal
CREATE TABLE IF NOT EXISTS public."reservas_alojamiento" (
  "id" text NOT NULL,
  "unidad_id" text NOT NULL,
  "alojamiento_id" text NOT NULL,
  "cliente_id" text,
  "cliente_nombre" text NOT NULL,
  "cliente_email" text,
  "cliente_telefono" text,
  "es_invitado" boolean NOT NULL DEFAULT false,
  "fecha_inicio" timestamp(3) with time zone NOT NULL,
  "fecha_fin" timestamp(3) with time zone NOT NULL,
  "modalidad" text NOT NULL,
  "cantidad_personas" integer NOT NULL DEFAULT 1,
  "tarifa_id" text,
  "precio_lista_snapshot" bigint NOT NULL,
  "precio_final_snapshot" bigint NOT NULL,
  "moneda" text NOT NULL DEFAULT 'ARS',
  "estado" text NOT NULL DEFAULT 'pending_payment',
  "hold_expiracion" timestamp(3) with time zone,
  "payment_id" text,
  "preference_id" text,
  "metodo_pago" text,
  "notas" text,
  "creado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizado_en" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reservas_alojamiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_reservas_alojamiento_unidad" FOREIGN KEY ("unidad_id")
    REFERENCES public."unidades_alojamiento"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fk_reservas_alojamiento_alojamiento" FOREIGN KEY ("alojamiento_id")
    REFERENCES public."alojamientos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "ix_reservas_alojamiento_alojamiento"
  ON public."reservas_alojamiento"("alojamiento_id", "fecha_inicio");
CREATE INDEX IF NOT EXISTS "ix_reservas_alojamiento_unidad_rango"
  ON public."reservas_alojamiento"("unidad_id", "fecha_inicio", "fecha_fin");
CREATE INDEX IF NOT EXISTS "ix_reservas_alojamiento_hold"
  ON public."reservas_alojamiento"("estado", "hold_expiracion");

-- 9. Extensión btree_gist y exclusión física contra doble reserva o solapamiento de holds
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ex_reservas_alojamiento_sin_solapamiento'
  ) THEN
    ALTER TABLE public."reservas_alojamiento"
      ADD CONSTRAINT "ex_reservas_alojamiento_sin_solapamiento"
      EXCLUDE USING gist (
        "unidad_id" WITH =,
        tstzrange("fecha_inicio", "fecha_fin", '[)') WITH &&
      )
      WHERE ("estado" IN ('pending_payment', 'confirmed', 'checked_in'));
  END IF;
END $$;

-- 10. Calificaciones de alojamiento (solo por cliente con reserva completed)
CREATE TABLE IF NOT EXISTS public."calificaciones_alojamiento" (
  "id" text NOT NULL,
  "reserva_id" text NOT NULL,
  "alojamiento_id" text NOT NULL,
  "cliente_id" text,
  "puntuacion" smallint NOT NULL,
  "comentario" text,
  "fecha_creacion" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calificaciones_alojamiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_calificaciones_alojamiento_reserva" UNIQUE ("reserva_id"),
  CONSTRAINT "ck_calificaciones_alojamiento_puntuacion" CHECK ("puntuacion" >= 1 AND "puntuacion" <= 5),
  CONSTRAINT "fk_calificaciones_alojamiento_reserva" FOREIGN KEY ("reserva_id")
    REFERENCES public."reservas_alojamiento"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fk_calificaciones_alojamiento_alojamiento" FOREIGN KEY ("alojamiento_id")
    REFERENCES public."alojamientos"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "ix_calificaciones_alojamiento_alojamiento"
  ON public."calificaciones_alojamiento"("alojamiento_id");
