# Diccionario de datos TUS

> **ADVERTENCIA.** Este documento describe el modelo relacional **canónico objetivo** de TUS Core.
> No es una copia exacta del estado físico actual de PostgreSQL. Las FK marcadas `OBJETIVO_FUTURO`
> todavía no existen como constraint físico y se implementarán mediante migraciones forward-only posteriores.
> Las relaciones `[LOGICA]`, `[EXTERNA]`, `[POLIMORFICA]`, `[HISTORICA]`, `[TECNICA]` y `[LEGACY]` **no son FK SQL**.

---

## 1. Convenciones

- **`id`** — PK surrogate, `varchar`, estable e **inmutable**, generada por aplicación. No tiene significado de negocio.
- **`tenant_id`** — excepción técnica de aislamiento (permanece en inglés). Determina el ámbito de datos y autorización.
- **Business ID** (`prestador_id`, `compromiso_id`, `factura_id`, `pago_id`, `reserva_id`, …) — identidad de negocio, protegida por `UNIQUE (tenant_id, <id>)`.
- **Tipos monetarios** — `bigint` en unidades menores (NO `int`); nunca se reinterpreta su significado.
- **`json`** — valores serializados **congelados** (event types, `disposition`, `failedGates`, snapshots). No se renormalizan.
- **Estado de relación**:
  - `FISICA_ACTUAL` — ya existe como FK en PostgreSQL.
  - `OBJETIVO_FUTURO` — aprobada conceptualmente, se creará en la fase física.
  - `OBJETIVO_FUTURO_REQUIERE_VALIDACION` — aprobada pero bloqueada por `@default("")`, legacy o datos no auditados.
- **Clases de referencia no-FK**: `LOGICA`, `EXTERNA`, `POLIMORFICA`, `HISTORICA`, `TECNICA`, `LEGACY`.
- **ON UPDATE** — `NO ACTION` por defecto: PK y business IDs son inmutables.
- **ON DELETE** — `RESTRICT` por defecto (preservar información comercial/fiscal/auditoría); `CASCADE` solo en hijos estrictamente dependientes sin valor autónomo.

---

## 2. Matriz de PK

| TABLA | PK | TIPO | RAZÓN | BUSINESS ID | UNIQUE TENANT-SCOPED |
|---|---|---|---|---|---|
| `prestadores` | `id` | varchar | Surrogate estable e inmutable; `prestador_id` es de negocio | `prestador_id` | `(tenant_id, prestador_id)` [objetivo] |
| `publicaciones` | `id` | varchar | Surrogate; la publicación cambia de versión/disponibilidad | — | — |
| `compromisos_mercado_servicios` | `id` | varchar | Surrogate | `compromiso_id` | `(tenant_id, compromiso_id)` |
| `auditoria_mercado_servicios` | `id` | varchar | Surrogate | — | — |
| `compromisos` | `id` | varchar | Surrogate del agregado | `compromiso_id` | `(tenant_id, compromiso_id)` |
| `transiciones_compromiso` | `id` | varchar | Surrogate histórico | — | `(tenant_id, compromiso_id, version)` |
| `compensaciones_compromiso` | `id` | varchar | Surrogate | `compensacion_id` | `(tenant_id, compensacion_id)` |
| `referencias_auditoria` | `id` | varchar | Surrogate | `referencia_id` | `(tenant_id, referencia_id)` |
| `calendarios` | `id` | varchar | Surrogate | — | — |
| `reglas_calendario` | `id` | varchar | Surrogate | — | `(tenant_id, calendario_id, weekday, starts_at, ends_at)` |
| `excepciones_calendario` | `id` | varchar | Surrogate | — | — |
| `reservas` | `id` | varchar | Surrogate | `reserva_id` | `(tenant_id, reserva_id)` |
| `zonas_entrega` | `id` | varchar | Surrogate | `zona_id` | `(tenant_id, zona_id)` |
| `turnos_entrega` | `id` | varchar | Surrogate | `turno_id` | `(tenant_id, turno_id)` |
| `tareas_entrega` | `id` | varchar | Surrogate | `tarea_id` | `(tenant_id, tarea_id)` |
| `evidencias_entrega` | `id` | varchar | Surrogate | `evidencia_id` | `(tenant_id, evidencia_id)` |
| `incidentes_entrega` | `id` | varchar | Surrogate | `incidente_id` | `(tenant_id, incidente_id)` |
| `auditoria_entrega` | `id` | varchar | Surrogate | `auditoria_id` | `(tenant_id, auditoria_id)` |
| `operaciones_pos` | `id` | varchar | Surrogate | `operacion_id` | `(tenant_id, operacion_id)` + `(tenant_id, idempotency_key)` |
| `versiones_pos` | `id` | varchar | Surrogate | — | `(tenant_id, shift_id)` |
| `comprobantes_pos` | `id` | varchar | Surrogate | `comprobante_id` | `(tenant_id, comprobante_id)` |
| `dispositivos_pos` | `id` | varchar | Surrogate | `dispositivo_id` | `(tenant_id, dispositivo_id)` |
| `sesiones_pos` | `id` | varchar | Surrogate | `sesion_id` | `(tenant_id, sesion_id)` |
| `conflictos_pos` | `id` | varchar | Surrogate | `conflicto_id` | `(tenant_id, conflicto_id)` |
| `auditoria_pos` | `id` | varchar | Surrogate | `auditoria_id` | `(tenant_id, auditoria_id)` |
| `casos_soporte` | `id` | varchar | Surrogate | `caso_id` | `(tenant_id, caso_id)` |
| `evidencias_soporte` | `id` | varchar | Surrogate | `evidencia_id` | `(tenant_id, evidencia_id)` |
| `lineas_tiempo_soporte` | `id` | varchar | Surrogate | `entrada_id` | `(tenant_id, entrada_id)` |
| `compensaciones_soporte` | `id` | varchar | Surrogate | `entrada_id` | `(tenant_id, entrada_id)` |
| `acciones_whatsapp` | `id` | varchar | Surrogate | — | `(tenant_id, idempotency_key)` |
| `confirmaciones_whatsapp` | `id` | varchar | Surrogate | `confirmacion_id` | `(tenant_id, confirmacion_id)` |
| `auditoria_whatsapp` | `id` | varchar | Surrogate | — | — |
| `consentimientos_whatsapp` | `id` | varchar | Surrogate | — | `(tenant_id, recipient_id)` |
| `mensajes_whatsapp` | `id` | varchar | Surrogate | `mensaje_id` | `(tenant_id, mensaje_id)` |
| `eventos_webhook_whatsapp` | `id` | varchar | Surrogate | — | `(tenant_id, provider_event_id)` |
| `evidencias_habilitacion` | `id` | varchar | Surrogate | — | `(tenant_id, capability, gate, referencia_evidencia)` |
| `decisiones_habilitacion` | `id` | varchar | Surrogate (append-only) | — | — |
| `intenciones_pago` | `id` | varchar | Surrogate | `pago_id` | `(tenant_id, pago_id)` + `(tenant_id, compromiso_id)` + `(tenant_id, idempotency_key)` |
| `idempotencia_financiera` | `id` | varchar | Surrogate | — | `(tenant_id, idempotency_key)` |
| `instantaneas_comision` | `id` | varchar | Surrogate | `instantanea_id` | `(tenant_id, instantanea_id)` + `(tenant_id, compromiso_id)` |
| `movimientos_contables` | `id` | varchar | Surrogate (append-only) | `entrada_id` | `(tenant_id, entrada_id)` |
| `evidencias_financieras` | `id` | varchar | Surrogate | `evidencia_id` | `(tenant_id, evidencia_id)` |
| `confirmaciones_financieras` | `id` | varchar | Surrogate | `confirmacion_id` | `(tenant_id, confirmacion_id)` + `(tenant_id, compromiso_id)` |
| `bloqueos_financieros` | `id` | varchar | Surrogate | `bloqueo_id` | `(tenant_id, bloqueo_id)` + `(tenant_id, compromiso_id)` |
| `registros_conciliacion` | `id` | varchar | Surrogate | `conciliacion_id` | `(tenant_id, conciliacion_id)` + `(tenant_id, compromiso_id)` |
| `eventos_webhook_pago` | `id` | varchar | Surrogate | — | `(tenant_id, provider, provider_event_id)` |
| `facturas` | `id` | varchar | Surrogate (append-only) | `factura_id` | `(tenant_id, factura_id)` |
| `lineas_factura` | `id` | varchar | Surrogate | — | `(tenant_id, id)` (redundante con PK) |
| `notas_credito` | `id` | varchar | Surrogate (append-only) | `nota_credito_id` | `(tenant_id, nota_credito_id)` |
| `suscripciones` | `id` | varchar | Surrogate | `suscripcion_id` | `(tenant_id, suscripcion_id)` |
| `perfiles_fiscales` | `id` | varchar | Surrogate | — | `(tenant_id, party_id)` |
| `cuentas_facturacion` | `id` | varchar | Surrogate | `cuenta_facturacion_id` | `(tenant_id, cuenta_facturacion_id)` |
| `planes_suscripcion` | `id` | varchar | Surrogate | `plan_id` | `(tenant_id, plan_id)` |
| `reintegros_facturacion` | `id` | varchar | Surrogate (append-only) | `reintegro_id` | `(tenant_id, reintegro_id)` |
| `movimientos_contables_facturacion` | `id` | varchar | Surrogate (append-only) | `entrada_id` | `(tenant_id, entrada_id)` |
| `idempotencia_facturacion` | `id` | varchar | Surrogate | — | `(tenant_id, key)` |
| `auditoria_facturacion` | `id` | varchar | Surrogate (append-only) | `auditoria_id` | `(tenant_id, auditoria_id)` |
| `gestion_mora` | `id` | varchar | Surrogate | `mora_id` | `(tenant_id, mora_id)` |
| `secuencias_numeracion` | `id` | varchar | Surrogate | — | `tenant_id` (1:1) |
| `exportaciones_contables` | `id` | varchar | Surrogate (append-only) | `exportacion_id` | `(tenant_id, exportacion_id)` |
| `outbox_entrega` | `id` | varchar | Surrogate | `event_id` | `(tenant_id, event_id)` |
| `outbox_pos` | `id` | varchar | Surrogate | `event_id` | `(tenant_id, event_id)` |
| `outbox_soporte` | `id` | varchar | Surrogate | `event_id` | `(tenant_id, event_id)` |
| `outbox_whatsapp` | `id` | varchar | Surrogate | `event_id` | `(tenant_id, event_id)` |
| `outbox_facturacion` | `id` | varchar | Surrogate | `event_id` | `(tenant_id, event_id)` |
| `registros_operaciones` | `id` | varchar | Surrogate | — | — |

**Regla de PK:** no se necesitan PK compuestas en el núcleo TUS. La identidad de negocio se protege por UNIQUE tenant-scoped; la PK queda surrogada y simple.

---

## 3. Matriz de FK

| ORIGEN | COLUMNAS | DESTINO | ESTADO | RAZÓN | CARDINALIDAD | NULLABLE | ON DELETE | ON UPDATE | REQUIERE AUDITAR DATOS |
|---|---|---|---|---|---|---|---|---|---|
| `lineas_factura` | `(tenant_id, factura_id)` | `facturas` | FISICA_ACTUAL | Línea depende de su factura | N:1 | NO | NO ACTION | NO ACTION | No |
| `publicaciones` | `(tenant_id, prestador_id)` | `prestadores` | OBJETIVO_FUTURO | Publicación pertenece a un prestador | N:1 | NO | RESTRICT | NO ACTION | Sí (cross-tenant, huérfanos) |
| `compromisos` | `(tenant_id, prestador_id)` | `prestadores` | OBJETIVO_FUTURO | Obligación comercial con prestador | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `transiciones_compromiso` | `(tenant_id, compromiso_id)` | `compromisos` | OBJETIVO_FUTURO | Histórico de un compromiso | N:1 | NO | RESTRICT | NO ACTION | Sí (huérfanos) |
| `compensaciones_compromiso` | `(tenant_id, compromiso_id)` | `compromisos` | OBJETIVO_FUTURO | Compensación de un compromiso | 1:1 | NO | RESTRICT | NO ACTION | Sí |
| `compromisos_mercado_servicios` | `(tenant_id, publicacion_id)` | `publicaciones` | OBJETIVO_FUTURO_REQUIERE_VALIDACION | Línea de checkout referencia listing | N:1 | NO | RESTRICT | NO ACTION | Sí (listing sin unique por tenant) |
| `reglas_calendario` | `(tenant_id, calendario_id)` | `calendarios` | OBJETIVO_FUTURO | Regla depende del calendario | N:1 | NO | CASCADE | NO ACTION | Sí |
| `excepciones_calendario` | `(tenant_id, calendario_id)` | `calendarios` | OBJETIVO_FUTURO | Excepción depende del calendario | N:1 | NO | CASCADE | NO ACTION | Sí |
| `reservas` | `(tenant_id, calendario_id)` | `calendarios` | OBJETIVO_FUTURO | Reserva ocupa franja de un calendario | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `turnos_entrega` | `(tenant_id, zona_id)` | `zonas_entrega` | OBJETIVO_FUTURO | Turno en una zona | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `evidencias_entrega` | `(tenant_id, tarea_id)` | `tareas_entrega` | OBJETIVO_FUTURO | Comprobante de una tarea | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `incidentes_entrega` | `(tenant_id, tarea_id)` | `tareas_entrega` | OBJETIVO_FUTURO | Incidente de una tarea | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `comprobantes_pos` | `(tenant_id, operacion_id)` | `operaciones_pos` | OBJETIVO_FUTURO | Comprobante de una operación | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `conflictos_pos` | `(tenant_id, operacion_id)` | `operaciones_pos` | OBJETIVO_FUTURO | Conflicto de una operación | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `evidencias_soporte` | `(tenant_id, caso_id)` | `casos_soporte` | OBJETIVO_FUTURO | Evidencia de un caso | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `lineas_tiempo_soporte` | `(tenant_id, caso_id)` | `casos_soporte` | OBJETIVO_FUTURO | Timeline de un caso | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `compensaciones_soporte` | `(tenant_id, caso_id)` | `casos_soporte` | OBJETIVO_FUTURO | Compensación de un caso | 1:1 | NO | RESTRICT | NO ACTION | Sí |
| `intenciones_pago` | `(tenant_id, compromiso_id)` | `compromisos` | OBJETIVO_FUTURO | Pago de un compromiso | 1:1 | NO | RESTRICT | NO ACTION | Sí |
| `instantaneas_comision` | `(tenant_id, compromiso_id)` | `compromisos` | OBJETIVO_FUTURO | Snapshot de un compromiso | 1:1 | NO | RESTRICT | NO ACTION | Sí |
| `movimientos_contables` | `(tenant_id, compromiso_id)` | `compromisos` | OBJETIVO_FUTURO | Movimiento de un compromiso | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `evidencias_financieras` | `(tenant_id, compromiso_id)` | `compromisos` | OBJETIVO_FUTURO | Evidencia de un compromiso | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `confirmaciones_financieras` | `(tenant_id, compromiso_id)` | `compromisos` | OBJETIVO_FUTURO | Confirmación de un compromiso | 1:1 | NO | RESTRICT | NO ACTION | Sí |
| `bloqueos_financieros` | `(tenant_id, compromiso_id)` | `compromisos` | OBJETIVO_FUTURO | Congelamiento de un compromiso | 1:1 | NO | RESTRICT | NO ACTION | Sí |
| `registros_conciliacion` | `(tenant_id, compromiso_id)` | `compromisos` | OBJETIVO_FUTURO | Conciliación de un compromiso | 1:1 | NO | RESTRICT | NO ACTION | Sí |
| `facturas` | `(tenant_id, compromiso_id)` | `compromisos` | OBJETIVO_FUTURO_REQUIERE_VALIDACION | Documento sobre un compromiso | N:1 | NO | RESTRICT | NO ACTION | Sí (`""` permitido) |
| `notas_credito` | `(tenant_id, factura_id)` | `facturas` | OBJETIVO_FUTURO | NC reduce una factura | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `reintegros_facturacion` | `(tenant_id, factura_id)` | `facturas` | OBJETIVO_FUTURO | Reintegro de una factura | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `movimientos_contables_facturacion` | `(tenant_id, factura_id)` | `facturas` | OBJETIVO_FUTURO | Ledger de una factura | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `gestion_mora` | `(tenant_id, suscripcion_id)` | `suscripciones` | OBJETIVO_FUTURO | Mora de una suscripción | N:1 | NO | RESTRICT | NO ACTION | Sí |
| `suscripciones` | `(tenant_id, plan_id)` | `planes_suscripcion` | OBJETIVO_FUTURO_REQUIERE_VALIDACION | Suscripción a un plan | N:1 | NO | RESTRICT | NO ACTION | Sí (`""` permitido) |

---

## 4. Matriz de relaciones NO-FK

| TABLA | CAMPO | TIPO | DESTINO CONCEPTUAL | RAZÓN DE NO FK | PROTECCIÓN DE INTEGRIDAD |
|---|---|---|---|---|---|
| `publicaciones` | `prestador_id` | (ver FK) | prestadores | — | — |
| `tareas_entrega` | `compromiso_id` | LOGICA | compromisos | Entrega puede vivir más que el compromiso | Aplicación |
| `tareas_entrega` | `operador_id` | EXTERNA | Personal | Actor no persistido como entidad propia | Aplicación |
| `tareas_entrega` | `prestador_id` | LOGICA | prestadores | Referencia de negocio | Aplicación |
| `tareas_entrega` | `zona_id`, `turno_id` | LOGICA | zonas/turnos | Referencias operativas | Aplicación |
| `casos_soporte` | `compromiso_id`, `disputa_id` | LOGICA | compromisos/disputas | Soporte puede existir sin compromiso | Aplicación |
| `referencias_auditoria` | `compromiso_id` | LOGICA | compromisos | Traza puede sobrevivir al agregado | Aplicación |
| `movimientos_contables` | `linked_entry_id` | LOGICA | movimientos_contables (self) | Auto-referencia append-only | Aplicación |
| `movimientos_contables_facturacion` | `linked_entry_id`, `credit_note_id`, `refund_id` | LOGICA | ledger/NC/reintegro | Auto-referencia | Aplicación |
| `facturas` | `account_id`, `pago_id`, `order_id`, `pos_operation_id` | LOGICA | cuentas/pagos/ordenes/operaciones | `""` permitidos; referencias de negocio | Aplicación |
| `suscripciones` | `cliente_id` | EXTERNA/LOGICA | cliente | Cliente no es entidad TUS persistida | Aplicación |
| `perfiles_fiscales` | `party_id` | POLIMORFICA | parte fiscal | Parte polimórfica | Aplicación |
| `cuentas_facturacion` | `party_id` | POLIMORFICA | parte | Parte polimórfica | Aplicación |
| `mensajes_whatsapp` | `consentimiento_id` | LOGICA | consentimientos_whatsapp | Referencia lógica | Aplicación |
| `evidencias_habilitacion` | `capability`, `gate`, `owner`, `scope` | POLIMORFICA | capacidad/gate | Referencias polimórficas | Evaluación de habilitación |
| `decisiones_habilitacion` | `capability`, `profile`, `scope` | POLIMORFICA | capacidad | Referencias polimórficas | Evaluación de habilitación |
| `auditoria_*` (todas) | `resource_type` + `resource_id` | POLIMORFICA | agregados | Recurso polimórfico | Aplicación |
| `auditoria_*` | `actor_id`, `correlation_id` | LOGICA/TECNICA | actor/correlación | Identificadores de contexto | Aplicación |
| `intenciones_pago` | `provider`, `provider_reference`, `provider_status` | EXTERNA | Mercado Pago/pasarela | Integración externa | Contrato de proveedor |
| `instantaneas_comision` | `provider_reference` | EXTERNA | proveedor | Integración externa | Contrato de proveedor |
| `registros_conciliacion` | `provider_reference`, `provider_amount` | EXTERNA | proveedor | Integración externa | Contrato de proveedor |
| `eventos_webhook_pago` | `provider`, `provider_event_id`, `signature`, `payload` | EXTERNA | webhook de proveedor | Integración externa | Verificación de firma |
| `eventos_webhook_whatsapp` | `provider_event_id`, `signature` | EXTERNA | Meta/WhatsApp | Integración externa | Verificación de firma |
| `confirmaciones_whatsapp` | `sender_id` | EXTERNA | número Meta | Integración externa | Contrato Meta |
| `mensajes_whatsapp` | `recipient_id`, `template`, `template_version` | EXTERNA | Meta/WhatsApp | Integración externa | Contrato Meta |
| `consentimientos_whatsapp` | `recipient_id`, `recipient_type` | EXTERNA | identidad externa | Integración externa | Aplicación |
| `evidencias_habilitacion` | `referencia_evidencia` | EXTERNA | evidencia externa | Referencia externa | Aplicación |
| `perfiles_fiscales` | `authority`, `external_approval_reference`, `evidence_ref` | EXTERNA | AFIP/ARCA | Integración externa | Contrato fiscal |
| `exportaciones_contables` | `external_approval_reference` | EXTERNA | contabilidad externa | Integración externa | Contrato contable |
| `calendarios` | `service_id` | LEGACY | TusService | Acoplamiento legacy | Pendiente migración |
| `reservas` | `service_id` | LEGACY | TusService | Acoplamiento legacy | Pendiente migración |
| `reservas` | `cliente_id` | EXTERNA/LOGICA | cliente | Cliente no es entidad persistida | Aplicación |
| `outbox_*` (todos) | `aggregate_id` | POLIMORFICA | agregado | Agregado polimórfico | Dispatcher de worker |
| `outbox_*` (todos) | `event_type` | TECNICA | — | Identificador técnico congelado | Constante |
| `registros_operaciones` | `context`, `channel`, `geography` | TECNICA | — | Dimensiones de reporting | Aplicación |

---

## 5. Datos a auditar antes de crear FKs (solo lectura)

Nunca ejecutar `DELETE`/`UPDATE`/`TRUNCATE`. Estas consultas detectan huérfanos y bloqueos antes de `ADD CONSTRAINT`.

```sql
-- Publicaciones cuyo prestador no existe en el mismo tenant
SELECT l.tenant_id, l.id, l."merchantId"
FROM "TusListing" l
LEFT JOIN "TusMerchant" m
  ON m.tenant_id = l.tenant_id AND m."merchantId" = l."merchantId"
WHERE m.id IS NULL;

-- Duplicados de merchantId por tenant (rompería el futuro unique)
SELECT tenant_id, "merchantId", COUNT(*)
FROM "TusMerchant"
GROUP BY tenant_id, "merchantId"
HAVING COUNT(*) > 1;

-- Transiciones/compensaciones sin compromiso
SELECT t.tenant_id, t."commitmentId"
FROM "TusCommitmentTransition" t
LEFT JOIN "TusCommitment" c
  ON c.tenant_id = t.tenant_id AND c."commitmentId" = t."commitmentId"
WHERE c.id IS NULL;

-- Referencias cross-tenant (listing de tenant A apuntando merchant de tenant B)
SELECT l.tenant_id, l."merchantId"
FROM "TusListing" l
WHERE NOT EXISTS (
  SELECT 1 FROM "TusMerchant" m
  WHERE m.tenant_id = l.tenant_id AND m."merchantId" = l."merchantId"
);

-- Facturas con commitmentId vacío o inexistente
SELECT tenant_id, "invoiceId", "commitmentId"
FROM "TusInvoice"
WHERE "commitmentId" = '' OR "commitmentId" NOT IN (
  SELECT "commitmentId" FROM "TusCommitment"
);

-- NULL/vacíos que bloquean FK (@default "")
SELECT 'invoice.accountId' k, COUNT(*) FROM "TusInvoice" WHERE "accountId" = ''
UNION ALL SELECT 'invoice.paymentId', COUNT(*) FROM "TusInvoice" WHERE "paymentId" = ''
UNION ALL SELECT 'subscription.planId', COUNT(*) FROM "TusSubscription" WHERE "planId" = '';

-- Compromisos de mercado cuyo listing no existe
SELECT mc.tenant_id, mc."listingId"
FROM "TusMarketplaceCommitment" mc
LEFT JOIN "TusListing" l ON l.id = mc."listingId"
WHERE l.id IS NULL;
```

---

## 6. Detalle por dominio

### 6.1 Mercado

**`prestadores`** — Perfil operativo/comercial del prestador (ex `TusMerchant`).
- PK `id` (surrogate); business ID `prestador_id` (ex `merchantId`).
- UNIQUE objetivo `(tenant_id, prestador_id)`; hoy solo `tenant_id` es `@unique` (1 tenant = 1 prestador actualmente).
- FK entrantes objetivo: `publicaciones`, `compromisos`.
- Invariante: `prestador_id` inmutable; `operating_policy_version` gobierna la política operativa.

**`publicaciones`** — Oferta visible (ex `TusListing`).
- PK `id`; FK objetivo `(tenant_id, prestador_id) → prestadores`, `onDelete RESTRICT`.
- Nota: la relación Prisma actual usa `tenantId` (incorrecta) con `onDelete Cascade`; el modelo objetivo la corrige a `prestador_id`.

**`compromisos_mercado_servicios`** — Línea/compromiso de checkout del mercado (ex `TusMarketplaceCommitment`).
- PK `id`; `compromiso_id` unique tenant-scoped.
- FK objetivo `publicacion_id → publicaciones`; `prestador_id` referencia lógica.

**`auditoria_mercado_servicios`** — Traza de acciones de mercado.
- `resource_type`/`resource_id` polimórficos; sin FK.

### 6.2 Compromisos

**`compromisos`** — Obligación comercial canónica (ex `TusCommitment`).
- PK `id`; `compromiso_id` unique tenant-scoped; versionado optimista (`version`).
- FK objetivo `prestador_id → prestadores`; es el agregado referenciado por transiciones, compensaciones, finanzas y facturación.

**`transiciones_compromiso`** — Histórico append-only de transiciones.
- UNIQUE `(tenant_id, compromiso_id, version)`; FK objetivo `compromiso_id → compromisos` RESTRICT.

**`compensaciones_compromiso`** — Compensación 1:1 por compromiso; FK objetivo RESTRICT.

**`referencias_auditoria`** — Referencias de auditoría; `compromiso_id` lógica.

### 6.3 Calendario

**`calendarios`** — Calendario de disponibilidad; propietario canónico = prestador (hoy `service_id` apunta a legacy `TusService`).
**`reglas_calendario`** / **`excepciones_calendario`** — Hijos dependientes; FK objetivo `calendario_id → calendarios` CASCADE.
**`reservas`** — Ocupación de franja; FK objetivo `calendario_id → calendarios` RESTRICT; `cliente_id` externa/lógica; `service_id` legacy.

### 6.4 Entrega

**`zonas_entrega`** → **`turnos_entrega`** (FK objetivo zona, RESTRICT) → **`tareas_entrega`** (referencias lógicas a zona/turno/compromiso; `operador_id` nullable/externa) ← **`evidencias_entrega`** y **`incidentes_entrega`** (FK objetivo a tarea, RESTRICT).
**`auditoria_entrega`** — traza polimórfica.

### 6.5 POS

**`operaciones_pos`** — agregado; idempotencia `(tenant_id, idempotency_key)`.
**`comprobantes_pos`** / **`conflictos_pos`** — FK objetivo a `operaciones_pos`, RESTRICT.
**`versiones_pos`**, **`dispositivos_pos`**, **`sesiones_pos`** — soporte operativo; referencias lógicas.
**`auditoria_pos`** — traza; `operacion_id` lógica.

### 6.6 Soporte

**`casos_soporte`** — caso de asistencia; `compromiso_id`/`disputa_id` lógicas.
**`evidencias_soporte`**, **`lineas_tiempo_soporte`**, **`compensaciones_soporte`** — FK objetivo a `casos_soporte`, RESTRICT (compensación 1:1).

### 6.7 WhatsApp

Canal gobernado. Referencias externas a Meta (`sender_id`, `recipient_id`, `template`, `provider_event_id`, `signature`) nunca son FK. `consentimiento_id` lógica. Idempotencia en `acciones_whatsapp`.

### 6.8 Habilitación

**`evidencias_habilitacion`** y **`decisiones_habilitacion`** — históricas/append-only; `capability`/`gate`/`owner`/`scope`/`profile` polimórficos, sin FK. Valores serializados congelados (`resultado_habilitacion`, `requisitos_fallidos`, `ids_evidencia`).

### 6.9 Finanzas

Todas las entidades de finanzas referencian `compromiso_id` (FK objetivo RESTRICT, mayormente 1:1). `provider`/`provider_reference`/`provider_status`/`provider_event_id`/`signature` son EXTERNAS. Ledger es append-only con trigger; auto-referencia `linked_entry_id` lógica.

### 6.10 Facturación

**`facturas`** — documento fiscal append-only (trigger); FK objetivo `compromiso_id → compromisos` (requiere validar `""`).
**`lineas_factura`** — FK **FISICA_ACTUAL** compuesta `(tenant_id, factura_id) → facturas`.
**`notas_credito`**, **`reintegros_facturacion`**, **`movimientos_contables_facturacion`** — FK objetivo a `facturas`, RESTRICT.
**`suscripciones`** — `plan_id` FK objetivo (requiere validar `""`); `cliente_id` externa.
**`perfiles_fiscales`** / **`cuentas_facturacion`** — `party_id` polimórfica.
**`gestion_mora`** — FK objetivo a `suscripciones`.
**`secuencias_numeracion`** — 1:1 por tenant.
**`exportaciones_contables`** — append-only; `invoice_ids`/`ledger_entry_ids` lógicas; `external_approval_reference` externa.

### 6.11 Outbox TUS

`outbox_entrega`, `outbox_pos`, `outbox_soporte`, `outbox_whatsapp`, `outbox_facturacion` — `event_type` técnico congelado; `aggregate_id` polimórfico. Sin FK.

### 6.12 Reporting

**`registros_operaciones`** — métrica operativa; sin FK.

---

## 7. Deuda legacy documentada

- `calendarios.service_id` y `reservas.service_id` → todavía acopladas a `TusService` (legacy). **Pendiente migración** a `prestador_id`/`publicacion_id`.
- `TusProduct`, `TusService`, `TusInventory`, `TusTenant` — legacy, excluidos del DER Core; `TusInventory.product_id → TusProduct` es deuda a resolver antes de eliminar esos modelos.
- Uniques redundantes `(tenant_id, id)` en calendario/excepción/dead-letter — eliminar en fase física.
- Relación Prisma actual `TusListing → TusMerchant` por `tenantId` — reemplazar por `prestador_id` (documentada en `publicaciones`).

---

## 8. Notas de ON DELETE / ON UPDATE

- **ON UPDATE**: `NO ACTION` global. PK e IDs de negocio son inmutables.
- **ON DELETE**:
  - `CASCADE` solo en composición pura: `reglas_calendario`, `excepciones_calendario` (hijos sin valor autónomo del calendario).
  - `RESTRICT` en todo lo comercial/financiero/fiscal/auditoría: prestador↔publicación, compromisos y sus históricos, finanzas, facturación, soporte.
  - `NO ACTION` mantenido para la FK ya existente `lineas_factura → facturas`.
- Nunca CASCADE por comodidad; nunca CASCADE sobre snapshots/ledgers/auditorías.
