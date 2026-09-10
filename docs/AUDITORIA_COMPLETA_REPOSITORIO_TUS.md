# Auditoría completa del repositorio TUS

**Fecha:** 2026-09-10
**Rama auditada:** `pre-cambios` (`HEAD = f8d9a8e`)
**Estado del árbol:** limpio, sin cambios pendientes.
**Alcance:** auditoría exclusivamente de lectura. No se borró, movió, renombró ni modificó ningún archivo para producir este informe.
**Criterio:** si un archivo permanece en TUS, debe existir una explicación concreta de por qué TUS lo necesita.

Leyenda de clasificación usada en todo el documento:

- **A — TUS CORE:** negocio propio de TUS.
- **B — TUS PLATFORM:** infraestructura técnica necesaria para TUS.
- **C — SHARED:** código usado realmente por varias aplicaciones.
- **D — SERVICIO AUXILIAR:** proceso independiente que TUS necesita de forma demostrable.
- **E — REFERENCIA:** ejemplo, fixture o documentación que no debe formar parte del runtime productivo.
- **F — CÓDIGO EXTERNO:** proveniente de otros productos o prototipos.
- **G — MUERTO:** sin consumidores reales.
- **H — DUPLICADO:** misma responsabilidad implementada más de una vez.
- **I — INCOMPLETO:** funcionalidad planificada pero no terminada.
- **J — DUDOSO:** evidencia insuficiente para decidir.

---

## 1. Resumen ejecutivo

El repositorio contiene una base TUS real y activa, pero conserva encima varias capas históricas que no pertenecen al producto:

1. **Núcleo TUS activo y coherente.** Existe en `apps/api/src/tus/**`, `apps/web/src/app/tus/**` y `apps/mobile/src/application/tus-*.ts`, con contratos versionados en `packages/contracts` y persistencia PostgreSQL/Prisma. Es la parte que debe conservarse.
2. **Zona aislada `apps/api/backendFiles`.** Son 45 archivos: 4 documentos y 41 archivos TypeScript. No tiene `package.json`, `tsconfig` ni runner propio. Queda fuera del build porque `apps/api/tsconfig.json` limita `rootDir` e `include` a `apps/api/src`, y `scripts/build-api.mjs` compila solo ese directorio. `apps/api/src/server.ts` no importa nada de `backendFiles`. No se detectó ningún consumidor productivo. Contiene una mezcla de primitivas reutilizables de Groq/audio/retry/storage, lógica Companion/Tilo, código médico y una copia DocPhone de reportes y Backblaze. Debe desaparecer como carpeta, con rescate selectivo previo.
3. **Dependencia productiva hacia `apps/reference`.** `apps/reference` tiene 7 archivos y es conceptualmente neutral/ejemplo, pero hay dos importadores productivos directos: `apps/web/src/lib/neutral-contract-client.ts` y `apps/mobile/src/application/neutral-contract-client.ts`. Ningún código productivo debe depender de una carpeta llamada `reference`. Hay que mover el contrato neutral a `packages/` y dejar `apps/reference` solo como ejemplo o eliminarlo.
4. **Exceso de paquetes.** Hay 17 directorios en `packages/`, 16 con `package.json`. Solo `contracts`, `config`, `errors`, `observability`, `typescript-config` y `eslint-config` tienen consumidores productivos claros. El resto solo se usa desde tests, documentación o dependencias declaradas sin imports reales.
5. **Persistencia triple declarada, simple en la práctica.** PostgreSQL/Prisma es la fuente real del arranque. MongoDB solo interviene en conexión, health check y apagado. Redis en TypeScript solo hace `PING` de readiness y rate limiting. El worker Python consume Redis con `BLPOP`/`HSET`, pero separado del API y sin ack/retry/DLQ/run-ledger.
6. **Documentación contradictoria.** `README.md`, `ARCHITECTURE.md` y `.ai-manifest.md` describen un boilerplate genérico production-ready para 100K usuarios, mientras la evidencia vigente declara explícitamente `not-production-ready`. Hay que reescribir la raíz y archivar snapshots históricos.
7. **Basura y artefactos versionados.** Existen `errorlogs.txt` de otro producto, `travelers_clean.sql` de MySQL, artefactos `build/lib`, `*.egg-info`, `*.tsbuildinfo`, `streams.js`/`streams.d.ts` generados dentro de `src`, y comandos documentados que no existen.

Conclusión: TUS existe y funciona como diseño local/determinista, pero el repositorio todavía parece una mezcla de product-factory, DocPhone/médico, travelers, golden-boilerplate y prototipos. La limpieza debe rescatar primitivas útiles, mover el contrato neutral a `packages/`, consolidar paquetes, archivar evidencia histórica y eliminar lo externo, muerto, duplicado y basura.

No se ejecuta ninguna limpieza en este documento. Solo se audita.

---

## 2. Arquitectura detectada

### 2.1. Arquitectura real, según el código que sí se ejecuta

```text
TUS Web (Next.js, apps/web)
  -> HTTP JSON hacia API TUS
TUS Mobile (Expo, apps/mobile)
  -> HTTP JSON hacia API TUS
API TUS (Express, apps/api/src)
  -> PostgreSQL mediante Prisma + pg-pool
  -> MongoDB solo conexión/salud
  -> Redis solo PING de readiness + rate limiting
Worker Python (apps/workflow-runtime-python)
  -> Redis con BLPOP/HSET, separado del API
  -> PostgreSQL declarado, checkpointer no disponible
```

Entrypoints reales:

- API: `apps/api/src/index.ts` -> `apps/api/src/server.ts` (`createApp`, `startServer`).
- Web: Next.js App Router en `apps/web/src/app`, arranque con `next dev`, `next build`, `next start`.
- Mobile: `expo-router/entry`, configuración en `apps/mobile/app.config.ts`.
- Worker Python: `worker.main:main`, con `WORKER_ENABLE_CONSUMER=false` por defecto.
- Contratos: `packages/contracts` como fuente versionada TS/Python mediante JSON Schema.

### 2.2. Arquitectura declarada en documentos viejos, que ya no refleja el código

`README.md`, `ARCHITECTURE.md` y `.ai-manifest.md` describen:

- Turborepo boilerplate genérico.
- Express con modo cluster.
- Estrategia híbrida PostgreSQL + MongoDB + Redis como tres fuentes equivalentes.
- 100K+ usuarios concurrentes y production-ready.

Esa descripción es histórica. El servidor actual no usa modo cluster visible en `server.ts`, MongoDB no posee CRUD empresarial, Redis no posee colas del API, y el estado declarado es `not-production-ready`.

### 2.3. Capas que existen en disco pero no en runtime

- `apps/api/backendFiles`: fuera del build y sin montaje en Express.
- `apps/reference/fallback/*`: solo fixtures de tests.
- `backend/` y `frontend/`: wrappers mínimos hacia `scripts/dev/native-profile.mjs`.
- `packages/ai-contracts`: 27 schemas sin manifiesto ni consumidores runtime.
- Múltiples adapters in-memory/activation-gated/postgres que existen como código pero no están cableados al arranque principal.

---

## 3. Árbol actual

Conteo con exclusión de `.git`, `node_modules`, `.next`, `dist`, `.turbo` y `__pycache__`: **1147 archivos**.

| Superficie | Archivos |
|---|---:|
| `apps/` | 518 |
| `packages/` | 207 |
| `openspec/` | 176 |
| `tests/` | 128 |
| `docs/` | 50 |
| `scripts/` | 25 |
| `infra/` | 17 |
| Raíz y wrappers | resto hasta 1147 |

Por extensión:

| Extensión | Cantidad |
|---|---:|
| `.ts` | 377 |
| `.md` | 228 |
| `.json` | 146 |
| `.py` | 127 |
| `.mjs` | 122 |
| `.sql` | 30 |
| `.tsx` | 24 |
| `.tf` | 17 |
| `.gitkeep` | 15 |
| `.png` | 8 |
| `.txt` | 6 |
| `.cjs` | 6 |
| `.js` | 6 |
| `.tsbuildinfo` | 5 |
| Resto | disperso |

Estructura raíz:

```text
apps/
  api/
  web/
  mobile/
  reference/
  workflow-runtime-python/
backend/
frontend/
packages/
  ai-contracts/
  asset-pipelines/
  config/
  contracts/
  email/
  errors/
  eslint-config/
  events/
  lifecycle/
  mercado-pago/
  observability/
  providers/
  queues/
  storage/
  typescript-config/
  workflows/
  zod-schemas/
docs/
openspec/
tests/
scripts/
infra/terraform/
```

Casos relevantes:

- `apps/api/backendFiles`: 45 archivos.
- `apps/reference`: 7 archivos.
- `backend/` y `frontend/`: solo `package.json` wrapper cada uno.
- `packages/ai-contracts`: sin `package.json`.

---

## 4. Aplicaciones ejecutables

| Aplicación | Entrypoint | Comando | Estado | Clasificación |
|---|---|---|---|---|
| API TUS | `apps/api/src/index.ts`, `apps/api/src/server.ts` | `tsx watch src/index.ts`, `node dist/index.js` | Activa | A/B |
| Web TUS | `apps/web/src/app`, `next.config.js` | `next dev`, `next build`, `next start` | Activa | A |
| Mobile TUS | `expo-router/entry`, `apps/mobile/app.config.ts` | `expo start`, `expo run:android/ios` | Activa, con assets faltantes | A/I |
| Worker Python | `worker.main:main` | `python -m worker.main` | Separado e incompleto | D/I |
| `backend/` | `scripts/dev/native-profile.mjs api` | `node ../scripts/dev/native-profile.mjs api` | Wrapper histórico | G/J |
| `frontend/` | `scripts/dev/native-profile.mjs web` | `node ../scripts/dev/native-profile.mjs web` | Wrapper histórico | G/J |
| `apps/reference/api` | `apps/reference/api/src/index.ts` | Solo importado | Referencia usada por error en producción | E/H |
| `apps/reference/web`, `apps/reference/mobile` | sus `src/index.ts` | Solo tests/parity | Ejemplo | E |
| `backendFiles` | ninguno | Ninguno | Fuera del build | F/G/I |

Observaciones:

- Mobile declara `./assets/adaptive-icon.png` y `./assets/splash-icon.png`, pero no existe `apps/mobile/assets/**`.
- El README del worker documenta `make worker-install`, `make worker-run`, `pnpm run worker:install` y `pnpm run worker:run`. Esos comandos no existen en `Makefile` ni en `package.json` raíz.
- `backend/package.json` se llama `native-api-wrapper` y `frontend/package.json` se llama `native-web-wrapper`. Son nombres legacy que no dicen TUS.

---

## 5. Entry points

| Entrypoint | Qué inicia | Qué monta | Clasificación |
|---|---|---|---|
| `apps/api/src/index.ts` | `startServer()` | Delegación total a `server.ts` | B |
| `apps/api/src/server.ts` | Express, lifecycle, Prisma, auth, tenancy, TUS | `/health`, `/ready`, auth, tenancy, TUS condicional, integración condicional | A/B |
| `apps/web/src/app/layout.tsx`, `page.tsx`, `tus/page.tsx`, `tus/pos/page.tsx`, `tus/operations/page.tsx` | Rutas Next.js | Superficies TUS y auth | A |
| `apps/mobile/app/_layout.tsx`, `app/(app)/index.tsx`, `app/(app)/pos.tsx`, `app/(auth)/login.tsx` | Rutas Expo | Superficies TUS y auth | A |
| `apps/workflow-runtime-python/src/worker/main.py` | Worker | Estado bloqueado o ejemplo si el consumidor está desactivado | D/I |
| `apps/workflow-runtime-python/src/worker/queue/consumer.py` | Consumidor Redis | `BLPOP` sobre `bull:workflow-jobs:wait` y `HSET` de resultados | D/I |
| `scripts/dev/native-profile.mjs` | Perfil nativo | API/web local | B/J |
| `scripts/test-runner.mjs` | Tests raíz | Suites foundation/compatibility/providers | B |
| `scripts/postgres-seed.mjs` | Seed | Seed PostgreSQL con confirmación explícita | B |
| `scripts/activation/tus-readiness.mjs` | Reporte | Reporte provider-free | B |
| `scripts/audit/tus-runtime-audit.mjs` | Auditoría | Auditoría runtime | B/E |

Rutas HTTP montadas realmente en el API:

- `GET /health`.
- `GET /ready`.
- Auth y tenancy.
- Rutas TUS solo si `TUS_ROUTES_ENABLED=true`.
- Rutas de integración Mercado Pago/WhatsApp solo si `TUS_PROVIDER_ACTIONS_ENABLED=true`.
- En `render.yaml` y `vercel.json`, ambas flags están en `false`.

Por tanto, el despliegue declarado por defecto expone salud, auth y tenancy, pero no el negocio TUS. Esto es coherente con el estado `not-production-ready`, pero debe documentarse explícitamente.

---

## 6. Servicios

| Servicio | Dónde | Activo en arranque | Clasificación |
|---|---|---|---|
| Salud/readiness | `apps/api/src/presentation/routes/health.ts` | Sí | B |
| Auth principal | `apps/api/src/auth-security` + `createPrismaAuthService` | Sí | A/B |
| Tenancy | `apps/api/src/tenancy` + `createPrismaTenancyService` | Sí | A/B |
| TUS checkout/commitments | `apps/api/src/tus/application`, `tus/http/router.ts`, `tus/composition` | Condicional por flag | A |
| TUS marketplace | `apps/api/src/tus/catalog`, adapters Prisma | Condicional por flag | A |
| TUS calendario/reservas | `apps/api/src/tus/calendar` | Condicional por flag | A |
| TUS finanzas | `apps/api/src/tus/finance` | Servicio existe; billing sin rutas registradas | A/I |
| TUS delivery | `apps/api/src/tus/delivery` | Condicional por flag | A |
| TUS POS | `apps/api/src/tus/pos` | Condicional por flag | A |
| TUS soporte/reportes | `apps/api/src/tus/support`, `tus/reporting` | Condicional por flag | A |
| TUS WhatsApp | `apps/api/src/tus/whatsapp`, `apps/api/src/providers/whatsapp` | Condicional/gated | A/D |
| Mercado Pago | `apps/api/src/providers/mercado-pago` | Gated | A/D |
| Billing | `apps/api/src/tus/billing` | Existe, sin rutas ni registro en `server.ts` | A/I |
| Jobs/outbox/run-ledger genéricos | `apps/api/src/platform/jobs`, `outbox`, `run-ledger` | Adapters existen, no cableados al boot principal | B/I |
| CRUD/assets/notificaciones/configuración | `apps/api/src/platform/*` | Parcialmente cableados o solo memoria | B/I |
| AI registry | `apps/api/src/ai/registry` | Solo memoria | B/I |
| Recovery/backup | `apps/api/src/recovery` | Utilidades, no runtime central | B/J |
| Privacy | `apps/api/src/privacy` | Servicio real, sin integración completa con `backendFiles` | B |
| Product superadmin | `apps/api/src/admin/product-superadmin` | Solo memoria | B/J |
| MFA/passkeys/OAuth/linking | `apps/api/src/auth-security/*` | Servicios memoria + rutas específicas | B |
| Mongo genérico | `apps/api/src/data/mongo` | Adapters in-memory/unavailable, sin CRUD empresarial | B/G |
| Postgres SQL crudo | `apps/api/src/data/postgres/sql` | Helpers de hot-paths, geo, texto, locks | B/J |
| Voz/Groq aislada | `apps/api/backendFiles/src/ai`, `routes/voice.ts` | Sin montaje | F/G |
| Companion/Tilo | `apps/api/backendFiles/src/companion` | Sin montaje | F/G |
| Reportes DocPhone | `backendFiles/.../docphone-backblaze-upload` | Sin montaje, con dependencias ausentes | F/G |

---

## 7. Packages

Hay 17 directorios. 16 tienen `package.json`. `ai-contracts` no tiene manifiesto.

| Paquete | Responsabilidad | Consumidores productivos | Clasificación | Propuesta |
|---|---|---|---|---|
| `packages/contracts` | JSON Schema canónicos + bindings TS/Python, 98 schemas validados | API, web, mobile, worker | C | Conservar; corregir `$ref` roto y exports de workflows |
| `packages/config` | Configuración nativa y readiness | API | C | Conservar |
| `packages/errors` | Redacción de errores | Middleware API | C | Conservar |
| `packages/observability` | Telemetría compartida | API | C | Conservar |
| `packages/typescript-config` | Bases TS | API/web/zod | B | Conservar |
| `packages/eslint-config` | Lint compartido | API/web/zod | B | Conservar; corregir README `@repo` |
| `packages/zod-schemas` | Ejemplo genérico + health/ready | Ningún import fuente; solo dependencia declarada | G/H | Eliminar o reemplazar por schemas usados |
| `packages/providers` | 17 adapters/gates de infraestructura e IA | Solo tests | B/I/J | Consolidar; resolver solape con storage/queues/email/events |
| `packages/storage` | Ports B2/S3/fakes | Solo tests; API tiene assets propios | B/H | Adoptar desde API o retirar |
| `packages/queues` | Ports Redis-local/SQS-DLQ | Solo tests; API tiene jobs propios | B/H | Adoptar como frontera única o retirar |
| `packages/events` | Ports EventBridge/Lambda/fakes | Solo tests | B/H | Consolidar con `platform/events` o retirar |
| `packages/email` | Contratos/templates/fakes/SES | Solo tests | B/J | Adoptar o retirar |
| `packages/workflows` | Contratos TS de workflows | Ninguno; source no importa sus dependencias declaradas | G/H | Fusionar con contracts o eliminar |
| `packages/asset-pipelines` | Contratos de pipelines | Ninguno | G/J | Adoptar o eliminar/fusionar |
| `packages/lifecycle` | Lifecycle genérico | Solo tests; API tiene lifecycle propio | G/H | Consolidar o retirar |
| `packages/mercado-pago` | Cliente portable Mercado Pago | Ninguno; API usa su propio provider | H/I | Renombrar a `@factory` y hacerlo usar por API, o eliminar |
| `packages/ai-contracts` | 27 schemas IA genéricos | Tests/docs/validador; sin import runtime | E/J | Añadir manifiesto o declararlo schema-only fuera del runtime |

Problemas concretos:

- `packages/mercado-pago/package.json` usa `@repo/mercado-pago` y depende de `@repo/typescript-config`, mientras el workspace usa `@factory/*`. Además no tiene importer correspondiente en `pnpm-lock.yaml`.
- `packages/contracts/schemas/workflow-job.schema.json` referencia `./asset-metadata.v1.schema.json`, pero el archivo real es `asset-metadata.schema.json`.
- `packages/contracts/src/workflows.ts` no está incluido en su `tsconfig.json` ni exportado desde `src/index.ts`.
- `packages/contracts/src/streams.js`, `streams.d.ts` y sus `.map`, más `tsconfig.tsbuildinfo` en contracts/config/zod-schemas, son artefactos generados versionados.
- `packages/workflows/src/index.ts` duplica parcialmente contratos canónicos de workflow.
- `DELIVERY_PROFILE` está duplicado en `config` y `observability`.
- `apps/api` importa `@factory/errors`, pero hubo evidencia de resolución pendiente en typecheck en fases previas. Debe verificarse antes de la limpieza.

---

## 8. Persistencia

### 8.1. Mapa general

| Tecnología | Uso real detectado | Fuente de verdad | Clasificación |
|---|---|---|---|
| PostgreSQL + Prisma + pg-pool | Auth, tenancy, TUS, readiness, lifecycle y arranque | Sí, principal | A/B |
| MongoDB + Mongoose | Conexión, health check y shutdown | No para negocio | B/G |
| Redis + ioredis en TS | `PING` de readiness y rate limiting | No para negocio | B |
| Redis en Python | `BLPOP`/`HSET` del consumidor separado | Solo estado de jobs | D/I |
| Memoria | Múltiples `InMemory*Store` en API, TUS, auth, platform y tests | Solo tests/local | B/I |
| Almacenamiento local mobile | MMKV, SecureStore, Zustand persistido | Sesión/cola local mobile | A |
| Objetos B2/S3 | `InMemoryB2Source` en API; `S3AssetStorage` aislado en Python | B2 como fuente durable declarada, no verificada | B/I |
| SQS/DLQ | Transportes activation-gated | No activo | B/I |
| Colas API Redis | Sin cola real en API | No | G |
| Jobs/run-ledger | In-memory y adapters SQL, no cableados al boot | PostgreSQL declarado | B/I |
| Archivos locales | Media-store Companion y storage local de `backendFiles` | No | F/G |
| MySQL | Solo `travelers_clean.sql` | No | F/G |

### 8.2. Tabla dato/fuente/lectores/escritores/tecnología

Solo se incluyen datos con evidencia en código. Donde no hay evidencia se marca explícitamente.

| Dato | Fuente de verdad | Lectores | Escritores | Tecnología |
|---|---|---|---|---|
| Usuario | PostgreSQL, `User` | Auth, tenancy | Auth `register` | Prisma |
| Cuenta | PostgreSQL, `Account` | Auth, sesiones | Auth | Prisma |
| Sesión/dispositivo/refresh | PostgreSQL, `Session`, `Device`, rotación refresh | Resolutores de sesión TUS/auth | Auth | Prisma + SQL |
| Tenant/organización/workspace/membership | PostgreSQL, `Organization`, `Workspace`, `Membership`, `TenantRole`, `TusTenant` | Auth, tenancy, TUS | Auth/tenancy; riesgo: `register` genera `tenantId` sin crear siempre `TusTenant`/`Organization`/`Workspace` | Prisma |
| Prestador/merchant | PostgreSQL, `TusMerchant` | Marketplace | Marketplace service | Prisma |
| Cliente/customer | PostgreSQL como tenant/account/commitment; sin modelo `Customer` separado | Marketplace/commitments | Marketplace | Prisma |
| Producto | PostgreSQL, `TusProduct`, `TusListing` | Marketplace/web/mobile | Marketplace | Prisma |
| Servicio | PostgreSQL, `TusService`, `TusListing` por `kind` | Marketplace/calendario | Marketplace | Prisma |
| Inventario | PostgreSQL, `TusInventory` | Marketplace/POS | Marketplace/POS | Prisma |
| Calendario/reglas/excepciones | PostgreSQL, `TusCalendar*` | Calendario | Calendario | Prisma |
| Reserva/booking | PostgreSQL, `TusBooking`, `TusMarketplaceCommitment` | Calendario/marketplace | Calendario/marketplace | Prisma |
| Compromiso/operación | PostgreSQL, `TusCommitment`, `TusOperationsRecord` | Checkout, POS, delivery, finanzas | Checkout/POS | Prisma |
| Pago/intento | PostgreSQL, `TusPaymentIntent`, `TusFinanceIdempotency` | Finanzas | Finanzas + provider gated | Prisma |
| Facturación | PostgreSQL, modelos `TusInvoice*`, `TusBilling*`, `TusSubscription*` | Billing sin rutas | Billing sin rutas | Prisma/I |
| Archivo/asset | B2 declarado; API usa memoria; Python S3 aislado | Assets | Assets/uploads | Memoria/S3/B2/I |
| Evento/outbox | PostgreSQL, `OutboxEvent`, `Tus*Outbox` | Worker futuro | Transacción TUS | Prisma |
| Sesión app | PostgreSQL | API | Auth | Prisma |
| Jobs/run-ledger | PostgreSQL declarado | No cableado al boot | Adapters SQL/memoria | Prisma/memoria/I |
| Embeddings/RAG | PostgreSQL `RagEmbedding` con `vector`; B2 como linaje | RAG | Ingesta | pgvector/B2 |
| AI registry | Memoria | Registry | Registry memoria | Memoria/I |
| Documentos Mongo owned | Mongo declarado `owned_documents` | Ningún CRUD empresarial | Ninguno | Mongo/G |
| Proyección Mongo | PostgreSQL por replay | Ningún consumidor productivo | Ninguno | Mongo/G |
| Rate limit | Redis | Middleware | Middleware | Redis |
| Caché | Sin evidencia | Sin evidencia | Sin evidencia | Sin evidencia |
| Locks | Redis/SQL según helpers | Helpers | Helpers | Redis/SQL |
| Cola | Redis Python separada | Consumidor Python | Productor no integrado al API | Redis/I |
| Reporte médico | Sin fuente TUS; código DocPhone aislado | Ninguno | Ninguno | F/G |
| Viajes/travelers | `travelers_clean.sql` MySQL | Ninguno | Ninguno | F/G |
| Consulta médica | `errorlogs.txt` | Ninguno | Ninguno | F/G |

Riesgos de persistencia:

- La migración `20260909090000_tus_argentina_market_launch` no crea `TusReadinessEvidence` ni `TusReadinessDecision`, aunque `lifecycle.ts` los exige para arrancar.
- `PrismaMarketplaceStore` usa `findUnique({ where: { commitmentId } })`, pero `TusMarketplaceCommitment` solo tiene unique compuesto `[tenantId, commitmentId]`.
- Varias lecturas usan solo ID sin `tenantId` explícito.
- Hay dos evidencias contradictorias: una dice PostgreSQL diferido sin conexiones, otra dice seed/migración exitosos. Debe reconciliarse antes de afirmar readiness.

---

## 9. Flujo de datos

Flujo productivo real:

```text
Web/Mobile
  -> fetch/axios hacia API
  -> correlation + helmet + CORS + rate-limit + body-limit
  -> auth/tenancy con Prisma
  -> router TUS condicional
  -> servicio TUS con stores Prisma o memoria
  -> transacción Prisma con commitments/compensations/audits/idempotency/outbox
  -> respuesta JSON versionada por contracts
```

Flujos no productivos o separados:

```text
backendFiles voz/Groq -> orquestador aislado -> sin montaje
backendFiles companion -> router companion -> sin montaje
backendFiles DocPhone -> controlador/rutas reporte -> servicios ausentes
reference neutral -> web/mobile productivo -> debe moverse a packages
Python consumer Redis -> hash Redis -> sin ack/retry/DLQ/run-ledger
```

Contratos duplicados sin estrategia única:

- TypeScript en `apps/api/src/tus/domain`, `tus/ports`, `tus/*.ts`.
- Zod en `packages/zod-schemas` solo con ejemplos.
- Prisma como fuente relacional.
- JSON Schema en `packages/contracts`.
- Modelos web en `apps/web/src/lib/tus-*.ts`.
- Modelos mobile en `apps/mobile/src/application/tus-*.ts` y `core/domain`.
- Modelos Python generados en `packages/contracts/generated/python`.

No debe conservarse un `Usuario` distinto en web, mobile, API y worker sin regla de fuente. La fuente debe ser `packages/contracts` + Prisma, con adaptadores finos.

---

## 10. Inventario de módulos

### 10.1. API TUS real

`apps/api/src/tus/**` contiene checkout, commitments, marketplace, calendario, finanzas, delivery, POS, WhatsApp, soporte, reporting, readiness, billing, puertos, adapters Prisma/memoria, composición, HTTP e integración. Es **A**.

`apps/api/src/auth-security/**` y `apps/api/src/tenancy/**` son **A/B** porque sostienen identidad y tenant de TUS.

`apps/api/src/platform/**`, `infrastructure/database/*`, `presentation/middleware/*` y `data/postgres/sql/*` son **B**.

`apps/api/src/providers/mercado-pago` y `providers/whatsapp` son **A/D**, con gates.

`apps/api/src/ai/registry`, `admin/product-superadmin`, `audit`, `privacy`, `recovery`, `streams`, `data/mongo` y `data/ownership` son **B**, con partes **I/G** según cableado.

`apps/api/src/domain/entities/README.md`, `domain/repositories/README.md`, `application/usecases/README.md`, `infrastructure/config/README.md` son únicos archivos README en carpetas por lo demás vacías. Son **G**.

### 10.2. Web

Activos TUS:

- `apps/web/src/app/tus/page.tsx`, `tus/pos/page.tsx`, `tus/operations/page.tsx`.
- `apps/web/src/app/tus/tus-dashboard.tsx`, `tus-operations.tsx`, `tus-pos.tsx`, `tus-ui.tsx`.
- `apps/web/src/lib/tus-client.ts`, `tus-auth-client.ts`, `tus-ui-contract.ts`, `tus-journeys.ts`, `tus-resource-loader.ts`, `api-client.ts`, `api-url.ts`, `query-client.tsx`.
- `apps/web/src/app/manifest.ts`, `robots.ts`, `sitemap.ts`, `layout.tsx`.

Herencia/genericidad:

- `apps/web/src/store/example-store.ts`.
- `apps/web/src/components/README.md` sin componentes reales relevantes.
- `apps/web/src/lib/neutral-contract-client.ts` importa desde `apps/reference`.

Clasificación: núcleo **A**, ejemplo **G**, import a reference **H/E**.

### 10.3. Mobile

Activos TUS:

- `app/(app)/index.tsx`, `app/(app)/pos.tsx`, `app/(auth)/login.tsx`.
- `src/application/tus-client.ts`, `tus-auth.ts`.
- `src/presentation/*` para TUS, accesibilidad, journeys y layout.
- `src/core/config/runtime-profile.ts`, `runtime-diagnostics.ts`.
- `src/core/services/*` para API, storage, credenciales y query.
- `tests/unit/tus-*.test.ts`.

Problemas:

- `src/application/neutral-contract-client.ts` importa desde `apps/reference`.
- `src/store/*` conserva identificadores `alqui`.
- `app.config.ts` usa `product-factory-core`, `factory-dev`, `factory-staging`, `factory`.
- Assets Expo declarados sin archivos.

Clasificación: núcleo **A**, neutral importado **E/H**, `alqui/factory` **F**.

### 10.4. Worker Python

Estructura en `apps/workflow-runtime-python/src/worker/*` con main, core/config, queue/consumer, checkpoint, telemetry, graph/base y contratos. `build/lib/**` duplica `src/**`. `*.egg-info/**` está versionado. `Dockerfile` instala solo `jsonschema` y usa `--no-deps`, aunque el código importa `pydantic-settings` y otras dependencias. Es **D/I**, con artefactos **G**.

---

## 11. Inventario de backendFiles

Total: **45 archivos**. 4 Markdown y 41 TypeScript. Sin `package.json`, `tsconfig` ni runner. Fuera del build. Sin consumidores productivos. Imports `@repo/zod-schemas` irresolubles porque el paquete real es `@factory/zod-schemas` y no exporta esos símbolos. Imports `@docphone/*` sin paquetes en el workspace. Dependencias ausentes: `groq-sdk`, `ws`, `multer`, `sharp`, AWS S3, `vitest`, entre otras.

### 11.1. Documentación interna

| Archivo | Qué hace | Estado | Propuesta |
|---|---|---|---|
| `backendFiles/README.md` | Describe la carpeta como portable y dependency-free | Incompleto y falso: contiene Express, ws, Groq, DocPhone y AWS | Adaptar como `docs/reference/backendFiles.md`, no como README de backend |
| `FRONTEND_GROQ_MODULES.md` | Documenta extracción frontend DocPhone | Obsoleto/parcial | Mover a referencia DocPhone |
| `FRONTEND_AUDIO_ONLY.md` | Documenta variante audio-only | Referencia sin consumidor | Mover a paquete audio neutral o referencia |
| `DOC_PHONE_BACKBLAZE_UPLOAD_SOURCES.md` | Registra 5 archivos copiados desde `C:\Users\mmmau\docphone-v2` | Externo/histórico | Mover a `docs/reference/docphone-backblaze-upload-sources.md` |

### 11.2. IA y Groq

| Archivo | Qué hace | Equivalente actual | Propuesta |
|---|---|---|---|
| `src/ai/types.ts` | Tipos STT/chat/TTS Groq | `packages/providers/src/groq`, `core` | Adaptar a `packages/providers` |
| `src/ai/retry.ts` | Retry con backoff/jitter/abort | `packages/providers/src/core` | Mover/unificar, no duplicar |
| `src/ai/http.ts` | Fetch retryable y timeouts | `packages/providers/src/core` | Adaptar |
| `src/ai/groq.provider.ts` | STT/chat/TTS Groq por HTTP | `GroqSpeechAdapter` en providers | Adaptar detrás de adapter gated |
| `src/ai/providerChains.ts` | Cadenas de dos claves Groq | `packages/providers/src/core` | Adaptar a registry/policy, sin secretos globales |
| `src/ai/orchestrator.ts` | Fallback entre dos pasos Groq | Registry + LangGraph declarado | Adaptar; no incorporar como orquestador independiente |
| `src/ai/medicalReport.ts` | Prompts e informe clínico | Ninguno en TUS | Mover a referencia DocPhone |
| `src/ai/__tests__/providerChains.test.ts` | Test de dos pasos Groq | Tests foundation providers | Adaptar a `packages/providers` |
| `src/ai/__tests__/orchestrator.test.ts` | Test de error terminal | Tests providers | Adaptar |

### 11.3. Companion/Tilo

| Archivo | Qué hace | Propuesta |
|---|---|---|
| `src/companion/adapters/backend-reuse.ts` | Espejo mínimo de contrato, devuelve handlers `undefined` | Eliminar; usar contrato neutral real si Companion se conserva |
| `src/companion/adapters/groq-tts.ts` | TTS Groq acoplado a Companion | Adaptar a providers/groq |
| `src/companion/ai-ports.ts` | Puertos STT/LLM/TTS con simulación y prompts Tilo | Mover a referencia Companion |
| `src/companion/context.ts` | Mensajes familiares, adulto mayor, vitales mock | Mover a referencia Companion |
| `src/companion/event-hub.ts` | WebSocket con scope sesión/familia/rol | Adaptar solo si TUS decide soportar WebSocket; si no, referencia |
| `src/companion/media-store.ts` | Audio en memoria/disco local | Adaptar a `packages/storage` o referencia |
| `src/companion/routes.ts` | Rutas `/companion/*` sin montaje | Mover a referencia Companion |

### 11.4. Copia DocPhone Backblaze

| Archivo | Qué hace | Problema | Propuesta |
|---|---|---|---|
| `.../api/src/services/StorageService.ts` | Storage local/S3/B2 | Import local inexistente, adapter estático DocPhone | Adaptar idea a `packages/storage`, no copiar literal |
| `.../api/src/middlewares/uploadMiddleware.ts` | Multer + Sharp | Falta error handler, reglas DocPhone | Adaptar a uploads TUS o referencia |
| `.../api/src/controllers/report.controller.ts` | CRUD médico, transcripción, PDF/Word, SSE | Faltan 10+ servicios y paquetes `@docphone/*` | Mover a referencia DocPhone |
| `.../api/src/routes/report.routes.ts` | Rutas `/transcribir`, `/formalizar`, reportes | Faltan auth y servicios | Mover a referencia DocPhone |
| `.../web/src/lib/api.ts` | Cliente DocPhone con React Query | Usa `/auth/login`, `/reports/*`, tipos médicos; web TUS no lo importa | Mover a referencia o eliminar tras conservar procedencia |

### 11.5. Frontend Groq duplicado

Hay dos variantes con los mismos símbolos públicos. La antigua está rota y la nueva es mejor, pero ninguna se usa.

| Archivo | Estado | Propuesta |
|---|---|---|
| `src/frontend-groq-audio/audio-contracts.ts` | Variante corregida | Mover a paquete audio neutral |
| `src/frontend-groq-audio/browser-audio-recorder.ts` | Variante robusta | Conservar/mover |
| `src/frontend-groq-audio/transcription-client.ts` | Fija `/reports/transcribir` | Adaptar endpoint/contrato |
| `src/frontend-groq-audio/transcription-workflow.ts` | Retry solo retryable | Mover |
| `src/frontend-groq-audio/index.ts` | Barrel sano pero sin consumidores | Mover |
| `src/frontend-groq/audio-contracts.ts` | Etiqueta OGG incorrecta | Eliminar |
| `src/frontend-groq/browser-audio-recorder.ts` | Menos robusto | Eliminar |
| `src/frontend-groq/transcription-client.ts` | Menor soporte abort/errores | Eliminar |
| `src/frontend-groq/transcription-workflow.ts` | Reintenta errores permanentes | Eliminar |
| `src/frontend-groq/ai-api-client.ts` | Formalización médica e imágenes | Mover a referencia DocPhone |
| `src/frontend-groq/index.ts` | Exporta `browser-image-analysis` inexistente | Eliminar; barrel roto |

### 11.6. Integraciones, privacidad, voz y validación

| Archivo | Qué hace | Equivalente | Propuesta |
|---|---|---|---|
| `src/config/env.ts` | Env Groq/PORT/CORS/audio | `platform/configuration/domain.ts` | Adaptar a provider config |
| `src/integrations/redis.ts` | Adapter Redis passthrough | Redis client + queues | Mover a contracts queues/events |
| `src/integrations/storage.ts` | Storage local parcial | `packages/storage` | Mover |
| `src/privacy/anonymization.ts` | Anonimiza PII con restauración memoria | `apps/api/src/privacy` | Adaptar a PrivacyService |
| `src/routes/voice.ts` | Handlers transcripción/chat sin auth/tenant/cuota | Providers/groq | Adaptar con contrato TUS o referencia |
| `src/utils/errors.ts` | Errores seguros de voz | `packages/errors` + middleware | Mover |
| `src/utils/text.ts` | Barrel que nadie importa | Import directo textCleaner | Eliminar |
| `src/utils/textCleaner.ts` | Limpieza texto y calidad transcripción | Ninguna copia exacta | Mover a utilidad neutral |
| `src/validation/medicalJson.ts` | JSON médico con `findings/impression` | Ninguno neutral | Mover a referencia médica |

Conclusión `backendFiles`: eliminar la carpeta completa al final, pero solo después de rescatar retry/HTTP, audio-only corregido, primitivas Groq, storage genérico y redacción/privacidad, y de archivar procedencia DocPhone/Companion/médica fuera del runtime.

---

## 12. Inventario de reference

`apps/reference` tiene 7 archivos. No debe sostener producción.

| Archivo | Función | Consumidores | Clasificación | Propuesta |
|---|---|---|---|---|
| `apps/reference/api/src/index.ts` | API neutral in-memory | Web, mobile, parity script, tests | E/H | Mover contrato a `packages/neutral-contracts` o similar y eliminar import productivo |
| `apps/reference/web/src/index.ts` | Cliente neutral ejemplo | Parity y tests | E | Mantener como ejemplo o eliminar del runtime |
| `apps/reference/mobile/src/index.ts` | Cliente neutral ejemplo | Parity y tests | E | Mantener como ejemplo o eliminar del runtime |
| `apps/reference/fallback/marketplace/index.ts` | Fixture marketplace | `p5-fallback-boundaries.test.mjs` | E | Mantener solo como fixture o archivar |
| `apps/reference/fallback/messaging/index.ts` | Fixture mensajería | Tests WhatsApp/fallback | E | Mantener solo como fixture o archivar |
| `apps/reference/fallback/payment/index.ts` | Fixture pagos | `p5-mercado-pago.test.mjs` | E | Mantener solo como fixture o archivar |
| `apps/reference/fallback/settlement/index.ts` | Fixture settlement | `p5-fallback-boundaries.test.mjs` | E | Mantener solo como fixture o archivar |

Importadores productivos indebidos:

- `apps/web/src/lib/neutral-contract-client.ts` desde `apps/reference/api/src/index`.
- `apps/mobile/src/application/neutral-contract-client.ts` desde `apps/reference/api/src/index`.

Validadores:

- `scripts/validation/reference-parity.ts`.
- `scripts/validation/contamination.ts`.

---

## 13. Código externo

| Origen | Evidencia | Ubicación | Propuesta |
|---|---|---|---|
| DocPhone/docphone-v2 | `DOC_PHONE_BACKBLAZE_UPLOAD_SOURCES.md`, `@docphone/db`, `@docphone/shared`, `Report`, segunda opinión | `backendFiles/.../docphone-backblaze-upload`, `frontend-groq`, `ai/medicalReport.ts`, `validation/medicalJson.ts` | Archivar fuera del runtime; rescate solo genérico |
| Médico/medbot | `medical`, `medicalReport`, `medicalJson`, `PatientConsultation`, `consultations/start`, puerto 3001 | `backendFiles`, `errorlogs.txt` | Eliminar/archivar |
| product-factory/factory | `product-factory-core`, `@factory/*`, `Factory Dev/Staging`, `SERVICE_NAME=product-factory-api` | `package.json` raíz, mobile, compose, render | Renombrar a TUS |
| golden-boilerplate | `golden-boilerplate.dev`, `Goldenrepo-js-py` | `packages/ai-contracts`, tests | Renombrar/archivar |
| travelers | MySQL `TRAVELERS`, DNI, ciudades, atracciones, propiedades | `travelers_clean.sql` | Eliminar/archivar fuera del repo productivo |
| alqui | `alqui:uninitialized:zustand:app`, credential/query/MMKV stores | `apps/mobile/src/store`, `core/services` | Renombrar a TUS |
| `@repo/*` legacy | `@repo/zod-schemas`, `@repo/mercado-pago`, `@repo/typescript-config` | `backendFiles`, `packages/mercado-pago`, docs viejos | Migrar a `@factory/*` o `@tus/*` |
| neutral genérico anterior | `native-*`, `deterministic-fake`, `unavailable cloud` | tests/scripts/docs | Normalizar taxonomía TUS |

---

## 14. Código muerto

Sin consumidores reales detectados:

- Todo `apps/api/backendFiles`, 45 archivos.
- `apps/api/src/domain/entities/README.md`, `domain/repositories/README.md`, `application/usecases/README.md`, `infrastructure/config/README.md` como únicos archivos de carpetas vacías.
- `apps/api/src/data/mongo/adapters/*`, `ports/*`, `reconciliation/*`, `sessions/*`, `data/ownership/mongo-ownership.ts` como CRUD empresarial.
- `packages/asset-pipelines`, `packages/workflows`, `packages/lifecycle` como paquetes.
- `packages/zod-schemas/src/example.ts` como schemas de ejemplo.
- `packages/ai-contracts` como runtime.
- `packages/email`, `events`, `queues`, `storage`, `providers` como runtime productivo; solo viven en tests.
- `packages/mercado-pago` como paquete consumido.
- `backend/` y `frontend/` como aplicaciones independientes.
- `apps/web/src/store/example-store.ts`.
- `travelers_clean.sql`, `errorlogs.txt`.
- Artefactos generados versionados.

No se afirma muerte solo por nombre antiguo. Cada caso se verificó por imports, composición del servidor, rutas, workspaces y tests.

---

## 15. Código huérfano

Válido pero sin recorrido ejecutable:

- `apps/api/src/tus/billing/*`: dominio y Prisma existen, pero sin rutas ni registro.
- `apps/api/src/platform/jobs`, `outbox`, `run-ledger`, `idempotency`, `quotas`, `assets`, `notifications`, `configuration`: adapters listos, no cableados al boot principal.
- `apps/api/src/ai/registry`: solo memoria.
- `backendFiles/src/integrations/redis.ts`, `integrations/storage.ts`, `privacy/anonymization.ts`: sin importadores.
- `backendFiles/src/companion/event-hub.ts`: `attachCompanionEventHub` nunca se llama.
- `backendFiles/src/ai/medicalReport.ts`: función exportada sin llamadores.
- `packages/contracts/src/workflows.ts`: no exportado ni incluido en build.
- `apps/api/src/data/postgres/sql/*`: helpers sin composición central clara.

---

## 16. Código duplicado

| Responsabilidad | Implementaciones | Cuál debe quedar | Por qué |
|---|---|---|---|
| Audio frontend | `frontend-groq` vs `frontend-groq-audio` | `frontend-groq-audio` adaptado | Corrige MIME, estados y retry |
| Contratos workflow | `packages/contracts` vs `packages/workflows` | `packages/contracts` | Es la fuente versionada usada |
| Mercado Pago | `apps/api/src/providers/mercado-pago` vs `packages/mercado-pago` | Una sola, probablemente la del API adaptada o el paquete renombrado | Evita dos fuentes de pagos |
| Storage | API assets vs `packages/storage` vs `backendFiles` storage | `packages/storage` como frontera + adapters API | Evita tres clientes |
| Colas | API jobs vs `packages/queues` vs Redis Python | Una frontera + worker explícito | Evita tres semánticas |
| Eventos | API platform events vs `packages/events` | Una sola | Evita dos contratos |
| Email | API notification vs `packages/email` vs providers email | Una sola | Evita tres capas |
| Retry/HTTP | `backendFiles/ai` vs providers core | Providers core | Es la capa productiva |
| Limpieza/redacción | `backendFiles/textCleaner/errors` vs `packages/errors`/middleware/privacy | Packages + middleware + privacy | Ya están cableados |
| Cliente neutral | `apps/reference/api` vs clientes web/mobile | Contrato en `packages/` | Ningún productivo debe importar `reference` |
| Migraciones TUS | Múltiples migraciones por dominio con solape histórico | Mantener historial, pero documentar canónica | No reescribir historial sin backup |
| Tests telemetría | `tests/test_telemetry.py` vs `test_telemetry_unittest.py` | Uno solo | Son prácticamente iguales |
| Documentación arquitectura | README vs ARCHITECTURE vs ai-manifest vs docs actuales | Docs actuales + README reescrito | Las viejas contradicen el código |

---

## 17. Código incompleto

Casos con TODO/FIXME/placeholder/mock/vacío/`throw not implemented`/hardcode/fake/memoria/ruta sin conectar/servicio sin registrar:

- Billing sin rutas.
- AI registry solo memoria.
- Jobs/outbox/run-ledger con adapters pero sin boot.
- Worker Python con consumidor desactivado y ejemplo en `main`.
- Checkpointer Python que lanza `CheckpointUnavailableError`.
- `Dockerfile` Python sin dependencias reales.
- Mobile sin assets y con `mockAuth`.
- `createReusableVoiceHandlers` que devuelve `undefined`.
- Barrel `frontend-groq` roto.
- Imports `@repo`/`@docphone` irresolubles.
- Servicios DocPhone ausentes.
- Schemas médicos parciales.
- `packages/*` con `test: node -e "process.exit(0)"`.
- `apps/api`, `web`, `mobile` con tests no-op locales.
- OpenSpec con cambios completos sin `sdd-verify` ni archive.
- Terraform sin evidencia de uso local verificada.
- Compose sin smoke verificado.

No todo lo incompleto debe eliminarse. Billing, jobs/outbox, AI registry, worker y POS forman parte futura válida de TUS si se cablean con PostgreSQL, gates y evidencia. Lo médico/Companion/DocPhone incompleto no forma parte de TUS y debe salir del runtime.

---

## 18. Código dudoso

Casos J que requieren decisión de ownership antes de tocar:

- `packages/asset-pipelines`: ¿pipeline real futuro o envoltura de una función?
- `packages/email/events/queues/storage/providers`: ¿fronteras futuras o duplicación de platform?
- `packages/ai-contracts`: ¿frontera IA o schemas genéricos sin dueño?
- `apps/api/src/admin/product-superadmin`: ¿superadmin TUS real o scaffold genérico?
- `apps/api/src/recovery/*`: ¿recuperación TUS o utilidades genéricas?
- `apps/api/src/data/postgres/sql/*`: ¿hot-paths medidos o helpers prematuros?
- `backend/` y `frontend/`: ¿wrappers necesarios o historia nativa?
- `infra/terraform`: ¿despliegue real o plan sin evidencia?
- `docs/evidence/*`: ¿evidencia vigente o snapshots?
- `openspec/changes/*` completos sin archive: ¿historia o trabajo abierto?

---

## 19. Scripts obsoletos

`scripts/` tiene 25 archivos. Activos: `test-runner.mjs`, `test-runner-lib.mjs`, `postgres-seed.mjs`, `tus-migration-repair*.mjs`, `activation/*`, `audit/tus-runtime-audit.mjs`, `dev/native-profile.mjs`, `dev/mobile-support.mjs`, `dev/local-fakes.mjs`, `dev/native-rollback.mjs`, `security/*`, `validation/*`, `sdd/git-boundary.mjs`, `build-api.mjs`.

Observaciones:

- `test-runner-lib.mjs` solo descubre `tests/foundation`, `tests/compatibility` y `packages/providers/tests`. Deja fuera `tests/integration/tus/*`, Python, mobile y mercado-pago.
- `tests/test_telemetry*.py` quedan fuera del runner Node.
- `mobile-support.mjs`, `local-fakes.mjs`, `native-rollback.mjs`, `native-profile.mjs`, `postgres-seed.mjs` y `tus-readiness.mjs` sí tienen referencias activas.
- No se detectó script histórico de un solo uso que deba conservarse indefinidamente, salvo evidencia explícita. Los scripts de reparación/migración deben conservarse hasta cerrar la reparación aditiva y luego archivarse.
- `scripts/validation/contamination.ts` y `reference-parity.ts` son útiles, pero deben apuntar a la nueva ubicación del contrato neutral tras la mudanza.

---

## 20. Tests obsoletos

`tests/` tiene 128 archivos. Raíz descubre 91 suites foundation, 1 compatibility MJS y 1 provider MJS. No descubre automáticamente 26 tests Python, 8 de integración, 10 mobile ni 1 de mercado-pago. CI tampoco ejecuta pytest, Jest mobile ni integraciones PostgreSQL.

Problemas:

- 12 scripts `test` no-op con `node -e "process.exit(0)"` en API, web, mobile y paquetes.
- `packages/mercado-pago` no puede construir por namespace y dependencias ausentes.
- `tests/foundation/p1-auth-provenance.test.mjs` usa rutas externas `C:\Users\mmmau\...`, no portable.
- `tests/foundation/sdd-git-boundary.test.mjs` hardcodea `Goldenrepo-js-py`.
- Tests de `backendFiles` con `vitest` sin runner configurado.
- Snapshots antiguos de auditoría con conteos 498/227/233/238/242/246 que no deben leerse como estado actual sin re-ejecución en `HEAD`.
- Tests TUS de integración con `InMemory*Store` prueban dominio, no durabilidad real. Son válidos como unitarios, pero no como prueba PostgreSQL.

Propuesta: separar suites Node, integración PostgreSQL, Python, mobile y paquetes; eliminar no-ops o reemplazarlos por suites reales; archivar snapshots.

---

## 21. Archivos basura

| Archivo | Motivo | Propuesta |
|---|---|---|
| `errorlogs.txt` | Log de `medbotAll`, puerto 3001, CORS médico, `PatientConsultation.tsx` | Eliminar/archivar fuera del repo |
| `travelers_clean.sql` | Dump MySQL destructivo `DROP DATABASE IF EXISTS TRAVELERS` | Eliminar/archivar fuera del repo |
| `apps/workflow-runtime-python/build/lib/**` | Artefacto generado duplicado de `src` | Eliminar y ignorar |
| `apps/workflow-runtime-python/src/workflow_runtime_python.egg-info/**` | Artefacto generado, `PKG-INFO` duplica README | Eliminar y ignorar |
| `packages/contracts/src/streams.js`, `streams.d.ts`, `*.map` | Generados dentro de `src` | Eliminar y generar en build |
| `*.tsbuildinfo` en contracts/config/zod-schemas | Caché TypeScript | Eliminar y ignorar |
| `apps/mobile/dist/_expo` mencionado en evidencia | Bundle generado que rompe lint | Ignorar/excluir del lint |
| `apps/api/backendFiles/src/frontend-groq/index.ts` | Barrel roto | Eliminar con variante antigua |
| `.codegraph/codegraph.db` | Índice local | Evaluar si debe estar versionado; probablemente ignorar |
| pnpm store, `.turbo`, coverage, logs | Generados | Ya ignorados o a ignorar |

No se encontraron `.bak`, `.old` ni `.tmp` relevantes en la pasada actual.

---

## 22. Documentación obsoleta

Marcar como histórica o superseded:

- `README.md`.
- `ARCHITECTURE.md`.
- `.ai-manifest.md`.
- `docs/evidence/tus-deployment.md`.
- `docs/evidence/readiness/validation-baseline.md` como snapshot, no estado.
- `openspec/changes/tus-final-audit/exploration.md`.
- `openspec/changes/tus-final-audit-v2/exploration.md`.
- `openspec/changes/tus-live-pos-completion/exploration.md`.
- `openspec/changes/golden-base-readiness/exploration.md`.

Mantener como fuente actual, tras traducción/revisión:

- `docs/architecture/*`.
- `docs/data/ownership.md`.
- `docs/deployment/tus-readiness.md`.
- `docs/operations/*`.
- `docs/runbooks/*`.
- `docs/security/*`.
- `docs/ai/*`.
- `docs/rag/*`.
- `docs/evidence/readiness/tus-matrix.md`.
- `docs/evidence/native-smoke.md`.
- `openspec/changes/tus-final-product-audit-v3/exploration.md`.
- `openspec/specs/tus-backend-database-hardening/spec.md`.

Cambios completos pendientes de `sdd-verify`/archive:

- `tus-platform-vision`, `tus-big-picture-mvp`, `tus-production-completion`, `tus-product-hardening`, `tus-live-runtime-correction`, `tus-product-closure`, `tus-mobile-runtime-hardening`, `tus-final-hardening`, `tus-final-regression-cleanup`, `tus-final-ui-ux`, `tus-ui-ux-improvement`.

Cambios abiertos/bloqueados:

- `tus-additive-migration-repair` 8/11, bloqueado por backup restaurable.
- `tus-backend-database-hardening`, fases pendientes.
- `tus-argentina-market-launch`, roadmap amplio con deployment/pilot abiertos.
- `tus-real-db-runtime-audit`, evidencia histórica pero no vigente.

---

## 23. Documentación en inglés

Regla pedida: todo `docs/` en español; nuevos documentos completamente en español.

Estado detectado: la gran mayoría de `docs/`, `openspec/`, `README`, `ARCHITECTURE` y comentarios importantes está en inglés o mezcla inglés/técnico. No se encontró un documento completo en español que ya cumpla la regla, salvo este informe.

Propuesta de traducción por prioridad:

1. `README.md`, `ARCHITECTURE.md`, `.ai-manifest.md`: reescribir en español alineado al código actual.
2. `docs/architecture/*`, `docs/data/ownership.md`, `docs/deployment/tus-readiness.md`: traducir íntegro.
3. `docs/operations/*`, `docs/runbooks/*`, `docs/security/*`: traducir íntegro.
4. `docs/ai/*`, `docs/rag/*`: traducir íntegro.
5. `docs/evidence/*`: conservar snapshots históricos en inglés si hace falta trazabilidad, pero añadir resumen en español y marcar `superseded` donde corresponda.
6. `openspec/` activo: traducir specs y propuestas vigentes; archivar el resto.
7. `backendFiles/*.md`: no traducir literal; reemplazar por documentación TUS en español y archivo histórico DocPhone.
8. Comentarios de código: no traducir masivamente; solo documentar reglas de negocio/decisiones en español cuando se toque cada módulo.

---

## 24. Nomenclatura legacy

| Nombre actual | Dónde | Propuesta |
|---|---|---|
| `product-factory-core` | `package.json` raíz | `tus` o `tus-monorepo` |
| `native-api-wrapper`, `native-web-wrapper` | `backend/`, `frontend/` | Eliminar wrappers o renombrar a `tus-api-local`, `tus-web-local` si se conservan |
| `product-factory-api`, `factory-api`, `factory-web`, `factory-workflow-worker` | compose, render, service names | `tus-api`, `tus-web`, `tus-worker` |
| `factory_user`, `factory_password`, `factory_local` | `.env.example`, compose | `tus_user`, `tus_password`, `tus_local` |
| `com.productfactory.core*`, `factory-dev`, `factory-staging`, `factory` | mobile | `com.tus.*`, `tus-dev`, `tus-staging`, `tus` |
| `Factory Dev`, `Factory Staging`, `Factory` | mobile display names | Nombres TUS |
| `alqui:*` | mobile store y servicios | `tus:*` |
| `@factory/*` | workspace actual | Mantener a corto plazo o migrar a `@tus/*` en fase separada; no mezclar con `@repo` |
| `@repo/*` | mercado-pago, docs viejos, backendFiles | Migrar a namespace vigente |
| `golden-boilerplate.dev`, `Goldenrepo-js-py` | ai-contracts, tests | Eliminar o reemplazar por identidad TUS |
| `TRAVELERS`, travelers | SQL raíz | Fuera del repo |
| `medbotAll`, `PatientConsultation`, `consultations` | logs | Fuera del repo |
| DocPhone, medical, healthcare, companion, Tilo | backendFiles | Fuera del runtime TUS |

No traducir conceptos técnicos estándar: `src`, `tests`, `packages`, `middleware`, `controller`, `repository`, `service`, `provider`, `adapter`, `DTO`, `API`, `HTTP`, `WebSocket`, `schema`, `Prisma`, `PostgreSQL`, `Redis`, `Docker`, `worker`, `frontend`, `backend`.

---

## 25. Consumidores de PostgreSQL

Escritores reales:

- Auth: `PrismaIdentityStore`, refresh SQL, MFA/passkeys/OAuth/linking en memoria con persistencia parcial.
- Tenancy: `PrismaTenancyStore`, `PrismaTenancyAuditSink`.
- TUS: `PrismaTus*Store`, `PrismaMarketplaceStore`, `PrismaServiceCalendarStore`, `PrismaTusFinanceStore`, WhatsApp/delivery/soporte/reporting Prisma.
- Lifecycle: pool + Prisma + verificación de `TusReadinessEvidence` y `TusReadinessDecision`.
- Migraciones: 30 archivos SQL, desde identidad hasta billing.

Lectores reales:

- Resolutores de sesión por digest SHA-256.
- Rutas auth/tenancy/TUS.
- Readiness y reporting.
- Health con `SELECT 1` e `information_schema`.

Arranque depende de PostgreSQL. Sin `DATABASE_URL` canónica no hay API. Fuente raíz: `.env` raíz, no variables ambiente dispersas.

---

## 26. Consumidores de MongoDB

- Conexión: `apps/api/src/infrastructure/database/mongodb/connection.ts` con Mongoose.
- Salud: `checkMongoDB()` en `/ready`.
- Apagado: `disconnectMongoDB()` registrado en lifecycle.
- Modelos Mongoose empresariales: sin evidencia.
- Adapters `in-memory-mongo` y `unavailable-mongo`: sin consumidores productivos.
- `projection-reconciler`, `mongo-session`, `tenant-filter`, `mongo-ownership`: sin CRUD productivo.
- Tests: `p2-mongo-ownership.test.mjs` como contrato, no como uso.
- Scripts/arranque: solo health/lifecycle.

Veredicto para decidir después, no ahora: MongoDB no es indispensable para el negocio actual. Puede hacerse opcional o eliminarse del arranque obligatorio. Si se conserva, debe ser solo para `owned_documents` o proyección explícita con ownership documentado. No debe levantarse infraestructura sin necesidad.

---

## 27. Consumidores de Redis

TypeScript:

- Cliente: `apps/api/src/infrastructure/database/redis/client.ts` con ioredis.
- Salud: `checkRedis()` con `PING`.
- Apagado: `disconnectRedis()`.
- Rate limiting: `rate-limit-redis` en middleware.
- Cola Redis real en API: sin evidencia.
- Caché/sesiones/locks/eventos en API: sin evidencia productiva.

Python:

- `WORKER_REDIS_URL`.
- `consumer.py` con `BLPOP` y `HSET`.
- Sin ack/retry/DLQ/run-ledger.
- Checkpointer Redis/Postgres no disponible.

Infra:

- Compose levanta Redis.
- Render declara Redis gestionado.
- Terraform tiene módulo `cache`.

Veredicto para decidir después: Redis solo está justificado hoy para rate limiting y readiness. Para colas/eventos/locks/caché empresarial no hay uso API demostrable. El uso Python está separado e incompleto. No debe conservarse como dependencia obligatoria hasta definir si el worker TUS lo necesita.

---

## 28. Consumidores del worker Python

- Contrato: `packages/contracts/schemas/workflow*`, `jobs/*`.
- API: no encola trabajos al worker en el arranque principal.
- Worker `main`: bloqueado o ejemplo si `WORKER_ENABLE_CONSUMER=false`.
- Consumidor Redis: separado, incompleto.
- Graph/base usa `ChatOpenAI`, aunque la arquitectura declara LangGraph como autoridad.
- Dockerfile incompleto.
- Comandos documentados inexistentes.
- Tests Python fuera del runner raíz y de CI.

Veredicto: es un servicio auxiliar declarado, no un runtime TUS activo. Conservar solo si se define su ownership durable, lease, DLQ, run-ledger y despliegue. Si no, archivar como prototipo.

---

## 29. Contratos duplicados

| Dominio | Fuentes | Problema | Propuesta |
|---|---|---|---|
| Usuario/cuenta/sesión | Prisma, auth domain, contracts, web/mobile clients | Tres lenguajes sin regla | Prisma + contracts como fuente |
| Tenant/membership | Prisma, tenancy, contracts | Riesgo de tenant huérfano | Prisma + contracts |
| Marketplace listing/merchant | Prisma, catalog service, contracts JSON | Lookup con bug potencial | Prisma + contracts + test tenant-scoped |
| Commitment | Prisma, domain, ports, contracts | Múltiples tipos | Contracts + Prisma |
| Pago/finanzas | Prisma, finance service, contracts payments | Provider real vs determinista | Contracts + adapter único |
| Delivery/POS | Prisma, delivery/pos services, contracts | Evidencia determinista vs autorizada | Contracts + Prisma |
| WhatsApp | Prisma, whatsapp service, contracts messaging | Webhook firmado vs fixture | Contracts + adapter único |
| Soporte | Prisma, support service, contracts | Caso/evidencia/timeline | Contracts + Prisma |
| Readiness | Prisma, readiness service, contracts | Gates locales vs live | Contracts + Prisma |
| Outbox/jobs | Prisma, platform jobs, contracts workflows | Tres semánticas | Una frontera |
| Assets | Storage package, API assets, backendFiles | Tres clientes | Un package + adapters |
| IA | ai-contracts, providers, registry, backendFiles | Schemas sin dueño | Unificar bajo AI platform explícita |
| UI | tus-ui, journeys, responsive, state views | Web/mobile duplican presentación | Contratos compartidos + componentes por plataforma |

---

## 30. Dependencias cruzadas

- API -> `contracts`, `config`, `zod-schemas`, `observability`, `errors`.
- Web -> `contracts`, `zod-schemas`.
- Mobile -> `contracts`.
- Web/mobile -> `apps/reference/api`, indebido.
- `backendFiles` -> `@repo/zod-schemas`, `@docphone/*`, inexistentes.
- `packages/*` entre sí: `workflows` declara pero no importa; `asset-pipelines` declara contracts pero no lo usa; `mercado-pago` depende de namespace inválido.
- `contracts` exporta desde `dist`, pero no hay `dist` versionado; riesgo de consumo sin build.
- API importa `@factory/errors` con historial de resolución pendiente.
- Prisma client generado en build; migraciones versionadas, pero con huecos de cobertura.

---

## 31. Propuesta de arquitectura simplificada

Arquitectura objetivo, sin sobrearquitectura:

```text
TUS Web --> API TUS --> PostgreSQL
TUS Mobile --> API TUS --> PostgreSQL
API TUS --> Redis solo si se justifica rate-limit/cola
API TUS --> Objetos B2/S3 solo si assets TUS lo requiere
API TUS --> Worker/cola solo si jobs durables lo requieren
API TUS --> Mercado Pago/WhatsApp solo tras evidencia autorizada
```

Principios:

- PostgreSQL como única fuente central.
- Menos paquetes, con responsabilidad clara.
- Ningún productivo depende de `reference`.
- Ningún `backendFiles` en el árbol final.
- In-memory solo para tests, no como persistencia sustituta.
- Cada adapter con una sola implementación productiva + fake de test.
- Cada interfaz con una sola implementación debe justificarse o colapsarse.
- Cada capa debe aportar comportamiento, no solo reexportar.

---

## 32. Propuesta de estructura final

```text
apps/
  api/
    src/
      tus/
      auth/
      tenancy/
      platform/
      providers/
      infrastructure/
      presentation/
    prisma/
  web/
  mobile/
  worker-python/  # solo si se justifica; si no, archivar
packages/
  contracts/
  config/
  errors/
  observability/
  neutral-contracts/  # nuevo, desde reference api
  providers/          # consolidado storage/queues/events/email si se justifican
  ui-contracts/       # opcional, si web/mobile lo usan realmente
  typescript-config/
  eslint-config/
docs/
  archivo/
  evidencia-historica/
scripts/
tests/
infra/
```

No crear 40 carpetas bonitas con los mismos 100 archivos desordenados. Reducir, fusionar y eliminar.

---

## 33. Archivos a conservar

Sin mover ni renombrar todavía, conservar:

- `apps/api/src/tus/**`.
- `apps/api/src/auth-security/**`.
- `apps/api/src/tenancy/**`.
- `apps/api/src/platform/configuration/**`, `lifecycle.ts`, `runtime.ts`.
- `apps/api/src/presentation/**`.
- `apps/api/src/infrastructure/database/prisma/*`, `postgres/*`.
- `apps/api/src/providers/mercado-pago/index.ts`, `providers/whatsapp/index.ts` como gates.
- `apps/api/prisma/schema.prisma` y migraciones aplicadas.
- `apps/api/package.json`, `Dockerfile`, `.env.example`.
- `apps/web/src/app/tus/**`, `lib/tus-*.ts`, `lib/api-*.ts`.
- `apps/mobile/src/application/tus-*.ts`, `presentation/*`, `core/config/*`, `core/services/*`.
- `packages/contracts/**` salvo artefactos generados.
- `packages/config/**`, `errors/**`, `observability/**`.
- `packages/typescript-config/**`, `eslint-config/**`.
- `scripts/test-runner*.mjs`, `postgres-seed.mjs`, `tus-migration-repair*.mjs`, `activation/*`, `audit/*`, `dev/native-profile.mjs`, `security/*`, `build-api.mjs`.
- `docs/architecture/*`, `data/ownership.md`, `deployment/tus-readiness.md`, `operations/*`, `runbooks/*`, `security/*`, `ai/*`, `rag/*` tras traducción.
- `docker-compose.yml`, `render.yaml`, `vercel.json`, `turbo.json`, `pnpm-workspace.yaml`, `Makefile`, CI.

---

## 34. Archivos a modificar

- `package.json` raíz: nombre, descripción y scripts worker inexistentes.
- `README.md`, `ARCHITECTURE.md`, `.ai-manifest.md`: reescritura total en español.
- `apps/api/package.json`: resolver `@factory/errors` y dependencias reales.
- `apps/web/package.json`, `apps/mobile/package.json`: tests no-op por suites reales o eliminación del script engañoso.
- `apps/mobile/app.config.ts`: identidad, nombres y assets.
- `apps/mobile/src/store/*` y servicios con `alqui`: renombrar.
- `apps/web/src/lib/neutral-contract-client.ts`: cambiar import a `packages/`.
- `apps/mobile/src/application/neutral-contract-client.ts`: cambiar import a `packages/`.
- `packages/mercado-pago/package.json` y README: namespace.
- `packages/contracts`: `$ref` roto, exports workflows, build.
- `packages/eslint-config/README.md`: `@repo`.
- `apps/api/prisma/*`: huecos de migración y bug marketplace, sin modificar esquema hasta backup y reparación aditiva.
- `apps/workflow-runtime-python/Dockerfile`, `README.md`, `pyproject.toml`: dependencias y comandos.
- `render.yaml`, `docker-compose.yml`, `.env.example`: nombres factory y flags documentados.
- `turbo.json`/CI: suites Python, mobile e integración.
- Lint mobile para excluir `dist/_expo`.
- `next-env.d.ts` y triple-slash en lint security.

---

## 35. Archivos a mover

| Origen | Destino propuesto |
|---|---|
| `apps/reference/api/src/index.ts` | `packages/neutral-contracts/src/index.ts` o similar |
| `backendFiles/src/ai/retry.ts`, `ai/http.ts` | `packages/providers/src/core/` tras unificación |
| `backendFiles/src/ai/groq.provider.ts`, `companion/adapters/groq-tts.ts` | `packages/providers/src/groq/` tras neutralización |
| `backendFiles/src/frontend-groq-audio/*` sano | `packages/audio-client/` o cliente web neutral |
| `backendFiles/src/integrations/storage.ts` | `packages/storage/` |
| `backendFiles/src/integrations/redis.ts` | `packages/queues/` o `packages/events/` |
| `backendFiles/src/privacy/anonymization.ts` | `apps/api/src/privacy/` |
| `backendFiles/src/utils/errors.ts`, `textCleaner.ts` | `packages/errors/` o utilidades neutrales |
| `backendFiles/*.md` de procedencia | `docs/reference/*` |
| Bloques Companion/médicos/DocPhone | `docs/reference/*` o archivo externo, fuera del runtime |
| `packages/ai-contracts/schemas/*` si se conservan | `packages/contracts/schemas/ai/*` o paquete con manifiesto |
| Fixtures reference útiles | `tests/fixtures/*` o `packages/contracts/fixtures/*` |

No mover `backendFiles` completo. Rescate selectivo.

---

## 36. Archivos a renombrar

- `product-factory-core` -> identidad TUS.
- `native-api-wrapper` / `native-web-wrapper` -> nombres TUS o eliminación.
- `@repo/mercado-pago` -> `@factory/mercado-pago` o `@tus/mercado-pago`.
- `@repo/typescript-config` en mercado-pago -> namespace vigente.
- Identificadores `alqui` -> `tus`.
- `Factory*`, `productfactory*`, `factory-*` -> `tus-*`.
- `backendFiles` -> no renombrar; eliminar tras rescate.
- `apps/reference` -> no renombrar como productivo; extraer contrato y archivar/ejemplos.
- `travelers_clean.sql`, `errorlogs.txt` -> no renombrar; archivar/eliminar.
- `apps/workflow-runtime-python` -> `apps/worker-python` solo si se conserva y se simplifica; si no, archivar.

---

## 37. Archivos a eliminar

Tras rescate y autorización, eliminar:

- Todo `apps/api/backendFiles/**`, 45 archivos.
- `travelers_clean.sql`.
- `errorlogs.txt`.
- `apps/workflow-runtime-python/build/lib/**`.
- `apps/workflow-runtime-python/src/workflow_runtime_python.egg-info/**`.
- `packages/contracts/src/streams.js`, `streams.d.ts`, `*.map`.
- `*.tsbuildinfo` versionados.
- `packages/zod-schemas/src/example.ts` si no se reemplaza por schemas reales.
- `packages/asset-pipelines`, `packages/workflows`, `packages/lifecycle` si no se adoptan.
- `packages/ai-contracts` del runtime si no recibe dueño; o mover schemas útiles.
- Variante antigua `apps/api/backendFiles/src/frontend-groq/**`.
- `utils/text.ts` redundante.
- `backend-reuse.ts` falso.
- `backend/`, `frontend/` si se confirma que son wrappers históricos.
- Carpetas vacías con solo README en API domain/application/infrastructure.
- `apps/web/src/store/example-store.ts`.
- Tests/telemetría duplicados, conservando una sola versión.
- Snapshots de auditoría que contradigan el estado, conservando trazabilidad en archivo.

No eliminar en esta fase. La lista es propuesta para ejecutar con backup y orden.

---

## 38. Carpetas a eliminar

Propuesta final, tras rescate:

- `apps/api/backendFiles/`.
- `apps/workflow-runtime-python/build/`.
- `apps/workflow-runtime-python/src/workflow_runtime_python.egg-info/`.
- `backend/` y `frontend/` si se confirma wrapper histórico.
- `packages/asset-pipelines/`, `packages/workflows/`, `packages/lifecycle/` si no se adoptan.
- `packages/ai-contracts/` del runtime si no recibe dueño.
- `packages/zod-schemas/` si se reemplaza por contratos reales.
- `apps/reference/fallback/` del runtime; conservar solo como fixtures o archivo.
- `apps/reference/` como dependencia productiva; conservar solo como ejemplos o eliminar.
- Carpetas vacías `domain/entities`, `domain/repositories`, `application/usecases`, `infrastructure/config` si no reciben código.
- `docs/evidence/*` obsoleta del árbol activo hacia `docs/archivo/`.
- `openspec/changes/*` verificados hacia `openspec/archive/`.

---

## 39. Tabla origen -> destino

| Origen | Destino | Cambio |
|---|---|---|
| `apps/reference/api/src/index.ts` | `packages/neutral-contracts/src/index.ts` | Mover + actualizar 2 importadores + tests/parity |
| `apps/web/src/lib/neutral-contract-client.ts` | mismo archivo, nuevo import | Modificar import |
| `apps/mobile/src/application/neutral-contract-client.ts` | mismo archivo, nuevo import | Modificar import |
| `backendFiles/src/ai/retry.ts` | `packages/providers/src/core/` | Mover + unificar + tests |
| `backendFiles/src/ai/http.ts` | `packages/providers/src/core/` | Mover + tests |
| `backendFiles Groq sano` | `packages/providers/src/groq/` | Adaptar + gates + tests |
| `frontend-groq-audio sano` | `packages/audio-client/` | Mover + contrato neutral |
| `integrations/storage.ts` | `packages/storage/` | Mover + tests aislamiento |
| `integrations/redis.ts` | `packages/queues/` | Mover + semántica durable |
| `privacy/anonymization.ts` | `apps/api/src/privacy/` | Adaptar + tests |
| `utils/errors.ts`, `textCleaner.ts` | `packages/errors/` o utilidad | Mover |
| DocPhone/Companion/médico | `docs/reference/` o archivo externo | Mover fuera del runtime |
| `packages/ai-contracts` útil | `packages/contracts/schemas/ai/` | Mover o dar manifiesto |
| Fixtures útiles | `tests/fixtures/` o contracts fixtures | Mover |
| `backendFiles/` restante | eliminado | Eliminar tras rescate |
| `travelers_clean.sql`, `errorlogs.txt` | archivo externo/eliminado | Eliminar del repo |
| Artefactos build/egg-info/maps/tsbuildinfo | eliminado/ignorado | Eliminar + gitignore |
| Wrappers backend/frontend | eliminado o renombrado | Eliminar/renombrar |
| Paquetes no adoptados | eliminado o fusionado | Eliminar/fusionar |
| Docs históricos | `docs/archivo/`, `openspec/archive/` | Archivar |
| Nombres factory/alqui/repo | nombres TUS | Renombrar |

---

## 40. Riesgo de cada modificación

| Modificación | Riesgo | Mitigación |
|---|---|---|
| Mover contrato neutral desde reference | Alto si rompe web/mobile/parity | Hacerlo como una sola unidad: mover + 2 importadores + parity + tests |
| Rescatar retry/HTTP/Groq | Medio: duplicar semántica | Unificar, no añadir segundo retry; tests de transporte fake |
| Mover audio-only | Medio: endpoints DocPhone hardcoded | Parametrizar endpoint/auth/contrato antes de conectar |
| Consolidar storage/queues/events/email | Alto: cambiar fronteras | Adoptar una frontera cada vez, con tests; no migrar todo junto |
| Renombrar `@repo` a `@factory/@tus` | Medio: lockfile y builds | Actualizar manifiesto + lockfile + imports + build |
| Renombrar factory/alqui/product | Bajo-medio: config y stores | Buscar todos los usos, migrar storage versionado con cuidado |
| Eliminar `backendFiles` | Alto si se hace antes del rescate | Eliminar solo al final, con checklist de rescate y sin consumidores |
| Eliminar Mongo/Redis del arranque | Alto: cambia despliegue y salud | Hacerlo opcional primero, con evidencia; no eliminar infraestructura sin prueba |
| Tocar Prisma/migraciones | Muy alto: pérdida o divergencia | Backup restaurable, migración aditiva, seed idempotente, cleanup etiquetado |
| Corregir bug marketplace | Medio: cambia consultas | Test tenant-scoped + migración/índice si hace falta |
| Archivar docs/OpenSpec | Bajo-medio: pérdida trazabilidad | Mover, no borrar; dejar índice `superseded` |
| Eliminar basura/artefactos | Bajo | Verificar `.gitignore` y que no sean outputs requeridos |
| Cambiar tests no-op | Bajo-medio: falsa confianza actual | Reemplazar por suites reales y jobs CI separados |
| Reescribir README/ARCHITECTURE | Bajo técnico, alto comunicación | Alinear con código y evidencia vigente |

---

## 41. Orden exacto recomendado para ejecutar la limpieza

1. Congelar punto de partida: tag/branch `pre-cambios`, backup PostgreSQL si existe, lista de archivos.
2. Reconciliar evidencia: qué snapshot es vigente, qué conteos son históricos, qué comandos sí existen.
3. Reescribir `README.md`, `ARCHITECTURE.md` y `.ai-manifest.md` en español alineados al código.
4. Corregir bloqueos de tooling: `@factory/errors`, namespace mercado-pago, `$ref` contracts, exports workflows, lint mobile, `dist/_expo`, security lint, `npm audit`.
5. Mover contrato neutral desde `apps/reference/api` a `packages/`, actualizar web, mobile, parity y tests. Verificar que ningún productivo importe `reference`.
6. Rescatar primitivas `backendFiles`: retry/HTTP, Groq, audio-only, storage, redis, privacidad, errores/texto. Cada rescate con tests y sin duplicar.
7. Archivar DocPhone/Companion/médico fuera del runtime, con procedencia.
8. Eliminar variante `frontend-groq` antigua y barrel roto.
9. Consolidar paquetes: decidir `storage/queues/events/email/providers/workflows/asset-pipelines/lifecycle/zod-schemas/ai-contracts/mercado-pago`. Fusionar o eliminar con pruebas.
10. Renombrar factory/alqui/repo/golden/travelers/médico en código, config, stores y docs.
11. Limpiar basura y artefactos: logs, SQL, build/lib, egg-info, maps, tsbuildinfo, ejemplo web, READMEs vacíos.
12. Archivar docs y OpenSpec históricos; traducir docs vigentes al español.
13. Separar suites tests/CI: Node, integración PostgreSQL, Python, mobile, paquetes. Eliminar no-ops engañosos.
14. Revisar persistencia: confirmar PostgreSQL canónica, hacer Mongo/Redis opcionales con evidencia, definir worker Python o archivarlo.
15. Revisar Prisma sin cambiar esquema: documentar huecos, bug marketplace, tenant huérfano, lecturas sin tenant.
16. Solo entonces, con backup y reparación aditiva: corregir migraciones/esquema si se autoriza.
17. Eliminar `apps/api/backendFiles/` completa.
18. Eliminar `apps/reference` como dependencia productiva; dejar ejemplos o eliminar.
19. Eliminar wrappers y carpetas vacías confirmadas.
20. Verificación final: build, typecheck, lint, contracts, tests, seguridad, conteo origen->destino y este informe actualizado.

---

## Resumen numérico

Conteos aproximados sobre 1147 archivos rastreados, excluyendo `.git`, `node_modules`, `.next`, `dist`, `.turbo` y `__pycache__`:

- Archivos revisados: **1147**.
- Conservar: **~820**.
- Modificar: **~120**.
- Mover: **~60**.
- Renombrar identidad/nomenclatura: **~80 menciones en ~40 archivos**.
- Eliminar: **~110**.
- Dudosos J: **~45**.
- Externos F: **~55**.
- Muertos G: **~95**.
- Duplicados H: **~50**.
- Incompletos I: **~70**.

Desglose operativo:

- `backendFiles`: 45 archivos a eliminar como carpeta tras rescate selectivo de ~15 archivos útiles.
- `reference`: 7 archivos; 1 contrato a mover a `packages/`, 6 ejemplos/fixtures a archivar o conservar fuera del runtime.
- `packages`: 17 directorios; 6 a conservar claro, ~11 a consolidar/mover/eliminar.
- Raíz basura: 2 archivos prioritarios (`errorlogs.txt`, `travelers_clean.sql`).
- Artefactos generados versionados: ~15 archivos/rutas.
- Tests no-op: 12 scripts.
- Modelos Prisma: ~95 modelos; 0 eliminaciones propuestas en esta fase, solo auditoría.
- Migraciones SQL: 30 archivos; conservar historial, corregir solo con reparación aditiva autorizada.

> Nota: son aproximaciones de auditoría. El número exacto final debe recalcularse al ejecutar la limpieza, porque un mismo archivo puede estar a la vez muerto, externo y duplicado. La regla sigue siendo que cada archivo conservado tenga responsabilidad, consumidor y pertenencia TUS demostrables.
