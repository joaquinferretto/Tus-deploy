-- DOCUMENTO-NOSIS-PUBLICO-01. A documentary verification can now be made with the public search of
-- Nosis: the method of a verification accepts 'nosis_public'. Forward-only: the CHECK is replaced
-- by a wider one that accepts every value the previous one accepted. No row is rewritten and
-- nothing else changes (the compared data live in the existing JSON snapshot of the verification).
ALTER TABLE public."verificaciones_identidad" DROP CONSTRAINT "ck_verificaciones_identidad_metodo";
ALTER TABLE public."verificaciones_identidad"
  ADD CONSTRAINT "ck_verificaciones_identidad_metodo" CHECK ("metodo_verificacion" IS NULL OR "metodo_verificacion" IN ('nosis_browser', 'nosis_api', 'nosis_public', 'demo', 'manual'));
