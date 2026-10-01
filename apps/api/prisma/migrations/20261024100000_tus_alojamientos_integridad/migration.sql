-- INTEGRIDAD-01 (alojamientos): invariants that hold for ANY writer move into the database.
-- Forward-only. Nothing is dropped; no table is added (one nullable column: section 8).
--
-- The CHECK and the composite FOREIGN KEY constraints are NOT VALID: they apply to every new or
-- updated row from now on, without re-checking historical rows (production data cannot be read
-- from where this migration is written). docs/database/AUDITORIA_INTEGRIDAD_2026-10.md lists the
-- read-only queries to run before a later VALIDATE CONSTRAINT.

-- 1. One alojamiento per public address (slug). Existing duplicates are resolved deterministically:
--    the oldest keeps its slug, the others get a suffix taken from their id.
UPDATE public."alojamientos" a
   SET "slug" = a."slug" || '-' || right(a."id", 8)
  FROM (
    SELECT "id", row_number() OVER (PARTITION BY "slug" ORDER BY "creado_en", "id") AS posicion
      FROM public."alojamientos"
  ) d
 WHERE d."id" = a."id" AND d.posicion > 1;

CREATE UNIQUE INDEX "uq_alojamientos_slug" ON public."alojamientos"("slug");

-- 2. alojamientos
ALTER TABLE public."alojamientos"
  ADD CONSTRAINT "ck_alojamientos_punto" CHECK (
    "latitud" BETWEEN -90 AND 90 AND "longitud" BETWEEN -180 AND 180
  ) NOT VALID;

ALTER TABLE public."alojamientos"
  ADD CONSTRAINT "ck_alojamientos_estado" CHECK (
    "estado" IN ('borrador', 'publicado', 'pausado', 'suspendido')
  ) NOT VALID;

ALTER TABLE public."alojamientos"
  ADD CONSTRAINT "ck_alojamientos_rating" CHECK (
    "rating_cantidad" >= 0 AND ("rating_promedio" IS NULL OR "rating_promedio" BETWEEN 1 AND 5)
  ) NOT VALID;

ALTER TABLE public."alojamientos"
  ADD CONSTRAINT "ck_alojamientos_horas" CHECK (
    "check_in_hora" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "check_out_hora" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ) NOT VALID;

-- 3. unidades_alojamiento
ALTER TABLE public."unidades_alojamiento"
  ADD CONSTRAINT "ck_unidades_alojamiento_capacidad" CHECK (
    "capacidad_personas" >= 1 AND "banos_cantidad" >= 0
  ) NOT VALID;

ALTER TABLE public."unidades_alojamiento"
  ADD CONSTRAINT "ck_unidades_alojamiento_estado" CHECK (
    "estado" IN ('activa', 'mantenimiento', 'inactiva')
  ) NOT VALID;

-- Target of the composite foreign key of reservations (a unit and ITS alojamiento).
CREATE UNIQUE INDEX "uq_unidades_alojamiento_id_alojamiento" ON public."unidades_alojamiento"("id", "alojamiento_id");

-- 4. tarifas_alojamiento
ALTER TABLE public."tarifas_alojamiento"
  ADD CONSTRAINT "ck_tarifas_alojamiento_precio" CHECK ("precio" >= 0) NOT VALID;

ALTER TABLE public."tarifas_alojamiento"
  ADD CONSTRAINT "ck_tarifas_alojamiento_modalidad" CHECK (
    "modalidad" IN ('por_hora', 'bloque_horas', 'noche', 'dia', 'semana')
  ) NOT VALID;

ALTER TABLE public."tarifas_alojamiento"
  ADD CONSTRAINT "ck_tarifas_alojamiento_duracion" CHECK (
    "duracion_horas" IS NULL OR "duracion_horas" >= 1
  ) NOT VALID;

ALTER TABLE public."tarifas_alojamiento"
  ADD CONSTRAINT "ck_tarifas_alojamiento_estadia" CHECK (
    "minimo_estadia" >= 1 AND ("maximo_estadia" IS NULL OR "maximo_estadia" >= "minimo_estadia")
  ) NOT VALID;

ALTER TABLE public."tarifas_alojamiento"
  ADD CONSTRAINT "ck_tarifas_alojamiento_moneda" CHECK ("moneda" ~ '^[A-Z]{3}$') NOT VALID;

ALTER TABLE public."tarifas_alojamiento"
  ADD CONSTRAINT "ck_tarifas_alojamiento_dias_semana" CHECK (
    cardinality("dias_semana") >= 1 AND "dias_semana" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]
  ) NOT VALID;

-- 5. bloqueos_unidad_alojamiento
ALTER TABLE public."bloqueos_unidad_alojamiento"
  ADD CONSTRAINT "ck_bloqueos_unidad_alojamiento_rango" CHECK ("fecha_fin" > "fecha_inicio") NOT VALID;

-- 6. reservas_alojamiento
ALTER TABLE public."reservas_alojamiento"
  ADD CONSTRAINT "ck_reservas_alojamiento_rango" CHECK ("fecha_fin" > "fecha_inicio") NOT VALID;

ALTER TABLE public."reservas_alojamiento"
  ADD CONSTRAINT "ck_reservas_alojamiento_estado" CHECK (
    "estado" IN ('pending_payment', 'confirmed', 'checked_in', 'completed', 'cancelled', 'expired')
  ) NOT VALID;

ALTER TABLE public."reservas_alojamiento"
  ADD CONSTRAINT "ck_reservas_alojamiento_modalidad" CHECK (
    "modalidad" IN ('por_hora', 'bloque_horas', 'noche', 'dia', 'semana')
  ) NOT VALID;

ALTER TABLE public."reservas_alojamiento"
  ADD CONSTRAINT "ck_reservas_alojamiento_personas" CHECK ("cantidad_personas" >= 1) NOT VALID;

ALTER TABLE public."reservas_alojamiento"
  ADD CONSTRAINT "ck_reservas_alojamiento_precios" CHECK (
    "precio_lista_snapshot" >= 0 AND "precio_final_snapshot" >= 0
  ) NOT VALID;

ALTER TABLE public."reservas_alojamiento"
  ADD CONSTRAINT "ck_reservas_alojamiento_moneda" CHECK ("moneda" ~ '^[A-Z]{3}$') NOT VALID;

-- A reservation waiting for its payment always says until when it keeps the dates.
ALTER TABLE public."reservas_alojamiento"
  ADD CONSTRAINT "ck_reservas_alojamiento_hold" CHECK (
    "estado" <> 'pending_payment' OR "hold_expiracion" IS NOT NULL
  ) NOT VALID;

-- reservas_alojamiento.alojamiento_id is a copy of the alojamiento of the unit (kept for the
-- listing index): the pair must exist in unidades_alojamiento.
ALTER TABLE public."reservas_alojamiento"
  ADD CONSTRAINT "fk_reservas_alojamiento_unidad_alojamiento" FOREIGN KEY ("unidad_id", "alojamiento_id")
    REFERENCES public."unidades_alojamiento"("id", "alojamiento_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;

-- Target of the composite foreign key of ratings (a reservation and ITS alojamiento).
CREATE UNIQUE INDEX "uq_reservas_alojamiento_id_alojamiento" ON public."reservas_alojamiento"("id", "alojamiento_id");

-- 6b. The owner of an alojamiento is a real account (NULL = managed by the platform only).
ALTER TABLE public."alojamientos"
  ADD CONSTRAINT "fk_alojamientos_propietario" FOREIGN KEY ("propietario_id")
    REFERENCES public."Account"("id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;

-- 7. calificaciones_alojamiento: a rating counts for the alojamiento of its reservation.
ALTER TABLE public."calificaciones_alojamiento"
  ADD CONSTRAINT "fk_calificaciones_alojamiento_reserva_alojamiento" FOREIGN KEY ("reserva_id", "alojamiento_id")
    REFERENCES public."reservas_alojamiento"("id", "alojamiento_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;

-- 8. A payment received for a reservation that no longer holds its dates (expired or cancelled) is
--    never confirmed automatically: the reservation keeps the payment data and is marked for
--    reconciliation / manual review from this moment.
ALTER TABLE public."reservas_alojamiento" ADD COLUMN "pago_en_revision_desde" timestamp(3) with time zone;

CREATE INDEX "ix_reservas_alojamiento_pago_en_revision" ON public."reservas_alojamiento"("pago_en_revision_desde")
  WHERE "pago_en_revision_desde" IS NOT NULL;
