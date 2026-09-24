# Auditoria WEB-09 de pagos, comisiones y conciliacion

> **Estado:** auditada el 2026-09-23. Esta unidad clasifica capacidades y define un plan; no habilita providers, cobros,
> capturas, refunds, split, settlement ni payouts reales.

## Resultado ejecutivo

El repositorio contiene dominio, persistencia y pruebas deterministas para varias operaciones financieras, pero no existe un
recorrido productivo y atomico desde WEB-08 hasta Mercado Pago y payout. La composicion Prisma usa
`UnavailableMercadoPagoFinanceProvider`, no inyecta transporte de release y mantiene los gates apagados. Ninguna capacidad
financiera obtiene grado A en esta auditoria.

Grados:

- **A — listo/ejecutable:** compuesto en runtime, durable y verificable de extremo a extremo.
- **B — parcial:** existe implementacion sustancial, pero falta composicion, atomicidad, fuente externa o activacion segura.
- **C — ausente:** no existe la operacion de producto en el runtime TUS.

## Clasificacion A/B/C

| Capacidad           | Grado | Evidencia y limite actual                                                                                                                                                         |
| ------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PaymentIntent       | B     | `TusFinanceService.createPaymentIntent`, HTTP y Prisma existen. La composicion usa `UnavailableMercadoPagoFinanceProvider`, los gates parten en `false` y el intento queda `held` |
| Captura             | C     | No existe operacion, endpoint ni agregado de captura de provider; POS declara captura no reclamada                                                                                |
| Webhook             | B     | Hay validacion, replay y transiciones en finance, un adapter API con inbox/saga in-memory y un paquete portable; ninguno forma un flujo durable compuesto en produccion           |
| Conciliacion        | B     | Compara valores persistidos con referencias e importes aportados por el caller; no consulta pagos, movimientos ni reportes del provider                                           |
| Comision TUS        | B     | Snapshot versionado y aritmetica entera en basis points existen; no hay cobro, transferencia ni reconciliacion externa de la comision                                             |
| Split               | B     | La politica y el ledger modelan reparto local; no se envia `marketplace_fee` ni una instruccion equivalente a Mercado Pago                                                        |
| Settlement          | B     | Elegibilidad, hold, release y compensacion estan modelados; release local no equivale a transferencia y no existe job productivo inyectado                                        |
| Refund              | B     | Finance registra compensacion local y existe un cliente portable de refund; ambos caminos no estan conectados                                                                     |
| Invoice/billing     | B     | Billing tiene cuentas, planes, suscripciones, facturas, notas, mora, ledger y Prisma; no esta compuesto en `TusApplicationService` ni expuesto por HTTP/Web                       |
| Payout al prestador | C     | El runtime TUS no ejecuta payout. Existe un cliente Money Out portable sin integracion, persistencia ni reconciliacion con finance                                                |

## Relacion exacta con WEB-08

El recorrido WEB-08 termina en hechos comerciales durables:

```text
CompromisoMercadoServicios
  -> Trabajo
  -> Diagnostico confirmado
  -> Presupuesto versionado
  -> Decision del cliente sobre la ultima version vigente
  -> Inicio
  -> Evidencia de trabajo
  -> Trabajo completado
  -> outbox tus.work.*
```

No existe un consumidor financiero de `tus.work.budget_decided` o `tus.work.completed`. Por lo tanto:

- `Trabajo.completed` no significa `Payment.approved`;
- la evidencia de Trabajo no se convierte automaticamente en evidencia financiera;
- el total del presupuesto aceptado no reemplaza automaticamente el importe del compromiso;
- completion no emite factura, no libera settlement y no inicia payout;
- un pago futuro debe nacer de un comando financiero explicito, idempotente y vinculado al sujeto canonico aprobado.

## Arquitectura encontrada

### PaymentIntent y provider

- `apps/api/src/tus/finance/index.ts` implementa intent, snapshot de comision, ledger y estados provider/comercial.
- `apps/api/src/tus/finance/prisma.ts` persiste intentos y efectos financieros.
- `apps/api/src/tus/composition/index.ts` inyecta `UnavailableMercadoPagoFinanceProvider`.
- `apps/api/src/providers/mercado-pago/index.ts` implementa un adapter con receipts, retries, saga, outbox y dead letters
  in-memory.
- `packages/mercado-pago` contiene cliente, webhooks y Money Out portables, pero no estan compuestos con finance.

### Webhook e idempotencia

Finance valida firma, tolerancia temporal, monto, moneda, referencia, orden de eventos y replay. Sin embargo, el metodo no esta
expuesto por una ruta HTTP productiva y su store Prisma no persiste un inbox durable antes de mutar. El integration router se
monta sin adapter Mercado Pago en la composicion canonica, por lo que permanece no disponible aun con el flag de rutas.

La creacion de pago usa lectura previa y escritura posterior de idempotencia. No existe claim atomico antes del side effect de
provider, y una clave alternativa para el mismo compromiso puede producir otro intento. Pago, snapshot, ledger e idempotencia
no comparten una transaccion.

### Comision, split y settlement

La comision usa `BigInt` para el calculo por basis points y conserva snapshot. El split actual es una representacion contable
local, no una instruccion al provider. Release cambia estado y agrega ledger, pero no mueve dinero. El camino directo de release
no aplica todas las gates de payout/custodia que aplica el enqueue del job, y la composicion productiva no inyecta dicho job.

### Refund, conciliacion y billing

Refund financiero agrega compensacion local y puede actualizar estado, pero no llama al cliente real de Mercado Pago.
Conciliacion compara contra datos proporcionados por el caller, no contra una fuente externa confiable. Billing conserva un
dominio amplio, pero no tiene composicion de runtime ni superficie de producto.

## Blockers verificados

### 1. Sujeto financiero incompatible

WEB-08 usa `CompromisoMercadoServicios`, mientras las FK de payment intent, comision, ledger, conciliacion y factura apuntan al
modelo separado `Compromiso`. El lookup de composicion puede encontrar el compromiso marketplace, pero la persistencia
financiera no puede referenciarlo de forma consistente sin una decision de modelo y una migracion forward-only.

### 2. Unidades monetarias divergentes

Marketplace persiste minor units como `BIGINT`, pero algunos mapeos reconstruyen `amount` como numero decimal. Finance trata
`commitment.amount` como minor unit entero. Un presupuesto WEB-08 usa strings decimales de minor units. Antes de integrar debe
adoptarse una frontera unica:

- `bigint` en dominio y persistencia;
- string decimal en JSON;
- conversion explicita a major units solo en el adapter del provider;
- moneda y redondeo definidos por contrato, sin floats para contabilidad.

### 3. Efectos financieros no atomicos

Provider call, pago, snapshot, entradas de ledger e idempotencia se escriben por separado. Un fallo intermedio puede dejar un
pago externo sin estado local o un release sin ledger. El patron WEB-08 de claim, transaccion serializable, outbox y retry
acotado debe adaptarse antes de habilitar side effects.

### 4. Tres implementaciones Mercado Pago sin composicion canonica

Finance, el adapter API y `packages/mercado-pago` resuelven partes distintas. Falta seleccionar una frontera, preservar raw body
para firma, persistir inbox antes de procesar y mapear cuentas/provider references desde estado confiable, no desde el payload
del caller.

### 5. Billing durable requiere reparacion

La auditoria estatica detecto snapshots JSON con `bigint`, conversiones que leen `contractVersion` no persistido y nombres de
campos de idempotencia que no coinciden con las columnas Prisma. Ademas, emision, lineas, ledger, audit y outbox no son una sola
transaccion. Estos puntos requieren tests PostgreSQL reales antes de exponer billing.

## Migraciones futuras

Toda migracion debe ser aditiva y forward-only. No se aplico ninguna durante WEB-09. Un plan seguro requerira:

1. definir el sujeto canonico de pago entre `Compromiso` y `CompromisoMercadoServicios`;
2. normalizar minor units y agregar constraints de moneda, monto no negativo y basis points;
3. modelar idempotency claims `pending/completed/failed` con lease y expiracion;
4. persistir attempts, autorizacion y captura sin sobrescribir historia;
5. crear inbox webhook durable con claim, retries y dead letter;
6. persistir refunds, runs de conciliacion, settlement y payout como agregados separados;
7. reparar snapshots y mappings de billing antes de componerlos.

## Plan WEB-09

### WEB-09A — contratos, dinero y sujeto canonico

- Resolver la identidad financiera de commitments WEB-08.
- Unificar minor units como `bigint` interno/string HTTP.
- Corregir mappings, constraints y contratos.
- Probar linkage y aritmetica contra PostgreSQL descartable.

### WEB-09B — payment intent y captura determinista

- Consolidar la frontera Mercado Pago sin activar credenciales.
- Agregar attempts y estados explicitos de autorizacion/captura.
- Implementar claim idempotente y outbox dentro de transacciones.
- Mantener provider fake determinista y provider real gated.

### WEB-09C — webhook, refund y conciliacion

- Ingerir raw body y persistir receipt antes de procesar.
- Procesar con retries acotados, dead letter y outbox transaccional.
- Conectar refund a un puerto provider sin habilitarlo.
- Conciliar desde statements/provider data, no desde valores del caller.

### WEB-09D — comision, split, settlement y payout

- Versionar y acotar reglas de comision.
- Decidir formalmente split al cobrar versus payout posterior.
- Aplicar gates financieros, payout y custodia en todos los caminos de release.
- Persistir transferencia y reconciliar Money Out antes de marcar payout completo.

### WEB-09E — integracion WEB-08, billing y provider futuro

- Derivar explicitamente la base de pago del presupuesto aceptado.
- Consumir eventos de Trabajo con una politica aprobada, sin equiparar completion y approval.
- Componer billing y exponer rutas autenticadas solo despues de reparar persistencia.
- Ejecutar conformance sandbox, rollback y conciliacion antes de activar flags.

## Evidencia y tests existentes

- `tests/foundation/p5-mercado-pago.test.mjs`: firma, replay, retry, compensacion y poison delivery del adapter determinista.
- `tests/foundation/p9-finance.test.mjs`: gates, snapshots, ledger, freezes, release y persistencia.
- `tests/foundation/p9-billing.test.mjs`: ownership, ARS, invoices, dunning, ledger e idempotencia con mocks.
- `tests/integration/tus/finance-webhook.test.mjs`: integracion adicional no incluida por defecto en el runner principal.
- `packages/mercado-pago/tests/mercado-pago.test.cjs`: paquete portable no incluido por defecto en el runner principal.

Los mocks actuales no prueban atomicidad PostgreSQL, FK reales, JSON con `bigint`, carreras ni side effects de provider. La
activacion queda bloqueada hasta contar con esos tests y un target descartable autorizado.

## WEB-09A — modelo financiero canonico (IMPLEMENTADO)

**Estado:** implementado sin provider, sin cobro y sin migracion aplicada a una base real.

### Mapa comercial real

```text
Publicacion (tenant prestador)
  -> CompromisoMercadoServicios (tenant cliente, prestador_tenant_id, publicacion_id, monto BIGINT total minor)
  -> Trabajo (1:1 por (tenant_id, compromiso_id); FK compuesta al compromiso)
  -> Presupuesto aceptado (opcional, versionado)
  -> ObligacionPagoServicio (1:1 por (tenant_id, trabajo_id); FK compuesta a Trabajo)
```

- `Compromiso` (`compromisos`) es el agregado legacy de commitments directos: su `tenant_id` es el tenant del prestador y
  su FK a `prestadores` impide representar un compromiso cross-tenant del marketplace. No es el sujeto de servicios.
- `CompromisoMercadoServicios` es el compromiso comercial de un servicio; `Trabajo` su ejecucion.
- `ObligacionPagoServicio` es la identidad financiera canonica: fija tenant cliente, tenant/prestador, publicacion, compromiso,
  Trabajo y, si existe, la version de presupuesto aceptada. La FK compuesta a `trabajos` rechaza cadenas mezcladas.
- El finance legacy (`TusFinanceService`) rechaza compromisos marketplace con `SERVICE_OBLIGATION_REQUIRED`: su `amount`
  esta en unidades mayores y sus tablas no son FK-validas para ese sujeto.

### Importe y dinero

- Importe derivado en servidor: presupuesto aceptado (`accepted_budget`) o compromiso de precio final
  (`fixed_price_commitment`, `priceMode` `fixed`/`precio_fijo` o sin modo). `precio_desde` y `por_hora` sin presupuesto
  quedan bloqueados con `AMOUNT_NOT_FINAL`: definir su base de cobro es una decision de producto pendiente.
- Representacion canonica: `bigint` minor units + ISO 4217 en dominio/Prisma; string decimal en JSON
  (`amountMinor`); unidades mayores solo en el adapter de provider (`minorUnitsToMajorDecimal`), sin floats. Helpers
  centralizados en `packages/contracts/src/money.ts`; comision por basis points con redondeo half-up entero.
- `MarketplaceCommitment.amount` sigue siendo un campo de presentacion en unidades mayores (wire contract sin cambios); la
  logica financiera usa `priceSnapshot.minor * quantity` o `compromisos_mercado_servicios.monto`.

### Persistencia

- Migracion `20260923100000_tus_service_finance_identity`: crea `obligaciones_pago_servicio` con CHECKs de monto, moneda,
  estado y origen; agrega `obligacion_id` a `intenciones_pago`, `instantaneas_comision` y `movimientos_contables`, relaja
  `compromiso_id` y exige un unico sujeto por fila con CHECK `NOT VALID`. No hay backfill, borrado ni reescritura. Se
  mantiene un unico ledger (append-only por trigger existente).
- Estados de obligacion: `pending_payment -> paid -> refunded | charged_back`. `Trabajo.completed` no cambia la obligacion.
- Idempotencia financiera: clave por tenant y huella `sha256` calculada en servidor desde el comando canonico; misma clave y
  misma solicitud reproduce la respuesta, misma clave con otra solicitud devuelve `IDEMPOTENCY_CONFLICT`. Persistida en
  `idempotencia_financiera` dentro de la misma transaccion serializable, con reintento acotado ante P2034/P2002.

### Fronteras Mercado Pago

| Frontera                                             | Rol                                                                   | Decision                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| `apps/api/src/tus/finance` (`ProveedorPagoFinanzas`) | Legacy `Compromiso`                                                   | Se conserva; no financia servicios                      |
| `apps/api/src/providers/mercado-pago`                | Adapter in-memory con saga/outbox propios, solo router de integracion | Referencia; no canonico                                 |
| `packages/mercado-pago`                              | Cliente HTTP portable, firma con raw body, refunds, Money Out         | Base del futuro adapter WEB-09E                         |
| Puerto de pagos de servicio (WEB-09B)                | Interfaz canonica TUS                                                 | Unica frontera que usan B/C; fake determinista en tests |

## WEB-09B — intencion de pago y eventos deterministas (IMPLEMENTADO)

**Estado:** implementado sin provider real. La composicion Prisma usa `ProveedorPagosServicioNoDisponible`; ningun pago de
servicio puede quedar aprobado sin un evento verificado de un provider habilitado.

- **Intencion:** `POST /tus/v1/work/:workId/payment-intents` (alias `/tus/v1/trabajos/:workId/pagos`) exige sesion del
  tenant cliente, `tus:checkout` o `tus:work:accept` e `idempotency-key`. Rechaza `amount`, `amountMinor`, `currency`,
  estados, referencias, fechas e identidades en el body (`CLIENT_AUTHORITY_FIELDS`). Crea la obligacion si falta, reutiliza
  una intencion `pending` activa y numera intentos por obligacion; nunca llama al provider dentro de la transaccion.
- **Lectura:** `GET /tus/v1/work/:workId/finance` (alias `/tus/v1/trabajos/:workId/finanzas`) para cliente o prestador;
  otros tenants reciben `404`.
- **Persistencia:** la intencion vive en `intenciones_pago` con `obligacion_id`, `intento`, `estado_despacho` y
  `prestador_tenant_id`; `estado_proveedor` separado de `estado_despacho`. Las columnas legacy reciben valores neutros.
- **Despacho:** `despacharIntencionPago` es un paso de worker: lee, llama al puerto fuera de la transaccion con clave
  idempotente = `paymentId` y registra `dispatched` o `dispatch_failed`. No existe worker productivo ni endpoint de despacho.
- **Provider canonico:** `PuertoProveedorPagosServicio` (crear pago + verificar evento). Implementaciones:
  `ProveedorPagosServicioNoDisponible` (runtime) y `ProveedorPagosServicioDeterminista` (tests, HMAC sobre raw body y
  montos en unidades mayores convertidos sin floats). WEB-09E debe implementar este puerto sobre `packages/mercado-pago`.
- **Eventos:** firma primero; resolucion por referencia del provider (o por `paymentId` cuando el despacho no llego a
  persistirse); inbox durable `eventos_webhook_pago` unico por tenant/provider/evento con raw body. Resultados:
  `applied`, `no_op`, `stale`, `ignored_unknown_status`, `rejected_transition`, `quarantined` (monto, moneda o
  referencia). Duplicados devuelven el resultado original sin efectos; eventos desconocidos o sin intencion no mutan dinero.
- **Estados provider:** `pending -> approved | rejected | expired | cancelled`; `approved -> refunded | charged_back`.
  `approved` mueve la obligacion a `paid`; `refunded`/`charged_back` a sus estados homonimos.
- **Outbox y auditoria:** `tus.payment.intent_created`, `tus.payment.intent_dispatched` y `tus.payment.status_changed` en
  la tabla compartida `OutboxEvent`; `auditoria_finanzas_servicio` registra origen, actor, correlacion, clave y transicion,
  sin secretos. Estado, inbox, outbox y auditoria comparten transaccion serializable con reintento P2034/P2002.
- Migracion `20260923110000_tus_service_payment_intents`: aditiva, no aplicada a una base real.

## WEB-09C — ledger, comision y conciliacion internos (IMPLEMENTADO)

**Estado:** implementado como contabilidad interna. No hay split, payout, refund ni transferencia real.

- **Ledger:** unico, `movimientos_contables`, append-only por el trigger existente. Los asientos de servicio usan
  `obligacion_id` e ids deterministas (`svc-gross-*`, `svc-commission-*`, `svc-payable-*`, `svc-refund-*`,
  `svc-chargeback-*`), de modo que el mismo efecto no puede registrarse dos veces por `(tenant_id, entrada_id)`.
- **Comision:** regla existente `mvp-10-percent-v1` (1000 bps) sin nueva decision comercial; base = importe de la
  obligacion; redondeo half-up entero; snapshot inmutable unico por obligacion en `instantaneas_comision` con base, tasa,
  version, comision, neto, moneda, referencia y evidencia (`provider-event:<id>`). Solo se calcula ante un evento
  `approved` verificado y aplicado; el inbox evita duplicados.
- **Liquidacion interna:** `liquidaciones_servicio` (`held -> eligible | frozen | reversed`, `eligible -> frozen |
reversed`, `frozen -> reversed`). `eligible` exige pago aprobado y `Trabajo.completed` (`evaluarLiquidacion`, paso de
  sistema sin HTTP). `estado_desembolso` es siempre `not_executed` por CHECK: nada indica que el prestador cobro.
- **Refund/contracargo:** solo por evento verificado; agregan `refund_compensation` o `chargeback_compensation` vinculados al
  asiento bruto y mueven la liquidacion a `reversed` o `frozen`. No se llama al provider.
- **Conciliacion:** `conciliarObligacion` compara inbox verificado, intenciones, ledger, snapshot y liquidacion. Hallazgos:
  `matched`, `missing`, `duplicate`, `amount_mismatch`, `currency_mismatch`, `invalid_state`. Cada corrida se
  guarda append-only en `conciliaciones_servicio` (trigger); una discrepancia congela la liquidacion y nunca corrige montos.
  La fuente externa sigue siendo el evento firmado recibido; no existe consulta de statements del provider (WEB-09E).
- **Superficie:** `GET /tus/v1/work/:workId/finance` agrega `settlement` y regla de comision solo para el prestador.
- **Billing:** sin cambios; no se emite factura fiscal.
- Migracion `20260923120000_tus_service_settlement_reconciliation`: aditiva, no aplicada a una base real.

### Clasificacion posterior a WEB-09A/B/C

| Capacidad                           | Grado | Motivo                                                                            |
| ----------------------------------- | ----- | --------------------------------------------------------------------------------- |
| PaymentIntent de servicio           | B     | Persistente, idempotente y atomico; sin provider habilitado ni worker de despacho |
| Webhook/eventos                     | B     | Inbox durable, firma, dedupe y orden; sin ruta publica ni provider real           |
| Comision TUS                        | B     | Exacta, versionada y deduplicada; sin cobro real de la comision                   |
| Conciliacion                        | B     | Interna y determinista; sin statements del provider                               |
| Settlement interno                  | B     | Estados internos correctos; sin payout                                            |
| Captura, split, payout, refund real | C     | Fuera de alcance (WEB-09E)                                                        |

## DB-09-SAFETY — modelo financiero de sujeto dual (IMPLEMENTADO)

**Decision:** se mantiene un unico ledger y tablas financieras compartidas. `intenciones_pago`, `instantaneas_comision` y
`movimientos_contables` referencian **exactamente uno** de dos sujetos con FK real: `compromiso_id` (legacy, FK a
`compromisos`) u `obligacion_id` (servicios, FK a `obligaciones_pago_servicio`). No se usa `subject_type + subject_id`.

**Motivo:** evitar duplicar ledger, intenciones, comision, conciliacion y settlement por tipo de sujeto.

**`DROP NOT NULL`:** existe solo en `20260923100000_tus_service_finance_identity`, una sentencia por tabla. No borra
columnas ni filas: reemplaza la invariante "`compromiso_id` obligatorio" por "`(compromiso_id IS NULL) <> (obligacion_id IS
NULL)`" (`ck_*_sujeto_unico`). El repo ya tenia el precedente `reservas.servicio_id DROP NOT NULL` (WEB-04D1).
Riesgos reales: un camino de escritura que omita ambos sujetos (bloqueado por CHECK y por `asegurarSujetoFinancieroUnico`),
uniques que ignoran NULL (ver tabla) y consultas que asuman `compromiso_id` presente (ver abajo).

### Invariantes por tabla

| Tabla                    | Legacy          | Servicio                           | XOR                     | Unicidad legacy                   | Unicidad servicio                                                      | FKs                                                                                 |
| ------------------------ | --------------- | ---------------------------------- | ----------------------- | --------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `intenciones_pago`       | `compromiso_id` | `obligacion_id`                    | CHECK validado          | `(tenant, compromiso_id)`         | `(tenant, obligacion_id, intento)`, `(tenant, pago_id, obligacion_id)` | compromisos; obligacion; `(tenant, obligacion, prestador_tenant, orden_id=trabajo)` |
| `instantaneas_comision`  | `compromiso_id` | `obligacion_id`                    | CHECK validado          | `(tenant, compromiso_id)`         | `(tenant, obligacion_id)`                                              | compromisos; obligacion                                                             |
| `movimientos_contables`  | `compromiso_id` | `obligacion_id`                    | CHECK validado          | `(tenant, entrada_id)` compartido | idem + ids `svc-*` (CHECK `espacio_sujeto`)                            | compromisos; obligacion                                                             |
| `liquidaciones_servicio` | —               | `obligacion_id` NOT NULL           | n/a                     | —                                 | `(tenant, obligacion_id)`                                              | obligacion; `(tenant, obligacion, prestador_tenant, trabajo)`                       |
| `eventos_webhook_pago`   | sin sujeto      | `pago_id` + `obligacion_id` juntos | CHECK `sujeto_completo` | `(tenant, proveedor, evento)`     | idem                                                                   | `(tenant, pago, obligacion)` a la intencion exacta                                  |

Todas las FKs son `ON DELETE RESTRICT ON UPDATE NO ACTION`; no hay cascadas. Cada unicidad logica tiene una variante con
la columna del sujeto no nula, por lo que la semantica de NULL de PostgreSQL no deja filas sin proteger. No hicieron falta
indices parciales: la unica unicidad dependiente de estado ("una intencion activa por obligacion") la cubre la
transaccion serializable mas el unique `(tenant, obligacion_id, intento)`.

### Consultas y codigo

- No hay SQL crudo, `INNER JOIN` ni `include` de `compromiso` sobre estas tablas. El store legacy (`finance/prisma.ts`)
  filtra siempre por `compromisoId` y el de servicios por `obligacionId`; ninguno lista filas del otro sujeto.
- Cambios: `appendLedger` legacy responde `LEDGER_IMMUTABLE` si el id pertenece a otro sujeto en vez de mapear la fila;
  todos los escritores pasan por `asegurarSujetoFinancieroUnico`; las claves de idempotencia de servicios se guardan como
  `servicio:<clave>` en `idempotencia_financiera`, compartida con claves crudas legacy, para que el mismo tenant y la
  misma clave no colisionen entre flujos.
- Billing, reporting, soporte y delivery no leen estas tablas.

### Checker de migraciones

`scripts/tus-migration-repair-lib.mjs` clasificaba como `destructive` cualquier `DROP`. Ahora clasifica cada accion de
`ALTER TABLE` por separado y toma la mas severa: `constraint_relaxation` (solo `ALTER COLUMN x DROP NOT NULL`),
`high_risk` (`DROP CONSTRAINT`, `DROP DEFAULT`, `DROP INDEX|TRIGGER|FUNCTION`), `destructive` (`DROP TABLE|SCHEMA|TYPE|COLUMN`,
`TRUNCATE`, `CASCADE`, `DELETE FROM` y cualquier `DROP` no reconocido). El gate rechaza `destructive`, `high_risk` y
`ambiguous`; acepta la relajacion y la informa. Una sentencia `DROP NOT NULL, DROP COLUMN` queda `destructive`.

### Datos historicos

Las filas historicas cumplen el XOR por construccion (`compromiso_id` era NOT NULL y `obligacion_id` nacio vacia), por
eso `20260924100000_tus_finance_subject_hardening` valida los CHECKs sin backfill. Los CHECKs de monto no negativo sobre
tablas legacy siguen `NOT VALID` hasta auditar datos reales. No se detecto ninguna fila con ambos sujetos NULL.

### Checklist antes de aplicar WEB-08/WEB-09 en una base real (NO aplicado)

1. Backup restaurable verificado y ventana acordada.
2. Baseline: `_prisma_migrations` y esquema real comparados con `DER_TUS.dbml`; confirmar que las migraciones hasta
   `20260917100000_tus_work_budget` coinciden antes de las cuatro de WEB-09/DB-09.
3. Filas incompatibles (solo lectura): intenciones, instantaneas y movimientos con `compromiso_id IS NULL`; montos negativos
   en tablas legacy; `entrada_id LIKE 'svc-%'` en ledger legacy; eventos con `pago_id` sin `obligacion_id`; trabajos que
   comparten `(reserva_tenant_id, reserva_id)` no nulos (bloquean `uq_trabajos_reserva`).
4. Locks: `CREATE UNIQUE INDEX` sin `CONCURRENTLY` bloquea escrituras de la tabla durante el build; `ALTER COLUMN DROP
NOT NULL` toma ACCESS EXCLUSIVE brevemente; `VALIDATE CONSTRAINT` no bloquea escrituras. Medir tamaño de tablas y usar
   `lock_timeout`.
5. Orden: `20260917100000` → `20260923100000` → `20260923110000` → `20260923120000` → `20260924100000` →
   `20260924130000`, forward-only.
6. Dry run en una copia descartable con `prisma migrate deploy` y los tests de integracion PostgreSQL.
7. Smoke posterior: `/health`, `/ready`, lectura de trabajos y `GET /tus/v1/work/:workId/finance`.
8. Rollback operativo: no hay down migrations; ante fallo restaurar backup o aplicar una migracion correctiva forward-only.
   Volver a `SET NOT NULL` solo es posible mientras no existan filas de servicio.

## DB-09-GATE y DB-09-DRYRUN (2026-09-24)

### Gate de migraciones

`reviewMigrationChain` (`scripts/tus-migration-repair-lib.mjs`) acepta una cadena solo por razones explicitas:

- `append_only_guard`: funcion `RETURNS trigger` cuyo cuerpo es unicamente `RAISE EXCEPTION '<literal>'` (con `OR REPLACE`
  solo si ninguna migracion anterior definio ese nombre) y `CREATE TRIGGER ... BEFORE UPDATE OR DELETE ... FOR EACH ROW` sobre
  una funcion guard ya reconocida. Sin contexto de cadena ambas sentencias siguen `ambiguous`; `gateInventory` las rechaza.
- `REVIEWED_MIGRATION_STATEMENTS`: tres sentencias de `20260917100000_tus_work_budget` (backfill determinista, reemplazo de
  FK en la misma sentencia y `ON DELETE CASCADE` de lineas a presupuesto) fijadas por migracion + sha256 del SQL normalizado;
  cualquier edicion o copia en otra migracion vuelve a bloquear.
- `DROP FUNCTION`, `DROP TRIGGER` y demas DROP siguen `high_risk`/`destructive`; el historial anterior a WEB-08 sigue bloqueado.

La cadena `20260917100000` → `20260924100000` queda aceptada.

### Dry run en PostgreSQL descartable

- Cluster creado con `initdb` en el scratchpad del agente (PostgreSQL 16.15), `127.0.0.1:55439`, `system_identifier`
  7688946921154849088, DBs `tus_dryrun_fresh` y `tus_dryrun_upgrade`; detenido con `pg_ctl stop` y data dir eliminado. El
  servicio local `postgresql-x64-16` (puerto 5432) no se toco.
- **Fresh install:** `prisma migrate deploy` aplico las 38 migraciones en 4,5 s (WEB-08/09: 96, 36, 20, 29 y 12 ms).
- **Upgrade:** baseline hasta `20260916140000` (33 migraciones, 4,1 s), datos legacy sinteticos y luego las cinco migraciones
  WEB-08/09 en 1,87 s (107, 39, 22, 25 y 14 ms). El backfill de `prestador_tenant_id` y los `VALIDATE` pasaron sobre filas
  legacy; la fila legacy conservo `compromiso_id` con `obligacion_id` NULL.
- `_prisma_migrations`: 38 aplicadas, 0 sin terminar, 0 revertidas en ambas DBs. `prisma validate`: OK.
- **Drift:** `migrate diff` DB → `schema.prisma` reporta 112 lineas identicas en fresh, en el baseline previo contra el schema
  de `ba8db98` y despues del upgrade: WEB-08/09 no agregan drift. El drift es historico (FKs `tenant_id → "TusTenant"` NOT
  VALID, indices y defaults creados por migraciones previas y no declarados en Prisma). Consecuencia operativa: las filas de
  servicio en `intenciones_pago` y `movimientos_contables` tambien requieren que `tenant_id` exista en `"TusTenant"`.
- **Constraints reales:** 41/41 casos SQL pasan (XOR en las tres tablas, FK obligacion+prestador+trabajo, intencion exacta desde
  inbox, uniques por sujeto, espacio `svc-*`, idempotencia `servicio:<clave>` junto a la clave legacy, RESTRICT en borrados,
  triggers append-only, CHECKs de obligacion y liquidacion). Sin FKs en cascada en tablas financieras.
- **Locks:** solo `AccessExclusiveLock` sobre tablas nuevas y `ShareRowExclusiveLock`/`ShareLock` sobre `trabajos` y
  `presupuestos` durante la creacion de FKs; todos concedidos sin espera (sesion unica).
- **API:** levantada con `tsx src/index.ts` contra `tus_dryrun_upgrade` (PID 17516, puerto 3199): `/health` 200, `/ready` 200,
  rutas financieras 403 sin sesion, 2 conexiones a la DB descartable; proceso detenido y puerto libre.

## WEB-08F/G/H — cierre de deudas de Trabajo (IMPLEMENTADO, 2026-09-24)

Cierra los tres pendientes que WEB-08 habia diferido antes de WEB-09D. Sin cambios en `packages/contracts`; no se toca
Mercado Pago ni flags de provider.

### WEB-08F — visibilidad del expediente

La autorizacion se aplica en `ServicioTrabajo.getWork` (servidor), con el tenant tomado de la sesion; la Web no filtra.

| Dato                      | Cliente (`tenantId` del trabajo)            | Prestador (`prestadorTenantId`)  |
| ------------------------- | ------------------------------------------- | -------------------------------- |
| Acceso                    | solo trabajos propios                       | solo trabajos donde es prestador |
| Trabajo (estado, version) | si                                          | si                               |
| Diagnosticos              | solo `confirmed`                            | todos, incluidos borradores      |
| Presupuestos y versiones  | todos salvo `draft`; sin `recordId` interno | todos; sin `recordId` interno    |
| Evidencias del trabajo    | si                                          | si                               |
| Transiciones (eventos)    | estado, version, motivo, fecha              | idem                             |
| `actorId`/`correlationId` | no en transiciones                          | no en transiciones               |
| Pago                      | `GET .../finance` (audiencia propia WEB-09) | idem, con comision y neto        |

- La respuesta agrega `viewer: 'customer' | 'provider'` (aditivo). Otro tenant, incluido otro prestador, recibe `404`.
- Cada coleccion se filtra ademas por `tenantId` + `trabajoId` del trabajo resuelto (defensa ante un adapter defectuoso).
- `Diagnostico` y `EvidenciaTrabajo` conservan `actorId`/`correlationId` porque el contract los exige; son identificadores
  del prestador, no datos del cliente. Las transiciones dejan de exponerlos porque mezclan actores de ambas partes.
- `Trabajo` no contiene direccion ni ubicacion: las reglas de privacidad geografica existentes no cambian.
- Reclamos: no existe vinculo reclamo↔trabajo en el modelo actual; soporte sigue con su autorizacion propia.

### WEB-08G — deduplicacion

Relevamiento previo: la idempotencia de Trabajo era por `(tenantId, idempotency-key)` pero comparaba el `requestHash` que
envia el cliente; `trabajoId` ya era determinista por compromiso y `uq_trabajos_tenant_compromiso` impedia dos trabajos por
compromiso, pero una reserva podia quedar vinculada a varios trabajos y un carrito podia generar pedidos dos veces con otra
clave.

- **Huella en servidor:** `ServicioTrabajo.execute` guarda `sha256` de `{operation, campos semanticos}` calculado en servidor.
  El `requestHash` del cliente sigue siendo obligatorio (contract) pero no decide. Misma clave + mismo pedido → `replay`
  aunque cambie el hash del cliente o `createdAt`; misma clave + otro pedido u otra operacion → `409 CONFLICT`.
- **Trabajo existente:** aceptar un compromiso ya aceptado con otra clave devuelve el trabajo existente con
  `status: 'replay'` (HTTP 200), sin nuevas transiciones, auditoria ni outbox. Igual para evidencia repetida, diagnostico ya
  confirmado y decision de presupuesto ya registrada.
- **Reserva:** una reserva vincula como maximo un trabajo (`RESERVATION_ALREADY_LINKED`), en dominio y con el indice unico
  `uq_trabajos_reserva (reserva_tenant_id, reserva_id)`.
- **Carrito:** `checkout` rechaza un segundo checkout del mismo `(tenantId, cartId)` con otra clave
  (`409 CART_ALREADY_CHECKED_OUT`, `details.commitmentIds` con los compromisos existentes). La misma clave sigue en replay.
- **Carreras:** `PrismaTrabajoTransaction` reintenta (max. 3) ante `P2034` y ahora tambien `P2002`; el reintento relee y
  resuelve como replay. El checkout ya corria en `Serializable` con reintento.
- Transicion: registros de idempotencia de Trabajo creados antes de este cambio guardan el hash del cliente; reintentar esas
  claves devuelve `409 CONFLICT` en lugar de replay. Afecta solo reintentos de pedidos anteriores al despliegue.

### WEB-08H — reserva y trabajo atomicos

- La validacion de reserva salio de `TusApplicationService` y paso a `ServicioTrabajo.acceptCommitment`, dentro de la misma
  transaccion `Serializable` que crea trabajo, transicion, auditoria, outbox y registro de idempotencia.
- Puerto nuevo `TrabajoReservaPort.lockForWork`. En Prisma es un `UPDATE reservas ... SET estado = 'confirmed' WHERE
tenant_id = prestador AND reserva_id AND cliente_tenant_id AND publicacion_id AND estado = 'confirmed'` sin cambio efectivo:
  valida y toma el lock de fila en la misma sentencia. En memoria valida contra el calendario dentro del cerrojo serial.
- No hay estado intermedio: si falla cualquier paso posterior se revierten trabajo, vinculo, idempotencia, auditoria y outbox;
  la reserva no cambia. La reserva no se "consume" con un cambio de estado; el vinculo es la fila de `trabajos`.

### Migracion

`20260924130000_tus_work_reservation_unique`: `CREATE UNIQUE INDEX "uq_trabajos_reserva"`. Forward-only, aditiva,
clasificada `additive` por el gate DB-09 y agregada a su cadena. Los NULL no colisionan. Si la base real tuviera dos trabajos
sobre una reserva, el indice falla sin modificar datos (consulta previa en el checklist).

### Validacion

- Tests nuevos `tests/foundation/web-08fgh.test.mjs` (6): proyeccion por audiencia en servicio y HTTP, tenant ajeno y
  cabecera `x-tenant-id` falsificada, huella en servidor, 5 aceptaciones concurrentes, reserva unica, rollback ante fallo
  intermedio, lock y reintento del adapter Prisma. `web-08-workflow` actualiza el rechazo de reserva al servicio real.
- Focales: WEB-08, WEB-09, `tus-web-*`, DB-09, p8/p9 (con `TUS_ROUTES_ENABLED=true`) y `p0-contracts`: 244/244.
- Suite foundation completa: 588/601. Las 13 fallas son previas y ajenas al cambio: `pnpm` fuera del PATH, CRLF en archivos
  de deploy, regex de documentacion nativa, frontera git e import sin extension de `apps/web/src/lib/api-url`.
- `contracts:validate` 107 schemas; typecheck contracts/API/Web; `prisma validate`; build API; Prettier en archivos que ya
  cumplian; `git diff --check`.
- **PostgreSQL 16 real** (cluster descartable en el scratchpad, `127.0.0.1:55441`, detenido y borrado; el servicio local 5432
  no se toco), 39 migraciones aplicadas:
  - 6 aceptaciones concurrentes del mismo compromiso con claves distintas: 1 `executed`, 5 `replay`, 1 trabajo, 1 transicion.
  - 2 compromisos concurrentes sobre la misma reserva: 1 `executed`, 1 `RESERVATION_ALREADY_LINKED`.
  - Fallo inyectado despues del INSERT del trabajo: 0 trabajos, 0 idempotencia, 0 outbox, 0 auditoria, reserva intacta;
    el reintento con la misma clave ejecuta.
  - Cancelacion de reserva abierta antes del lock: `INVALID_RESERVATION_LINK`, sin trabajo.
  - Lock tomado por el trabajo: la cancelacion concurrente espero 558 ms hasta el commit.
  - INSERT directo de un segundo trabajo sobre la misma reserva: `23505`.
  - Tabla real de idempotencia: misma clave con otro hash de cliente → replay; con otro compromiso → `CONFLICT`.

### Residuales

- ~~La cancelacion de una reserva en el calendario no consulta si hay un trabajo vinculado.~~ Resuelto en WEB-08I.
- ESLint de `prisma-work.ts` reporta 7 imports de tipo sin uso, preexistentes a este cambio.

## WEB-08I — coherencia entre cancelacion de reserva y trabajo (IMPLEMENTADO, 2026-09-24)

**Regla:** una reserva vinculada a un trabajo no puede cancelarse directamente desde calendario; desde ese momento el
trabajo es la autoridad de su ciclo de vida.

### Calendario

- `ServiceCalendarService.cancel` y `markNoShow` (las dos unicas escrituras del calendario sobre una reserva existente)
  ejecutan `ensureNotLinkedToWork` dentro de su transaccion: bloquean la fila de la reserva y consultan
  `trabajos(reserva_tenant_id, reserva_id)`. Si hay trabajo: `409 RESERVATION_LINKED_TO_WORK`, sin escribir reserva,
  trabajo, idempotencia, auditoria ni outbox (el calendario solo audita intentos permitidos).
- Reserva sin trabajo: comportamiento anterior sin cambios (`cancelled` o `cancelled-late` segun la ventana).
- La validacion corre despues de la autorizacion existente: un tenant ajeno recibe el mismo `403 FORBIDDEN` haya o no vinculo,
  y el error `409` no incluye el `trabajoId` (el formato de error de calendario no tiene campo de detalle y no se amplio).
- Se valida en servidor; no depende de que Web o Mobile oculten acciones.

### Concurrencia (sin segunda estrategia de locking)

Se reutiliza el mecanismo de WEB-08H: lock de fila sobre `reservas` mediante un `UPDATE` sin cambio efectivo, dentro de
transacciones `Serializable` con reintento ante `P2034` (trabajo y calendario ya usaban ese regimen).

- **El trabajo toma el lock primero:** la cancelacion espera; al commit su transaccion falla por serializacion, reintenta,
  ve el trabajo y responde `RESERVATION_LINKED_TO_WORK`.
- **La cancelacion toma el lock primero:** la vinculacion espera; al commit reintenta, `lockForWork` ya no encuentra la
  reserva `confirmed` y responde `INVALID_RESERVATION_LINK`.
- En memoria, calendario y Trabajo comparten `SerializadorEnMemoria` (`apps/api/src/tus/domain/serializador-en-memoria.ts`)
  en la composicion, asi sus transacciones tampoco se intercalan.
- No hace falta DDL nuevo: `uq_trabajos_reserva` (WEB-08G) sigue siendo la garantia fisica de una reserva por trabajo; el
  estado cruzado lo garantizan el lock y la transaccion. Sin migracion en WEB-08I.

### Cancelacion desde el trabajo

Ya existia una operacion canonica (`cancelWork`, WEB-08E: solo prestador, `expectedVersion`, idempotente). Es ahora la
unica via para cancelar una reserva vinculada:

- En la misma transaccion: transicion del trabajo a `cancelled` + `TrabajoReservaPort.cancelForWork` (`UPDATE reservas SET
estado = 'cancelled', version = version + 1 WHERE ... estado = 'confirmed'`) + auditoria `reservation.cancelled` + evento
  `tus.work.cancelled` con `reservationId` y `reservationCancelled`. Un fallo en cualquier paso revierte trabajo y reserva.
- Se usa `cancelled` y no `cancelled-late`: la ventana tardia es una politica sobre el cliente y esta cancelacion la
  ejecuta el prestador.
- Idempotencia WEB-08G: misma clave → `replay` sin escrituras; otra clave sobre un trabajo ya cancelado →
  `409 INVALID_STATE` sin escrituras. No se agregaron estados.
- El cliente no cancela trabajos (decision WEB-08E vigente): con reserva vinculada debe gestionarlo con el prestador.

### Estados terminales

Estados reales: trabajo `requested | in_diagnosis | budget_pending | accepted | in_progress | completed | cancelled`;
reserva `confirmed | cancelled | cancelled-late | no-show`.

- Trabajo `cancelled` → la reserva vinculada queda `cancelled` en la misma transaccion (si seguia `confirmed`).
- Trabajo `completed` → la reserva queda `confirmed` como registro historico; no existe estado de reserva "cumplida" y no se
  inventa. El calendario tampoco puede marcarla `no-show`.
- Cualquier reconciliacion futura entre estado terminal del trabajo y reserva pertenece al flujo del trabajo.

### Correccion incidental

`POST /tus/v1/calendar/bookings/:id/cancel` y `/no-show` devolvian la reserva cruda; en reservas de publicacion
`priceSnapshot.minor` es `BigInt` y la respuesta fallaba con `500` despues de confirmar la cancelacion. Ahora usan la misma
proyeccion `proyectarResultadoReserva` que la creacion de reservas (omite `priceSnapshot`).

### Validacion

- `tests/foundation/web-08i.test.mjs` (4, composicion en memoria real + HTTP): cancelacion libre, `409` para cliente,
  prestador y no-show con reserva/trabajo/contadores intactos, tenant ajeno indistinguible, cancelacion coordinada con replay
  y sin duplicados, 6 carreras + ambos ordenes forzados, adapters Prisma. Sin la guarda, 3 de 4 tests fallan.
- Suites WEB-08/08FGH/09A-C, DB-09, p8/p9/p10, `tus-web-*` y `p0-contracts`: 252/252. Contracts (107), typecheck API/Web,
  `prisma validate`, build API y `git diff --check`: OK.
- Suite foundation completa: 592/605; las mismas 13 fallas preexistentes y ambientales registradas en WEB-08F/G/H, sin
  regresiones nuevas.
- **PostgreSQL 16 real** (cluster descartable `127.0.0.1:55442`, detenido y borrado; 39 migraciones aplicadas):
  - Reserva sin trabajo: `cancelled`, version 2.
  - Reserva con trabajo: cliente, prestador y no-show → `RESERVATION_LINKED_TO_WORK`; tenant ajeno → `FORBIDDEN` igual que
    sin vinculo; reserva, trabajo, outbox, idempotencia, auditorias y transiciones sin cambios.
  - Trabajo con el lock primero: la cancelacion espero 585 ms y fallo; reserva `confirmed`, trabajo creado.
  - Cancelacion con el lock primero: la vinculacion espero 575 ms y fallo con `INVALID_RESERVATION_LINK`; sin trabajo.
  - 12 carreras sin orden impuesto: 0 con ambos exitos, 0 estados inconsistentes (en todas gano la cancelacion, cuyo camino
    es mas corto; los dos ordenes quedan cubiertos por los escenarios forzados).
  - `cancelWork`: trabajo y reserva `cancelled` (version 2); +1 outbox, +2 auditorias, +1 transicion; replay y otra clave sin
    escrituras; el calendario sigue rechazando la reserva.
  - Fallo inyectado en el outbox de `cancelWork`: trabajo `requested` v1 y reserva `confirmed` v1, contadores intactos.
  - `uq_trabajos_reserva` presente; INSERT duplicado → `23505`.

## WEB-09D — preview de pago, comision configurable y cuentas de cobro (IMPLEMENTADO, 2026-09-24)

**Estado:** implementado backend + Web con el proveedor real apagado. Ningun cobro real es posible: el adaptador real de
pagos (WEB-09E) no existe y `ADAPTADOR_PAGO_REAL_DISPONIBLE = false`.

### Decisiones de producto cerradas

- Un servicio se paga cuando el Trabajo esta `completed`, antes del cierre financiero. Aceptar el presupuesto fija el
  monto contractual pero no cobra.
- El presupuesto aceptado y versionado es la unica autoridad monetaria. Nunca se cobra desde el precio de la publicacion
  (`precio_desde`, `por_hora` ni precio fijo): sin presupuesto aceptado el motivo es `BUDGET_REQUIRED`.
- El servidor calcula el importe; la Web no envia montos (`CLIENT_AUTHORITY_FIELDS` sigue vigente).
- Con el proveedor apagado la preview funciona, no se crea obligacion, intencion, auditoria ni outbox, y la Web muestra
  "Pago online no disponible todavia". Esto reemplaza el comportamiento WEB-09B de registrar intenciones `held-no-provider`
  (que quedaban `pending` para siempre): ahora `crearIntencionPago`/`prepararObligacion` fallan cerrado antes de escribir.
- Quien absorbe la comision de Mercado Pago **no esta decidido**: la politica nace con `pspFeeBearer = undetermined` y
  mientras siga asi los pagos no se pueden habilitar (`PSP_FEE_POLICY_UNDECIDED`).

### Backend

- `GET /tus/v1/work/:workId/payment-preview` (alias `/tus/v1/trabajos/:workId/pago/vista-previa`): solo el cliente del
  trabajo (prestador `403`, otro tenant `404`, sin sesion `403`). Devuelve `workId`, `workStatus`, servicio, prestador,
  presupuesto aceptado y version, `amountMinor` (string) y moneda, `payable` + `notPayableReason`, obligacion y ultimo
  estado de pago, `paymentAvailable` + `unavailableReason`. Solo lecturas; los parametros de query se ignoran.
- Motivos no cobrables: `WORK_NOT_COMPLETED`, `BUDGET_REQUIRED`, `BUDGET_INCONSISTENT`, `INCONSISTENT_COMMERCIAL_CHAIN`,
  `WORK_CANCELLED`, `ALREADY_PAID`, `OBLIGATION_CLOSED`. Motivos de indisponibilidad (en este orden): `PAYMENTS_DISABLED`,
  `PROVIDER_NOT_CONFIGURED`, `PSP_FEE_POLICY_UNDECIDED`, `PROVIDER_ACCOUNT_NOT_CONNECTED`. Los mismos codigos son el `code`
  del error al intentar crear la intencion (`409` no cobrable, `503` no disponible).
- Politica de comision (`politicas_comision_servicio`): basis points 0..3000 (el maximo de 30% garantiza neto positivo
  antes del fee PSP), alcance `prestador > categoria (cohorte) > global`, versionada con `expectedVersion`, append-only.
  Sin politica persistida rige la regla existente `mvp-10-percent-v1` (1000 bp) con fee PSP `undetermined`.
- Snapshot: al aprobarse un pago se congela en `instantaneas_comision` tasa, version de regla, `politica_comision_id`,
  comision, neto TUS (`monto_neto` = bruto - comision), fee PSP informado por el evento y `neto_prestador` (resta el fee
  solo si lo absorbe el prestador; `NULL` si no puede afirmarse). Cambiar la politica no modifica snapshots anteriores.
- Configuracion de producto (`configuraciones_pagos_servicio`): `paymentsEnabled`, proveedor y moneda (solo ARS),
  versionada y append-only. El estado operativo se deriva del entorno en cada consulta (solo booleanos; nunca valores).
- Cuenta de cobro del prestador: `GET /tus/v1/provider/payment-account`, `POST .../mercado-pago/connect`,
  `POST .../disconnect` (permiso `tus:marketplace:write` del tenant prestador) y callback
  `GET /tus/v1/integrations/mercado-pago/oauth/callback`. OAuth authorization code con `state` aleatorio de 32 bytes
  guardado solo como sha256, TTL 10 minutos y consumo atomico de un solo uso, PKCE S256 y `platform_id=mp`. Tokens
  (access, refresh, public key) cifrados AES-256-GCM con AAD por tenant en `credenciales_cuenta_cobro`; nunca se
  devuelven. El callback siempre redirige a `TUS_WEB_BASE_URL/tus/prestador?mercadoPago=connected|error`.
- Administracion (`/tus/v1/admin/payments/status|configuration|commission-policies`): exige `tus:payments:admin` **y** que
  el tenant de la sesion sea `TUS_PLATFORM_ADMIN_TENANT_ID`; sin esa variable todo responde `403`. Ninguna ruta acepta
  tokens ni secretos.
- Migracion `20260925100000_tus_service_payment_configuration`: aditiva, forward-only, aceptada por el gate DB-09
  (4 `append_only_guard`), sin DDL destructivo.

### Web

- `apps/web/src/components/compromisos/pago-trabajo.tsx`: bloque "Pago" en el detalle del trabajo del cliente con
  servicio, prestador, presupuesto/version, total, estado y boton solo si `paymentAvailable`. Formateo exacto con `BigInt`
  (`lib/tus-money.ts`), clave idempotente estable por intento, reintento sin doble cobro.
- `apps/web/src/components/prestador/cuenta-cobro.tsx`: estado de la cuenta de Mercado Pago, "Conectar" solo si el backend
  lo permite, redireccion solo a `https://*.mercadopago.com(.xx)`; ningun token en el navegador.

### Mercado Pago: producto elegido (documentacion oficial, consultada 2026-09-24)

Fuentes: Mercado Pago Developers Argentina — "Como integrar el checkout en marketplace", "OAuth", "Obtener Access Token",
"Renovar Access Token", "Gestionar Access Token" y "Notificaciones Webhooks" (Checkout Pro).

- Producto: **Checkout Pro o Checkout API en modalidad marketplace (split de pagos)**. El pago se crea con el
  `access_token` del vendedor (prestador) obtenido por OAuth; la comision de la plataforma va en `marketplace_fee`
  (Checkout Pro, `/checkout/preferences`) o `application_fee` (Checkout API, `/v1/payments`) como **monto**, no como
  porcentaje. TUS calcula ese monto en servidor desde el snapshot (bp -> minor units -> decimal solo en el adapter).
- Liquidacion: el split es automatico; el dinero entra a la cuenta del prestador y la comision a la cuenta de TUS. TUS no
  necesita transferir al prestador (sin payout manual ni Money Out en este flujo).
- Fee de Mercado Pago: segun la documentacion oficial "primero se descuenta la comision de Mercado Pago, y la comision del
  marketplace se descuenta del saldo restante", es decir que en el split nativo lo absorbe el vendedor. Si el negocio
  decide que lo absorba TUS (`platform`), hace falta un ajuste explicito del `marketplace_fee` que no esta implementado.
- OAuth: authorization code (`https://auth.mercadopago.com/authorization`, `POST https://api.mercadopago.com/oauth/token`),
  `code` valido 10 minutos, access token 180 dias, refresh con scope `offline_access`, PKCE recomendado (si se habilita en
  la app pasa a ser obligatorio), `redirect_uri` estatica identica a la configurada, `state` unico por intento. Los tokens
  se invalidan por revocacion, cambio de contrasena o eliminacion de la app; hay webhooks de (des)vinculacion.
- Webhooks: header `x-signature` `ts=<ms>,v1=<hmac>`, manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`,
  HMAC-SHA256 con la clave secreta de la aplicacion.
- No se pudo descargar la pagina oficial de reembolsos de marketplace (404 en el portal): antes de WEB-09E hay que
  confirmar como se reintegra `marketplace_fee` en un refund.

### Hallazgo para WEB-09E (no corregido)

`packages/mercado-pago/src/webhooks.ts` interpreta `ts` en segundos (`timestamp * 1000`), pero la documentacion oficial
lo muestra en milisegundos (`ts=1742505638683`). Con headers reales toda notificacion quedaria como expirada. Hoy no afecta
porque ese paquete no esta compuesto; debe corregirse con tests antes de conectar el webhook.

### Validacion

- `tests/foundation/web-09d-pagos-configuracion.test.mjs` (8) y `tests/foundation/tus-web-pagos.test.mjs` (2): los 16 casos
  pedidos (preview correcta, no completado, sin presupuesto, borrador, total del presupuesto, listing `desde` distinto,
  por hora, cliente/prestador/tenant ajeno, cero escrituras, proveedor apagado, comision exacta, snapshot inmutable ante
  cambio de politica, importes enteros, monto del frontend rechazado) mas OAuth, admin, HTTP y migracion.
- WEB-09A/B/C adaptados a la regla nueva (trabajo pagable = completado con presupuesto aceptado); el caso "sin proveedor"
  ahora verifica rechazo sin escrituras.
- Suite foundation: 615 tests, 588 ok; las mismas 27 fallas que HEAD sin cambios (605 tests, 578 ok): cero regresiones.
- **PostgreSQL 16 real descartable** (`127.0.0.1:55451`, detenido y borrado): 40/40 migraciones en 5,5 s; 25 casos SQL de
  CHECK/unique/trigger; adapters Prisma reales: carrera de politicas -> una `VERSION_CONFLICT`; dos callbacks OAuth con el
  mismo `state` -> uno `connected` y otro `INVALID_STATE`; los tokens no aparecen en claro. `migrate diff`: sin drift en
  objetos WEB-09D (el drift restante es historico).

### Revision de seguridad

| Riesgo                               | Control                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| IDOR / tenant ajeno                  | Lectura por `buscarTrabajoAccesible`; ajeno `404`, prestador `403` en preview y pago                |
| Monto manipulado por Web o prestador | Importe solo del presupuesto aceptado persistido; campos monetarios en el body -> `400`             |
| Replay / doble pago                  | Idempotencia financiera con huella en servidor; una intencion activa por obligacion; inbox unico    |
| Doble webhook / doble comision       | Inbox `(tenant, proveedor, evento)` unico + snapshot unico por obligacion + ids de ledger fijos     |
| Reembolso repetido                   | Solo por evento verificado; asiento `svc-refund-*` unico                                            |
| Snapshot de comision                 | Politica leida al aprobar y congelada; politicas append-only                                        |
| Overflow / negativos / floats        | `bigint` extremo a extremo, CHECKs no negativos, tasa 0..3000, `NEGATIVE_NET`                       |
| Secretos en logs/HTTP/Web            | Estado operativo solo booleanos; errores OAuth sin cuerpo del proveedor; nada en `NEXT_PUBLIC_*`    |
| OAuth CSRF / replay de callback      | `state` de 256 bits, hash en DB, TTL 10 min, consumo atomico unico, PKCE S256                       |
| Tokens del prestador                 | AES-256-GCM, AAD por tenant, clave fuera de la DB, borrado al desconectar                           |
| Administracion                       | Permiso + tenant de plataforma por variable; sin variable `403`                                     |
| Webhook sin verificar                | No existe ruta publica de webhook de servicios; WEB-09E debe verificar `x-signature` (ver hallazgo) |

Garantias que **no** estan probadas y por eso el dinero real sigue bloqueado: adaptador real de creacion de pago con
`marketplace_fee`, ruta publica de webhook con raw body y firma real, consulta del pago a Mercado Pago antes de aprobar,
refresh de tokens del prestador, refunds reales y conciliacion contra reportes del proveedor.

## WEB-09E — provider real (NO IMPLEMENTADO, fuera de alcance)

WEB-09D dejo OAuth del prestador, configuracion y comision listos, pero no se implementaron llamadas de cobro a Mercado
Pago, captura, marketplace_fee, payout, refund real, webhook publico ni activacion de provider actions. `TUS_PROVIDER_ACTIONS_ENABLED`, gates financieros y jobs de release siguen
apagados. El futuro adapter debe implementar `PuertoProveedorPagosServicio` sobre `packages/mercado-pago`, verificar la
firma con el raw body y consultar statements para la conciliacion.

## Decision

WEB-09 queda cerrada como auditoria y plan. No se implementa ni activa provider real, captura, split, refund externo,
settlement o payout. `TUS_PROVIDER_ACTIONS_ENABLED`, gates financieros y release jobs deben permanecer apagados.
