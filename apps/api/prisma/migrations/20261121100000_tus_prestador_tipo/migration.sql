-- PRESTADOR-TIPO-01. How a provider is presented in TUS: as a person (persona fisica) or as a
-- business (empresa). Forward-only: one column on the public profile, its CHECK, and the
-- classification of the profiles that already exist. Nothing is dropped.
--
-- The rule: a PERSON carries, as its public name, the full name of the holder of its account
-- (every first name and every last name, capitalized); a BUSINESS carries a free public name. The
-- type is presentation only: it is no requirement to work, to charge or to withdraw.
ALTER TABLE public."perfiles_publicos_prestador" ADD COLUMN "tipo_prestador" text NOT NULL DEFAULT 'persona_fisica';
ALTER TABLE public."perfiles_publicos_prestador"
  ADD CONSTRAINT "ck_perfiles_publicos_prestador_tipo" CHECK ("tipo_prestador" IN ('persona_fisica', 'empresa'));

-- Existing profiles. TUS never recorded a type, and a public name was free text. So that no
-- profile is left as a person with a name that is not the one of its holder, and WITHOUT changing
-- what any client sees:
--
--   (1) a profile is a person only when it is unequivocal: its provider is linked to exactly one
--       account, of its own tenant and active (the rule of directorio/cuenta-prestador.ts), that
--       account has a first and a last name, and the public name already IS that full name
--       (ignoring upper/lower case and repeated spaces);
--   (2) every other profile keeps its public name exactly as it is, as a business (a free name).
--       The administration turns it into a person, audited, whenever it corresponds.
--
-- No public name is written here: a person whose name differs from the rule only in upper/lower
-- case or spaces is rewritten by the application (the one helper, capitalizarNombrePropio) the
-- next time its profile or its holder is saved. (lower() depends on the locale of the database for
-- letters outside ASCII; where it does not fold them the profile simply stays a business.)
UPDATE public."perfiles_publicos_prestador" AS perfil
SET "tipo_prestador" = 'empresa'
WHERE NOT EXISTS (
  SELECT 1
  FROM (
    SELECT p."tenant_id", (array_agg(DISTINCT p."cuenta_id"))[1] AS cuenta_id
    FROM public."prestadores" p
    WHERE p."cuenta_id" IS NOT NULL
    GROUP BY p."tenant_id"
    HAVING count(DISTINCT p."cuenta_id") = 1
  ) titular
  JOIN public."Account" a ON a."id" = titular.cuenta_id AND a."tenantId" = titular."tenant_id" AND a."status" = 'active'
  JOIN public."User" u ON u."id" = a."userId"
  WHERE titular."tenant_id" = perfil."tenant_id"
    AND btrim(coalesce(u."firstName", '')) <> '' AND btrim(coalesce(u."lastName", '')) <> ''
    AND lower(regexp_replace(btrim(perfil."nombre_publico"), '\s+', ' ', 'g'))
      = lower(regexp_replace(btrim(u."firstName") || ' ' || btrim(u."lastName"), '\s+', ' ', 'g'))
);
