# Bloque 0: preparación y cierre de decisiones

**Fecha:** 2026-09-13
**Rama:** `normalizacion-espanol-tus`
**Estado:** análisis materializado; implementación no iniciada.

Este documento materializa el análisis dirigido del Bloque 0 de normalización al español de TUS. No modifica código, Prisma, PostgreSQL, contracts, Web, Mobile, tests ni scripts.

## Reglas

- El negocio propio de TUS se expresa en español.
- Los identificadores TypeScript objetivo no llevan tildes: `Habilitacion`, `Prestador`, `DecisionHabilitacion`.
- `Tenant` y `tenantId` permanecen como excepción técnica de aislamiento.
- `Job` técnico no es equivalente a `Trabajo` funcional.
- `POS`, `WhatsApp`, `OAuth`, `OIDC`, `MFA`, `API`, `HTTP`, `JSON`, `Prisma`, `PostgreSQL`, `Redis` y nombres externos se conservan.
- No se traducen automáticamente valores serializados, rutas, eventos, permisos ni códigos de error.
- Los términos ambiguos bloquean únicamente los bloques que dependen de ellos.
- Los renombres físicos futuros requieren backup restaurable, migración forward-only y verificación de integridad.

## Estado previo

- `docs/GLOSARIO_TUS.md` es la fuente normativa.
- `apps/api/backendFiles` y `apps/reference` ya fueron eliminados como superficies productivas.
- El registro sin `tenantId` crea `TusTenant`, `Organization`, `Workspace`, `TenantRole` y `Membership` en una transacción.
- Web usa rutas Marketplace bajo `/tus/v1/marketplace/*`.
- Las tablas de readiness existen desde `20260826090000_tus_readiness`.
- `TusListing.price` ya fue convertido a `BIGINT` en unidades menores mediante `20260911120000_tus_listing_price_minor`.

## 1. Organization frente a TusTenant

`Organization` y `TusTenant` se mantienen provisionalmente como conceptos separados. No deben unificarse, eliminarse ni tratarse como sinónimos durante la normalización hasta que exista evidencia que demuestre que representan la misma responsabilidad.

| Concepto | Responsabilidad | Ownership | Consumidores | Decisión |
| --- | --- | --- | --- | --- |
| `Tenant` | Aislamiento técnico y autorización | `tenantId` | Auth, tenancy y TUS | Mantener como límite técnico |
| `TusTenant` | Raíz persistente de agregados TUS | Su `id` | Bootstrap, catálogo, finanzas, POS | Mantener separado |
| `Organization` | Unidad funcional de usuarios y espacios | Su `id` | `TenancyService`, `PrismaTenancyStore` | Mantener separado |
| `Workspace` | Espacio funcional de una organización | `workspaceId` + `organizationId` | Membership, assets, notifications | Mantener separado |

El bootstrap usa inicialmente el mismo identificador para `TusTenant` y `Organization`; esa coincidencia no prueba identidad semántica.

Reglas:

- No usar `Organization` como sinónimo general de `Tenant`.
- No eliminar ni fusionar `TusTenant` y `Organization` en esta fase.
- El registro con `tenantId` solicitado debe validar existencia y autorización.

**ORGANIZATION Y TUSTENANT SE MANTIENEN SEPARADOS: SÍ**

## 2. Workspace y ownership

`TenantContext` y `TusAuthenticatedTenantContext` actuales no transportan `workspaceId`. Assets, notifications y `Membership` sí aplican límites de tenant y workspace.

| Agregado o módulo | `tenantId` | `workspaceId` | `organizationId` | Fuente | Consumidores | Decisión |
| --- | --- | --- | --- | --- | --- | --- |
| `Account`, `Session` | Sí | No | No | PostgreSQL | Auth y sesiones | Tenant como límite; derivar workspace cuando aplique |
| `RefreshTokenFamily` | Sí | No | No | SQL | Rotación preparada | Separado de `Session` |
| `Organization` | Implícito | No | Su propio ID | PostgreSQL | Tenancy | Agregado funcional separado |
| `Workspace` | No directo | Sí | Sí | PostgreSQL | Membership | Origen canónico del espacio |
| `Membership` | Dominio tenant | Sí | Sí | PostgreSQL | Autorización | Conservar ambos límites |
| Assets | Sí | Sí | No | `AssetStore` y B2 | `AssetService` | Ownership compuesto |
| Notifications | Sí | Sí | No | `NotificationStorePort` | `NotificationService` | Propagar ambos IDs |
| Catálogo y Mercado de servicios | Sí | No | No | `TusMerchant`, `TusListing`, productos y servicios | Marketplace, Web, Mobile | Tenant; workspace solo con ownership probado |
| Compromisos | Sí | No | No | `TusCommitment`, `TusMarketplaceCommitment` | Checkout, finance, delivery, support, WhatsApp | Tenant; validar workspace cuando corresponda |
| Reservas | Sí | No | No | `TusCalendar`, `TusBooking` | Calendario y Marketplace | Validar pertenencia antes de acceso por ID |
| Pagos | Sí | No | No | `TusPayment*`, ledger, snapshots | Finance y checkout | Tenant; no hacer workspace owner financiero |
| Delivery | Sí | No | No | `TusDelivery*` | Delivery y compromisos | Agregado operativo tenant-scoped |
| POS | Sí | No | No | `TusPos*` | Web, Mobile y tests | Tenant; workspace contextual para turno/local |
| Soporte | Sí | No | No | `TusSupport*` | Support y operaciones | Tenant; no autoriza settlement |
| WhatsApp | Sí | No | No | `TusWhatsApp*` | WhatsApp y providers | Tenant; respetar consentimiento externo |

Workspace debe propagarse al contexto y comandos TUS donde exista ownership funcional, pero no como columna obligatoria de todas las tablas. Universalizarlo sin evidencia agregaría complejidad sin beneficio.

**WORKSPACE DEBE PROPAGARSE A TUS: SÍ, PARCIAL Y CONTEXTUAL**

## 3. RefreshTokenFamily

| Aspecto | Hallazgo |
| --- | --- |
| Existencia física | Tabla creada por `apps/api/prisma/migrations/20260823130000_refresh_rotation/migration.sql` |
| Dominio | `apps/api/src/auth-security/domain/refresh.ts` |
| Persistencia | `PostgresRefreshRotationStore` SQL y store in-memory |
| Seguridad | `FOR UPDATE`, digest actual/usados, replay, revocación y outbox |
| Prisma | No existe `model RefreshTokenFamily` en `schema.prisma` |
| Consumidores | Stores, servicio y tests internos; no hay consumidor HTTP |
| Flujo público | `AuthService` solo emite `accessToken` |
| Endpoint | No existe `/auth/refresh` |
| Composición | No instancia `RefreshRotationService` |
| Clasificación | **PREPARADO PERO NO EXPUESTO** |

La capacidad fue construida como SQL especializado y aún no forma parte del flujo público. Antes de traducir identidad se debe decidir si será endpoint público o librería interna. Si se expone, deben conectarse composición, contrato, endpoint, sesión completa y pruebas de reinicio/concurrencia. La incorporación posterior a Prisma debe reflejar los campos físicos reales y verificarse contra drift.

No renombrar tabla, columnas ni eventos `auth.refresh_rotated` y `auth.refresh_family_compromised`.

## 4. Matriz monetaria

No hay `DOUBLE PRECISION`, `Float` ni `Decimal` activos en el `schema.prisma` revisado. El residual es la mezcla entre `number`, `bigint` y unidades mayores/menores.

| Modelo o tabla | Campo | Tipo BD | Tipo TS | Moneda | Unidad interna | Unidad HTTP | Conversión | Riesgo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `TusListing` | `price` | `BIGINT` | `number`, `priceMinor: bigint` | `currency` | Menor | Mayor | Normalización/proyección pública | Mezcla de unidades |
| `TusMarketplaceCommitment` | `amount` | `BIGINT` | `number` y snapshots `bigint` | `currency` | Menor | Mayor | Precio menor por cantidad | Serialización `BigInt` |
| `TusCommitment` | `amount` | `BIGINT` | `number` | `currency` | Menor pretendida | Numérica | Adapter seguro | Validación no uniforme |
| `TusCommitmentCompensation` | `amount` | `BIGINT` | `number` | `currency` | Menor pretendida | Numérica | Pendiente | Entero seguro |
| `TusPaymentIntent` | `amount` | `BIGINT` | `number` | `currency` | Menor | Finance | Conversión segura | `MAX_SAFE_INTEGER` |
| `TusCommissionSnapshot` | Importes bruto, deducciones, base, comisión y neto | `BIGINT` | `number` | `currency` | Menor | Snapshot financiero | Adapter `number()` | Exactitud |
| `TusLedgerEntry` | `amount` | `BIGINT` | `number` | `currency` | Menor | No primario | Conversión segura | Append-only |
| `TusReconciliationRecord` | `providerAmount` | `BIGINT` | `number` | `currency` | Menor | Conciliación | Conversión segura | Diferencia externa |
| `TusInvoice` | `subtotal`, `taxAmount`, `feeAmount`, `total` | `BIGINT` | Billing | `currency` | Histórica/mixta | Pendiente | No convertir ahora | Campos duales |
| Billing | `*Minor`, `unitMinor`, `amountMinor` | `BIGINT` | `bigint` | `currency` | Menor | Pendiente | Proyección futura | Billing no expuesto |
| `TusPosOperation` y `TusPosReceipt` | `amount` | `BIGINT` | `number` | `currency` | Menor | POS numérica | Entero seguro | Offline/replay |
| `TusSupportCompensation` | `amount` | `BIGINT` | `number` | ARS actual | Menor pretendida | Support numérica | Validación finita | Menor rigor |
| `TusDelivery*` | Ningún importe owner | No aplica | Referencias `number` | Compromiso | No owner financiero | No aplica | No aplica | No reclamar settlement |

Decisión: no convertir datos ni renombrar campos monetarios ahora. Cada cambio futuro debe declarar moneda, unidad, redondeo y límite seguro.

## 5. Rutas `/tus/*` y `/tus/v1/*`

`/tus/v1/*` es canónico cuando existe. Los aliases permanecen hasta migrar consumidores y demostrar cero uso. **CONSUMO EXTERNO NO DETERMINABLE**.

| Ruta o familia | Estado | Web | Mobile | Tests/scripts | Compatibilidad | Retiro |
| --- | --- | --- | --- | --- | --- | --- |
| `/tus/checkout` | Legacy sin v1 equivalente | No | No | p8/p9 | Mantener contrato | Futuro |
| `/tus/commitments/:id` | Legacy sin v1 equivalente | No | No | Commerce/identity | Definir destino | Futuro |
| `/tus/v1/commitments/*` y `/tus/commitments/*` | v1 + alias | No | No | Tests HTTP | Payload idéntico | Sí |
| `/tus/v1/marketplace/*` y `/tus/marketplace/*` | v1 + alias reescrito | Discovery, operations, commitments, checkout | No explícito | p7/p8/p9, smoke | Mantener reescritura | Sí, aliases |
| `/tus/v1/calendar/*` | Solo v1 | No explícito | No explícito | Integración booking | Mantener | No inmediata |
| `/tus/v1/finance/*` y `/tus/finance/*` | v1 + alias | No explícito | No explícito | p8 finance | Mantener respuestas | Sí, aliases |
| `/tus/v1/delivery/*` y `/tus/delivery/*` | v1 + alias | No explícito | No explícito | p8/p9, runner | Migrar tests | Sí, aliases |
| `/tus/v1/pos/*` y `/tus/pos/*` | v1 + alias | Web usa alias | POS v1 | p8/p9, durable | Migrar Web | Sí, aliases |
| `/tus/v1/whatsapp/*` y aliases | v1 + aliases | Handoff v1 | No explícito | Tests WhatsApp | Nombres externos intactos | Selectivo |
| `/tus/v1/support/*` y `/tus/support/*` | v1 + alias | No explícito | No explícito | p9 support | Mantener | Sí, alias |
| `/tus/v1/reports/operations` y `/tus/reports/operations` | v1 + alias | Sí | No explícito | p9 operations | Mantener | Sí, alias |
| `/tus/seo/*` | Solo legacy | Metadata indirecta | No | Sin consumidor directo | Definir contrato | Pendiente |

No retirar aliases ni cambiar rutas en este bloque. `/tus/v2/*` es rechazado por el router.

## 6. Service Capture

No existe un tipo formal llamado `Service Capture`. `manual-service` significa registro manual de una operación comercial de servicio en POS.

- `manual-sale` exige `context: product`.
- `manual-service` exige `context: service`.
- Se persisten monto, moneda, dispositivo, turno, idempotencia y líneas opcionales.
- Produce operación POS, comprobante `accepted`, auditoría, outbox y avance de versión del turno.
- El comprobante fija `providerCapture: not-claimed` y `settlement: not-claimed`.
- No crea reserva, booking, evidencia financiera, ejecución del servicio ni liquidación.
- Web, Mobile y tests lo mantienen separado de la venta de producto.

**MANTENER PENDIENTE** como nombre formal. Describirlo provisionalmente como “operación de punto de venta de servicio”.

## 7. Checkout

```text
carrito
→ autenticación y tenant derivados de sesión
→ validación de autoridad, líneas, hash e idempotencia
→ validación de listing, merchant, política, precio y disponibilidad
→ reserva de stock o capacidad cuando corresponde
→ creación de compromisos
→ auditoría y referencias
→ outbox
→ respuesta executed/replay
```

El flujo está en `TusApplicationService.checkout` y `TusMarketplaceService.checkout`. Usa idempotencia por tenant, clave y hash. El pago real está separado y bloqueado por gates/provider.

`ConfirmacionCompra` sirve como texto visible de finalización, pero es estrecho como nombre interno porque el flujo también crea compromisos y reserva disponibilidad para productos y servicios.

**Decisión:** conservar `Checkout` por compatibilidad y usar `ConfirmacionCompra` solo en interfaz o caso de uso visible hasta definir un nombre interno más preciso.

## 8. Disposition

En `TusReadinessDecision` significa:

- `authorized`: habilitado, no determinista, sin gates fallidos y con evidencia externa autorizada.
- `disabled`: bloqueado fail-closed por evidencia faltante, inválida, expirada, revocada, conflictiva o rollback.
- `unavailable-deferred`: diferido por evidencia local, determinista o provider no disponible.

No es un sinónimo global de `ResultadoHabilitacion`: los scripts de activación también usan `authorized-live`, y los planes operativos usan `disabled` con otro sentido.

**Decisión:** traducirlo como `ResultadoHabilitacion` únicamente dentro del agregado de habilitación. Mantener los valores serializados actuales.

## 9. Contracts y compatibilidad

`packages/contracts` es la fuente canónica. `contractVersion` vigente: `1.0.0`.

| Cambio | Estrategia |
| --- | --- |
| Rename interno TypeScript sin cambiar payload | `CAMBIO DIRECTO` |
| Propiedad JSON incompatible | `ALIAS TEMPORAL` o `NUEVA VERSION` |
| Estado serializado incompatible | `NUEVA VERSION` |
| Ruta incompatible | `ALIAS TEMPORAL`, medición y retiro |
| Nombre o propiedad de provider externo | `MANTENER` |
| Nombre físico PostgreSQL | Migración futura explícita |

No cambiar `contractVersion`, estados, eventos, permisos ni envelopes por traducir nombres internos. Los bindings TypeScript/Python y las fixtures deben seguir validándose juntos.

## 10. @factory

### Mantener

- `@factory/contracts`, `@factory/config`, `@factory/errors`, `@factory/observability`.
- `@factory/typescript-config` y `@factory/eslint-config`.
- `FACTORY_PROFILE`, usado por configuración, scripts, Compose y gates.

### Renombrable a TUS, con migración

- `product-factory-core`.
- `native-api-wrapper` y `native-web-wrapper`.
- `product-factory-*`, `factory-api`, `factory-web`, `factory-workflow-worker`.
- `factory_local`, `factory_user`, `factory_password`.
- `com.productfactory.core*`, `Factory Dev`, `Factory Staging`, `Factory` y slug Mobile.
- Paquetes `@factory/*` sin consumidor runtime, después de resolver ownership y lockfile.

No cambiar ninguno en este bloque. Un futuro namespace `@tus/*` requiere coordinación de manifests, lockfile, imports, builds y despliegues.

## 11. alqui Mobile

| Clave | Escritura/lectura | Almacenamiento | Contenido | Riesgo | Estrategia futura |
| --- | --- | --- | --- | --- | --- |
| `alqui:<profile>:zustand:app` | `app-store.ts` | MMKV cifrado | Perfil, auth, red, settings, POS | Alto | Lectura legacy y copia a `tus:*` |
| `alqui:<profile>:tanstack:query` | `query-client.ts` | MMKV cifrado | Caché serializada | Medio | Migrar o invalidar explícitamente |
| `alqui-<profile>-<namespace>` | `mmkv-storage.ts` | MMKV | Namespaces | Alto | Lectura dual durante una versión |
| `alqui.<profile>.auth.accessToken` | `secure-credential-store.ts` | Expo SecureStore | Token de acceso | Muy alto | Migración atómica |
| `alqui.<profile>.auth.refreshToken` | `secure-credential-store.ts` | Expo SecureStore | Token de renovación | Muy alto | Migrar junto con refresh |
| `alqui.<profile>.auth.expiresAt` | `secure-credential-store.ts` | Expo SecureStore | Expiración | Alto | Migrar junto con credenciales |
| `alqui.<profile>.mmkv.encryptionKey` | `secure-credential-store.ts` | Expo SecureStore | Clave de cifrado MMKV | Muy alto | Conservar clave; no regenerar sin re-encriptar |
| `alqui:<profile>:tus-pos` | `tus-client.ts` y cola POS | MMKV cifrado | Operaciones offline/cuarentena | Alto | Validar tenant, perfil y schema |
| `alqui` | `axios-api-client.ts` | Memoria | Metadata Axios | Bajo | Renombrar solo como metadata futura |

No modificar Mobile ni claves persistentes en este bloque.

## 12. SQL fuera de Prisma

| Objeto | Tabla | Finalidad | Depende del nombre físico | Acción futura |
| --- | --- | --- | --- | --- |
| FKs `NOT VALID` tenant | `TusTenant`, identidad, catálogo, finanzas, POS, delivery, billing | Enforcement de ownership | Sí | Auditar huérfanos y validar con autorización |
| Checks POS | `TusPosOperation`, `TusPosReceipt` | Separa venta/servicio, importes y settlement | Sí | Mantener valores actuales |
| Checks delivery | `TusDeliveryTask` | Settlement no reclamado | Sí | Mantener |
| Check de inmutabilidad | `TusLedgerEntry` | Ledger inmutable | Sí | Mantener con trigger |
| Trigger append-only | `TusLedgerEntry` | Bloquea UPDATE/DELETE | Sí | Usar entradas compensatorias |
| Trigger historial billing | Tablas billing | Bloquea mutaciones históricas | Sí | Mantener antes de exponer billing |
| Índices de digest | `RefreshTokenFamily` | Unicidad y búsqueda de tokens | Sí | Verificar drift con Prisma futuro |
| SQL raw idempotencia | `IdempotencyRecord` | Replay por tenant/key | Sí | Mantener y probar en PostgreSQL |
| SQL raw outbox | `OutboxEvent` | Claim, publicación y recuperación | Sí | Centralizar writer con columnas reales |
| SQL raw run ledger | `RunLedger` | Estado e idempotencia de ejecuciones | Sí | Mantener y verificar migración |
| SQL raw refresh | `RefreshTokenFamily`, `Session` | Locking, rotación y revocación | Sí | Resolver outbox antes de exponer |
| SQL raw legacy `Inventory` | `Inventory` | Locks, bulk, agregados y búsqueda | Sí | Reconciliar con `TusInventory` o retirar |
| Predicado raw Membership | `Membership` | Autorización tenant | Sí | Revisar contra schema antes de activar |

Hallazgos técnicos pendientes que no se corrigen aquí:

- El SQL raw de `Membership` referencia `tenantId`, aparentemente desalineado con el schema actual, que usa `organizationId` y `workspaceId`.
- El writer SQL de refresh puede intentar insertar en `OutboxEvent` sin completar columnas obligatorias actuales como `tenantId`, `status`, `availableAt` y `createdAt`.
- Existen FKs `NOT VALID` sin `VALIDATE CONSTRAINT` localizado.

## 13. Primer bloque real elegido

**Readiness → Habilitación**, limitado a identificadores internos no persistidos y sin cambiar contratos ni valores serializados.

### Archivos exactos

- `apps/api/src/tus/readiness/index.ts`
- `apps/api/src/tus/domain/readiness.ts`
- `tests/foundation/p8-tus-readiness.test.mjs`
- `tests/foundation/p8-tus-deployment.test.mjs`
- `tests/foundation/p6-readiness.test.mjs`

### Identificadores candidatos a cambiar

- `TusReadinessGuard` → `GuardHabilitacion`.
- `TusReadinessEvidence` → `EvidenciaHabilitacion` en tipos internos no públicos.
- `TusReadinessDecision` → `DecisionHabilitacion` en tipos internos no públicos.
- `readinessGuard` → `guardHabilitacion` donde no cruce una frontera de compatibilidad.

### Identificadores que deben permanecer

- `contractVersion` y versión `1.0.0`.
- `authorized`, `disabled`, `unavailable-deferred`.
- Tablas, columnas, migraciones, rutas, eventos, permisos y envelopes.
- Imports y exports externos hasta actualizar consumidores en una unidad posterior.

### Contracts y rutas

- No modificar `packages/contracts` en el primer bloque.
- No modificar JSON Schema ni valores de `Disposition`.
- No cambiar `/tus/*` ni `/tus/v1/*`.
- No retirar aliases.

### Tests y verificaciones

```text
corepack pnpm run contracts:validate
corepack pnpm --filter @factory/api run typecheck
node --test tests/foundation/p8-tus-readiness.test.mjs
node --test tests/foundation/p8-tus-deployment.test.mjs
git diff --check
```

### Riesgo

Medio: Readiness atraviesa Marketplace, compromisos, finanzas, delivery, POS, soporte y WhatsApp. El riesgo se limita al renombrar tipos internos por agregado, conservar aliases y ejecutar tests focales antes de avanzar.

### Documento de salida

El bloque debe producir una matriz de nombres actual/objetivo/capa/consumidor/compatibilidad y una decisión de ownership `tenantId`/`workspaceId`, sin alterar persistencia ni contratos.

## 14. Decisiones abiertas

- Relación final entre `Organization` y `TusTenant`; hasta entonces permanecen separados.
- Lista definitiva de agregados TUS workspace-scoped; la propagación es parcial y contextual.
- Incorporación de `RefreshTokenFamily` a Prisma y eventual endpoint `/auth/refresh`.
- Corrección futura del writer de outbox de refresh.
- Nombre formal de `Service Capture`; por ahora queda pendiente.
- Nombre interno más preciso para el flujo `Checkout`.
- Migración de `number` a representación exacta en TypeScript para dinero.
- Retiro de aliases después de migrar consumidores y medir cero tráfico.
- Migración del namespace `@factory` a TUS.
- Migración compatible de claves persistentes `alqui` a `tus`.
- Reconciliación del SQL raw de `Membership` y del módulo legacy `Inventory`.

## Estado del Bloque 0

- No se implementó Readiness/Habilitación.
- No se modificó ningún contrato, ruta, estado, tabla, columna ni clave persistente.
- No se ejecutaron servidores, migraciones ni providers.
- El único archivo producido por esta fase es este documento.
