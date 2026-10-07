-- SEGURIDAD-DATA-API-01: the tables of TUS are not reachable through the Supabase Data API.
--
-- TUS uses Supabase only as PostgreSQL: Web -> API TUS -> Prisma -> PostgreSQL. Nothing reads a
-- table through PostgREST / GraphQL and there is no Supabase key in any client. But Supabase
-- publishes the schema `public` and grants its tables to the roles `anon` and `authenticated`, so
-- every table the migrations created could be read and written with the public (anon) key
-- (Security Advisor: rls_disabled_in_public, sensitive_columns_exposed).
--
-- Two independent controls, both closed:
-- 1. GRANTS: `anon` and `authenticated` lose every privilege on the tables, sequences and
--    functions of `public`, and stop receiving them on what later migrations create.
-- 2. RLS: enabled on every table, with NO policy: deny by default for any role that is not the
--    owner. No policy is created on purpose: nothing has to be public.
--
-- The role of the API is the owner of these tables (the same role that runs the migrations), and
-- an owner is not subject to RLS unless it is FORCED: it is never forced here. A table that is not
-- owned by the role running this migration is left untouched and reported, never locked.
--
-- Safe everywhere: on a PostgreSQL without those roles (local, CI) the grants part does nothing.
-- Forward-only, idempotent, no data is read or changed.

DO $$
DECLARE
  rol text;
  tabla record;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', rol);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', rol);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', rol);
      -- What this role creates from now on (every later migration) is not granted to them either.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', rol);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', rol);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', rol);
    END IF;
  END LOOP;

  FOR tabla IN
    SELECT c.oid::regclass AS nombre, pg_get_userbyid(c.relowner) AS propietario
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    IF tabla.propietario = current_user THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tabla.nombre);
    ELSE
      RAISE NOTICE 'SEGURIDAD-DATA-API-01: % is owned by % (not by %): RLS not changed', tabla.nombre, tabla.propietario, current_user;
    END IF;
  END LOOP;
END $$;
