# Producción TUS: despliegue, variables, migraciones y pagos

> **Estado (2026-09-24, rama `web-tus`):** el paquete de staging está preparado, pero el despliegue permanece en
> **NO-GO** hasta completar el checklist de este documento y el gate de `docs/SEGURIDAD_TUS.md`. La integración
> real de Mercado Pago (WEB-09E: Checkout Pro + Split 1:1, OAuth con renovación, webhook firmado y reembolsos) está
> implementada para **sandbox**, pero **no se probó contra Mercado Pago** porque no hay credenciales de prueba cargadas. El
> **dinero real no es habilitable**. Todo lo de pagos falla cerrado mientras falte configuración.

Este documento es la guía práctica. El detalle técnico de pagos está en `docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md`.

## 1. Arquitectura de despliegue recomendada

| Pieza      | Destino de staging         | Configuración en el repo                                          |
| ---------- | -------------------------- | ----------------------------------------------------------------- |
| Web        | Vercel                     | `vercel.json`, `apps/web/next.config.js`                          |
| API        | Hostinger Node.js, Node 22 | comandos reproducibles de §3; `/health` y `/ready`                |
| PostgreSQL | PostgreSQL 16 administrado | `DATABASE_URL` pooled + `DIRECT_URL` directa; Prisma forward-only |

No se usan Docker ni Terraform en este perfil. Nada de esto se aplicó automáticamente: no se creó infraestructura paga ni
se desplegó.

Opcionales que siguen apagados y **no** son necesarios para usar TUS: MongoDB, Redis, worker Python, B2, WhatsApp, AWS,
jobs de release/flota, provider actions. Con `NATIVE_PROFILE=1` el `/ready` de la API no los exige.

## 2. Variables de entorno

Nunca pegues valores reales en Git, en este documento ni en `NEXT_PUBLIC_*`. Los secretos van en el panel de Hostinger
(Environment → secret) o en el secret manager que use el equipo. `.env.example` solo tiene marcadores.

### API (Hostinger)

| Variable                       | Obligatoria      | Valor / ejemplo                                              | Secreto |
| ------------------------------ | ---------------- | ------------------------------------------------------------ | ------- |
| `NODE_ENV`                     | sí               | `production`                                                 | no      |
| `DATABASE_URL`                 | sí               | `postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require`    | **sí**  |
| `DIRECT_URL`                   | solo release     | endpoint directo de la misma DB, con TLS y permisos DDL      | **sí**  |
| `CORS_ORIGINS`                 | sí               | `https://<dominio-web>` (separadas por coma, sin `/` final)  | no      |
| `NATIVE_PROFILE`               | sí               | `1` (Mongo/Redis/worker opcionales para `/ready`)            | no      |
| `TUS_ROUTES_ENABLED`           | sí para usar TUS | `true` (en `render.yaml` sigue `false` por política; ver §5) | no      |
| `SECRET_STORE_REF`             | no (declarativa) | referencia del secret store; la API no la lee al arrancar    | no      |
| `PORT`                         | sí               | lo entrega Hostinger; prevalece sobre `API_PORT`             | no      |
| `HOST`                         | no               | default productivo `0.0.0.0`                                 | no      |
| `TRUST_PROXY_HOPS`             | sí               | `1` si hay exactamente un proxy Hostinger delante de Node    | no      |
| `SHUTDOWN_TIMEOUT_MS`          | no               | default del runtime                                          | no      |
| `TUS_PROVIDER_ACTIONS_ENABLED` | no               | `false`                                                      | no      |
| `TUS_RELEASE_JOBS_ENABLED`     | no               | `false`                                                      | no      |
| `TUS_FLEET_JOBS_ENABLED`       | no               | `false`                                                      | no      |
| `MONGODB_URL`, `REDIS_URL`     | no               | vacías (opcionales con `NATIVE_PROFILE=1`)                   | sí      |

Pagos (todas opcionales hasta habilitar dinero real; si falta cualquiera, los pagos quedan no disponibles):

| Variable                          | Qué es                                                                   | Secreto |
| --------------------------------- | ------------------------------------------------------------------------ | ------- |
| `TUS_MERCADOPAGO_ENABLED`         | interruptor de entorno de Mercado Pago (`true`/`false`)                  | no      |
| `MERCADO_PAGO_ENVIRONMENT`        | `sandbox` o `production` (sandbox pide tokens de prueba en OAuth)        | no      |
| `MERCADO_PAGO_CLIENT_ID`          | "Número de aplicación" (APP_ID) de la app de TUS en Mercado Pago         | no*     |
| `MERCADO_PAGO_CLIENT_SECRET`      | Client secret de la app de TUS                                           | **sí**  |
| `MERCADO_PAGO_WEBHOOK_SECRET`     | clave secreta de Webhooks de la app (valida `x-signature`)               | **sí**  |
| `MERCADO_PAGO_OAUTH_REDIRECT_URI` | `https://<api>/tus/v1/integrations/mercado-pago/oauth/callback` (exacta) | no      |
| `TUS_PAYMENT_CREDENTIALS_KEY`     | 32 bytes aleatorios en base64 para cifrar tokens de prestadores          | **sí**  |
| `TUS_WEB_BASE_URL`                | `https://<dominio-web>`; destino del redirect después del OAuth          | no      |
| `TUS_PLATFORM_ADMIN_TENANT_ID`    | tenant cuyos usuarios con `tus:payments:admin` administran pagos         | no      |
| `MERCADO_PAGO_NOTIFICATION_URL`   | `https://<api>/tus/v1/integrations/mercado-pago/webhooks` (HTTPS)        | no      |
| `MERCADO_PAGO_MARKETPLACE`        | opcional; solo si Mercado Pago exige `marketplace` con `marketplace_fee` | no      |

\* No es secreto pero tratalo como configuración sensible. El access token y la public key **de TUS** no se usan en este
flujo (los cobros se crean con el token OAuth de cada prestador); no hace falta cargarlos.

Generar la clave de cifrado (una vez, guardarla en el secret store; si se pierde, los prestadores deben reconectar):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Ingreso con Google (opcional; sin las tres variables el botón aparece como no disponible):

| Variable               | Qué es                                                                          | Secreto |
| ---------------------- | ------------------------------------------------------------------------------- | ------- |
| `GOOGLE_CLIENT_ID`     | Client ID del cliente OAuth "Aplicación web" de Google Cloud                    | no*     |
| `GOOGLE_CLIENT_SECRET` | Client secret de ese cliente                                                    | **sí**  |
| `GOOGLE_REDIRECT_URI`  | `https://<api>/auth/oauth/google/callback` (exacta, registrada en Google, HTTPS) | no      |

También requiere `TUS_WEB_BASE_URL` (destino del callback). En Google Cloud Console → APIs y servicios → Credenciales →
Crear credenciales → ID de cliente de OAuth → Aplicación web: agregar como "URI de redireccionamiento autorizado" el valor
exacto de `GOOGLE_REDIRECT_URI`; en "Pantalla de consentimiento" usar los scopes `openid`, `email` y `profile`.

Para los dominios actuales, cargar en Hostinger (API):

```text
GOOGLE_CLIENT_ID=<ID del cliente OAuth de Google>
GOOGLE_CLIENT_SECRET=<secreto del mismo cliente, solo en Hostinger>
GOOGLE_REDIRECT_URI=https://api.tusservicios.shop/auth/oauth/google/callback
TUS_WEB_BASE_URL=https://tusservicios.shop
```

Registrar esa misma URI de callback en Google Cloud y revisar la audiencia y el estado de publicación. Google contempla
una excepción a la lista de usuarios de prueba para los scopes básicos `openid`, `email` y `profile` usados aquí; una
aplicación interna de Workspace puede seguir restringida a su organización. Ver la
[documentación de estados OAuth](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).
Guardar las variables y redesplegar la API. `GET /auth/oauth/providers` debe devolver HTTP 200 con
`{"google":{"available":true}}`; un 200 con `available:false` significa que Google sigue deshabilitado.
`GET /auth/oauth/google/start` devuelve **303** a Google (una redirección correcta, no debe devolver 200).

Login y registro usan el mismo flujo: después de validar Google, un correo nuevo recibe un código de registro de un
solo uso en `/ingresar/google#code=...`. `POST /auth/oauth/exchange` crea la cuenta con el nombre y correo verificado de
Google, la vincula y devuelve HTTP 200 con una sesión TUS. No pide contraseña ni un segundo formulario. Un ingreso
posterior recupera la misma cuenta. Si el correo ya pertenece a otra cuenta TUS sin ese vínculo, exige iniciar sesión
en esa cuenta para vincular Google; no fusiona cuentas por coincidencia de correo.

La disponibilidad y los HTTP 200 no prueban por sí solos el consentimiento real en Google: verificar una primera entrada
y una segunda entrada con una cuenta de prueba autorizada, comprobando que conserva la misma cuenta TUS.

### Web (Vercel o Render `factory-web`)

| Variable                           | Obligatoria | Valor                                                                 |
| ---------------------------------- | ----------- | --------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`              | sí          | `https://<dominio-api>` (se incrusta en el build: redeploy si cambia) |
| `NEXT_PUBLIC_SITE_URL`             | recomendada | `https://<dominio-web>`                                               |
| `NEXT_PUBLIC_SUPPORT_WHATSAPP_URL` | no          | URL pública de soporte                                                |
| `API_BASE_URL`                     | no          | si se define debe ser igual a `NEXT_PUBLIC_API_URL`                   |
| `NEXT_PUBLIC_MAP_*`                | no          | proveedor de tiles y centro del mapa de la home (default OSM/Corrientes) |

La Web **no** necesita ningún secreto. Nunca definas tokens o claves en variables `NEXT_PUBLIC_*`. Sin
`NEXT_PUBLIC_API_URL` el build de producción falla a propósito; no hay `localhost` fijo.

### PostgreSQL

- PostgreSQL 16. TLS obligatorio: la API rechaza `DATABASE_URL` productiva sin `sslmode=require`, `verify-ca` o
  `verify-full`.
- `DATABASE_URL`: endpoint pooled, usuario de runtime con privilegios mínimos y límite de conexiones acorde al plan.
- `DIRECT_URL`: endpoint directo de la misma base, usuario de migración con DDL; cargarlo solo en el release job.
- Confirmar antes de migrar que `vector` está disponible e instalado. La cadena crea HNSW y falla si el plan no soporta
  pgvector.
- Backups automáticos + posibilidad de restauración puntual (PITR) antes de migrar.

## 3. Preparar la API en Hostinger

1. Configurar raíz del repositorio, Node `22.x` y Corepack/pnpm `9.15.9`.
2. Install: `corepack pnpm install --frozen-lockfile`.
3. Build: `corepack pnpm --filter @factory/api... build`. Los tres puntos son obligatorios: compilan primero todas las
   dependencias workspace y evitan depender de `dist/` cacheado.
4. Release, manual y separado del build: `corepack pnpm --filter @factory/api prisma:migrate:deploy`, únicamente después
   del gate PostgreSQL de §6. No configurar migración automática hasta probar la cadena sobre un clon descartable.
5. Start: `corepack pnpm --filter @factory/api start` (`node dist/index.js`). No usar `tsx`, watcher ni `pnpm dev`.
6. Cargar las variables de §2. Para staging funcional: `NATIVE_PROFILE=1`, `TUS_ROUTES_ENABLED=true`, provider actions y
   pagos en `false`.
7. Verificar:
   - `GET https://<api>/health` → `200 {"status":"ok"}`.
   - `GET https://<api>/ready` → `200 {"ready":true}` (con `NATIVE_PROFILE=1`; si da `503` revisar `dependencies` y
     `schema` en la respuesta).
8. Configurar liveness en `/health` y, si Hostinger permite readiness, tráfico solo con `/ready` en 200.
9. Verificar que `TRUST_PROXY_HOPS=1` devuelve buckets de rate limit por IP real. Si la topología tiene otro número de
   proxies, medirlo y fijar el valor exacto; nunca usar `trust proxy=true`.

## 4. Desplegar la Web (Vercel)

1. Importar el repositorio en Vercel. Opción recomendada: **Root Directory = raíz del repo** (usa `vercel.json`:
   instala con pnpm y ejecuta `pnpm --filter @factory/web... build`). No usar `apps/web` como raíz sin replicar el acceso
   a dependencias workspace.
2. Variables: `NEXT_PUBLIC_API_URL=https://<api>`, `NEXT_PUBLIC_SITE_URL=https://<web>`.
3. Deploy. Luego agregar `https://<web>` a `CORS_ORIGINS` de la API y redeployar la API.
4. Verificar `https://<web>/`, `/sign-in`, `/tus/mercado` y `/tus/prestador`. Si la API no responde, la Web muestra
   estados de error con reintento (no usa mocks).

El build local en Windows puede fallar solo en el paso `standalone` por symlinks (`EPERM`); en Linux/Vercel no aplica.
Para verificar localmente: `NEXT_DISABLE_STANDALONE=true pnpm --filter @factory/web... build`.

## 5. Habilitar TUS para el equipo (sin dinero real)

1. `TUS_ROUTES_ENABLED=true` en la API de staging. Mantener `TUS_PROVIDER_ACTIONS_ENABLED=false` y
   `TUS_MERCADOPAGO_ENABLED=false`.
2. Cuentas del equipo: `POST /auth/register` crea cuenta y tenant, pero **el backend no envía emails todavía**
   (`InMemoryEmailSender`) y el login exige email verificado. Hasta integrar un proveedor de correo, un operador puede
   verificar cuentas **del equipo** con SQL auditado solo sobre la base de staging:

   ```sql
   UPDATE "Account" a SET "emailVerifiedAt" = now(), "updatedAt" = now()
   FROM "User" u
   WHERE a."userId" = u.id AND u."normalizedEmail" = lower('persona@equipo.com') AND a."emailVerifiedAt" IS NULL;
   ```

3. Permisos: el dueño de una cuenta registrada recibe `tus:checkout`, `tus:marketplace:read`, `tus:marketplace:write` y
   `tus:read`; alcanza para publicar, comprar, gestionar trabajos y ver la preview de pago. Algunas rutas de calendario
   exigen `tus:calendar:write` (asignar por roles de tenancy si se necesita).
4. Qué ve el equipo: cliente → mercado, compra, trabajos, presupuesto, bloque "Pago" con total y "Pago online no disponible
   todavía"; prestador → publicaciones, trabajos, evidencia y "Cobros con Mercado Pago" (conexión deshabilitada hasta
   configurar OAuth).

## 6. Migraciones de base de datos (runbook)

La DB de staging debe ser nueva y vacía. No usar `factory_local`. Antes de aplicar, clasificar el target como **fresh** y
probar la cadena completa sobre una base PostgreSQL 16 descartable con pgvector:

1. `20260916140000_tus_provider_agenda_publication_modes`
2. `20260917100000_tus_work_budget`
3. `20260923100000_tus_service_finance_identity`
4. `20260923110000_tus_service_payment_intents`
5. `20260923120000_tus_service_settlement_reconciliation`
6. `20260924100000_tus_finance_subject_hardening`
7. `20260924130000_tus_work_reservation_unique`
8. `20260925100000_tus_service_payment_configuration`
9. `20260926100000_tus_service_payment_checkout` (WEB-09E)

La lista completa no se debe mantener a mano. Recalcularla desde el checkout antes de cada release:

```powershell
Get-ChildItem -LiteralPath apps/api/prisma/migrations -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName 'migration.sql') } |
  Sort-Object Name |
  Select-Object -ExpandProperty Name
```

```bash
find apps/api/prisma/migrations -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
```

La auditoría de este checkout encontró 41 migraciones; la primera es
`20260823120000_identity_persistence` y la última `20260926100000_tus_service_payment_checkout` (WEB-09E).
La migración de vector es `20260824150000_p3_embeddings_pgvector`. Las migraciones de finanzas incluyen
`20260826120000_tus_finance`, `20260827090500_tus_finance`, `20260923100000_tus_service_finance_identity`,
`20260923110000_tus_service_payment_intents`, `20260923120000_tus_service_settlement_reconciliation`,
`20260924100000_tus_finance_subject_hardening`, `20260925100000_tus_service_payment_configuration` y
`20260926100000_tus_service_payment_checkout`.

El resultado histórico 41/41 desde cero no se reutiliza como prueba del proveedor elegido: debe repetirse en una DB
PostgreSQL 16 descartable y registrarse con el commit exacto.

**No aplicar sobre `factory_local` ni sobre una base compartida sin autorización explícita.**

1. **Preflight:** `SHOW server_version;` y consultar `pg_available_extensions` para `vector`. Si la credencial de migración
   no puede instalarla, pedir al proveedor que lo haga antes.
2. **Linaje:** confirmar DB vacía o `_prisma_migrations` canónico sin filas fallidas. Un target divergente es NO-GO y no
   debe recibir replay histórico.
3. **Backup:** snapshot/PITR del proveedor; incluso en staging, probar restauración antes del primer cambio con datos.
4. **Detener la API** si el target ya recibe tráfico, para evitar escrituras durante el DDL.
5. **Preflight de solo lectura** (checklist DB-09-SAFETY en `docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md`): filas legacy
   incompatibles y trabajos que compartan reserva (bloquean `uq_trabajos_reserva`).
6. **Timeouts de sesión** para que un lock no quede colgado:
   `DIRECT_URL="...?options=-c%20lock_timeout%3D5s%20-c%20statement_timeout%3D300s"` (o
   `ALTER ROLE <migrador> SET lock_timeout = '5s'; ALTER ROLE <migrador> SET statement_timeout = '300s';`).
7. **Aplicar:** `corepack pnpm --filter @factory/api prisma:migrate:deploy`; Prisma usa `DIRECT_URL` para DDL.
8. **Verificar historial:**
   `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 10;`
   → en una DB fresh, las 41 migraciones deben tener `finished_at` no nulo y `rolled_back_at` nulo; en un upgrade, las 9
   nuevas de este release deben cumplirlo; `prisma migrate status` → "Database schema is up to date".
9. **Smoke DB:** existen `politicas_comision_servicio`, `configuraciones_pagos_servicio`, `cuentas_cobro_prestador`,
   `obligaciones_pago_servicio`, `reembolsos_servicio`; columna `intenciones_pago.comision_marketplace`; triggers `tus_politica_comision_append_only_trigger` y
   `tus_configuracion_pagos_append_only_trigger`.
10. **Iniciar la API.**
11. `GET /health` → 200.
12. `GET /ready` → 200.
13. **Smoke funcional:** login de una cuenta de prueba, `GET /tus/v1/work`, `GET /tus/v1/work/<id>/payment-preview`
    (debe responder `paymentAvailable:false` con `PAYMENTS_DISABLED`), `GET /tus/v1/admin/payments/status` con el admin.
14. **Rollback:** no hay down migrations. Si algo falla antes de abrir tráfico: restaurar el backup del paso 3 y
    redeployar el commit anterior. Si falla después: preferir una migración correctiva forward-only; restaurar solo si hay
    corrupción y aceptando perder escrituras posteriores al backup.

### 6.1 PostgreSQL administrado, URLs, SSL y pgvector

El código usa PostgreSQL estándar, Prisma y `pg`; no usa APIs de Supabase, Neon ni Render. Los tres perfiles son válidos
solo si el target ofrece PostgreSQL 16, TLS, `vector` y conexiones Prisma:

| Proveedor         | `DATABASE_URL` runtime                                                | `DIRECT_URL` Prisma               | Consideración                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase          | Pooler de sesión para una red IPv4 o conexión directa en una red IPv6 | Conexión directa                  | Migraciones, backups y restore deben usar la conexión directa. Ver [Supabase Connect](https://supabase.com/docs/guides/database/connecting-to-postgres). |
| Neon              | URL pooled (`-pooler`) para la API persistente                        | URL directa sin `-pooler`         | Prisma Migrate requiere conexión directa. Ver [Neon connection methods](https://neon.com/docs/connect/choose-connection).                                |
| Render PostgreSQL | URL interna si API y DB comparten región, o externa desde Hostinger   | URL directa/externa apta para DDL | Confirmar versión 16 y extensión en el dashboard. Ver [Render Postgres](https://render.com/docs/postgresql-creating-connecting).                         |

La API solo lee `DATABASE_URL`. `DIRECT_URL` es para `prisma validate`, `prisma migrate deploy` e introspección/release;
no debe imprimirse ni ser necesaria para requests. Si el proveedor no separa endpoints, se puede usar la misma URL en ambas
variables, manteniendo TLS y confirmando que el endpoint soporta DDL.

La configuración productiva debe usar `sslmode=require` como mínimo. Cuando el proveedor entrega CA, preferir
`sslmode=verify-full` con `sslrootcert`; no usar `sslmode=no-verify`, `rejectUnauthorized=false` ni certificados
desactivados. El driver `pg` recibe la política desde la URL y el código no agrega bypass TLS.

La migración `20260824150000_p3_embeddings_pgvector/migration.sql` ejecuta `CREATE EXTENSION IF NOT EXISTS vector`, crea
`vector(1024)` y un índice HNSW `vector_cosine_ops`. Si el usuario migrador no puede crear extensiones, un operador debe
habilitarla previamente en el target autorizado:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
```

No ejecutar esas sentencias contra `factory_local` ni una base compartida sin autorización.

### 6.1.1 Supabase paso a paso (base de TUS, incluidas las solicitudes del mapa)

TUS usa Supabase **solo como PostgreSQL**: la API se conecta con Prisma por `DATABASE_URL`. No se usa Supabase Auth, ni
`supabase-js`, ni claves `anon`/`service_role` en la Web.

1. Crear el proyecto (región cercana, p. ej. São Paulo) y guardar la contraseña de la base en el gestor de secretos.
2. Database → Extensions: habilitar `vector` (lo necesita la migración de embeddings).
3. **Cerrar la Data API**: Supabase publica el esquema `public` por PostgREST y las tablas que crean las migraciones
   quedarían accesibles con la clave `anon`. Como TUS no usa esa API: Project Settings → Data API → desactivarla (o quitar
   `public` de "Exposed schemas"). Alternativa: habilitar RLS sin políticas en todas las tablas.
4. Connect → copiar las URIs:
   - `DATABASE_URL` (runtime de la API en Hostinger): **Session pooler** (IPv4, puerto 5432), agregando `?sslmode=require`.
     No usar el Transaction pooler (6543) salvo que se agregue `pgbouncer=true&connection_limit=1`.
   - `DIRECT_URL` (solo migraciones, desde la máquina de release): **Direct connection** si hay IPv6; si no, el mismo
     Session pooler.
5. Migraciones: **siempre con `node scripts/db/migrate-deploy.mjs`**, nunca con `prisma migrate deploy` directo sobre
   una base nueva (ver 6.1.2). El despliegue de Hostinger lo corre solo después de compilar (`HOSTINGER_API_BUILD=1`);
   para la primera inicialización puede correrse también desde la máquina de release con las variables cargadas en la
   sesión (sin escribirlas en archivos ni en el historial).
6. Cargar `DATABASE_URL`, `DIRECT_URL` y `NODE_EXTRA_CA_CERTS` (ver 6.1.3) en Hostinger y redeployar la API. Verificar
   `/health`, `/ready` y `GET /tus/v1/public/solicitudes` (debe responder `{"items":[]}` con la base vacía).
7. Probar de punta a punta: iniciar sesión en la Web → `/publicar` → publicar → la solicitud aparece en el mapa de `/`.

La migración `20261001100000_tus_directorio_prestadores` (perfiles públicos, solicitudes dirigidas e imágenes) va
después de `20260930100000_tus_solicitudes_servicio`; es aditiva y las solicitudes existentes quedan públicas.

### 6.1.2 Migraciones automáticas e inicialización de una base nueva

`scripts/db/migrate-deploy.mjs` (lógica en `scripts/db/migrate-deploy-lib.mjs`, tests en
`tests/foundation/tus-migrate-deploy.test.mjs`) es el único camino de migración de despliegue:

- `scripts/hostinger-postinstall.mjs` lo ejecuta **después de compilar la API y antes de que Hostinger la arranque**. Si
  falla, la instalación termina con código distinto de 0 y el despliegue queda fallido. La API **nunca** migra al
  arrancar y la Web (Vercel) nunca migra.
- Requiere `DATABASE_URL` y `DIRECT_URL` (misma base; en producción con `sslmode=require|verify-ca|verify-full`). Se niega a
  correr contra `factory_local`, sin TLS en producción, con migraciones fallidas previas o sobre un esquema `public` con
  tablas y sin historial de Prisma. Solo imprime host, puerto, base, `sslmode` y el ref del proyecto Supabase; nunca
  usuario ni contraseña.
- **Mismo proyecto Supabase:** si alguna de las dos URLs es de Supabase, ambas tienen que ser endpoints reconocidos del
  mismo proyecto: directa o PgBouncer dedicado `db.<ref>.supabase.co` (usuario `postgres`) y Supavisor
  `aws-N-<región>.pooler.supabase.com` (usuario `<rol>.<ref>`, puertos 5432 o 6543). Cualquier combinación
  directa/pooler del mismo `<ref>` se acepta; refs distintos, un pooler sin `<rol>.<ref>`, un host de Supabase no
  reconocido o mezclar Supabase con otro proveedor detienen el proceso antes de conectar.
- **`migrate status` estricto:** solo se sigue si la salida completa coincide con el formato conocido de Prisma 5 ("al
  día" con exit 0, o lista de pendientes con exit 1 —el caso normal— o 0), la cantidad de migraciones coincide con el
  directorio y todos los nombres existen localmente. Migraciones fallidas, errores de conexión (`P1001`, `P1003`, ...) y
  **cualquier salida o error no reconocido** detienen el proceso antes de escribir.
- **Preflight de solo lectura** antes de la primera escritura: `migrate status` informa lo mismo para una base vacía que
  para una con tablas ajenas, así que un bloque `DO` que solo consulta el catálogo aborta si `public` tiene objetos y no
  existe `_prisma_migrations`.
- Es idempotente: sin pendientes termina con "nothing to apply". Nunca usa `migrate reset`, `db push` ni `--accept-data-loss`.

Por qué no alcanza con `prisma migrate deploy` en una base **vacía** (reproducido con la cadena real en PostgreSQL 16
descartable):

1. **22001 en `20260911120000_tus_pos_index_constraint_repair`** (y luego en `20260911130000`): Prisma crea
   `_prisma_migrations.id` como `VARCHAR(36)` y registra su fila antes de ejecutar cada migración. Esas migraciones
   terminan con `INSERT ... SELECT '<marcador de 38/41 caracteres>' ... WHERE NOT EXISTS` (pensado para
   `scripts/tus-migration-repair.mjs`, que crea la tabla con `id TEXT`); el `WHERE` descarta la fila, pero la constante
   igual se convierte a `VARCHAR(36)` y falla. **Solución:** si hay pendientes de esas dos, el script crea la tabla con el
   formato de Prisma salvo `id TEXT` (o amplía `id` a `TEXT` si ya existe; sin reescritura). Así el `NOT EXISTS` encuentra
   la fila de Prisma y no se inserta ningún marcador.
2. **42883 en `20260911130000_tus_live_schema_conformance_repair`**: compara `ARRAY(SELECT attname ...)` (`name[]`) con
   `text[]`; ese operador no existe en ninguna versión de PostgreSQL, así que esa migración no pudo aplicarse nunca tal cual.
   **Solución sin editar el archivo:** el script aplica con Prisma todo lo anterior, ejecuta esa migración derivada del
   archivo original con una sola sustitución verificada (`)::text[] = definition.index_columns`) y sin su `INSERT` de
   marcador, **en una transacción**, y la registra con `prisma migrate resolve --applied` (checksum real del archivo). Si
   el archivo cambiara de forma inesperada, la derivación falla y no se aplica nada. Luego corre `prisma migrate deploy`
   con el resto y exige `migrate status` al día.

Validado en PostgreSQL 16 descartable con TLS: base nueva completa (49 migraciones, 49 filas con checksum real y sin
marcadores), segunda ejecución sin cambios, esquema idéntico (`pg_dump --schema-only`) al de la cadena ejecutada como si
`20260911130000` fuese correcta, base existente (historial con marcadores de la herramienta de reparación) que solo recibe
lo pendiente y queda idéntica, y arranque real de la API con `/health` y `/ready`.

`prisma migrate diff` contra `schema.prisma` sigue mostrando diferencias **previas** (la base de referencia es idéntica):
objetos solo-SQL que Prisma no representa y que deben conservarse (FKs a tenants y conversaciones, índices parciales/HNSW,
defaults y `NOT NULL` agregados por migraciones, tabla legacy `RefreshTokenFamily`) y 9 índices declarados en
`schema.prisma` que ninguna migración crea (más un nombre de índice truncado). Estos últimos solo afectan rendimiento; se
corrigen con una migración de convergencia nueva, nunca editando la historia.

### 6.1.3 TLS de la API contra Supabase (sin desactivar la verificación)

La API usa `pg` para el chequeo de arranque. Con `pg` 8.2x, `sslmode=require` se trata como `verify-full`: verifica la
cadena y el nombre del servidor. El certificado de Supabase lo firma la CA propia de Supabase, que Node no trae, y el
arranque falla con `reason=SELF_SIGNED_CERT_IN_CHAIN` o `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (reproducido con una CA propia).
Prisma (migraciones y cliente) no es afectado. La solución es confiar en esa CA, no desactivar TLS:

La CA pública oficial está incluida en `apps/api/certs/supabase-ca.crt`, con su fuente, huella y vencimiento en el README
de esa carpeta. El pool `pg` la carga automáticamente para hosts Supabase reconocidos con `sslmode=require`, `verify-ca`
o `verify-full`, usando `sslrootcert` y forzando `verify-full`. Verifica cadena y hostname; no desactiva la validación TLS.
La ruta se resuelve desde el módulo compilado, independientemente del directorio de trabajo de Hostinger. Conservar la
carpeta `apps/api/certs` en el artefacto. No hace falta configurar `NODE_EXTRA_CA_CERTS` para este pool.

Si se especifica `sslrootcert` en `DATABASE_URL`, ese certificado tiene prioridad. Para renovar la CA, descargarla desde
Supabase → Database → SSL Configuration → **Download certificate**, verificar su procedencia y actualizar el archivo y
su huella documentada. No usar certificados recuperados de una conexión TLS no verificada.

Con la CA confiada, el mismo arranque llega a `/ready`. Si el log dice `reason=ERR_TLS_CERT_ALTNAME_INVALID`, el host de
`DATABASE_URL` no coincide con el certificado (usar exactamente el host que muestra Supabase en Connect).

### 6.2 Comandos de release sin secretos en Git

PowerShell:

```powershell
$env:DATABASE_URL = 'postgresql://RUNTIME_USER:PASSWORD@POOL_HOST:5432/DB?sslmode=require'
$env:DIRECT_URL = 'postgresql://MIGRATION_USER:PASSWORD@DIRECT_HOST:5432/DB?sslmode=verify-full'
corepack pnpm --filter @factory/api exec prisma validate
corepack pnpm --filter @factory/api prisma:migrate:deploy
```

Bash:

```bash
export DATABASE_URL='postgresql://RUNTIME_USER:PASSWORD@POOL_HOST:5432/DB?sslmode=require'
export DIRECT_URL='postgresql://MIGRATION_USER:PASSWORD@DIRECT_HOST:5432/DB?sslmode=verify-full'
corepack pnpm --filter @factory/api exec prisma validate
corepack pnpm --filter @factory/api prisma:migrate:deploy
```

Después de migrar, verificar en la DB autorizada:

```sql
SELECT current_setting('server_version'), extname, extversion
FROM pg_extension
WHERE extname = 'vector';

SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
ORDER BY started_at;
```

Una DB fresh debe reportar 41 migraciones terminadas, sin `rolled_back_at` ni filas fallidas. No marcar el resultado como
válido si el target no es PostgreSQL 16 o si el check `vector` falla.

### 6.3 Usuarios y timeouts

Separar, cuando el proveedor lo permita, un usuario de migración con DDL de un usuario runtime sin `SUPERUSER`,
`CREATEDB` ni `CREATEROLE`. El runtime solo necesita DML y las funciones/objetos ya instalados por migración. Si el
proveedor no permite esta separación en staging, registrarlo como deuda operativa y no elevar privilegios más allá de lo
necesario.

Antes de migrar, fijar en la sesión o rol migrador `lock_timeout = '5s'` y `statement_timeout = '300s'`, o usar los
parámetros equivalentes en `DIRECT_URL`. La API mantiene conexión máxima 2, timeout de conexión/statement de 60 segundos,
dos intentos acotados y cierre del pool fallido; no aumentar el pool sin evidencia de carga.

## 7. Mercado Pago: qué hay y cómo se configura

### Modelo implementado (WEB-09E, documentación oficial de Mercado Pago Argentina)

- Producto: **Split de Pagos 1:1 (marketplace) con Checkout Pro**. TUS es el marketplace; cada prestador es el vendedor.
- **Cuenta de TUS:** es la dueña de la _aplicación_ en Mercado Pago Developers y recibe su comisión (`marketplace_fee`).
- **Cuenta del prestador:** cada prestador conecta **su propia** cuenta por OAuth. La preferencia de pago se crea con el
  token del prestador; Mercado Pago cobra al cliente, acredita en la cuenta del prestador y separa automáticamente la
  comisión de TUS. TUS **no** cobra todo en su cuenta ni hace transferencias manuales.
- Por qué Checkout Pro y no Checkout API: Mercado Pago aloja el checkout (TUS no toca datos de tarjeta), TUS mantiene la
  autoridad sobre monto, comisión e idempotencia y el split 1:1 funciona igual con `marketplace_fee`. Hay una sola
  implementación productiva.

### Dinero: quién paga qué

**El cliente paga exactamente el total del presupuesto aceptado. No se le suma la comisión de TUS ni la de Mercado Pago.**

```text
Cliente paga total presupuesto
- fee Mercado Pago        (lo informa Mercado Pago en el pago; nunca se estima)
- comisión TUS            (tasa en bp sobre el total, congelada al crear el checkout)
= neto prestador
```

Ejemplo con presupuesto aceptado de **$50.000** y comisión TUS 10% (1000 bp):

| Concepto                    | Cálculo                                       | Resultado  |
| --------------------------- | --------------------------------------------- | ---------- |
| Total pagado por el cliente | presupuesto aceptado                          | $50.000,00 |
| Comisión TUS                | 50.000 × 1000 / 10000 (enteros, half-up)      | $5.000,00  |
| Fee Mercado Pago (ejemplo)  | `fee_details` tipo `mercadopago_fee` del pago | $3.000,00  |
| Neto del prestador          | 50.000 − 3.000 − 5.000                        | $42.000,00 |

- Todo en centavos (`bigint`); la conversión a decimal solo ocurre al hablar con Mercado Pago.
- La comisión se convierte a **monto** y se congela en la intención de pago al crear el checkout; eso es lo que recibe
  Mercado Pago como `marketplace_fee` y lo que se registra al aprobarse. Si TUS pasa de 10% a 12%, los pagos ya
  iniciados siguen en 10%.
- Si Mercado Pago todavía no informó su fee al aprobar, el neto queda "pendiente" y se completa una sola vez cuando llega
  el dato (nunca se inventa una tasa).

### Endpoints

| Ruta                                                                         | Quién               | Qué hace                                             |
| ---------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------- |
| `GET /tus/v1/work/:id/payment-preview`                                       | cliente del trabajo | total, estado, si se puede pagar (solo lectura)      |
| `POST /tus/v1/work/:id/checkout` (+ `Idempotency-Key`)                       | cliente del trabajo | crea o reutiliza el checkout y devuelve la URL de MP |
| `POST /tus/v1/integrations/mercado-pago/webhooks`                            | Mercado Pago        | notificaciones firmadas (`x-signature`)              |
| `GET /tus/v1/work/:id/finance`                                               | cliente / prestador | estado; el prestador ve bruto, comisión, fee y neto  |
| `GET/POST /tus/v1/provider/payment-account...`                               | prestador           | estado, conectar (OAuth) y desconectar               |
| `GET /tus/v1/integrations/mercado-pago/oauth/callback`                       | navegador (OAuth)   | vuelve de Mercado Pago y guarda la conexión          |
| `POST /tus/v1/admin/payments/refunds` (+ `Idempotency-Key`)                  | admin de plataforma | reembolso total                                      |
| `GET/POST /tus/v1/admin/payments/{status,configuration,commission-policies}` | admin               | estado, interruptor y comisión                       |

La vuelta del navegador desde Mercado Pago (`/tus/compromisos?pago=retorno&trabajo=<id>`) **nunca confirma** un pago: la
Web muestra "Estamos confirmando tu pago" y consulta a TUS hasta que llega el webhook verificado.

### Pasos en Mercado Pago Developers (manuales, los hace el dueño de la cuenta TUS)

1. Entrar a <https://www.mercadopago.com.ar/developers/panel/app> con la cuenta de TUS y **crear una aplicación**:
   pagos online, **Checkout Pro**, con **modelo marketplace / Split de Pagos** (si el formulario lo pregunta).
2. En la app → **URLs de redireccionamiento**: `https://<api>/tus/v1/integrations/mercado-pago/oauth/callback`
   (exacta y estática; es `MERCADO_PAGO_OAUTH_REDIRECT_URI`).
3. Habilitar el **flujo de código de autorización con PKCE** (TUS envía `code_challenge` S256).
4. **Credenciales de prueba** → copiar _Número de aplicación_ (`MERCADO_PAGO_CLIENT_ID`) y _Client secret_
   (`MERCADO_PAGO_CLIENT_SECRET`). No usar credenciales productivas en esta fase.
5. **Webhooks → Configurar notificaciones** (modo pruebas): URL
   `https://<api>/tus/v1/integrations/mercado-pago/webhooks` (es `MERCADO_PAGO_NOTIFICATION_URL`), eventos **Pagos** y
   **Vinculación de aplicaciones**; guardar y **revelar la clave secreta** → `MERCADO_PAGO_WEBHOOK_SECRET`.
6. **Cuentas de prueba**: crear un usuario **vendedor** (será el prestador) y un usuario **comprador** (el cliente).
   Usar las tarjetas de prueba de la documentación.
7. Cargar las variables en Hostinger con `MERCADO_PAGO_ENVIRONMENT=sandbox` y `TUS_MERCADOPAGO_ENABLED=true`.
8. Ejecutar `node scripts/dev/mercado-pago-sandbox-check.mjs` con esas variables (no imprime secretos; se niega a correr
   en producción).

Si Mercado Pago rechaza la preferencia con `marketplace_fee` pidiendo el campo `marketplace`, cargar
`MERCADO_PAGO_MARKETPLACE` con el valor que indique la app (la documentación lo asocia al Application ID).

### Cómo conecta su cuenta un prestador

`/tus/prestador` → "Cobros con Mercado Pago" → **Conectar Mercado Pago** (Conectando…) → login y autorización en Mercado
Pago → vuelve a TUS: **Conectado**. TUS guarda solo id de cuenta, scopes, vencimiento y los tokens cifrados. El token dura
180 días y **se renueva automáticamente** 7 días antes de vencer, en el momento de usarlo. Si la renovación falla y el
token ya venció, la cuenta pasa a **Requiere reconexión** y los pagos de ese prestador quedan no disponibles hasta que
reconecte. "Desconectar" borra los tokens en TUS; revocar el acceso en Mercado Pago lo hace el prestador desde su cuenta.

### Configurar la comisión (admin de plataforma)

Requisitos: `TUS_PLATFORM_ADMIN_TENANT_ID=<tenant>` y una sesión de ese tenant con el permiso `tus:payments:admin`.

```bash
# Estado (solo booleanos, nunca valores de secretos) y bloqueos pendientes
curl -H "Authorization: Bearer $TOKEN" -H "X-Correlation-Id: ops-1" https://<api>/tus/v1/admin/payments/status

# Comisión global 10% (expectedVersion = versión actual; 0 si no hay). Sin política persistida rige 10%.
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Correlation-Id: ops-2" \
  -d '{"scope":"global","rateBps":1000,"pspFeeBearer":"provider","reason":"lanzamiento","expectedVersion":0}' \
  https://<api>/tus/v1/admin/payments/commission-policies

# Override para un prestador (5%) o una categoría (scope "categoria", scopeRef = cohorte)
curl -X POST ... -d '{"scope":"prestador","scopeRef":"<prestadorId>","rateBps":500,"pspFeeBearer":"provider","reason":"acuerdo","expectedVersion":0}' ...
```

Límites: 0 a 3000 bp (0% a 30%). Cada cambio crea una versión nueva. `pspFeeBearer` debe ser `provider` (decisión de
producto: el fee de Mercado Pago sale del prestador); `platform` y `undetermined` bloquean los pagos.

### Reembolsos

- Solo **reembolso total**, iniciado por el admin de plataforma:
  `POST /tus/v1/admin/payments/refunds` con `{"tenantId":"<tenant cliente>","paymentId":"<pago TUS>","reason":"..."}` e
  `Idempotency-Key`. TUS llama a Mercado Pago con el token del prestador, body vacío y `X-Idempotency-Key` propia.
- En Split 1:1 Mercado Pago descuenta el reembolso de forma proporcional al vendedor y al marketplace, y **puede
  rechazarlo si el vendedor no tiene saldo**. En ese caso el reembolso queda en **`requires_review`**, el pago sigue
  `paid` y hay que intervenir manualmente (acordar con el prestador o devolver por otro medio). TUS **no** cubre la parte
  del prestador ni hace transferencias automáticas.
- Timeouts o errores ambiguos también quedan en `requires_review` (no se reintenta a ciegas para no reembolsar dos veces).
- La obligación pasa a `refunded` solo cuando llega el webhook verificado con el pago `refunded`.
- Reembolso parcial: **no soportado** (Mercado Pago lo informa como `approved` + `partially_refunded`).

### Habilitar y deshabilitar pagos (sandbox)

Los pagos solo se ofrecen si se cumple **todo** (el endpoint `status` lista lo que falta en `blockers`):

1. Variables de Mercado Pago completas, `TUS_MERCADOPAGO_ENABLED=true` y `MERCADO_PAGO_ENVIRONMENT=sandbox`.
2. Política de comisión válida (por defecto 10%, fee a cargo del prestador).
3. `POST /tus/v1/admin/payments/configuration` `{"paymentsEnabled":true,"reason":"...","expectedVersion":<n>}`.
4. El prestador del trabajo con cuenta de Mercado Pago **Conectada**.
5. En `production` además: decisión de habilitación `settlement` **autorizada por evidencia** (legal, impuestos,
   KYB/KYC, Mercado Pago, etc.). Ninguna variable puede saltear ese gate; sin evidencia el motivo es
   `PRODUCTION_NOT_AUTHORIZED`.

Deshabilitar (inmediato, sin redeploy): `"paymentsEnabled":false`. Corte de emergencia: `TUS_MERCADOPAGO_ENABLED=false` y
reinicio de la API. Los pagos registrados no se borran; los webhooks de pagos ya creados siguen conciliándose mientras el
adaptador esté configurado.

### Prueba sandbox de punta a punta (pendiente de credenciales)

1. `node scripts/dev/mercado-pago-sandbox-check.mjs --oauth` → todo `OK`.
2. Prestador (usuario vendedor de prueba): conectar Mercado Pago en `/tus/prestador`.
3. Flujo del trabajo hasta `completed` con presupuesto aceptado (por ejemplo $50.000).
4. Cliente (usuario comprador de prueba): "Pagar con Mercado Pago" → pagar con tarjeta de prueba aprobada.
5. Verificar: la Web muestra "Estamos confirmando tu pago" y luego **Pago confirmado** con el número de Mercado Pago; el
   prestador ve importe, comisión TUS, costo Mercado Pago y neto; en Mercado Pago el vendedor recibió el neto y la cuenta
   TUS la comisión.
6. Repetir con tarjeta **rechazada** (la Web ofrece reintentar en el mismo checkout) y con un pago **pendiente**.
7. Reembolso total desde el admin y verificar que el webhook deja la obligación `refunded`.
8. Reenviar una notificación desde el panel de Mercado Pago: TUS responde `duplicate` sin efectos.

## 8. Smoke posterior al despliegue

1. `/health` 200 y `/ready` 200.
2. Web carga `/`, `/sign-in`, `/tus/mercado` y `/tus/prestador` sin errores de CORS en la consola.
3. Login con una cuenta del equipo verificada.
   Solicitudes: `/publicar` con esa cuenta → la solicitud aparece en el mapa de `/` (zona aproximada) y en "Mis solicitudes".
   Directorio: el prestador completa `/prestador/perfil-publico`; aparece en `/trabajadores`; un cliente abre su perfil →
   "Solicitar servicio" → el prestador la ve en `/prestador/solicitudes` y la acepta; el cliente ve "aceptó tu solicitud" en
   `/mis-solicitudes`. Asistente: `/asistente` → describir el problema → barrio/urgencia → elegir un candidato real.
   Si Google está configurado: `/sign-in` → "Continuar con Google" vuelve a `/ingresar/google` y entra al panel;
   `/registro` → "Registrarme con Google" con un email nuevo pide aceptar términos en `/registro/completar`.
4. Prestador: publicar un servicio; cliente: comprarlo; prestador: aceptar, diagnosticar, presupuestar; cliente: aceptar
   presupuesto; prestador: iniciar y completar.
5. Sin pagos habilitados: el bloque "Pago" muestra el total y "Pago online no disponible todavía"; no se registra ningún
   pago (`GET /tus/v1/work/<id>/finance` → `obligation: null`).
6. Admin: `GET /tus/v1/admin/payments/status` lista los `blockers` esperados.

## 9. Rollback

- **Web:** Vercel → Deployments → "Promote to Production" del deploy anterior (instantáneo).
- **API:** seleccionar en Hostinger el artefacto/commit anterior. Si la versión nueva ya migró, validar compatibilidad antes
  de volver; no asumir que todo el historial es reversible.
- **Base:** ver §6 paso 12.
- **Pagos:** `paymentsEnabled:false` o `TUS_MERCADOPAGO_ENABLED=false` (§7).

## 10. Qué falta exactamente para dinero real

1. **Prueba sandbox completa** (§7) con credenciales y cuentas de prueba reales — no se pudo ejecutar: no hay
   credenciales en este entorno.
2. Confirmar en sandbox: que `marketplace_fee` se acepta sin `marketplace` (o cargar `MERCADO_PAGO_MARKETPLACE`), que
   las notificaciones configuradas por `notification_url` llegan con `x-signature`, y el formato del error de reembolso
   sin saldo.
3. Revisión legal/fiscal (facturación de la comisión, términos para prestadores) y evidencia de habilitación
   `settlement` para producción.
4. Solo entonces: credenciales productivas, `MERCADO_PAGO_ENVIRONMENT=production` y `paymentsEnabled:true`.

## 11. Checklist práctico de staging

- [ ] Leer y aprobar `docs/SEGURIDAD_TUS.md`; sin Critical/High abiertos.
- [ ] Registrar commit exacto, Node 22.x y pnpm 9.15.9.
- [ ] Ejecutar install frozen y builds `@factory/api...` / `@factory/web...` desde checkout limpio.
- [ ] Confirmar PostgreSQL 16, TLS, pgvector, DB fresh y backup/restore ensayado.
- [ ] Probar `prisma migrate deploy` primero sobre DB descartable; no usar `factory_local`.
- [ ] Configurar Hostinger con `DATABASE_URL` pooled, `DIRECT_URL` solo release y `TRUST_PROXY_HOPS` medido.
- [ ] Configurar Vercel con `NEXT_PUBLIC_API_URL` y sin secretos públicos.
- [ ] Dejar `TUS_MERCADOPAGO_ENABLED=false`, provider actions y jobs apagados.
- [ ] Verificar CORS exacto, `/health`, `/ready`, registro, login y revocación de membership.
- [ ] Ejecutar smoke funcional sin pagos y confirmar `PAYMENTS_DISABLED`.
- [ ] Probar SIGTERM y rollback de API/Web; documentar el resultado y el operador.
- [ ] Solo después marcar RELEASE-STAGING-01 GO; el dinero real sigue fuera de alcance.

## 12. STAGING REAL: orden operativo exacto

Esta sección es la lista corta para la primera activación. No crea proyectos, no modifica DNS, no ejecuta deploy y no
aplica migraciones por sí sola.

### 12.1 Preflight del checkout

1. Confirmar branch `web-tus`, commit exacto, Node `22.x` y pnpm `9.15.9`.
2. Usar el repo completo en Hostinger y Vercel con `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/*` y `packages/*`.
   No subir solo `apps/api`: los imports `workspace:*` requieren el monorepo.
3. Ejecutar:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @factory/api... build
corepack pnpm --filter @factory/web... build
```

En Windows, el build standalone puede fallar por symlinks `EPERM`; ese resultado no sustituye el build Linux de Vercel.
No usar `NEXT_DISABLE_STANDALONE=true` como evidencia de Vercel: sirve únicamente para validación local del compilado.

### 12.2 Crear la base PostgreSQL descartable

1. Crear una DB nueva PostgreSQL 16 en el proveedor elegido, con región cercana a Hostinger y sin datos compartidos.
2. Confirmar `server_version` y `vector` con los SQL de §6.1.
3. Obtener una URL pooled para `DATABASE_URL` y una directa para `DIRECT_URL`; percent-encodear contraseñas.
4. Probar backup/restore o PITR antes de migrar. Si el proveedor no soporta `vector` o restore verificable, detenerse.
5. Aplicar únicamente:

```bash
corepack pnpm --filter @factory/api exec prisma validate
corepack pnpm --filter @factory/api prisma:migrate:deploy
```

6. Ejecutar las consultas de `_prisma_migrations`, `vector` y las tablas de smoke de §6. No reutilizar `factory_local`.

### 12.3 Configurar Hostinger

Crear una Node.js app desde la raíz del repositorio, con Node `22.x`. La configuración exacta del panel debe ser:

| Campo             | Valor                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| Working directory | raíz del repositorio, donde viven `package.json` y `pnpm-workspace.yaml` |
| Install           | `corepack pnpm install --frozen-lockfile`                                |
| Build             | `corepack pnpm --filter @factory/api... build`                           |
| Release manual    | `corepack pnpm --filter @factory/api prisma:migrate:deploy`              |
| Start             | `corepack pnpm --filter @factory/api start`                              |
| Liveness          | `/health`                                                                |
| Readiness         | `/ready`, solo si el panel puede retirarlo del tráfico cuando no sea 200 |

Hostinger debe proporcionar `PORT`; la API usa `PORT` en production y `API_PORT`/`PORT`/`3101` en local. No fijar un
puerto público en el start command. Medir la cadena de proxies antes de fijar `TRUST_PROXY_HOPS`; nunca usar `true`.

Configurar inicialmente `NATIVE_PROFILE=1`, `TUS_ROUTES_ENABLED=true`, `TUS_PROVIDER_ACTIONS_ENABLED=false`,
`TUS_MERCADOPAGO_ENABLED=false`, `TUS_RELEASE_JOBS_ENABLED=false` y `TUS_FLEET_JOBS_ENABLED=false`.

### 12.4 Configurar Vercel

1. Importar el repo completo con **Root Directory = raíz**; no elegir `apps/web` como raíz porque se perdería el workspace.
2. Mantener `vercel.json`; usa `pnpm install --frozen-lockfile` y `pnpm --filter @factory/web... build`.
3. Configurar Node `22.x` si el proyecto Vercel lo permite; el `engines` raíz restringe Node a `>=20.11.0 <23`.
4. Cargar solo `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` y opcionalmente `NEXT_PUBLIC_SUPPORT_WHATSAPP_URL`.
5. No cargar `DATABASE_URL`, `DIRECT_URL`, secretos OAuth, claves MP ni `TUS_PAYMENT_CREDENTIALS_KEY` en Vercel.
6. Validar `/`, `/sign-in`, `/tus/mercado` y `/tus/prestador`. `NEXT_PUBLIC_API_URL` no tiene fallback localhost en production.

### 12.5 CORS y autenticación

1. Después de conocer la URL estable de Vercel, fijar `CORS_ORIGINS=https://<web>` sin wildcard ni slash final y redeployar
   la API.
2. Probar un `Origin` permitido, uno denegado y una request sin `Origin`.
3. La autenticación actual usa `Authorization: Bearer`; no hay cookie de sesión que requiera `SameSite`, `Domain` o
   `Secure`. `credentials: true` en CORS se conserva para compatibilidad futura, pero no convierte el Bearer en cookie.
4. Si se agregan cookies en una fase futura, preferir `app.<dominio>` + `api.<dominio>` y revisar explícitamente
   `SameSite=None; Secure`, CORS credentials y CSRF antes de activarlas.

### 12.6 Cuenta de staging y smoke sin pagos

1. Registrar una cuenta de equipo con `POST /auth/register`.
2. Verificarla solo mediante el SQL de §5, limitado a una cuenta de staging autorizada; no crear un bypass HTTP público.
3. Comprobar `/health` y `/ready`.
4. Ejecutar el recorrido cliente/prestador de §8 con `TUS_MERCADOPAGO_ENABLED=false`.
5. Confirmar `payment-preview` con `PAYMENTS_DISABLED`, sin checkout externo ni OAuth.
6. Enviar SIGTERM desde el panel o proceso controlado y comprobar cierre HTTP, Prisma, pool y recursos opcionales dentro
   de `SHUTDOWN_TIMEOUT_MS`.

### 12.7 Matriz inicial de flags

| Flag                           | Staging inicial |      Producción inicial | Razón                                                                               |
| ------------------------------ | --------------: | ----------------------: | ----------------------------------------------------------------------------------- |
| `TUS_ROUTES_ENABLED`           |          `true` | `false` hasta evidencia | habilita el negocio TUS sin habilitar providers                                     |
| `TUS_PROVIDER_ACTIONS_ENABLED` |         `false` |                 `false` | monta webhooks/OAuth de providers externos; no es necesario para el flujo sin pagos |
| `TUS_MERCADOPAGO_ENABLED`      |         `false` |                 `false` | dinero y OAuth externos apagados                                                    |
| `TUS_RELEASE_JOBS_ENABLED`     |         `false` |                 `false` | no hay evidencia de workers/leases                                                  |
| `TUS_FLEET_JOBS_ENABLED`       |         `false` |                 `false` | no activar operaciones de flota                                                     |
| `TUS_WHATSAPP_ENABLED`         |         `false` |                 `false` | provider externo no verificado                                                      |
| `TUS_AWS_ENABLED`              |         `false` |                 `false` | cloud/object storage no requerido por este staging                                  |

`TUS_PROVIDER_ACTIONS_ENABLED=false` no bloquea auth, tenancy, marketplace, trabajos, agenda ni la preview de pago; solo
deja fuera las rutas de integración Mercado Pago/WhatsApp. No confundir flags con autorización: los permisos siguen siendo
server-derived y tenant-scoped.

## 13. Variables para cargar

| Plataforma             | Variable                                                                       |                                     Obligatoria ahora |                  Secreta |
| ---------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------: | -----------------------: |
| Hostinger API          | `NODE_ENV=production`                                                          |                                                    sí |                       no |
| Hostinger API          | `DATABASE_URL` pooled                                                          |                                                    sí |                       sí |
| Hostinger release      | `DIRECT_URL` directa                                                           |                                        solo migración |                       sí |
| Hostinger API          | `CORS_ORIGINS`                                                                 |                                                    sí |                       no |
| Hostinger API          | `PORT`                                                                         |                                   la entrega el panel |                       no |
| Hostinger API          | `NATIVE_PROFILE=1`                                                             |                                       sí para staging |                       no |
| Hostinger API          | `TUS_ROUTES_ENABLED=true`                                                      |                                      sí para usar TUS |                       no |
| Hostinger API          | `TRUST_PROXY_HOPS`                                                             |                                      después de medir |                       no |
| Hostinger API          | `TUS_MERCADOPAGO_ENABLED=false`                                                |                                                    sí |                       no |
| Hostinger API          | `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `GOOGLE_CLIENT_SECRET`              |                             para ingresar con Google |           solo el secret |
| Vercel Web             | `NEXT_PUBLIC_API_URL`                                                          |                                                    sí |                       no |
| Vercel Web             | `NEXT_PUBLIC_SITE_URL`                                                         |                                           recomendada |                       no |
| Vercel Web             | `NEXT_PUBLIC_SUPPORT_WHATSAPP_URL`                                             |                                                    no |                       no |
| Futuro MP              | `MERCADO_PAGO_CLIENT_SECRET`                                                   |                                                    no |                       sí |
| Futuro MP              | `MERCADO_PAGO_WEBHOOK_SECRET`                                                  |                                                    no |                       sí |
| Futuro MP              | `TUS_PAYMENT_CREDENTIALS_KEY`                                                  |                                                    no |                       sí |
| Hostinger API          | `IDENTITY_PROVIDER=nosis-browser`                                              |                                        sí (identidad) |                       no |
| Hostinger API + worker | `TUS_IDENTITY_DOCUMENTS_KEY`                                                   |                                   sí (subidas de DNI) |                       sí |
| Host worker            | `NOSIS_BROWSER_*`, `TUS_NOSIS_SESSION_KEY`, `GROQ_API_KEY`/`GROQ_API_KEY_1..6` | para verificar automáticamente; pool Groq round-robin | credenciales y claves sí |

La verificación de identidad (migración `20260927100000_tus_identity_verification`, worker Chromium separado y runbook)
está en `docs/IDENTIDAD_PRESTADORES_TUS.md`. Sin worker las verificaciones quedan en cola y el admin puede aprobarlas
manualmente con motivo.

## 14. Resultado y blockers actuales

| Resultado              | Estado actual                                         | Evidencia faltante                                                   |
| ---------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| CODE READY FOR STAGING | `YES` para API/Web local                              | build standalone Linux/Vercel y audit SCA final del target           |
| POSTGRESQL 16 READY    | `NO`                                                  | DB descartable real, migrate deploy, backup/restore y SQL de versión |
| PGVECTOR READY         | `NO`                                                  | extensión `vector` verificada en el target                           |
| HOSTINGER CONFIG READY | `YES` como contrato                                   | panel, proxy, health, ready y SIGTERM reales                         |
| VERCEL CONFIG READY    | `YES` como contrato                                   | build/deploy y navegador reales                                      |
| SECURITY GATE          | `PASS` para hardening local; `PENDING` para SCA/infra | cerrar audit scoped y evidencia externa                              |
| MERCADO PAGO REAL      | `OFF`                                                 | no se debe activar en esta fase                                      |
| MERCADO PAGO SANDBOX   | código `READY`; verificación `NO`                     | credenciales sandbox y cuentas de prueba autorizadas                 |

### Clasificación

- **Bloquea deploy:** PostgreSQL 16/pgvector sin validar, build standalone Linux sin evidencia, SCA High residual del target,
  proxy/CORS/health reales sin probar.
- **Bloquea usar TUS:** `/ready` no 200, migraciones incompletas, `TUS_ROUTES_ENABLED` apagado o login sin procedimiento de
  verificación de staging.
- **Bloquea pagos sandbox:** credenciales, seller/buyer de prueba, callback/webhook y runner sandbox sin ejecutar.
- **Bloquea pagos productivos:** todo lo anterior más legal, fiscal, KYC/KYB, settlement y evidencia de dinero real.

No hacer push ni ejecutar deploy automático desde este documento. El commit/branch y el árbol Git deben quedar registrados
antes de que el dueño cargue credenciales y ejecute la fase externa.
