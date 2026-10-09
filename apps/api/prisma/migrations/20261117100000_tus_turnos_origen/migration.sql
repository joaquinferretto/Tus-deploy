-- AGENDA-MATRIZ-01. Additive: one nullable column. No existing row is rewritten.
--
-- Where a turno came from: 'tus' (a client requested it through TUS) or 'manual' (the provider
-- loaded it in its own agenda: a turno it got by phone, in person...). The rows that already exist
-- keep NULL and are read as they always were: a turno whose client is 'manual' is a manual one,
-- any other is a turno of TUS.
ALTER TABLE public."reservas" ADD COLUMN "origen" text;
ALTER TABLE public."reservas" ADD CONSTRAINT "ck_reservas_origen" CHECK ("origen" IS NULL OR "origen" IN ('tus', 'manual'));
