-- Provider reputation (FASE 9): the client of a COMPLETED work rates its provider once (1-5 and an
-- optional comment). Forward-only and additive: one new table, no existing row changes.
--
-- The composite FK binds the rating to the work's client tenant AND its assigned provider, so it
-- can never point to another provider; the unique index allows one rating per work; the author is
-- a real account. Ratings are append-only and the database itself refuses a rating of a work that
-- is not completed (defence in depth; the API checks it first).

CREATE TABLE public."calificaciones_trabajo" (
  "id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "trabajo_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "prestador_id" text NOT NULL,
  "autor_cuenta_id" text NOT NULL,
  "puntuacion" smallint NOT NULL,
  "comentario" text,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "calificaciones_trabajo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_calificaciones_trabajo_puntuacion" CHECK ("puntuacion" BETWEEN 1 AND 5),
  CONSTRAINT "ck_calificaciones_trabajo_comentario" CHECK ("comentario" IS NULL OR length(btrim("comentario")) BETWEEN 1 AND 500),
  CONSTRAINT "fk_calificaciones_trabajo_trabajo" FOREIGN KEY ("tenant_id", "trabajo_id", "prestador_tenant_id", "prestador_id")
    REFERENCES public."trabajos"("tenant_id", "trabajo_id", "prestador_tenant_id", "prestador_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fk_calificaciones_trabajo_autor" FOREIGN KEY ("autor_cuenta_id")
    REFERENCES public."Account"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "uq_calificaciones_trabajo_tenant_trabajo" ON public."calificaciones_trabajo"("tenant_id", "trabajo_id");
CREATE INDEX "idx_calificaciones_trabajo_prestador" ON public."calificaciones_trabajo"("prestador_tenant_id", "prestador_id");

CREATE OR REPLACE FUNCTION public.tus_calificacion_trabajo_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'calificaciones_trabajo is append-only';
END;
$$;
CREATE TRIGGER tus_calificacion_trabajo_append_only_trigger
  BEFORE UPDATE OR DELETE ON public."calificaciones_trabajo"
  FOR EACH ROW EXECUTE FUNCTION public.tus_calificacion_trabajo_append_only();

CREATE OR REPLACE FUNCTION public.tus_calificacion_requiere_trabajo_completado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."trabajos"
    WHERE "tenant_id" = NEW."tenant_id" AND "trabajo_id" = NEW."trabajo_id" AND "estado" = 'completed'
  ) THEN
    RAISE EXCEPTION 'only a completed work can be rated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tus_calificacion_requiere_trabajo_completado_trigger
  BEFORE INSERT ON public."calificaciones_trabajo"
  FOR EACH ROW EXECUTE FUNCTION public.tus_calificacion_requiere_trabajo_completado();
