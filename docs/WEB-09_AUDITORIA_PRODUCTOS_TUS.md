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

## Decision

WEB-09 queda cerrada como auditoria y plan. No se implementa ni activa provider real, captura, split, refund externo,
settlement o payout. `TUS_PROVIDER_ACTIONS_ENABLED`, gates financieros y release jobs deben permanecer apagados.
