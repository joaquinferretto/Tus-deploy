-- PRESTADOR-CUENTA-01 / SEGURIDAD-DATA-API-01: auditoría de datos, SOLO LECTURA.
--
-- Cada bloque es un SELECT: no modifica nada. Corre contra cualquier base de TUS que ya tenga la
-- migración 20261109100000_tus_prestador_cuenta (necesita prestadores.cuenta_id), por ejemplo
-- desde el SQL Editor de Supabase o con:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/db/auditoria-prestadores.sql
-- No imprime secretos: los teléfonos salen enmascarados y no se leen tokens ni contraseñas.
-- La columna "requiere" dice qué hacer con cada fila; nada de esto se corrige solo.

\echo '=== 1. Resumen de prestadores ==='
SELECT
  count(*)                                                        AS prestadores,
  count(*) FILTER (WHERE p."cuenta_id" IS NOT NULL)               AS con_cuenta_vinculada,
  count(*) FILTER (WHERE p."cuenta_id" IS NULL)                   AS sin_cuenta_vinculada
FROM public."prestadores" p;

\echo '=== 2. Prestadores SIN cuenta vinculada (reconciliación manual) ==='
-- cuentas_del_tenant = 0: nadie puede operar ese perfil. >= 2: había más de una candidata (la
-- regla anterior tomaba la más antigua); una persona tiene que decidir cuál es.
SELECT p."id" AS prestador, p."tenant_id", pf."nombre_publico", p."estado",
       (SELECT count(*) FROM public."Account" a WHERE a."tenantId" = p."tenant_id") AS cuentas_del_tenant,
       (SELECT count(*) FROM public."prestadores" y WHERE y."tenant_id" = p."tenant_id") AS prestadores_del_tenant,
       CASE
         WHEN (SELECT count(*) FROM public."Account" a WHERE a."tenantId" = p."tenant_id") = 0 THEN 'crear o asociar una cuenta'
         WHEN (SELECT count(*) FROM public."prestadores" y WHERE y."tenant_id" = p."tenant_id") > 1 THEN 'tenant con varios prestadores: decidir a mano'
         ELSE 'elegir cuál de las cuentas del tenant es la del prestador'
       END AS requiere
  FROM public."prestadores" p
  LEFT JOIN public."perfiles_publicos_prestador" pf ON pf."tenant_id" = p."tenant_id" AND pf."prestador_id" = p."prestador_id"
 WHERE p."cuenta_id" IS NULL
 ORDER BY cuentas_del_tenant DESC, p."fecha_creacion";

\echo '=== 3. Vínculos inválidos (cuenta inexistente, inactiva o de otro tenant) ==='
SELECT p."id" AS prestador, p."tenant_id", p."cuenta_id", a."status" AS estado_cuenta, a."tenantId" AS tenant_de_la_cuenta,
       CASE WHEN a."id" IS NULL THEN 'la cuenta no existe' WHEN a."tenantId" <> p."tenant_id" THEN 'la cuenta es de otro tenant' ELSE 'la cuenta no está activa' END AS requiere
  FROM public."prestadores" p
  LEFT JOIN public."Account" a ON a."id" = p."cuenta_id"
 WHERE p."cuenta_id" IS NOT NULL AND (a."id" IS NULL OR a."tenantId" <> p."tenant_id" OR a."status" <> 'active');

\echo '=== 4. Tenants de prestadores con más de una cuenta (antes caían en "la más antigua") ==='
SELECT p."tenant_id", count(DISTINCT a."id") AS cuentas, min(a."createdAt") AS cuenta_mas_antigua,
       bool_or(p."cuenta_id" IS NOT NULL) AS tiene_vinculo
  FROM public."prestadores" p
  JOIN public."Account" a ON a."tenantId" = p."tenant_id"
 GROUP BY p."tenant_id"
HAVING count(DISTINCT a."id") > 1
 ORDER BY cuentas DESC;

\echo '=== 5. Estado de contacto de cada prestador con cuenta vinculada ==='
-- destino_whatsapp: listo = recibe la solicitud con botones; requiere_plantilla = fuera de las 24
-- horas, solo le llega si la plantilla turno_solicitud_recibida está aprobada en Meta.
WITH base AS (
  SELECT p."id" AS prestador, p."tenant_id", pf."nombre_publico", a."id" AS cuenta, a."status" AS estado_cuenta,
         u."id" AS usuario, u."phoneNumber", u."phoneVerifiedAt", u."phonePending",
         (SELECT count(*) FROM public."contactos_whatsapp" c WHERE c."canal" = 'whatsapp' AND c."cuenta_vinculada_id" = a."id") AS contactos,
         (SELECT max(cv."ultimo_entrante_en")
            FROM public."contactos_whatsapp" c
            JOIN public."conversaciones_whatsapp" cv ON cv."contacto_id" = c."id" AND cv."estado" = 'active' AND cv."modo" = 'bot'
           WHERE c."canal" = 'whatsapp' AND c."cuenta_vinculada_id" = a."id") AS ultimo_mensaje,
         (SELECT v."estado" FROM public."verificaciones_identidad" v WHERE v."usuario_id" IN (a."id", u."id") ORDER BY v."fecha_creacion" DESC LIMIT 1) AS identidad,
         (SELECT cc."estado" FROM public."cuentas_cobro_prestador" cc WHERE cc."prestador_tenant_id" = p."tenant_id" ORDER BY cc."estado" LIMIT 1) AS mercado_pago
    FROM public."prestadores" p
    JOIN public."Account" a ON a."id" = p."cuenta_id"
    JOIN public."User" u ON u."id" = a."userId"
    LEFT JOIN public."perfiles_publicos_prestador" pf ON pf."tenant_id" = p."tenant_id" AND pf."prestador_id" = p."prestador_id"
)
SELECT prestador, "nombre_publico", cuenta, estado_cuenta,
       CASE WHEN "phoneNumber" IS NOT NULL THEN left("phoneNumber", 6) || '***' || right("phoneNumber", 4) WHEN "phonePending" IS NOT NULL THEN left("phonePending", 6) || '***' || right("phonePending", 4) END AS telefono,
       CASE WHEN "phoneNumber" IS NOT NULL AND "phoneVerifiedAt" IS NOT NULL THEN 'verificado' WHEN "phonePending" IS NOT NULL THEN 'sin verificar' ELSE 'sin teléfono' END AS estado_telefono,
       CASE WHEN contactos = 0 THEN 'no_vinculado' WHEN ultimo_mensaje > now() - interval '24 hours' THEN 'listo' ELSE 'requiere_plantilla' END AS destino_whatsapp,
       coalesce(identidad, 'sin verificación') AS identidad,
       coalesce(mercado_pago, 'not_connected') AS mercado_pago
  FROM base
 ORDER BY destino_whatsapp, "nombre_publico";

\echo '=== 6. Totales del punto 5 ==='
WITH base AS (
  SELECT a."id" AS cuenta, u."phoneNumber", u."phoneVerifiedAt", u."phonePending", p."tenant_id", u."id" AS usuario,
         EXISTS (SELECT 1 FROM public."contactos_whatsapp" c WHERE c."canal" = 'whatsapp' AND c."cuenta_vinculada_id" = a."id") AS vinculado,
         EXISTS (SELECT 1 FROM public."contactos_whatsapp" c JOIN public."conversaciones_whatsapp" cv ON cv."contacto_id" = c."id" AND cv."estado" = 'active' AND cv."modo" = 'bot'
                  WHERE c."canal" = 'whatsapp' AND c."cuenta_vinculada_id" = a."id" AND cv."ultimo_entrante_en" > now() - interval '24 hours') AS en_ventana
    FROM public."prestadores" p
    JOIN public."Account" a ON a."id" = p."cuenta_id"
    JOIN public."User" u ON u."id" = a."userId"
)
SELECT
  count(*)                                                                         AS prestadores_con_cuenta,
  count(*) FILTER (WHERE "phoneNumber" IS NULL AND "phonePending" IS NULL)          AS sin_telefono,
  count(*) FILTER (WHERE "phoneNumber" IS NULL AND "phonePending" IS NOT NULL)      AS telefono_no_verificado,
  count(*) FILTER (WHERE NOT vinculado)                                             AS whatsapp_no_vinculado,
  count(*) FILTER (WHERE vinculado AND NOT en_ventana)                              AS whatsapp_requiere_plantilla,
  count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public."verificaciones_identidad" v WHERE v."usuario_id" IN (cuenta, usuario) AND v."estado" IN ('verified', 'approved'))) AS identidad_no_verificada,
  count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public."cuentas_cobro_prestador" cc WHERE cc."prestador_tenant_id" = base."tenant_id" AND cc."estado" = 'connected')) AS mercado_pago_no_listo
FROM base;

\echo '=== 7. Data API: tablas de public sin RLS o con permisos para anon / authenticated ==='
-- Después de la migración 20261110100000_tus_data_api_cerrada este bloque no debe devolver filas.
SELECT c.relname AS tabla, c.relrowsecurity AS rls,
       has_table_privilege('anon', c.oid, 'SELECT')          AS anon_lee,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_lee,
       pg_get_userbyid(c.relowner)                           AS propietario
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
   AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
   AND (NOT c.relrowsecurity OR has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'))
 ORDER BY 1;

\echo '=== 8. Rol con el que corre esta sesión (debe ser el propietario de las tablas) ==='
SELECT current_user AS rol,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND pg_get_userbyid(c.relowner) <> current_user) AS tablas_de_otro_propietario;
