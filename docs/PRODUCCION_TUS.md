# Producción TUS: despliegue, variables, migraciones y pagos

> **Estado (2026-09-24, rama `web-tus`):** Web y API son desplegables para que el equipo vea y use TUS. El **dinero real
> no es habilitable**: falta WEB-09E (adaptador de cobro de Mercado Pago, webhook público con firma real y refunds) y la
> decisión de quién absorbe la comisión de Mercado Pago. Todo lo de pagos falla cerrado mientras tanto.

Este documento es la guía práctica. El detalle técnico de pagos está en `docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md`.

## 1. Arquitectura de despliegue recomendada

| Pieza      | Destino recomendado                   | Configuración en el repo                                |
| ---------- | ------------------------------------- | ------------------------------------------------------- |
| Web        | Vercel (o Render `factory-web`)       | `vercel.json`, `apps/web/next.config.js`, `render.yaml` |
| API        | Render `factory-api` (Node 20/22)     | `render.yaml` (build, `preDeployCommand`, `/health`)    |
| PostgreSQL | PostgreSQL administrado (Neon/Render) | `DATABASE_URL`; migraciones Prisma forward-only         |

No se usan Docker ni Terraform en este perfil. Nada de esto se aplicó automáticamente: no se creó infraestructura paga ni
se desplegó.

Opcionales que siguen apagados y **no** son necesarios para usar TUS: MongoDB, Redis, worker Python, B2, WhatsApp, AWS,
jobs de release/flota, provider actions. Con `NATIVE_PROFILE=1` el `/ready` de la API no los exige.

## 2. Variables de entorno

Nunca pegues valores reales en Git, en este documento ni en `NEXT_PUBLIC_*`. Los secretos van en el panel de Render
(Environment → secret) o en el secret manager que use el equipo. `.env.example` solo tiene marcadores.

### API (Render `factory-api`)

| Variable                       | Obligatoria      | Valor / ejemplo                                              | Secreto |
| ------------------------------ | ---------------- | ------------------------------------------------------------ | ------- |
| `NODE_ENV`                     | sí               | `production`                                                 | no      |
| `DATABASE_URL`                 | sí               | `postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require`    | **sí**  |
| `CORS_ORIGINS`                 | sí               | `https://<dominio-web>` (separadas por coma, sin `/` final)  | no      |
| `NATIVE_PROFILE`               | sí               | `1` (Mongo/Redis/worker opcionales para `/ready`)            | no      |
| `TUS_ROUTES_ENABLED`           | sí para usar TUS | `true` (en `render.yaml` sigue `false` por política; ver §5) | no      |
| `SECRET_STORE_REF`             | no (declarativa) | referencia del secret store; la API no la lee al arrancar    | no      |
| `PORT` / `HOST`                | no               | los pone Render; en producción escucha en `0.0.0.0`          | no      |
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

\* No es secreto pero tratalo como configuración sensible. El access token y la public key **de TUS** no se usan en este
flujo (los cobros se crean con el token de cada prestador); no los cargues hasta que WEB-09E los necesite.

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

- PostgreSQL 16 (probado con 16.15). TLS (`sslmode=require`) en el proveedor administrado.
- Un usuario con permisos DDL para `prisma migrate deploy` (puede ser distinto del usuario de runtime si el proveedor lo
  permite).
- Backups automáticos + posibilidad de restauración puntual (PITR) antes de migrar.

## 3. Desplegar la API (Render)

1. En Render: New → Blueprint → este repositorio, rama `web-tus` (o crear el servicio web manualmente con los mismos
   comandos).
2. Comandos (ya en `render.yaml`):
   - Build: `pnpm install --frozen-lockfile && pnpm --filter @factory/api build`
   - Pre-deploy: `pnpm --filter @factory/api prisma:migrate:deploy` (solo después de hacer el backup; ver §6)
   - Start: `pnpm --filter @factory/api start` (`node dist/index.js`)
   - Health check: `/health`
3. Cargar las variables de §2 (API). Mínimo: `DATABASE_URL`, `CORS_ORIGINS`, `NATIVE_PROFILE=1`,
   `TUS_ROUTES_ENABLED=true`.
4. Verificar:
   - `GET https://<api>/health` → `200 {"status":"ok"}`.
   - `GET https://<api>/ready` → `200 {"ready":true}` (con `NATIVE_PROFILE=1`; si da `503` revisar `dependencies` y
     `schema` en la respuesta).
5. La API cierra de forma ordenada ante `SIGTERM` (HTTP, base de datos y clientes opcionales con timeout).

## 4. Desplegar la Web (Vercel)

1. Importar el repositorio en Vercel. Opción recomendada: **Root Directory = raíz del repo** (usa `vercel.json`:
   instala con pnpm y construye `@factory/web`). Alternativa: Root Directory `apps/web` con framework Next.js.
2. Variables: `NEXT_PUBLIC_API_URL=https://<api>`, `NEXT_PUBLIC_SITE_URL=https://<web>`.
3. Deploy. Luego agregar `https://<web>` a `CORS_ORIGINS` de la API y redeployar la API.
4. Verificar `https://<web>/`, `/sign-in`, `/tus/mercado` y `/tus/prestador`. Si la API no responde, la Web muestra
   estados de error con reintento (no usa mocks).

El build local en Windows puede fallar solo en el paso `standalone` por symlinks (`EPERM`); en Linux (Vercel/Render) no
aplica. Para verificar localmente: `NEXT_DISABLE_STANDALONE=true pnpm --filter @factory/web build`.

## 5. Habilitar TUS para el equipo (sin dinero real)

1. `TUS_ROUTES_ENABLED=true` en la API. `render.yaml` lo mantiene en `false` porque los tests de contrato de despliegue
   fijan esa política; si usás Blueprint, cambiá el valor en el panel **y** tené en cuenta que un "sync" del Blueprint puede
   volverlo a `false` (alternativa: editar `render.yaml` como decisión explícita).
2. Cuentas del equipo: `POST /auth/register` crea cuenta y tenant, pero **el backend no envía emails todavía**
   (`InMemoryEmailSender`) y el login exige email verificado. Hasta integrar un proveedor de correo, un operador puede
   verificar cuentas **del equipo** con SQL auditado sobre la base de producción:

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

Pendientes contra `factory_local` (consulta de solo lectura, 2026-09-24). Para producción recalcular con
`prisma migrate status` contra la base real:

1. `20260916140000_tus_provider_agenda_publication_modes`
2. `20260917100000_tus_work_budget`
3. `20260923100000_tus_service_finance_identity`
4. `20260923110000_tus_service_payment_intents`
5. `20260923120000_tus_service_settlement_reconciliation`
6. `20260924100000_tus_finance_subject_hardening`
7. `20260924130000_tus_work_reservation_unique`
8. `20260925100000_tus_service_payment_configuration`

Todas son aditivas y forward-only; el gate DB-09 acepta la cadena. Dry run en PostgreSQL 16 descartable: 40/40 en 5,5 s.

**No aplicar sobre `factory_local` ni sobre una base compartida sin autorización explícita.**

1. **Backup:** snapshot del proveedor + `pg_dump --format=custom --no-owner "$DATABASE_URL" > tus-pre-migracion.dump`;
   verificar que se puede restaurar en una base descartable.
2. **Detener la API** (Render: suspender el servicio o escalar a 0) para evitar escrituras durante el DDL.
3. **Preflight de solo lectura** (checklist DB-09-SAFETY en `docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md`): filas legacy
   incompatibles y trabajos que compartan reserva (bloquean `uq_trabajos_reserva`).
4. **Timeouts de sesión** para que un lock no quede colgado:
   `DATABASE_URL="...?options=-c%20lock_timeout%3D5s%20-c%20statement_timeout%3D300s"` (o
   `ALTER ROLE <migrador> SET lock_timeout = '5s'; ALTER ROLE <migrador> SET statement_timeout = '300s';`).
5. **Aplicar:** `pnpm --filter @factory/api prisma:migrate:deploy` (o el `preDeployCommand` de Render).
6. **Verificar historial:**
   `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 10;`
   → las 8 con `finished_at` no nulo y `rolled_back_at` nulo; `prisma migrate status` → "Database schema is up to date".
7. **Smoke DB:** existen `politicas_comision_servicio`, `configuraciones_pagos_servicio`, `cuentas_cobro_prestador`,
   `obligaciones_pago_servicio`; triggers `tus_politica_comision_append_only_trigger` y
   `tus_configuracion_pagos_append_only_trigger`.
8. **Iniciar la API.**
9. `GET /health` → 200.
10. `GET /ready` → 200.
11. **Smoke funcional:** login de una cuenta de prueba, `GET /tus/v1/work`, `GET /tus/v1/work/<id>/payment-preview`
    (debe responder `paymentAvailable:false` con `PAYMENTS_DISABLED`), `GET /tus/v1/admin/payments/status` con el admin.
12. **Rollback:** no hay down migrations. Si algo falla antes de abrir tráfico: restaurar el backup del paso 1 y
    redeployar el commit anterior. Si falla después: preferir una migración correctiva forward-only; restaurar solo si hay
    corrupción y aceptando perder escrituras posteriores al backup.

## 7. Mercado Pago: qué hay y cómo se configura

### Modelo elegido (documentación oficial de Mercado Pago Argentina)

- Producto: **Split de pagos / marketplace** con Checkout Pro o Checkout API.
- **Cuenta de TUS:** es la dueña de la _aplicación_ en Mercado Pago Developers y recibe la comisión (`marketplace_fee`).
- **Cuenta del prestador:** cada prestador conecta **su propia** cuenta por OAuth. El cobro se crea con el token del
  prestador; Mercado Pago acredita el pago en la cuenta del prestador y separa automáticamente la comisión de TUS. TUS no
  transfiere dinero al prestador.
- **Fee de Mercado Pago:** en el split nativo Mercado Pago descuenta primero su comisión y luego la de TUS del saldo del
  vendedor (lo absorbe el prestador). Si el negocio quiere que lo absorba TUS, hay que ajustar la comisión enviada
  (no implementado). Esta decisión está **pendiente** y bloquea la habilitación.

### Cómo se calcula la comisión y el neto (ejemplo)

Cliente paga **$100.000** (10.000.000 centavos). Comisión TUS 10% = 1000 bp:

| Concepto                    | Cálculo                            | Resultado   |
| --------------------------- | ---------------------------------- | ----------- |
| Total pagado por el cliente | presupuesto aceptado               | $100.000,00 |
| Comisión TUS                | 100.000 × 1000 / 10000 (half-up)   | $10.000,00  |
| Bruto del prestador         | total − comisión TUS               | $90.000,00  |
| Fee Mercado Pago (ejemplo)  | lo informa Mercado Pago en el pago | $5.000,00   |
| Neto del prestador          | si el prestador absorbe el fee     | $85.000,00  |

Todo en centavos (`bigint`), sin floats. La tasa, la comisión, el fee y el neto quedan congelados en el snapshot del pago;
cambiar la comisión después no altera pagos anteriores.

### Pasos en Mercado Pago Developers (manuales, los hace el dueño de la cuenta TUS)

1. Entrar a <https://www.mercadopago.com.ar/developers/panel/app> con la cuenta de TUS y **crear una aplicación**
   (tipo de solución: pagos online / marketplace; producto Checkout Pro o Checkout API).
2. En la app: **URLs de redireccionamiento** → `https://<api>/tus/v1/integrations/mercado-pago/oauth/callback` (exacta,
   estática; es `MERCADO_PAGO_OAUTH_REDIRECT_URI`).
3. Habilitar **"flujo de código de autorización con PKCE"** (TUS ya envía `code_challenge` S256).
4. Copiar **Número de aplicación** (`MERCADO_PAGO_CLIENT_ID`) y **Client secret** (`MERCADO_PAGO_CLIENT_SECRET`) de
   _Credenciales_. Usar primero credenciales y **cuentas de prueba** (vendedor y comprador) para sandbox.
5. **Webhooks → Configurar notificaciones**: URL de producción del webhook (se define en WEB-09E; todavía no existe la
   ruta), evento _Pagos_ y _Vinculación de aplicaciones_; revelar la **clave secreta** → `MERCADO_PAGO_WEBHOOK_SECRET`.
6. Cargar las variables en Render (§2) con `MERCADO_PAGO_ENVIRONMENT=sandbox` y `TUS_MERCADOPAGO_ENABLED=true`.

### Cómo conecta su cuenta un prestador

`/tus/prestador` → "Cobros con Mercado Pago" → **Conectar Mercado Pago** → login y autorización en Mercado Pago → vuelve a
TUS con "Mercado Pago quedó conectado". TUS guarda solo el id de cuenta, scopes, vencimiento y los tokens cifrados.
"Desconectar" borra los tokens en TUS; revocar el acceso en Mercado Pago lo hace el prestador desde su cuenta. El access
token dura 180 días (la renovación automática es parte de WEB-09E).

### Configurar la comisión (admin de plataforma)

Requisitos: `TUS_PLATFORM_ADMIN_TENANT_ID=<tenant>` y una sesión de ese tenant con el permiso `tus:payments:admin`.

```bash
# Estado (solo booleanos, nunca valores de secretos) y bloqueos pendientes
curl -H "Authorization: Bearer $TOKEN" -H "X-Correlation-Id: ops-1" https://<api>/tus/v1/admin/payments/status

# Comisión global 10%, fee de Mercado Pago a cargo del prestador (expectedVersion = versión actual, 0 si no hay)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "X-Correlation-Id: ops-2" \
  -d '{"scope":"global","rateBps":1000,"pspFeeBearer":"provider","reason":"lanzamiento","expectedVersion":0}' \
  https://<api>/tus/v1/admin/payments/commission-policies

# Override para un prestador (5%) o una categoría (scope "categoria", scopeRef = cohorte)
curl -X POST ... -d '{"scope":"prestador","scopeRef":"<prestadorId>","rateBps":500,"pspFeeBearer":"provider","reason":"acuerdo","expectedVersion":0}' ...
```

Límites: 0 a 3000 bp (0% a 30%). Cada cambio crea una versión nueva (no se edita ni borra historia).

### Habilitar y deshabilitar pagos

Habilitar exige **todo** esto (el endpoint `status` lista lo que falta en `blockers`):

1. WEB-09E implementado y probado en sandbox (hoy `REAL_PAYMENT_ADAPTER_NOT_IMPLEMENTED`).
2. Variables de Mercado Pago cargadas y `TUS_MERCADOPAGO_ENABLED=true`.
3. Política con `pspFeeBearer` decidido (`provider` o `platform`).
4. Configuración de producto: `POST /tus/v1/admin/payments/configuration`
   `{"paymentsEnabled":true,"reason":"...","expectedVersion":<n>}`.
5. El prestador del trabajo con cuenta conectada.

Deshabilitar (inmediato, sin redeploy): `POST /tus/v1/admin/payments/configuration` con `"paymentsEnabled":false`.
Corte de emergencia a nivel entorno: `TUS_MERCADOPAGO_ENABLED=false` y redeploy/restart de la API. Los pagos ya
registrados no se borran; la preview vuelve a "Pago online no disponible todavía".

## 8. Smoke posterior al despliegue

1. `/health` 200 y `/ready` 200.
2. Web carga `/`, `/sign-in`, `/tus/mercado` y `/tus/prestador` sin errores de CORS en la consola.
3. Login con una cuenta del equipo verificada.
4. Prestador: publicar un servicio; cliente: comprarlo; prestador: aceptar, diagnosticar, presupuestar; cliente: aceptar
   presupuesto; prestador: iniciar y completar.
5. Cliente: el bloque "Pago" muestra el total del presupuesto y "Pago online no disponible todavía"; no aparece ningún
   pago registrado (`GET /tus/v1/work/<id>/finance` → `obligation: null`).
6. Admin: `GET /tus/v1/admin/payments/status` lista los `blockers` esperados.

## 9. Rollback

- **Web:** Vercel → Deployments → "Promote to Production" del deploy anterior (instantáneo).
- **API:** Render → Deploys → "Rollback" al deploy anterior. Si la versión nueva ya migró, la anterior sigue funcionando
  porque las migraciones son aditivas.
- **Base:** ver §6 paso 12.
- **Pagos:** `paymentsEnabled:false` o `TUS_MERCADOPAGO_ENABLED=false` (§7).

## 10. Qué falta exactamente para dinero real

1. Decisión de negocio: quién absorbe el fee de Mercado Pago.
2. WEB-09E: adaptador `PuertoProveedorPagosServicio` sobre `packages/mercado-pago` con el token del prestador y
   `marketplace_fee`, ruta pública de webhook con raw body y verificación `x-signature` (corregir antes el `ts` en
   milisegundos del paquete), consulta del pago a Mercado Pago antes de aprobar, worker de despacho, renovación de tokens,
   refunds reales y conciliación contra reportes.
3. Prueba completa en sandbox con cuentas de prueba (pago aprobado, rechazado, reembolso, webhook duplicado).
4. Revisión legal/fiscal (facturación de la comisión, términos para prestadores).
5. Solo entonces: `MERCADO_PAGO_ENVIRONMENT=production`, credenciales productivas y `paymentsEnabled:true`.
