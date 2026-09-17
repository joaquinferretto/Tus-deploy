# Diccionario de datos TUS

> **ESTADO FÍSICO.** Este documento describe el modelo relacional canónico de TUS Core y el estado
> físico posterior a la migración `20260914180000_tus_physical_spanish`: el núcleo TUS ya usa
> tablas, columnas, índices, uniques y FKs en español `snake_case`. Las FK marcadas `OBJETIVO_FUTURO`
> siguen siendo conceptuales y se implementarán mediante migraciones forward-only posteriores.
> Las relaciones `[LOGICA]`, `[EXTERNA]`, `[POLIMORFICA]`, `[HISTORICA]`, `[TECNICA]` y `[LEGACY]` **no son FK SQL**.
> La validación de esta fase demuestra paridad entre el target descartable y `factory_local`, incluyendo el
> inventario de índices canónicos definido en el DER.
>
> **Nomenclatura:** todo nombre de tabla, columna, índice, unique y FK controlado por TUS está en
> español `snake_case`. Se conservan únicamente excepciones técnicas justificadas: `id`, `tenant_id`,
> `actor_id`, `POS`, `WhatsApp` y `sla`. Los **valores** externos/técnicos congelados NO se traducen.
>
> **Alcance WEB-04D2/WEB-04D3 (2026-09-17, base `5f56c84`).** Estas Builds no modifican el modelo físico ni crean una
> migración. D2 activa en la aplicación el uso canónico de campos existentes desde WEB-04D1; D3 conecta la superficie Web
> con discovery, slots y bookings canónicos por `listingId`. El adapter Prisma traduce los valores físicos en español a
> los valores contractuales vigentes.
>
> **Auditoría WEB-08 (2026-09-17, base `de0f5cb`).** Esta Build no agrega tablas, columnas, índices, constraints ni
> migraciones. No existen en el modelo físico canónico `trabajos`, `diagnosticos`, `presupuestos` ni sus líneas/aceptaciones.
> `TusJob` es una tabla técnica de cola; `confirmaciones_whatsapp` conserva snapshots expirable del canal y no es un
> presupuesto comercial de servicio.

---

## 1. Convenciones

- **`id`** — PK surrogate, `varchar`, estable e **inmutable**, generada por aplicación. Sin significado de negocio.
- **`tenant_id`** — excepción técnica de aislamiento (permanece en inglés). Determina el ámbito de datos y autorización.
- **Business ID** (`prestador_id`, `compromiso_id`, `factura_id`, `pago_id`, `reserva_id`, …) — identidad de negocio, protegida por `UNIQUE (tenant_id, <id>)`.
- **`actor_id`** — identificador técnico transversal del actor que ejecuta una acción (excepción justificada).
- **Tipos monetarios** — `bigint` en unidades menores (NO `int`); nunca se reinterpreta su significado.
- **`json`** — valores serializados **congelados** (event types, `resultado_habilitacion`, `requisitos_fallidos`, snapshots). Solo se diseña el nombre de columna; el valor no se traduce.
- **Estado de relación**:
  - `FISICA_ACTUAL` — ya existe como FK en PostgreSQL.
  - `OBJETIVO_FUTURO` — aprobada conceptualmente, se creará en la fase física.
  - `OBJETIVO_FUTURO_REQUIERE_VALIDACION` — aprobada pero bloqueada por `@default("")`, legacy o datos no auditados.
- **Clases de referencia no-FK**: `LOGICA`, `EXTERNA`, `POLIMORFICA`, `HISTORICA`, `TECNICA`, `LEGACY`.
- **ON UPDATE** — `NO ACTION` por defecto: PK y business IDs son inmutables.
- **ON DELETE** — `RESTRICT` por defecto (preservar información comercial/fiscal/auditoría); `CASCADE` solo en hijos estrictamente dependientes sin valor autónomo.

### Regla de aislamiento por tenant (FK físicas)

> **Toda FK física entre dos entidades tenant-scoped debe garantizar mismo tenant a nivel PostgreSQL.**
>
> Forma canónica: `hijo.(tenant_id, referencia_id) → padre.(tenant_id, identificador_referenciado)`.
> No se confía solo en validación de aplicación para relaciones que son FK físicas.
>
> - Si el padre tiene **business ID** estable con `UNIQUE (tenant_id, business_id)` aprobado → usar `(tenant_id, business_id)`.
> - Si el padre **no tiene** business ID apropiado → usar `(tenant_id, id)` y declarar un `UNIQUE (tenant_id, id)` redundante (necesario para que PostgreSQL admita la FK compuesta).
> - No aplica a referencias EXTERNAS, LOGICAS, POLIMORFICAS ni a entidades globales no tenant-scoped.

---

## 2. Trazabilidad de nombres de columna (pre-migración → físico actual)

Deja trazabilidad de los renombres físicos aplicados por la migración. Muestra solo campos relevantes.

| Nombre físico pre-migración | Nombre físico actual | Tabla |
|---|---|---|
| `merchantId` | `prestador_id` | prestadores, publicaciones, compromisos, compromisos_mercado_servicios, tareas_entrega |
| `listingId` | `publicacion_id` | compromisos_mercado_servicios |
| `commitmentId` | `compromiso_id` | compromisos y dependientes |
| `cartId` | `carrito_id` | compromisos, compromisos_mercado_servicios |
| `lineIds` | `ids_lineas` | compromisos, compromisos_mercado_servicios |
| `bookingId` | `reserva_id` | reservas |
| `serviceId` | `servicio_id` | calendarios, reservas (LEGACY) |
| `customerId` | `cliente_id` | reservas, suscripciones |
| `zoneId` | `zona_id` | zonas_entrega, turnos_entrega |
| `shiftId` | `turno_id` | turnos_entrega, tareas_entrega, operaciones_pos, versiones_pos, sesiones_pos |
| `taskId` | `tarea_id` | tareas_entrega, evidencias_entrega, incidentes_entrega |
| `operatorIds` | `ids_operadores` | turnos_entrega |
| `operatorId` | `operador_id` | tareas_entrega |
| `proofId` | `evidencia_id` | evidencias_entrega |
| `incidentId` | `incidente_id` | incidentes_entrega |
| `auditId` | `auditoria_id` | auditorias de dominio |
| `operationId` | `operacion_id` | operaciones_pos y dependientes |
| `receiptId` | `comprobante_id` | comprobantes_pos |
| `deviceId` | `dispositivo_id` | dispositivos_pos, operaciones_pos, sesiones_pos |
| `sessionId` | `sesion_id` | sesiones_pos |
| `conflictId` | `conflicto_id` | conflictos_pos |
| `caseId` | `caso_id` | casos_soporte y dependientes |
| `disputeId` | `disputa_id` | casos_soporte |
| `evidenceId` | `evidencia_id` | evidencias_soporte, evidencias_financieras, instantaneas_comision |
| `entryId` | `entrada_id` | lineas_tiempo_soporte, compensaciones_soporte, movimientos, movimientos_facturacion |
| `paymentId` | `pago_id` | intenciones_pago, facturas, dependientes |
| `invoiceId` | `factura_id` | facturas y dependientes |
| `lineId` | `linea_id` | lineas_factura |
| `creditNoteId` | `nota_credito_id` | notas_credito, movimientos_contables_facturacion |
| `refundId` | `reintegro_id` | reintegros_facturacion, movimientos_contables_facturacion |
| `subscriptionId` | `suscripcion_id` | suscripciones, gestion_mora |
| `dunningId` | `mora_id` | gestion_mora |
| `billingAccountId` | `cuenta_facturacion_id` | cuentas_facturacion |
| `snapshotId` | `instantanea_id` | instantaneas_comision |
| `confirmationId` | `confirmacion_id` | confirmaciones_financieras, confirmaciones_whatsapp |
| `freezeId` | `bloqueo_id` | bloqueos_financieros |
| `reconciliationId` | `conciliacion_id` | registros_conciliacion |
| `referenceId` | `referencia_id` | referencias_auditoria |
| `compensationId` | `compensacion_id` | compensaciones_compromiso |
| `eventId` | `evento_id` | outbox |
| `eventType` | `tipo_evento` | outbox |
| `aggregateType` | `tipo_agregado` | outbox |
| `aggregateId` | `agregado_id` | outbox |
| `payload` | `datos_evento` | outbox, eventos_webhook_pago |
| `idempotencyKey` | `clave_idempotencia` | operaciones_pos, acciones_whatsapp, intenciones_pago, idempotencias |
| `requestHash` | `hash_solicitud` | idempotencias, acciones_whatsapp, mensajes_whatsapp |
| `integrityHash` | `hash_integridad` | comprobantes_pos |
| `correlationId` | `correlacion_id` | auditorías y dominios |
| `resourceType` | `tipo_recurso` | auditorias |
| `resourceId` | `recurso_id` | auditorias |
| `referenceType` | `tipo_referencia` | referencias_auditoria |
| `entryType` | `tipo_entrada` | movimientos, movimientos_facturacion |
| `linkedEntryId` | `entrada_vinculada_id` | movimientos, movimientos_facturacion |
| `status` | `estado` | todas |
| `kind` | `tipo` | publicaciones, operaciones_pos, comprobantes_pos, evidencias_financieras |
| `context` | `contexto` | múltiples |
| `amount` | `monto` | finanzas, compromisos, POS, soporte, reporting |
| `currency` | `moneda` | todas |
| `reason` | `motivo` | múltiples |
| `source` | `origen` | múltiples |
| `outcome` | `resultado` | auditorías, casos, decisiones, reporting |
| `action` | `accion` | auditorías |
| `name` | `nombre` | prestadores, publicaciones, calendarios, zonas, planes |
| `description` | `descripcion` | publicaciones, lineas_factura |
| `cohort` | `cohorte` | prestadores, publicaciones |
| `locationId` | `ubicacion_id` | prestadores, publicaciones |
| `timezone` | `zona_horaria` | prestadores, calendarios |
| `staffRoles` | `roles_personal` | prestadores |
| `price` | `precio` | publicaciones |
| `stock` | `existencias` | publicaciones |
| `capacity` | `capacidad` | publicaciones, reglas_calendario |
| `durationMinutes` | `duracion_minutos` | publicaciones |
| `estimatedDurationMinutes` | `duracion_estimada_minutos` | publicaciones |
| `bookingMode` | `modalidad_reserva` | publicaciones |
| `priceMode` | `modalidad_precio` | publicaciones |
| `calendarId` | `calendario_id` | reservas (contrato canónico) |
| `providerId` | `prestador_id` | calendarios |
| `granularityMinutes` | `granularidad_minutos` | calendarios |
| `bufferMinutes` | `buffer_minutos` | calendarios |
| `listingId` | `publicacion_id` | reservas (contrato canónico) |
| `workingHours` | `horario_trabajo` | publicaciones |
| `quantity` | `cantidad` | compromisos_mercado_servicios, lineas_factura |
| `slotStart` / `slotEnd` | `franja_inicio` / `franja_fin` | compromisos_mercado_servicios |
| `weekday` | `dia_semana` | reglas_calendario |
| `startsAt` / `endsAt` | `fecha_inicio` / `fecha_fin` (o `hora_inicio`/`hora_fin` en reglas) | calendario, turnos, reservas |
| `postalCodes` | `codigos_postales` | zonas_entrega |
| `recipientName` | `nombre_destinatario` | evidencias_entrega |
| `capturedAt` | `fecha_captura` | evidencias_entrega |
| `evidenceSource` | `origen_evidencia` | evidencias_entrega |
| `proof` | `evidencia` | tareas_entrega |
| `incident` | `incidente` | tareas_entrega |
| `pickup` / `dropoff` | `retiro` / `entrega` | tareas_entrega |
| `settlementClaim` | `reclamo_liquidacion` | tareas_entrega |
| `failureReason` | `motivo_fallo` | tareas_entrega |
| `party` | `parte` | evidencias_soporte |
| `summary` | `resumen` | evidencias_soporte |
| `submittedBy` | `presentada_por` | evidencias_soporte |
| `openedBy` | `abierto_por` | casos_soporte |
| `category` | `categoria` | casos_soporte |
| `recipientId` | `destinatario_id` | mensajes_whatsapp, consentimientos_whatsapp |
| `recipientType` | `tipo_destinatario` | consentimientos_whatsapp |
| `senderId` | `remitente_id` | confirmaciones_whatsapp, auditoria_whatsapp |
| `template` | `plantilla` | mensajes_whatsapp |
| `templateVersion` | `version_plantilla` | mensajes_whatsapp |
| `consentId` | `consentimiento_id` | mensajes_whatsapp |
| `provider` | `proveedor` | intenciones_pago, eventos_webhook_pago |
| `providerReference` | `referencia_proveedor` | intenciones_pago, instantaneas_comision, registros_conciliacion |
| `providerStatus` | `estado_proveedor` | intenciones_pago |
| `providerEventId` | `evento_proveedor_id` | eventos_webhook |
| `providerAmount` | `monto_proveedor` | registros_conciliacion |
| `providerCapture` | `captura_proveedor` | comprobantes_pos |
| `signature` | `firma` | eventos_webhook |
| `commercialStatus` | `estado_comercial` | intenciones_pago |
| `credentialsCollected` | `credenciales_recolectadas` | intenciones_pago |
| `merchantOfRecord` | `comerciante_registro` | intenciones_pago |
| `collectionModel` | `modelo_cobro` | intenciones_pago |
| `splitPolicy` | `politica_distribucion` | intenciones_pago |
| `orderId` | `orden_id` | intenciones_pago, facturas, dependientes |
| `posOperationId` | `operacion_pos_id` | intenciones_pago, facturas, dependientes |
| `grossAmount` | `monto_bruto` | instantaneas_comision |
| `deductions` | `deducciones` | instantaneas_comision |
| `commissionableBase` | `base_comisionable` | instantaneas_comision |
| `commissionAmount` | `monto_comision` | instantaneas_comision |
| `netAmount` | `monto_neto` | instantaneas_comision |
| `ruleVersion` | `version_regla` | instantaneas_comision |
| `rateBps` | `tasa_puntos_base` | instantaneas_comision (decisión documentada) |
| `ledgerStatus` | `estado_contable` | instantaneas_comision, registros_operaciones |
| `taxAmount` / `feeAmount` | `monto_impuestos` / `monto_tarifas` | facturas |
| `subtotalMinor` / `taxMinor` / `feeMinor` / `totalMinor` | `subtotal_menor` / `impuestos_menor` / `tarifas_menor` / `total_menor` | facturas |
| `unitMinor` | `unitario_menor` | lineas_factura |
| `invoiceType` | `tipo_factura` | facturas |
| `taxReference` | `referencia_fiscal` | facturas |
| `taxSnapshot` | `instantanea_fiscal` | facturas |
| `snapshotVersion` | `version_instantanea` | facturas |
| `taxIdentity` | `identidad_fiscal` | perfiles_fiscales |
| `taxCategory` | `categoria_fiscal` | perfiles_fiscales |
| `ivaTreatment` | `tratamiento_iva` | perfiles_fiscales |
| `withholdingTreatment` | `tratamiento_retencion` | perfiles_fiscales |
| `authority` | `autoridad` | perfiles_fiscales |
| `externalApprovalReference` | `referencia_aprobacion_externa` | perfiles_fiscales, exportaciones_contables |
| `partyId` | `parte_id` | perfiles_fiscales, cuentas_facturacion |
| `role` | `rol` | cuentas_facturacion |
| `interval` | `intervalo` | suscripciones, planes_suscripcion |
| `dunningAttempt` | `intento_mora` | suscripciones |
| `cancelReason` | `motivo_cancelacion` | suscripciones |
| `planSnapshot` | `instantanea_plan` | suscripciones |
| `attempt` | `intento` | gestion_mora |
| `retryAt` | `fecha_reintento` | gestion_mora |
| `nextNumber` | `siguiente_numero` | secuencias_numeracion |
| `exportId` | `exportacion_id` | exportaciones_contables |
| `invoiceIds` | `ids_facturas` | exportaciones_contables |
| `ledgerEntryIds` | `ids_entradas_contables` | exportaciones_contables |
| `postedExternally` | `publicada_externamente` | exportaciones_contables |
| `capability` | `capacidad` | evidencias_habilitacion, decisiones_habilitacion |
| `gate` | `requisito` | evidencias_habilitacion |
| `owner` | `propietario` | evidencias_habilitacion |
| `scope` | `alcance` | evidencias_habilitacion, decisiones_habilitacion |
| `profile` | `perfil` | evidencias_habilitacion, decisiones_habilitacion |
| `execution` | `ejecucion` | evidencias_habilitacion |
| `evidenceClass` | `clase_evidencia` | evidencias_habilitacion |
| `liveConformance` | `conformidad_produccion` | evidencias_habilitacion |
| `disposition` | `resultado_habilitacion` | decisiones_habilitacion |
| `failedGates` | `requisitos_fallidos` | decisiones_habilitacion |
| `evidenceIds` | `ids_evidencia` | decisiones_habilitacion |
| `evidenceType` | `tipo_evidencia` | evidencias_habilitacion |
| `evidenceRef` | `referencia_evidencia` | evidencias_habilitacion, perfiles_fiscales |
| `availableAt` | `disponible_desde` | outbox |
| `attempts` | `intentos` | outbox |
| `lastError` | `ultimo_error` | outbox |
| `claimId` | `reclamo_procesamiento_id` | outbox |
| `claimUntil` | `reclamado_hasta` | outbox |
| `publishedAt` | `fecha_publicacion` | outbox |
| `retentionUntil` | `retencion_hasta` | outbox, mensajes_whatsapp, auditoria_whatsapp |
| `channel` | `canal` | registros_operaciones |
| `geography` | `geografia` | registros_operaciones |
| `whatsappActions` | `acciones_whatsapp` | registros_operaciones |
| `posOffline` | `pos_fuera_linea` | registros_operaciones |

**Marcas temporales** (aplican a todas las tablas):

| Nombre físico pre-migración | Nombre físico actual |
|---|---|
| `createdAt` | `fecha_creacion` |
| `updatedAt` | `fecha_actualizacion` |
| `issuedAt` | `fecha_emision` |
| `expiresAt` | `fecha_expiracion` |
| `occurredAt` | `fecha_ocurrencia` |
| `evaluatedAt` | `fecha_evaluacion` |
| `confirmedAt` | `fecha_confirmacion` |
| `capturedAt` | `fecha_captura` |
| `grantedAt` | `fecha_otorgamiento` |
| `revokedAt` | `fecha_revocacion` |
| `consumedAt` | `fecha_consumo` |
| `openedAt` | `fecha_apertura` |
| `closedAt` | `fecha_cierre` |
| `resolvedAt` | `fecha_resolucion` |
| `cancelledAt` | `fecha_cancelacion` |
| `releaseAt` | `fecha_liberacion` |
| `providerEventAt` | `fecha_evento_proveedor` |

**Versiones** (aplican a todas las tablas):

| Nombre físico pre-migración | Nombre físico actual |
|---|---|
| `contractVersion` | `version_contrato` |
| `policyVersion` | `version_politica` |
| `availabilityVersion` | `version_disponibilidad` |
| `schemaVersion` | `version_esquema` |
| `snapshotVersion` | `version_instantanea` |
| `templateVersion` | `version_plantilla` |
| `operatingPolicyVersion` | `version_politica_operativa` |

---

## 3. Matriz de PK

| TABLA | PK | TIPO | RAZÓN | BUSINESS ID | UNIQUE TENANT-SCOPED |
|---|---|---|---|---|---|
| `prestadores` | `id` | varchar | Surrogate estable e inmutable | `prestador_id` | `(tenant_id, prestador_id)` [FISICA_ACTUAL] |
| `publicaciones` | `id` | varchar | Surrogate; cambia versión/disponibilidad | — | `(tenant_id, id)` [FISICA_ACTUAL] |
| `compromisos_mercado_servicios` | `id` | varchar | Surrogate | `compromiso_id` | `(tenant_id, compromiso_id)` |
| `auditoria_mercado_servicios` | `id` | varchar | Surrogate | — | — |
| `compromisos` | `id` | varchar | Surrogate del agregado | `compromiso_id` | `(tenant_id, compromiso_id)` |
| `transiciones_compromiso` | `id` | varchar | Surrogate histórico | — | `(tenant_id, compromiso_id, version)` |
| `compensaciones_compromiso` | `id` | varchar | Surrogate | `compensacion_id` | `(tenant_id, compensacion_id)` |
| `referencias_auditoria` | `id` | varchar | Surrogate | `referencia_id` | `(tenant_id, referencia_id)` |
| `calendarios` | `id` | varchar | Surrogate | — | `(tenant_id, prestador_id)` [FISICA_NUEVA; NULL legacy] |
| `reglas_calendario` | `id` | varchar | Surrogate | — | `(tenant_id, calendario_id, dia_semana, hora_inicio, hora_fin)` |
| `excepciones_calendario` | `id` | varchar | Surrogate | — | — |
| `reservas` | `id` | varchar | Surrogate | `reserva_id` | `(tenant_id, reserva_id)` |
| `zonas_entrega` | `id` | varchar | Surrogate | `zona_id` | `(tenant_id, zona_id)` |
| `turnos_entrega` | `id` | varchar | Surrogate | `turno_id` | `(tenant_id, turno_id)` |
| `tareas_entrega` | `id` | varchar | Surrogate | `tarea_id` | `(tenant_id, tarea_id)` |
| `evidencias_entrega` | `id` | varchar | Surrogate | `evidencia_id` | `(tenant_id, evidencia_id)` |
| `incidentes_entrega` | `id` | varchar | Surrogate | `incidente_id` | `(tenant_id, incidente_id)` |
| `auditoria_entrega` | `id` | varchar | Surrogate | `auditoria_id` | `(tenant_id, auditoria_id)` |
| `operaciones_pos` | `id` | varchar | Surrogate | `operacion_id` | `(tenant_id, operacion_id)` + `(tenant_id, clave_idempotencia)` |
| `versiones_pos` | `id` | varchar | Surrogate | — | `(tenant_id, turno_id)` |
| `comprobantes_pos` | `id` | varchar | Surrogate | `comprobante_id` | `(tenant_id, comprobante_id)` |
| `dispositivos_pos` | `id` | varchar | Surrogate | `dispositivo_id` | `(tenant_id, dispositivo_id)` |
| `sesiones_pos` | `id` | varchar | Surrogate | `sesion_id` | `(tenant_id, sesion_id)` |
| `conflictos_pos` | `id` | varchar | Surrogate | `conflicto_id` | `(tenant_id, conflicto_id)` |
| `auditoria_pos` | `id` | varchar | Surrogate | `auditoria_id` | `(tenant_id, auditoria_id)` |
| `casos_soporte` | `id` | varchar | Surrogate | `caso_id` | `(tenant_id, caso_id)` |
| `evidencias_soporte` | `id` | varchar | Surrogate | `evidencia_id` | `(tenant_id, evidencia_id)` |
| `lineas_tiempo_soporte` | `id` | varchar | Surrogate | `entrada_id` | `(tenant_id, entrada_id)` |
| `compensaciones_soporte` | `id` | varchar | Surrogate | `entrada_id` | `(tenant_id, entrada_id)` |
| `acciones_whatsapp` | `id` | varchar | Surrogate | — | `(tenant_id, clave_idempotencia)` |
| `confirmaciones_whatsapp` | `id` | varchar | Surrogate | `confirmacion_id` | `(tenant_id, confirmacion_id)` |
| `auditoria_whatsapp` | `id` | varchar | Surrogate | — | — |
| `consentimientos_whatsapp` | `id` | varchar | Surrogate | — | `(tenant_id, destinatario_id)` |
| `mensajes_whatsapp` | `id` | varchar | Surrogate | `mensaje_id` | `(tenant_id, mensaje_id)` |
| `eventos_webhook_whatsapp` | `id` | varchar | Surrogate | — | `(tenant_id, evento_proveedor_id)` |
| `evidencias_habilitacion` | `id` | varchar | Surrogate | — | `(tenant_id, capacidad, requisito, referencia_evidencia)` |
| `decisiones_habilitacion` | `id` | varchar | Surrogate (append-only) | — | — |
| `intenciones_pago` | `id` | varchar | Surrogate | `pago_id` | `(tenant_id, pago_id)` + `(tenant_id, compromiso_id)` + `(tenant_id, clave_idempotencia)` |
| `idempotencia_financiera` | `id` | varchar | Surrogate | — | `(tenant_id, clave_idempotencia)` |
| `instantaneas_comision` | `id` | varchar | Surrogate | `instantanea_id` | `(tenant_id, instantanea_id)` + `(tenant_id, compromiso_id)` |
| `movimientos_contables` | `id` | varchar | Surrogate (append-only) | `entrada_id` | `(tenant_id, entrada_id)` |
| `evidencias_financieras` | `id` | varchar | Surrogate | `evidencia_id` | `(tenant_id, evidencia_id)` |
| `confirmaciones_financieras` | `id` | varchar | Surrogate | `confirmacion_id` | `(tenant_id, confirmacion_id)` + `(tenant_id, compromiso_id)` |
| `bloqueos_financieros` | `id` | varchar | Surrogate | `bloqueo_id` | `(tenant_id, bloqueo_id)` + `(tenant_id, compromiso_id)` |
| `registros_conciliacion` | `id` | varchar | Surrogate | `conciliacion_id` | `(tenant_id, conciliacion_id)` + `(tenant_id, compromiso_id)` |
| `eventos_webhook_pago` | `id` | varchar | Surrogate | — | `(tenant_id, proveedor, evento_proveedor_id)` |
| `facturas` | `id` | varchar | Surrogate (append-only) | `factura_id` | `(tenant_id, factura_id)` |
| `lineas_factura` | `id` | varchar | Surrogate | — | `(tenant_id, id)` (redundante con PK) |
| `notas_credito` | `id` | varchar | Surrogate (append-only) | `nota_credito_id` | `(tenant_id, nota_credito_id)` |
| `suscripciones` | `id` | varchar | Surrogate | `suscripcion_id` | `(tenant_id, suscripcion_id)` |
| `perfiles_fiscales` | `id` | varchar | Surrogate | — | `(tenant_id, parte_id)` |
| `cuentas_facturacion` | `id` | varchar | Surrogate | `cuenta_facturacion_id` | `(tenant_id, cuenta_facturacion_id)` |
| `planes_suscripcion` | `id` | varchar | Surrogate | `plan_id` | `(tenant_id, plan_id)` |
| `reintegros_facturacion` | `id` | varchar | Surrogate (append-only) | `reintegro_id` | `(tenant_id, reintegro_id)` |
| `movimientos_contables_facturacion` | `id` | varchar | Surrogate (append-only) | `entrada_id` | `(tenant_id, entrada_id)` |
| `idempotencia_facturacion` | `id` | varchar | Surrogate | — | `(tenant_id, clave)` |
| `auditoria_facturacion` | `id` | varchar | Surrogate (append-only) | `auditoria_id` | `(tenant_id, auditoria_id)` |
| `gestion_mora` | `id` | varchar | Surrogate | `mora_id` | `(tenant_id, mora_id)` |
| `secuencias_numeracion` | `id` | varchar | Surrogate | — | `tenant_id` (1:1) |
| `exportaciones_contables` | `id` | varchar | Surrogate (append-only) | `exportacion_id` | `(tenant_id, exportacion_id)` |
| `outbox_entrega` | `id` | varchar | Surrogate | `evento_id` | `(tenant_id, evento_id)` |
| `outbox_pos` | `id` | varchar | Surrogate | `evento_id` | `(tenant_id, evento_id)` |
| `outbox_soporte` | `id` | varchar | Surrogate | `evento_id` | `(tenant_id, evento_id)` |
| `outbox_whatsapp` | `id` | varchar | Surrogate | `evento_id` | `(tenant_id, evento_id)` |
| `outbox_facturacion` | `id` | varchar | Surrogate | `evento_id` | `(tenant_id, evento_id)` |
| `registros_operaciones` | `id` | varchar | Surrogate | — | — |

**Regla de PK:** no se necesitan PK compuestas en el núcleo TUS. La identidad de negocio se protege por UNIQUE tenant-scoped; la PK queda surrogada y simple.

---

## 4. Matriz de FK

| ORIGEN | COLUMNAS | DESTINO | ESTADO | RAZÓN | CARDINALIDAD | NULLABLE | ON DELETE | ON UPDATE | REQUIERE AUDITAR DATOS |
|---|---|---|---|---|---|---|---|---|---|
| `lineas_factura` | `(tenant_id, factura_id)` | `facturas` | FISICA_ACTUAL | Línea depende de su factura | N:1 | NO | NO ACTION | NO ACTION | No |
| `publicaciones` | `(tenant_id, prestador_id)` | `prestadores` | FISICA_ACTUAL | Publicación pertenece a un prestador | N:1 | NO | RESTRICT | NO ACTION | No |
| `calendarios` | `(tenant_id, prestador_id)` | `prestadores` | FISICA_NUEVA | Agenda principal del prestador; NULL para legacy | N:1 | SÍ | RESTRICT | NO ACTION | No |
| `compromisos` | `(tenant_id, prestador_id)` | `prestadores` | FISICA_ACTUAL | Obligación comercial con prestador | N:1 | NO | RESTRICT | NO ACTION | No |
| `transiciones_compromiso` | `(tenant_id, compromiso_id)` | `compromisos` | FISICA_ACTUAL | Histórico de un compromiso | N:1 | NO | RESTRICT | NO ACTION | No |
| `compensaciones_compromiso` | `(tenant_id, compromiso_id)` | `compromisos` | FISICA_ACTUAL | Compensación de un compromiso | 1:1 | NO | RESTRICT | NO ACTION | No |
| `compromisos_mercado_servicios` | `(tenant_id, publicacion_id)` | `publicaciones` | FISICA_ACTUAL | Línea de checkout referencia listing (mismo tenant) | N:1 | NO | RESTRICT | NO ACTION | No |
| `reglas_calendario` | `(tenant_id, calendario_id)` | `calendarios` | FISICA_ACTUAL | Regla depende del calendario (mismo tenant) | N:1 | NO | CASCADE | NO ACTION | No |
| `excepciones_calendario` | `(tenant_id, calendario_id)` | `calendarios` | FISICA_ACTUAL | Excepción depende del calendario (mismo tenant) | N:1 | NO | CASCADE | NO ACTION | No |
| `reservas` | `(tenant_id, calendario_id)` | `calendarios` | FISICA_ACTUAL | Reserva ocupa franja de un calendario (mismo tenant) | N:1 | NO | RESTRICT | NO ACTION | No |
| `reservas` | `(tenant_id, publicacion_id)` | `publicaciones` | FISICA_NUEVA | Reserva consume una publicación; NULL para legacy | N:1 | SÍ | RESTRICT | NO ACTION | No |
| `turnos_entrega` | `(tenant_id, zona_id)` | `zonas_entrega` | FISICA_ACTUAL | Turno en una zona | N:1 | NO | RESTRICT | NO ACTION | No |
| `evidencias_entrega` | `(tenant_id, tarea_id)` | `tareas_entrega` | FISICA_ACTUAL | Comprobante de una tarea | N:1 | NO | RESTRICT | NO ACTION | No |
| `incidentes_entrega` | `(tenant_id, tarea_id)` | `tareas_entrega` | FISICA_ACTUAL | Incidente de una tarea | N:1 | NO | RESTRICT | NO ACTION | No |
| `comprobantes_pos` | `(tenant_id, operacion_id)` | `operaciones_pos` | FISICA_ACTUAL | Comprobante de una operación | N:1 | NO | RESTRICT | NO ACTION | No |
| `conflictos_pos` | `(tenant_id, operacion_id)` | `operaciones_pos` | FISICA_ACTUAL | Conflicto de una operación | N:1 | NO | RESTRICT | NO ACTION | No |
| `evidencias_soporte` | `(tenant_id, caso_id)` | `casos_soporte` | FISICA_ACTUAL | Evidencia de un caso | N:1 | NO | RESTRICT | NO ACTION | No |
| `lineas_tiempo_soporte` | `(tenant_id, caso_id)` | `casos_soporte` | FISICA_ACTUAL | Timeline de un caso | N:1 | NO | RESTRICT | NO ACTION | No |
| `compensaciones_soporte` | `(tenant_id, caso_id)` | `casos_soporte` | FISICA_ACTUAL | Compensación de un caso | 1:1 | NO | RESTRICT | NO ACTION | No |
| `intenciones_pago` | `(tenant_id, compromiso_id)` | `compromisos` | FISICA_ACTUAL | Pago de un compromiso | 1:1 | NO | RESTRICT | NO ACTION | No |
| `instantaneas_comision` | `(tenant_id, compromiso_id)` | `compromisos` | FISICA_ACTUAL | Snapshot de un compromiso | 1:1 | NO | RESTRICT | NO ACTION | No |
| `movimientos_contables` | `(tenant_id, compromiso_id)` | `compromisos` | FISICA_ACTUAL | Movimiento de un compromiso | N:1 | NO | RESTRICT | NO ACTION | No |
| `evidencias_financieras` | `(tenant_id, compromiso_id)` | `compromisos` | FISICA_ACTUAL | Evidencia de un compromiso | N:1 | NO | RESTRICT | NO ACTION | No |
| `confirmaciones_financieras` | `(tenant_id, compromiso_id)` | `compromisos` | FISICA_ACTUAL | Confirmación de un compromiso | 1:1 | NO | RESTRICT | NO ACTION | No |
| `bloqueos_financieros` | `(tenant_id, compromiso_id)` | `compromisos` | FISICA_ACTUAL | Congelamiento de un compromiso | 1:1 | NO | RESTRICT | NO ACTION | No |
| `registros_conciliacion` | `(tenant_id, compromiso_id)` | `compromisos` | FISICA_ACTUAL | Conciliación de un compromiso | N:1 | NO | RESTRICT | NO ACTION | No |
| `facturas` | `(tenant_id, compromiso_id)` | `compromisos` | FISICA_ACTUAL | Documento sobre un compromiso; la aplicación debe rechazar `""` | N:1 | NO | RESTRICT | NO ACTION | No |
| `notas_credito` | `(tenant_id, factura_id)` | `facturas` | FISICA_ACTUAL | NC reduce una factura | N:1 | NO | RESTRICT | NO ACTION | No |
| `reintegros_facturacion` | `(tenant_id, factura_id)` | `facturas` | FISICA_ACTUAL | Reintegro de una factura | N:1 | NO | RESTRICT | NO ACTION | No |
| `movimientos_contables_facturacion` | `(tenant_id, factura_id)` | `facturas` | FISICA_ACTUAL | Ledger de una factura | N:1 | NO | RESTRICT | NO ACTION | No |
| `gestion_mora` | `(tenant_id, suscripcion_id)` | `suscripciones` | FISICA_ACTUAL | Mora de una suscripción | N:1 | NO | RESTRICT | NO ACTION | No |
| `suscripciones` | `(tenant_id, plan_id)` | `planes_suscripcion` | FISICA_ACTUAL | Suscripción a un plan; la aplicación debe rechazar `""` | N:1 | NO | RESTRICT | NO ACTION | No |

---

## 5. Matriz de relaciones NO-FK

| TABLA | CAMPO | TIPO | DESTINO CONCEPTUAL | RAZÓN DE NO FK | PROTECCIÓN DE INTEGRIDAD |
|---|---|---|---|---|---|
| `tareas_entrega` | `compromiso_id` | LOGICA | compromisos | Entrega puede vivir más que el compromiso | Aplicación |
| `tareas_entrega` | `operador_id` | EXTERNA | Personal | Actor no persistido como entidad propia | Aplicación |
| `tareas_entrega` | `prestador_id` | LOGICA | prestadores | Referencia de negocio | Aplicación |
| `tareas_entrega` | `zona_id`, `turno_id` | LOGICA | zonas/turnos | Referencias operativas | Aplicación |
| `casos_soporte` | `compromiso_id`, `disputa_id` | LOGICA | compromisos/disputas | Soporte puede existir sin compromiso | Aplicación |
| `referencias_auditoria` | `compromiso_id` | LOGICA | compromisos | Traza puede sobrevivir al agregado | Aplicación |
| `movimientos_contables` | `entrada_vinculada_id` | LOGICA | movimientos_contables (self) | Auto-referencia append-only | Aplicación |
| `movimientos_contables_facturacion` | `entrada_vinculada_id`, `nota_credito_id`, `reintegro_id` | LOGICA | ledger/NC/reintegro | Auto-referencia | Aplicación |
| `facturas` | `cuenta_id`, `pago_id`, `orden_id`, `operacion_pos_id` | LOGICA | cuentas/pagos/ordenes/operaciones | `""` permitidos; referencias de negocio | Aplicación |
| `suscripciones` | `cliente_id` | EXTERNA/LOGICA | cliente | Cliente no es entidad TUS persistida | Aplicación |
| `perfiles_fiscales` | `parte_id` | POLIMORFICA | parte fiscal | Parte polimórfica | Aplicación |
| `cuentas_facturacion` | `parte_id` | POLIMORFICA | parte | Parte polimórfica | Aplicación |
| `mensajes_whatsapp` | `consentimiento_id` | LOGICA | consentimientos_whatsapp | Referencia lógica | Aplicación |
| `evidencias_habilitacion` | `capacidad`, `requisito`, `propietario`, `alcance` | POLIMORFICA | capacidad/gate | Referencias polimórficas | Evaluación de habilitación |
| `decisiones_habilitacion` | `capacidad`, `perfil`, `alcance` | POLIMORFICA | capacidad | Referencias polimórficas | Evaluación de habilitación |
| `auditoria_*` (todas) | `tipo_recurso` + `recurso_id` | POLIMORFICA | agregados | Recurso polimórfico | Aplicación |
| `auditoria_*` | `actor_id`, `correlacion_id` | TECNICA | actor/correlación | Identificadores de contexto | Aplicación |
| `intenciones_pago` | `proveedor`, `referencia_proveedor`, `estado_proveedor` | EXTERNA | Mercado Pago/pasarela | Integración externa | Contrato de proveedor |
| `instantaneas_comision` | `referencia_proveedor` | EXTERNA | proveedor | Integración externa | Contrato de proveedor |
| `registros_conciliacion` | `referencia_proveedor`, `monto_proveedor` | EXTERNA | proveedor | Integración externa | Contrato de proveedor |
| `eventos_webhook_pago` | `proveedor`, `evento_proveedor_id`, `firma`, `datos_evento` | EXTERNA | webhook de proveedor | Integración externa | Verificación de firma |
| `eventos_webhook_whatsapp` | `evento_proveedor_id`, `firma` | EXTERNA | Meta/WhatsApp | Integración externa | Verificación de firma |
| `confirmaciones_whatsapp` | `remitente_id` | EXTERNA | número Meta | Integración externa | Contrato Meta |
| `mensajes_whatsapp` | `destinatario_id`, `plantilla`, `version_plantilla` | EXTERNA | Meta/WhatsApp | Integración externa | Contrato Meta |
| `consentimientos_whatsapp` | `destinatario_id`, `tipo_destinatario` | EXTERNA | identidad externa | Integración externa | Aplicación |
| `evidencias_habilitacion` | `referencia_evidencia` | EXTERNA | evidencia externa | Referencia externa | Aplicación |
| `perfiles_fiscales` | `autoridad`, `referencia_aprobacion_externa`, `referencia_evidencia` | EXTERNA | AFIP/ARCA | Integración externa | Contrato fiscal |
| `exportaciones_contables` | `referencia_aprobacion_externa` | EXTERNA | contabilidad externa | Integración externa | Contrato contable |
| `calendarios` | `servicio_id` | LEGACY | TusService | Acoplamiento legacy | Pendiente migración |
| `reservas` | `servicio_id` | LEGACY | TusService | Acoplamiento legacy | Pendiente migración |
| `reservas` | `cliente_id` | EXTERNA/LOGICA | cliente | Cliente no es entidad persistida | Aplicación |
| `outbox_*` (todos) | `agregado_id` | POLIMORFICA | agregado | Agregado polimórfico | Dispatcher de worker |
| `outbox_*` (todos) | `tipo_evento` | TECNICA | — | Identificador técnico congelado | Constante |
| `registros_operaciones` | `contexto`, `canal`, `geografia` | TECNICA | — | Dimensiones de reporting | Aplicación |

---

## 6. Datos a auditar antes de crear FKs (solo lectura)

Nunca ejecutar `DELETE`/`UPDATE`/`TRUNCATE`. Estas consultas son el inventario histórico
pre-migración para detectar huérfanos y bloqueos antes de `ADD CONSTRAINT`; sus nombres físicos
antiguos no deben ejecutarse contra el esquema actual sin adaptar la consulta.

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

## 7. Detalle por dominio

### 7.1 Mercado

**`prestadores`** — Perfil operativo/comercial del prestador (ex `TusMerchant`).
- PK `id`; business ID `prestador_id` (ex `merchantId`).
- UNIQUE físico actual `(tenant_id, prestador_id)`.
- FK físicas actuales entrantes: `publicaciones`, `compromisos`.
- Invariante: `prestador_id` inmutable; `version_politica_operativa` gobierna la política operativa.

**`publicaciones`** — Oferta visible (ex `TusListing`).
- PK `id`; FK física actual `(tenant_id, prestador_id) → prestadores`, `onDelete RESTRICT`.
- La relación anterior por `tenantId` fue reemplazada por el mapping Prisma `Publicacion.prestador`.
- Para publicaciones de servicio, `modalidad_reserva` y `modalidad_precio` son configuraciones comerciales nullable durante la transición. `modalidad_reserva` acepta `turno_fijo`, `visita_diagnostico`, `duracion_estimada` y `requiere_presupuesto`; `modalidad_precio` acepta `precio_fijo`, `precio_desde`, `por_hora` y `presupuesto`. La API también acepta aliases legacy.
- `duracion_minutos` aplica a `turno_fijo` y `visita_diagnostico`; `duracion_estimada_minutos` aplica a `duracion_estimada`. `requiere_presupuesto` no tiene duración automática.
- `horario_trabajo` permanece legacy y no es la fuente canónica de disponibilidad nueva.

**`compromisos_mercado_servicios`** — Línea/compromiso de checkout (ex `TusMarketplaceCommitment`).
- FK física actual `(tenant_id, publicacion_id) → publicaciones`; `prestador_id` referencia lógica adicional.

**`auditoria_mercado_servicios`** — Traza; `tipo_recurso`/`recurso_id` polimórficos.

### 7.2 Compromisos

**`compromisos`** — Obligación comercial canónica (ex `TusCommitment`); versionado optimista.
**`transiciones_compromiso`** — Histórico append-only; UNIQUE `(tenant_id, compromiso_id, version)`.
**`compensaciones_compromiso`** — 1:1 por compromiso.
**`referencias_auditoria`** — Traza; `compromiso_id` lógica.

### 7.3 Calendario

**`calendarios`** — Agenda principal de disponibilidad del prestador; `(tenant_id, prestador_id)` es UNIQUE para nuevas filas y `prestador_id` nullable permite conservar legacy.
- `granularidad_minutos` default 15 y `buffer_minutos` default 0 controlan la generación futura de inicios; la duración pertenece a la publicación.
- `servicio_id` permanece nullable y legacy, sin FK canónica a `TusService`.
**`reglas_calendario`** / **`excepciones_calendario`** — Hijos; FK físicas actuales CASCADE.
**`reservas`** — FK física actual `calendario_id → calendarios` RESTRICT y nueva FK nullable `(tenant_id, publicacion_id) → publicaciones` RESTRICT; `cliente_id` externa/lógica; `servicio_id` legacy.

En WEB-04D2/WEB-04D3 la agenda se resuelve por `(tenant_id, prestador_id)`. El `calendarId` externo es una comprobación opcional de
la agenda encontrada, no una autoridad para cambiar de prestador. `publicacion_id` ya existente se escribe para
bookings canónicos; las reservas legacy pueden continuar con `servicio_id`.

WEB-04D3 no agrega tablas, columnas, índices, constraints, relaciones físicas ni providers. La ausencia de agenda y el
presupuesto requerido son estados de aplicación (`not_configured` y `BUDGET_REQUIRED`), no nuevos estados persistidos.

WEB-08 mantiene esta frontera física: `BUDGET_REQUIRED` no implica una tabla de presupuesto. `compromisos_mercado_servicios`
relaciona la publicación con el compromiso de checkout, pero no tiene identidad de `Trabajo`, diagnóstico, líneas de
presupuesto, vigencia, versión aceptada ni evidencia de ejecución del servicio.

### 7.4 Entrega

`zonas_entrega` → `turnos_entrega` (FK zona RESTRICT) → `tareas_entrega` (referencias lógicas) ← `evidencias_entrega` / `incidentes_entrega` (FK tarea RESTRICT). `operador_id` nullable/externa.

### 7.5 POS

`operaciones_pos` (agregado, idempotencia) ← `comprobantes_pos` / `conflictos_pos` (FK RESTRICT). `versiones_pos`, `dispositivos_pos`, `sesiones_pos` de soporte.

### 7.6 Soporte

`casos_soporte` ← `evidencias_soporte`, `lineas_tiempo_soporte`, `compensaciones_soporte` (FK RESTRICT).

### 7.7 WhatsApp

Canal gobernado; referencias externas a Meta (`remitente_id`, `destinatario_id`, `plantilla`, `evento_proveedor_id`, `firma`) nunca son FK. `consentimiento_id` lógica.

### 7.8 Habilitación

`evidencias_habilitacion` y `decisiones_habilitacion` — históricas/append-only; `capacidad`/`requisito`/`propietario`/`alcance`/`perfil` polimórficos. Valores congelados (`resultado_habilitacion`, `requisitos_fallidos`, `ids_evidencia`).

### 7.9 Finanzas

Todas referencian `compromiso_id` mediante FKs físicas actuales RESTRICT, mayormente 1:1. Referencias externas: `proveedor`, `referencia_proveedor`, `estado_proveedor`, `evento_proveedor_id`, `firma`. Ledger append-only con trigger; `entrada_vinculada_id` auto-referencia lógica. `tasa_puntos_base` (ex `rateBps`): decisión de españolizar el identificador; el valor numérico (basis points) conserva su semántica financiera.

### 7.10 Facturación

`facturas` (append-only) ← `lineas_factura` (FK física actual compuesta) ← `notas_credito` / `reintegros_facturacion` / `movimientos_contables_facturacion` (FKs físicas actuales RESTRICT). `suscripciones` (`plan_id` FK física actual, `cliente_id` externa). `perfiles_fiscales`/`cuentas_facturacion` (`parte_id` polimórfica). `gestion_mora` FK física actual a `suscripciones`. `secuencias_numeracion` 1:1 por tenant.

### 7.11 Outbox TUS

`tipo_evento` técnico congelado; `agregado_id` polimórfico. Sin FK.

### 7.12 Reporting

`registros_operaciones` — métrica operativa; sin FK.

---

## 8. Deuda legacy documentada

- `calendarios.servicio_id` y `reservas.servicio_id` → todavía acopladas a `TusService` (legacy). **Pendiente migración** a `prestador_id`/`publicacion_id`.
- `TusProduct`, `TusService`, `TusInventory`, `TusTenant` — legacy, excluidos del DER Core; `TusInventory.product_id → TusProduct` es deuda a resolver antes de eliminar esos modelos.
- Uniques `(tenant_id, id)`: `calendarios` ya es NECESARIO para la FK compuesta tenant-scoped (no redundante); `excepciones_calendario` y `TusDeadLetter` siguen siendo redundantes con la PK (sin FK entrante que las requiera).
- Relación anterior `TusListing → TusMerchant` por `tenantId` — reemplazada por la FK física `(tenant_id, prestador_id)` y el mapping Prisma `Publicacion.prestador`.

### Drift físico preexistente resuelto

Los siguientes índices estaban definidos en `DER_TUS.dbml` y `schema.prisma`, pero no existían en el snapshot PRE ni después de la migración física inicial:

`idx_calendarios_tenant_servicio_estado`, `idx_reglas_tenant_calendario`, `idx_excepciones_tenant_calendario_franja`,
`idx_reservas_tenant_calendario_franja`, `idx_reservas_tenant_cliente_estado`,
`idx_compensaciones_soporte_tenant_caso_fecha_creacion`, `idx_consentimientos_whatsapp_tenant_estado`,
`idx_mensajes_whatsapp_tenant_destinatario_estado`, `idx_eventos_webhook_whatsapp_tenant_estado_ocurrencia`,
`idx_eventos_webhook_pago_tenant_estado_ocurrencia`, `idx_facturas_tenant_compromiso_estado`,
`idx_lineas_factura_tenant_factura`, `idx_notas_credito_tenant_factura_estado`,
`idx_suscripciones_tenant_cliente_estado`, `idx_perfiles_fiscales_tenant_estado`.

La migración `20260914180000_tus_physical_spanish` renombró y preservó objetos existentes; la migración
`20260915140000_tus_physical_spanish_indexes` agregó exclusivamente estos 15 índices. El inventario físico posterior
queda alineado con el DER: faltantes antes `15`, faltantes después `0`.

---

## 9. Notas de ON DELETE / ON UPDATE

- **ON UPDATE**: `NO ACTION` global. PK e IDs de negocio son inmutables.
- **ON DELETE**:
  - `CASCADE` solo en composición pura: `reglas_calendario`, `excepciones_calendario`.
  - `RESTRICT` en todo lo comercial/financiero/fiscal/auditoría.
  - `NO ACTION` mantenido para la FK ya existente `lineas_factura → facturas`.
- Nunca CASCADE por comodidad; nunca CASCADE sobre snapshots/ledgers/auditorías.

---

## 10. Excepciones en inglés (justificadas)

| Término | Motivo |
|---|---|
| `id` | PK surrogate técnica |
| `tenant_id` | excepción técnica de aislamiento |
| `actor_id` | identificador técnico transversal del actor |
| `POS` | sigla del punto de venta (dentro de `operaciones_pos`, etc.) |
| `WhatsApp` | nombre propio del canal Meta |
| `sla` | acrónimo estándar de servicio |
| `plan_id` | semántica clara y sin traducción natural necesaria (plan de suscripción) |

Los **valores** almacenados en columnas como `tipo_evento`, `resultado_habilitacion`, `requisitos_fallidos`, `tipo_agregado`, `proveedor`, enums contractuales y payloads externos **permanecen congelados** en su forma original.
