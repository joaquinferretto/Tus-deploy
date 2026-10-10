-- PRESTADOR-TIPO-01. How a provider is presented in TUS: as a person (persona fisica) or as a
-- business (empresa). Additive and forward-only: one column on the public profile and its CHECK.
-- Nothing is dropped and no existing value is rewritten.
--
-- Existing providers: 'persona_fisica' is the default because TUS never recorded a type; it changes
-- NOTHING of how they are shown (their public name stays exactly as it is). An administrator sets
-- 'empresa' explicitly, audited. The type is presentation only: it is no requirement to work, to
-- charge or to withdraw, and the holder of the account ("User".firstName / lastName) is elsewhere.
ALTER TABLE public."perfiles_publicos_prestador" ADD COLUMN "tipo_prestador" text NOT NULL DEFAULT 'persona_fisica';
ALTER TABLE public."perfiles_publicos_prestador"
  ADD CONSTRAINT "ck_perfiles_publicos_prestador_tipo" CHECK ("tipo_prestador" IN ('persona_fisica', 'empresa'));
