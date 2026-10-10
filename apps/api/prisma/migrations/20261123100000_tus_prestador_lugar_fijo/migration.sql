-- LUGAR-FIJO-01. The place where a provider attends (modality 'local' or 'mixto'): an optional
-- name, its address and an optional short note on how to get in. Additive and forward-only: three
-- nullable columns on the public profile and their length CHECKs. Nothing is dropped and no
-- existing row is rewritten: a profile from before simply has no place yet.
--
-- The name may be published. The ADDRESS and the NOTE are private: the API gives them only to the
-- provider itself, to the administration and to the client of a CONFIRMED turno with it.
ALTER TABLE public."perfiles_publicos_prestador" ADD COLUMN "lugar_nombre" text;
ALTER TABLE public."perfiles_publicos_prestador" ADD COLUMN "lugar_direccion" text;
ALTER TABLE public."perfiles_publicos_prestador" ADD COLUMN "lugar_descripcion" text;
ALTER TABLE public."perfiles_publicos_prestador"
  ADD CONSTRAINT "ck_perfiles_publicos_prestador_lugar" CHECK (
    ("lugar_nombre" IS NULL OR char_length("lugar_nombre") BETWEEN 2 AND 80)
    AND ("lugar_direccion" IS NULL OR char_length("lugar_direccion") BETWEEN 5 AND 160)
    AND ("lugar_descripcion" IS NULL OR char_length("lugar_descripcion") BETWEEN 1 AND 240)
  );
