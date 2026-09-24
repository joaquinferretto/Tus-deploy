# Producción TUS: despliegue, variables, migraciones y pagos

> **Estado (2026-09-24, rama `web-tus`):** el paquete de staging está preparado, pero el despliegue permanece en
> **NO-GO** hasta completar el checklist de este documento y el gate de `docs/SEGURIDAD_TUS.md`. La integración
> real de Mercado Pago (WEB-09E: Checkout Pro + Split 1:1, OAuth con renovación, webhook firmado y reembolsos) está
> implementada para **sandbox**, pero **no se probó contra Mercado Pago** porque no hay credenciales de prueba cargadas. El
> **dinero real no es habilitable**. Todo lo de pagos falla cerrado mientras falte configuración.

Este documento es la guía práctica. El detalle técnico de pagos está en `docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md`.

## 1. Arquitectura de despliegue recomendada

| Pieza      | Destino de staging             | Configuración en el repo                                      |
| ---------- | ------------------------------ | ------------------------------------------------------------- |
| Web        | Vercel                        | `vercel.json`, `apps/web/next.config.js`                       |
| API        | Hostinger Node.js, Node 22    | comandos reproducibles de §3; `/health` y `/ready`             |
| PostgreSQL | PostgreSQL 16 administrado    | `DATABASE_URL` pooled + `DIRECT_URL` directa; Prisma forward-only |

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

### Web (Vercel o Render `factory-web`)

| Variable                           | Obligatoria | Valor                                                                 |
| ---------------------------------- | ----------- | --------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`              | sí          | `https://<dominio-api>` (se incrusta en el build: redeploy si cambia) |
| `NEXT_PUBLIC_SITE_URL`             | recomendada | `https://<dominio-web>`                                               |
| `NEXT_PUBLIC_SUPPORT_WHATSAPP_URL` | no          | URL pública de soporte                                                |
| `API_BASE_URL`                     | no          | si se define debe ser igual a `NEXT_PUBLIC_API_URL`                   |

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

Todas son aditivas y forward-only; el gate DB-09 acepta la cadena. Dry run en PostgreSQL 16 descartable: 41/41 desde cero
en 5,4 s y upgrade desde 40 con datos previos en 1,8 s.

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
7. Cargar las variables en Render con `MERCADO_PAGO_ENVIRONMENT=sandbox` y `TUS_MERCADOPAGO_ENABLED=true`.
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
