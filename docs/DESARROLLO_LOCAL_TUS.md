# Desarrollo local de TUS

Esta guia describe la baseline local verificada para ejecutar PostgreSQL, API y Web sin MongoDB, Redis, workers ni providers externos. No representa readiness productivo ni autoriza acciones reales de pago, settlement o infraestructura.

## Alcance

La baseline habilita:

- autenticacion y sesiones persistidas en PostgreSQL;
- bootstrap de tenant, organization, workspace, membership y rol Owner;
- router HTTP TUS;
- readiness de publicacion por evidencia explicita;
- onboarding, listings y discovery Marketplace;
- Web Next.js contra la API local.

Se mantienen deshabilitados:

- acciones de providers externos;
- MongoDB y Redis en el perfil nativo;
- Python worker;
- settlement, fleet y release jobs sin evidencia autorizada propia.

## Requisitos

- Windows PowerShell 5.1 o posterior.
- Node.js `>=20.11.0 <23`. La baseline fue verificada con Node `22.23.2`.
- pnpm `9.15.9` mediante Corepack.
- PostgreSQL 16 con pgvector instalado.
- Base local alcanzable mediante `DATABASE_URL`.

Comprobar las versiones:

```powershell
node --version
corepack pnpm --version
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" --version
```

No usar Node 23 o superior: el workspace declara `node >=20.11.0 <23`.

## Configuracion

El archivo `.env` de la raiz es la fuente local de `DATABASE_URL`. Debe permanecer fuera de Git. Usar valores locales propios y tomar `.env.example` como referencia.

Variables requeridas para esta baseline:

```dotenv
FACTORY_PROFILE=local
NODE_ENV=development
DATABASE_URL="postgresql://<usuario>:<clave>@localhost:5432/<base-local>"
API_PORT=3101
NEXT_PUBLIC_API_URL="http://localhost:3101"
CORS_ORIGINS="http://localhost:3000"
TUS_ROUTES_ENABLED=true
TUS_PROVIDER_ACTIONS_ENABLED=false
```

`API_BASE_URL` es un alias legacy. Si se define junto con `NEXT_PUBLIC_API_URL`, ambos valores deben coincidir. Preferir siempre `NEXT_PUBLIC_API_URL`.

## PostgreSQL

Comprobar el servicio y la conexion antes de iniciar la API:

```powershell
Get-Service -Name "postgresql-x64-16"
$env:PGPASSWORD = "<clave-local>"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U "<usuario>" -h localhost -d "<base-local>" -c "SELECT version();"
```

Aplicar migraciones de forma forward-only:

```powershell
$env:DATABASE_URL = "postgresql://<usuario>:<clave>@localhost:5432/<base-local>"
corepack pnpm --dir apps/api exec prisma migrate deploy
corepack pnpm --dir apps/api exec prisma validate
```

La baseline actual contiene 30 migraciones. `20260911120000_tus_listing_price_minor` convierte `TusListing.price` a `BIGINT` en unidades monetarias menores.

No ejecutar reset, force reset ni limpieza global sobre una base compartida.

## API nativa

Definir las flags en la terminal que inicia el wrapper:

```powershell
$env:FACTORY_PROFILE = "local"
$env:NODE_ENV = "development"
$env:API_PORT = "3101"
$env:CORS_ORIGINS = "http://localhost:3000"
$env:TUS_ROUTES_ENABLED = "true"
$env:TUS_PROVIDER_ACTIONS_ENABLED = "false"
node scripts/dev/native-profile.mjs api
```

El wrapper toma `DATABASE_URL` exclusivamente del `.env` raiz y transmite solo variables permitidas. En el perfil nativo:

| Dependencia | Estado |
|---|---|
| PostgreSQL | requerida |
| MongoDB | deshabilitada |
| Redis | deshabilitada |
| Python worker | deshabilitado |
| Soporte mobile | fake local |
| Providers externos | deshabilitados |

Para automatizacion o agentes, la API debe iniciarse detached, con stdout/stderr redirigidos, PID conservado y verificacion acotada de puerto. No dejar el wrapper en foreground dentro de una ejecucion automatizada. Consultar `AGENTS.md`.

## Health y readiness

Verificar la API antes de cualquier prueba funcional:

```powershell
curl.exe -sS -w "`nHTTP %{http_code}`n" http://localhost:3101/health
curl.exe -sS -w "`nHTTP %{http_code}`n" http://localhost:3101/ready
```

Resultados esperados:

- `/health`: HTTP `200`, `status: "ok"`;
- `/ready`: HTTP `200`, `ready: true`, profile `native`;
- PostgreSQL y schema en estado ready;
- dependencias no requeridas informadas como disabled/fake, sin bloquear readiness.

## Registro y sesion local

Registrar una identidad sin `tenantId` crea un tenant nuevo y asigna rol `owner`:

```powershell
$registerBody = @{
  email = "<email-local>"
  password = "<clave-local-segura>"
  displayName = "Operador local"
} | ConvertTo-Json

$registration = Invoke-RestMethod `
  -Uri "http://localhost:3101/auth/register" `
  -Method Post `
  -ContentType "application/json" `
  -Body $registerBody

$registration.account
```

El resultado debe contener un `tenantId` generado y `roles: ["owner"]`.

El registro no devuelve el token de verificacion. Para un smoke estrictamente local puede aplicarse el mismo mecanismo PostgreSQL de las pruebas del repositorio:

```sql
UPDATE "Account" a
SET "emailVerifiedAt" = NOW(), "updatedAt" = NOW()
FROM "User" u
WHERE a."userId" = u.id
  AND u."normalizedEmail" = '<email-local-normalizado>';
```

Este bypass es solo local. No debe usarse en produccion ni reemplazar el flujo real de verificacion.

Iniciar sesion:

```powershell
$loginBody = @{
  email = "<email-local>"
  password = "<clave-local-segura>"
  deviceId = "web-local"
  deviceLabel = "Navegador local"
} | ConvertTo-Json

$login = Invoke-RestMethod `
  -Uri "http://localhost:3101/auth/sign-in" `
  -Method Post `
  -ContentType "application/json" `
  -Body $loginBody

$headers = @{
  Authorization = "Bearer $($login.session.accessToken)"
  "X-Correlation-Id" = "local-session-check"
}

Invoke-RestMethod -Uri "http://localhost:3101/auth/session" -Headers $headers
```

`X-Correlation-Id` es obligatorio para recuperar una sesion. Nunca escribir access tokens en logs ni archivos versionados.

## Readiness de publicacion

Las mutaciones de onboarding, listing y publicacion requieren cuatro gates para capability `publication`:

- `legal`;
- `kyb`;
- `tax`;
- `runtimeProvider`.

El profile y scope locales verificados son:

```text
profile = native-local
scope = argentina-stage-1
```

Sin evidencia, una mutacion debe responder HTTP `409` con `TUS_READINESS_BLOCKED`. No inventar evidencia para ocultar ese resultado.

La evidencia se persiste en `TusReadinessEvidence` y debe ser emitida por un operador o proceso autorizado. Para una baseline desechable se puede cargar evidencia con referencias claramente locales, `capability=publication`, los cuatro gates, `profile=native-local`, `execution=local-verification`, `scope=argentina-stage-1`, `revoked=false` y vigencia actual. El runtime solo autoriza registros cuyo `source` sea `authorized-external`; esto no convierte la prueba local en conformidad productiva y `liveConformance` debe permanecer `false`.

No habilitar evidence de `provider-actions`, `settlement`, `fleet` o `release-jobs` como parte de esta baseline.

## Marketplace canonico

Rutas verificadas:

```text
POST /tus/v1/marketplace/onboarding
POST /tus/v1/marketplace/listings
POST /tus/v1/marketplace/listings/:listingId/publish
GET  /tus/v1/marketplace/discovery
GET  /tus/v1/marketplace/merchant/operations
GET  /tus/v1/marketplace/customer/commitments
POST /tus/v1/marketplace/checkout
```

Las mutaciones autenticadas requieren:

- `Authorization: Bearer <token>`;
- `X-Correlation-Id`;
- `X-TUS-Readiness-Profile: native-local`;
- `X-TUS-Readiness-Scope: argentina-stage-1` cuando aplique readiness;
- `Idempotency-Key` para checkout.

No usar estas rutas legacy:

```text
/tus/v1/discovery/offers
/tus/v1/merchant/operations
/tus/v1/customer/commitments
```

Un listing con precio `12500` ARS se persiste como `1250000` unidades menores y se devuelve por HTTP como `price: 12500`. Los campos internos bigint `priceMinor` y `priceSnapshot` no forman parte del payload publico de listing/discovery/merchant operations.

## Web local

En otra terminal:

```powershell
$env:NEXT_PUBLIC_API_URL = "http://localhost:3101"
node scripts/dev/native-profile.mjs web
```

Abrir:

```text
http://localhost:3000/sign-in?returnTo=%2Ftus
```

Usar `localhost` en Web y API. El origen `http://127.0.0.1:3000` es distinto para CORS y session storage.

La Web guarda solo access token y expiracion en `sessionStorage`, recupera autoridad desde `/auth/session` y carga recursos desde las rutas Marketplace canonicas. La baseline fue verificada en desktop y en viewport mobile de 390 px, sin errores de consola ni contenido fuera del viewport.

## Checks progresivos

Ejecutar con Node compatible:

```powershell
corepack pnpm run contracts:validate
corepack pnpm --filter @factory/api run typecheck
corepack pnpm --filter @factory/web run typecheck
corepack pnpm --filter @factory/web run build
```

En Windows sin Developer Mode, `output: "standalone"` puede fallar al crear symlinks con `EPERM`. Para verificar el build local sin modificar permisos del sistema:

```powershell
$env:NEXT_PUBLIC_API_URL = "http://localhost:3101"
$env:NEXT_DISABLE_STANDALONE = "true"
corepack pnpm --filter @factory/web run build
```

Standalone permanece habilitado por defecto para despliegue. `NEXT_DISABLE_STANDALONE=true` es solo un override explicito de build local.

## Diagnostico

Si una peticion falla:

1. Comprobar el puerto con `Get-NetTCPConnection`.
2. Comprobar el PID con `Get-Process`.
3. Consultar `/health` y `/ready`.
4. Leer stdout/stderr del proceso.
5. Revisar preflight CORS en el navegador.
6. Reiniciar solo el proceso afectado despues de identificar la causa.

No reinstalar dependencias, resetear PostgreSQL ni cambiar configuracion del sistema como primera respuesta.

## Detencion

Detener solo los PIDs registrados al iniciar API y Web:

```powershell
Stop-Process -Id <pid-api>
Stop-Process -Id <pid-web>
```

Confirmar luego que los puertos `3101` y `3000` ya no tengan listeners. PostgreSQL puede permanecer activo si sigue siendo usado por otras tareas locales.
