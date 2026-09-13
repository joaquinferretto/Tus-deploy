# Plan de normalizacion al espanol de TUS

**Fecha:** 2026-09-12
**Rama:** `normalizacion-espanol-tus`
**Alcance:** planificacion y decisiones; no implementa renombres ni migraciones.

## 1. Objetivo

Normalizar al espanol el dominio propio de TUS sin romper:

- aislamiento por `tenantId`;
- datos persistidos y migraciones ya aplicadas;
- contratos Web, Mobile, API y worker;
- rutas, estados y eventos que ya tienen consumidores;
- integraciones externas;
- trazabilidad, idempotencia y seguridad.

El resultado esperado es un repositorio donde el negocio propio use vocabulario espanol, mientras que los nombres tecnicos, externos y los limites de compatibilidad permanezcan intactos cuando sea necesario.

Este documento convierte el inventario previo en decisiones ejecutables. No autoriza por si mismo cambios de codigo, Prisma, PostgreSQL, contratos, rutas, configuracion, secretos ni infraestructura.

## 2. Reglas de trabajo

- Una responsabilidad debe tener un solo nombre canonico por capa.
- No traducir por similitud textual; confirmar primero la responsabilidad funcional.
- Los identificadores de TypeScript se escribiran en espanol sin tildes.
- Los nombres visibles pueden usar tildes.
- `Tenant` y `tenantId` permanecen como excepcion tecnica de aislamiento.
- `Job` tecnico no se traduce como `Trabajo` funcional.
- `Marketplace` se reemplaza por `MercadoServicios` en el dominio propio, pero no se cambia de golpe una ruta publicada.
- `POS`, `WhatsApp`, `OAuth`, `OIDC`, `MFA`, `API`, `HTTP`, `JSON`, `Prisma`, `PostgreSQL`, `Redis`, `Docker` y nombres exigidos por terceros se conservan.
- Los valores serializados propios solo se cambian con version de contrato, migracion de datos y consumidores identificados.
- Las columnas y tablas actuales no se renombran por cambiar el modelo Prisma. Todo cambio fisico requiere migracion nueva, backup restaurable y preservacion de PK, FK, indices y uniques.
- No crear una entidad, tabla, endpoint o funcionalidad solo porque aparezca en el glosario.

## 3. Estado actual verificado

### 3.1. Trabajo ya realizado

- `docs/GLOSARIO_TUS.md` existe como fuente normativa inicial.
- El glosario separa `Trabajo` funcional de `Job` tecnico.
- El glosario fija `/mercado-servicios` como destino funcional de `Marketplace`.
- `apps/api/backendFiles` ya no existe en la rama actual. Su eliminacion fue registrada en el commit `47a89a3`.
- `apps/reference` ya no existe en la rama actual. Los importadores productivos a esa carpeta fueron eliminados en la limpieza previa.
- El bootstrap de registro sin `tenantId` crea en una transaccion la raiz `TusTenant`, `Organization`, `Workspace`, `TenantRole` y `Membership` en `PrismaIdentityStore.bootstrapTenant`.
- La Web usa actualmente `/tus/v1/marketplace/discovery`, `/tus/v1/marketplace/merchant/operations` y `/tus/v1/marketplace/customer/commitments`.
- La tabla `RefreshTokenFamily` existe mediante SQL y su rotacion tiene locking, deteccion de replay, revocacion de sesiones y outbox.
- Las tablas `TusReadinessEvidence` y `TusReadinessDecision` existen desde la migracion `20260826090000_tus_readiness`; las referencias que decian que faltaban son historicas y deben marcarse como obsoletas.
- `TusListing.price` ya fue convertido a `BIGINT` en unidades menores por `20260911120000_tus_listing_price_minor`.

### 3.2. Baseline que no debe confundirse con el plan

- `PostgreSQL` es la fuente de verdad persistente de identidad, tenant y dominio TUS.
- `TUS_ROUTES_ENABLED` controla el montaje HTTP del negocio y puede estar apagado en despliegues.
- `TUS_PROVIDER_ACTIONS_ENABLED` controla las acciones de providers externos.
- Finanzas permanece determinista y sin captura real mientras el provider y los gates no esten autorizados.
- `contractVersion` vigente para TUS es `1.0.0`.
- Los contratos JSON se validan con `additionalProperties: false` salvo excepciones explicitas.
- Las pruebas de memoria prueban dominio y contratos, no sustituyen una prueba de durabilidad PostgreSQL.

## 4. Decisiones de dominio

### 4.1. Tenant, organizacion y espacio de trabajo

**Decisión:** mantener tres conceptos con responsabilidades distintas hasta completar una migracion de identidad autorizada.

`Organization` y `TusTenant` se mantienen provisionalmente como conceptos separados. No deben unificarse, eliminarse ni tratarse como sinonimos durante la normalizacion hasta que exista evidencia que demuestre que representan la misma responsabilidad.

| Concepto | Responsabilidad | Nombre normativo | Estado actual |
| --- | --- | --- | --- |
| Tenant | Aislamiento tecnico de datos y autorizacion | `Tenant`, `tenantId` | Usado por TUS y mantenido como excepcion |
| Organization | Unidad funcional que agrupa usuarios y espacios | `Organization` por ahora; objetivo `Organizacion` | Modelo Prisma activo |
| Workspace | Espacio funcional dentro de una organizacion | `Workspace`; objetivo `EspacioTrabajo` | Modelo Prisma y servicios activos |

Reglas:

- No usar `Organization` como sinonimo general de `Tenant`.
- No eliminar `TusTenant` ni `Organization` en esta fase.
- No unificar `Organization` y `TusTenant` ni tratarlos como sinonimos sin evidencia de que representan la misma responsabilidad.
- Para tenants nuevos, conservar el mismo identificador como correlacion tecnica solo mientras se documente que son raices distintas.
- El camino de registro con `tenantId` solicitado debe validar que el tenant existe y que la incorporacion esta autorizada; no debe permitir seleccionar arbitrariamente un tenant desde el payload publico.
- `TenantContext` actual solo expresa tenant, actor y correlacion. La propagacion de `workspaceId` debe ser una decision separada antes de convertir `Workspace` en frontera obligatoria.

**Criterio de cierre:** existe una matriz que muestra para cada agregado si su ownership es `tenantId`, `workspaceId` o ambos, con pruebas de aislamiento para dos tenants y dos espacios.

### 4.2. Familia de tokens de renovacion

**Decisión:** normalizar el concepto en documentacion y tipos nuevos como `FamiliaTokenRenovacion`, pero no renombrar aun la tabla ni los eventos de seguridad.

Estado observado:

- `RefreshTokenFamily` esta creado en PostgreSQL por SQL.
- `schema.prisma` no declara el modelo.
- `RefreshRotationService` y `PostgresRefreshRotationStore` existen.
- La composicion principal expone Auth, pero no se encontro un flujo HTTP de refresh conectado a `RefreshRotationService`.
- La tabla guarda `lastRotationIdempotencyKey`, `lastPresentedTokenDigest` y `lastReplacementAccessTokenDigest`, que no forman parte del modelo Prisma.

Plan:

1. Mantener SQL como fuente actual y no generar una migracion destructiva para "alinear" Prisma.
2. Decidir si la rotacion sera una capacidad Auth publica o solo una libreria preparada.
3. Si se vuelve publica, conectar composicion, endpoint, contratos y pruebas de reinicio/concurrencia en una misma unidad.
4. Si se incorpora el modelo Prisma, hacerlo con los campos reales y una verificacion de drift contra la tabla existente.
5. Conservar `auth.refresh_rotated`, `auth.refresh_family_compromised` y los nombres de columnas existentes durante la transicion.

**Criterio de cierre:** una prueba durable demuestra rotacion atomica, idempotencia, replay, revocacion de familia, revocacion de dispositivo y outbox transaccional.

### 4.3. Prestador, comerciante y cliente

- `Provider` se normaliza como `Prestador`.
- `Merchant` se normaliza como `Comerciante` cuando significa el actor que administra una oferta.
- `Customer` se normaliza como `Cliente` cuando significa quien busca, reserva o recibe.
- No usar `Proveedor` para `Provider`; puede confundirse con un integrador externo.
- No crear un modelo `Customer` solo para traducir una etiqueta. Hoy el rol se expresa mediante cuenta, tenant, compromiso y contexto de marketplace.

### 4.4. Producto, servicio y captura de servicio

- `Product` -> `Producto`.
- `Service` -> `Servicio`.
- `Listing` -> `Publicacion`.
- `manual-sale` y `manual-service` permanecen como valores contractuales actuales.
- `context: product` y `context: service` permanecen como valores contractuales actuales.
- `Service Capture` queda pendiente. El texto actual de POS separa ventas de productos y capturas de servicios, pero no prueba si captura significa registro, inicio, toma o cumplimiento.

No elegir `CapturaServicio`, `RegistroServicio` ni `InicioServicio` hasta identificar:

- la operacion que se crea;
- el agregado que la persiste;
- el actor que la confirma;
- el estado que produce;
- los consumidores Web, Mobile y reporting.

### 4.5. Checkout, compromiso y reserva

| Termino | Decisión | Motivo |
| --- | --- | --- |
| `Checkout` | `ConfirmacionCompra` solo en una superficie de compra; mantener el identificador durante compatibilidad | El flujo crea compromisos y reserva capacidad, no solo un pago |
| `Commitment` | `Compromiso` | Es una obligacion comercial persistida y no es una reserva |
| `Booking` | `Reserva` | Bloquea un slot de calendario |
| `Settlement` | `Liquidacion` | Distribuye o cierra importes; no es el cobro |
| `Payment` | `Pago` | Representa cobro o movimiento de pago |

El endpoint actual `/tus/v1/marketplace/checkout` no se renombra en el primer bloque. Primero se documenta el contrato semantico; un cambio de ruta requiere alias, consumidor, fecha de retiro y prueba de no uso.

### 4.6. Habilitacion y `Disposition`

- `Readiness` -> `Habilitacion` en dominio y documentacion.
- `ReadinessEvidence` -> `EvidenciaHabilitacion`.
- `ReadinessDecision` -> `DecisionHabilitacion`.
- `Disposition` se interpreta como resultado de habilitacion solo en `TusReadinessDecision`.
- Los valores actuales `authorized`, `disabled` y `unavailable-deferred` no se traducen aun: son parte del contrato `1.0.0`.
- `authorized` requiere evidencia permitida, sin gates fallidos y sin contradicciones.
- `disabled` expresa que la capacidad esta deliberadamente deshabilitada.
- `unavailable-deferred` expresa que la operacion se difiere por evidencia o provider no disponible.

### 4.7. Dinero

**Decisión:** no hacer una traduccion global de importes hasta terminar la matriz de unidades.

- PostgreSQL TUS usa `BIGINT` en los agregados financieros actuales.
- Los contratos HTTP exponen valores JSON compatibles con `number` en unidades principales.
- `TusListing.price` se almacena en unidades menores y se proyecta publicamente en unidades principales.
- Persisten columnas historicas y campos duales como `amount`, `subtotalMinor`, `totalMinor`; cada uno debe clasificarse antes de renombrar.
- Nunca convertir dinero por coercion generica ni por `parseFloat`.
- Cada importe debe documentar moneda, unidad interna, unidad publica y redondeo.

**Criterio de cierre:** cada campo monetario de Prisma, dominio y contrato tiene una fila de ownership/unidad y una prueba de ida y vuelta para ARS.

## 4.8. Matriz de los 14 frentes

| # | Frente | Estado | Salida requerida |
| --- | --- | --- | --- |
| 1 | Glosario y vocabulario | Definido en `docs/GLOSARIO_TUS.md` | Glosario aprobado y sin sinonimos contradictorios |
| 2 | Frontera negocio/tecnica | Parcial | Lista de terminos que no se traducen |
| 3 | `Tenant` y aislamiento | Definido como raiz tecnica | Matriz de ownership y pruebas cross-tenant |
| 4 | `Organization` frente a `TusTenant` | Pendiente de consolidacion | Decision de coexistencia, proyeccion o unificacion |
| 5 | `Workspace` | Activo, pero con contexto incompleto | Regla de propagacion de `workspaceId` |
| 6 | Refresh rotation | Implementacion SQL preparada, no expuesta por HTTP | Decision de activacion y prueba durable |
| 7 | `Service Capture` | Semantica insuficiente | Nombre elegido solo despues de rastrear el agregado |
| 8 | `Checkout`, compromiso y reserva | Responsabilidades diferenciadas | Mapa de casos de uso y aliases |
| 9 | `Readiness` y `Disposition` | Contrato activo en ingles | Traduccion de dominio sin cambiar valores `1.0.0` |
| 10 | Prestador, comerciante y cliente | Vocabulario elegido | Aplicacion consistente por agregado |
| 11 | Dinero y unidades | `BIGINT` persistente, contratos numericos | Matriz monetaria por campo |
| 12 | Contratos y version | `1.0.0` vigente | Schemas, bindings y consumidores alineados |
| 13 | Rutas y compatibilidad | `/tus/v1/*` canonico, aliases activos | Inventario de consumidores y retiro controlado |
| 14 | Legacy, Mobile y documentacion | Limpieza parcial ya hecha | Migracion de claves, referencias historicas y verificacion final |

La matriz evita que una traduccion de interfaz se convierta accidentalmente en una migracion de datos o en un cambio de contrato.

## 5. Contratos, rutas y compatibilidad

### 5.1. Fuente canonica

`packages/contracts` es la fuente canonica de contratos publicos versionados. El esquema Prisma es la fuente de persistencia; no sustituye los contratos HTTP.

Reglas:

- `contractVersion` permanece en `1.0.0` hasta que exista una incompatibilidad real.
- Los nombres de propiedades publicas no se cambian solo para traducirlos.
- Los bindings TypeScript y Python deben validarse contra los mismos JSON Schema.
- `packages/contracts/src/tus.ts` es la frontera de validacion semantica TUS.
- Toda nueva propiedad requiere schema, binding, consumidor y prueba.
- Un renombrado incompatible debe introducir version nueva o alias explicitamente temporal.

### 5.2. Rutas

La ruta funcional canonica actual es `/tus/v1/*`. La traduccion de nombres de dominio no autoriza a cambiarla automaticamente.

Rutas de marketplace verificadas:

```text
POST /tus/v1/marketplace/onboarding
POST /tus/v1/marketplace/listings
POST /tus/v1/marketplace/listings/:listingId/publish
GET  /tus/v1/marketplace/discovery
GET  /tus/v1/marketplace/merchant/operations
GET  /tus/v1/marketplace/customer/commitments
POST /tus/v1/marketplace/checkout
```

Los aliases `/tus/marketplace/*`, `/tus/commitments/*`, `/tus/finance/*`, `/tus/delivery/*` y `/tus/pos/*` son compatibilidad interna actual. Antes de retirarlos se debe medir uso y actualizar clientes.

### 5.3. Estados y eventos

- No traducir valores actuales de estados, eventos outbox, permisos ni codigos de error en una pasada de identificadores.
- `manual-sale`, `manual-service`, `product`, `service`, `authorized`, `disabled` y `unavailable-deferred` permanecen en contratos actuales.
- La traduccion visible se realiza en Web/Mobile sin alterar el valor transportado.
- Eventos externos de Mercado Pago y WhatsApp conservan exactamente el formato del proveedor.

## 6. Inventario por superficie

| Superficie | Fuente actual | Accion primera | Riesgo |
| --- | --- | --- | --- |
| Glosario | `docs/GLOSARIO_TUS.md` | Mantener y revisar decisiones pendientes | Bajo |
| Dominio API TUS | `apps/api/src/tus/**` | Renombrar por agregado, con tests de contrato | Alto |
| Auth y seguridad | `apps/api/src/auth-security/**` | Separar nombres tecnicos de dominio; no tocar SQL sin drift check | Muy alto |
| Tenancy | `apps/api/src/tenancy/**` | Definir tenant/organizacion/workspace y validar tenant solicitado | Muy alto |
| Prisma/PostgreSQL | `apps/api/prisma/**` | Inventario de unidades y relaciones; luego migraciones aditivas | Muy alto |
| Contratos | `packages/contracts/**` | Mantener frontera y version; traducir solo tipos internos compatibles | Alto |
| Web | `apps/web/src/**` | Traducir copy y nombres internos despues de fijar contratos | Medio |
| Mobile | `apps/mobile/src/**` | Traducir copy y almacenamiento con migracion de claves | Alto |
| Worker Python | `apps/workflow-runtime-python/src/**` | Separar `Job` tecnico de conceptos TUS; validar contrato comun | Alto |
| Providers | `apps/api/src/providers/**` | Mantener nombres externos y gates | Medio |
| Documentacion | `docs/**`, `README.md`, `ARCHITECTURE.md` | Traducir vigente y marcar snapshots obsoletos | Bajo |
| Legacy eliminado | `backendFiles`, `apps/reference` | No recrear; actualizar referencias historicas | Bajo |

## 7. Bloque 0 — Preparación y cierre de decisiones

El primer bloque debe ser pequeno, reversible y sin renombrar tablas. Su objetivo es eliminar ambiguedad antes de tocar el dominio.

### Incluido

1. Actualizar este plan y el glosario con las decisiones aprobadas.
2. Crear un inventario mecanico de identificadores por superficie, sin editar resultados.
3. Generar una matriz `concepto -> nombre actual -> nombre objetivo -> capa -> consumidor -> compatibilidad`.
4. Confirmar que ningun archivo productivo vuelva a importar `apps/reference` ni mencione `backendFiles` como dependencia activa.
5. Confirmar rutas consumidas por Web/Mobile contra `apps/api/src/tus/http/router.ts`.
6. Confirmar la matriz `tenantId/workspaceId` para assets, notificaciones, tenancy y TUS.
7. Confirmar la unidad de cada importe financiero.
8. Definir el flujo de refresh: activo, preparado o fuera de alcance publico.
9. Ejecutar contratos, lint dirigido y pruebas de aislamiento sobre la rama de trabajo.

### Excluido

- Renombrar modelos Prisma o tablas PostgreSQL.
- Editar migraciones historicas.
- Crear una migracion de renombre.
- Cambiar `contractVersion`.
- Cambiar valores serializados o eventos.
- Activar providers reales, settlement o billing.
- Activar el worker Python.
- Cambiar claves persistentes de Mobile sin plan de migracion.
- Cambiar nombres de paquetes `@factory` o configuracion `factory`.

### Salida obligatoria

- Matriz de nomenclatura revisada.
- Lista de consumidores para cada alias.
- Decisión escrita sobre `Organization`/`TusTenant`/`Workspace`.
- Decisión escrita sobre refresh rotation.
- Matriz monetaria.
- Pruebas de que el bloque no modifica datos ni rompe contratos.

## 8. Fases posteriores

### Fase 0: congelar y medir

- Confirmar `git status`, rama, commit base y ausencia de procesos persistentes no registrados.
- Ejecutar inventario de imports, rutas, schemas, modelos y claves persistentes.
- Separar evidencia actual de snapshots de `docs/AUDITORIA_COMPLETA_REPOSITORIO_TUS.md` y `docs/ESTADO_FUNCIONAL_TUS_Y_PLAN_DE_LIMPIEZA.md`.
- No usar conteos historicos como estado actual.

### Fase 1: nomenclatura interna no persistida

- Renombrar tipos, funciones, servicios y errores de un agregado a la vez.
- Mantener adapters de compatibilidad donde exista consumidor externo.
- Actualizar pruebas junto al agregado, no al final.
- No cambiar payloads, rutas ni columnas en esta fase.

Orden recomendado:

1. Readiness y auditoria.
2. Catalogo, publicacion y prestadores.
3. Compromisos, checkout y reservas.
4. POS y delivery.
5. Soporte y comunicaciones.
6. Finanzas y billing.
7. Auth, tenancy y refresh solo despues de cerrar la semantica de identidad.

### Fase 2: Web y Mobile

- Traducir labels, copy, nombres de componentes y tipos internos ya estabilizados.
- Mantener paths HTTP y valores de contrato.
- Para Mobile, definir migracion de claves `alqui:*`, `alqui-*` y `alqui.` antes de cualquier renombre.
- Probar reinstalacion, upgrade con datos existentes, offline POS y cuarentena.

### Fase 3: contratos compatibles

- Añadir alias internos solo donde haya consumidor real.
- Versionar un schema solo ante incompatibilidad, no ante un simple cambio de nombre interno.
- Regenerar bindings TypeScript/Python y ejecutar validacion de 98 schemas o el conteo vigente actualizado.
- Probar Web, Mobile y worker contra la misma fixture.

### Fase 4: persistencia

- Validar backup restaurable.
- Mapear cada tabla, columna, constraint, indice y FK afectado.
- Preferir `ALTER TABLE ... RENAME` cuando sea seguro.
- Mantener una ventana de lectura/escritura compatible si hay consumidores desplegados.
- Ejecutar migracion forward-only y smoke PostgreSQL.
- Nunca resetear una base compartida ni editar migraciones ya aplicadas.

### Fase 5: infraestructura y legacy

- No recrear `backendFiles` ni `apps/reference`.
- Actualizar documentos que los mencionan como estado activo.
- Resolver por separado namespaces `@repo`, `@factory`, `product-factory`, `factory`, `alqui` y `golden-boilerplate`.
- Consolidar paquetes solo con consumidor, ownership y prueba; no fusionar por estetica.
- Mantener providers externos detras de sus gates.

### Fase 6: verificacion final

- `contracts:validate`.
- Typecheck API, Web, Mobile y worker cuando el entorno compatible este disponible.
- Build API/Web.
- Pruebas unitarias TUS.
- Pruebas de integracion PostgreSQL.
- Pruebas de aislamiento entre tenants y, si corresponde, workspaces.
- Pruebas de rutas canonicas y aliases.
- Pruebas Mobile de migracion de almacenamiento y offline.
- Lint y seguridad.
- Auditoria de imports legacy y diff de nombres.

## 9. Riesgos y mitigaciones

| Riesgo | Severidad | Mitigacion |
| --- | --- | --- |
| Confundir `Tenant` con `Organization` | Muy alta | Decisión separada, matriz de ownership y pruebas cross-tenant |
| Renombrar Prisma sin renombrar fisico PostgreSQL | Muy alta | Migracion explicita y drift check |
| Romper Mobile por cambiar claves persistentes | Alta | Migracion versionada, lectura dual temporal y prueba de upgrade |
| Cambiar estados o eventos al traducir | Alta | Mantener valores actuales; traducir solo presentacion |
| Publicar refresh sin composicion durable | Alta | No exponer endpoint hasta completar store, contrato y pruebas |
| Mezclar `Pago` y `Liquidacion` | Alta | Mantener agregados y contratos separados |
| Convertir importes entre unidades | Muy alta | Matriz monetaria y pruebas ARS de ida/vuelta |
| Reintroducir codigo eliminado | Media | Prueba de ausencia de `backendFiles` y `apps/reference` productivos |
| Tratar snapshots como evidencia actual | Media | Marcar `superseded` y fechar toda evidencia |
| Sobreconsolidar paquetes | Media | Un paquete solo con ownership, consumidor y beneficio demostrable |

## 10. Criterios de aceptacion del plan

El plan se considera listo para implementacion cuando:

- cada uno de los 14 temas del primer bloque tiene una decisión o un bloqueo explicito;
- los terminos todavia ambiguos bloquean unicamente los bloques que dependen de ellos, no la normalizacion completa;
- `Service Capture` no bloquea una normalizacion independiente de `Readiness`/`Habilitacion`;
- no queda una traduccion ambigua en los bloques que ya estan listos para implementarse;
- todos los cambios incompatibles tienen estrategia de version o alias;
- la persistencia tiene backup y estrategia forward-only definidos;
- Web, Mobile, API y worker tienen consumidores identificados;
- se distingue codigo propio, tecnico, externo, historico y eliminado;
- la verificacion puede ejecutarse sin procesos foreground persistentes;
- la rama mantiene el arbol limpio salvo el documento de plan mientras esta fase siga abierta.

## 11. Referencias

- `AGENTS.md`: reglas de ejecucion, procesos y verificaciones.
- `docs/GLOSARIO_TUS.md`: vocabulario normativo y excepciones.
- `docs/AUDITORIA_COMPLETA_REPOSITORIO_TUS.md`: inventario historico; contiene referencias previas a carpetas ya eliminadas.
- `docs/ESTADO_FUNCIONAL_TUS_Y_PLAN_DE_LIMPIEZA.md`: estado funcional historico y recorridos; debe leerse junto al codigo actual.
- `docs/DESARROLLO_LOCAL_TUS.md`: baseline local PostgreSQL -> API -> Web.
- `apps/api/prisma/schema.prisma`: modelos y ownership persistente actual.
- `apps/api/src/auth-security/application/auth-service.ts`: registro, sesion y permisos actuales.
- `apps/api/src/auth-security/adapters/postgres/prisma-identity-store.ts`: bootstrap persistente de tenant, organizacion, espacio, rol y membresia.
- `apps/api/src/auth-security/application/refresh/refresh-service.ts`: servicio de rotacion de refresh.
- `apps/api/src/auth-security/adapters/postgres/sql/refresh-rotation-store.ts`: implementacion SQL durable.
- `apps/api/src/auth-security/adapters/postgres/sql/refresh-rotation.sql.ts`: locking y actualizacion atomica.
- `apps/api/src/tenancy/application/tenancy-service.ts`: semantica de organizacion, espacio y membresia.
- `apps/api/src/tus/http/router.ts`: rutas TUS y aliases actuales.
- `apps/api/src/tus/readiness/index.ts`: evaluacion de habilitacion.
- `packages/contracts/src/tus.ts`: contratos y valores serializados TUS.
- `apps/web/src/lib/tus-client.ts`: rutas consumidas por Web.
- `apps/mobile/src/application/tus-client.ts`: transporte y contratos Mobile.
- `apps/mobile/src/core/services/mmkv-storage.ts`: claves persistentes Mobile a migrar en fase separada.
- `apps/api/prisma/migrations/20260823130000_refresh_rotation/migration.sql`: tabla SQL de refresh.
- `apps/api/prisma/migrations/20260826090000_tus_readiness/migration.sql`: tablas iniciales de habilitacion.
- `apps/api/prisma/migrations/20260911120000_tus_listing_price_minor/migration.sql`: conversion de precio a unidades menores.

## 12. Estado de esta fase

Este archivo es el unico entregable de la fase de planificacion. No se modificaron codigo, contratos, Prisma, PostgreSQL, migraciones, configuracion, Mobile, Web, tests ni scripts para crearlo.
