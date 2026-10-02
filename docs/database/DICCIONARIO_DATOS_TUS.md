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
> **WEB-08A/B (2026-09-17).** La migración `20260917100000_tus_work_budget` agrega de forma
> forward-only `trabajos`, `diagnosticos`, `presupuestos`, `lineas_presupuesto`, `aceptaciones_presupuesto`,
> `transiciones_trabajo`, `evidencias_trabajo` y `auditoria_trabajo`. WEB-08B implementa sus operaciones HTTP y stores.
> `TusJob` sigue siendo una tabla técnica de cola; `confirmaciones_whatsapp` conserva snapshots expirable del canal y no es un
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

| Nombre físico pre-migración                              | Nombre físico actual                                                   | Tabla                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `merchantId`                                             | `prestador_id`                                                         | prestadores, publicaciones, compromisos, compromisos_mercado_servicios, tareas_entrega |
| provider tenant (interno)                                | `prestador_tenant_id`                                                  | compromisos_mercado_servicios, trabajos, presupuestos, evidencias_trabajo              |
| `listingId`                                              | `publicacion_id`                                                       | compromisos_mercado_servicios                                                          |
| `commitmentId`                                           | `compromiso_id`                                                        | compromisos y dependientes                                                             |
| `cartId`                                                 | `carrito_id`                                                           | compromisos, compromisos_mercado_servicios                                             |
| `lineIds`                                                | `ids_lineas`                                                           | compromisos, compromisos_mercado_servicios                                             |
| `bookingId`                                              | `reserva_id`                                                           | reservas                                                                               |
| `serviceId`                                              | `servicio_id`                                                          | calendarios, reservas (LEGACY)                                                         |
| `customerId`                                             | `cliente_id`                                                           | reservas, suscripciones                                                                |
| tenant cliente de reserva (interno)                      | `cliente_tenant_id`                                                    | reservas                                                                               |
| `zoneId`                                                 | `zona_id`                                                              | zonas_entrega, turnos_entrega                                                          |
| `shiftId`                                                | `turno_id`                                                             | turnos_entrega, tareas_entrega, operaciones_pos, versiones_pos, sesiones_pos           |
| `taskId`                                                 | `tarea_id`                                                             | tareas_entrega, evidencias_entrega, incidentes_entrega                                 |
| `operatorIds`                                            | `ids_operadores`                                                       | turnos_entrega                                                                         |
| `operatorId`                                             | `operador_id`                                                          | tareas_entrega                                                                         |
| `proofId`                                                | `evidencia_id`                                                         | evidencias_entrega                                                                     |
| `incidentId`                                             | `incidente_id`                                                         | incidentes_entrega                                                                     |
| `auditId`                                                | `auditoria_id`                                                         | auditorias de dominio                                                                  |
| `operationId`                                            | `operacion_id`                                                         | operaciones_pos y dependientes                                                         |
| `receiptId`                                              | `comprobante_id`                                                       | comprobantes_pos                                                                       |
| `deviceId`                                               | `dispositivo_id`                                                       | dispositivos_pos, operaciones_pos, sesiones_pos                                        |
| `sessionId`                                              | `sesion_id`                                                            | sesiones_pos                                                                           |
| `conflictId`                                             | `conflicto_id`                                                         | conflictos_pos                                                                         |
| `caseId`                                                 | `caso_id`                                                              | casos_soporte y dependientes                                                           |
| `disputeId`                                              | `disputa_id`                                                           | casos_soporte                                                                          |
| `evidenceId`                                             | `evidencia_id`                                                         | evidencias_soporte, evidencias_financieras, instantaneas_comision                      |
| `entryId`                                                | `entrada_id`                                                           | lineas_tiempo_soporte, compensaciones_soporte, movimientos, movimientos_facturacion    |
| `paymentId`                                              | `pago_id`                                                              | intenciones_pago, facturas, dependientes                                               |
| `invoiceId`                                              | `factura_id`                                                           | facturas y dependientes                                                                |
| `lineId`                                                 | `linea_id`                                                             | lineas_factura                                                                         |
| `creditNoteId`                                           | `nota_credito_id`                                                      | notas_credito, movimientos_contables_facturacion                                       |
| `refundId`                                               | `reintegro_id`                                                         | reintegros_facturacion, movimientos_contables_facturacion                              |
| `subscriptionId`                                         | `suscripcion_id`                                                       | suscripciones, gestion_mora                                                            |
| `dunningId`                                              | `mora_id`                                                              | gestion_mora                                                                           |
| `billingAccountId`                                       | `cuenta_facturacion_id`                                                | cuentas_facturacion                                                                    |
| `snapshotId`                                             | `instantanea_id`                                                       | instantaneas_comision                                                                  |
| `confirmationId`                                         | `confirmacion_id`                                                      | confirmaciones_financieras, confirmaciones_whatsapp                                    |
| `freezeId`                                               | `bloqueo_id`                                                           | bloqueos_financieros                                                                   |
| `reconciliationId`                                       | `conciliacion_id`                                                      | registros_conciliacion                                                                 |
| `referenceId`                                            | `referencia_id`                                                        | referencias_auditoria                                                                  |
| `compensationId`                                         | `compensacion_id`                                                      | compensaciones_compromiso                                                              |
| `eventId`                                                | `evento_id`                                                            | outbox                                                                                 |
| `eventType`                                              | `tipo_evento`                                                          | outbox                                                                                 |
| `aggregateType`                                          | `tipo_agregado`                                                        | outbox                                                                                 |
| `aggregateId`                                            | `agregado_id`                                                          | outbox                                                                                 |
| `payload`                                                | `datos_evento`                                                         | outbox, eventos_webhook_pago                                                           |
| `idempotencyKey`                                         | `clave_idempotencia`                                                   | operaciones_pos, acciones_whatsapp, intenciones_pago, idempotencias                    |
| `requestHash`                                            | `hash_solicitud`                                                       | idempotencias, acciones_whatsapp, mensajes_whatsapp                                    |
| `integrityHash`                                          | `hash_integridad`                                                      | comprobantes_pos                                                                       |
| `correlationId`                                          | `correlacion_id`                                                       | auditorías y dominios                                                                  |
| `resourceType`                                           | `tipo_recurso`                                                         | auditorias                                                                             |
| `resourceId`                                             | `recurso_id`                                                           | auditorias                                                                             |
| `referenceType`                                          | `tipo_referencia`                                                      | referencias_auditoria                                                                  |
| `entryType`                                              | `tipo_entrada`                                                         | movimientos, movimientos_facturacion                                                   |
| `linkedEntryId`                                          | `entrada_vinculada_id`                                                 | movimientos, movimientos_facturacion                                                   |
| `status`                                                 | `estado`                                                               | todas                                                                                  |
| `kind`                                                   | `tipo`                                                                 | publicaciones, operaciones_pos, comprobantes_pos, evidencias_financieras               |
| `context`                                                | `contexto`                                                             | múltiples                                                                              |
| `amount`                                                 | `monto`                                                                | finanzas, compromisos, POS, soporte, reporting                                         |
| `currency`                                               | `moneda`                                                               | todas                                                                                  |
| `reason`                                                 | `motivo`                                                               | múltiples                                                                              |
| `workId`                                                 | `trabajo_id`                                                           | trabajos y dependientes                                                                |
| `diagnosisId`                                            | `diagnostico_id`                                                       | diagnosticos                                                                           |
| `budgetId`                                               | `presupuesto_id`                                                       | presupuestos                                                                           |
| `acceptanceId`                                           | `aceptacion_id`                                                        | aceptaciones_presupuesto                                                               |
| `providerTenantId`                                       | `prestador_tenant_id`                                                  | trabajos, presupuestos, evidencias_trabajo                                             |
| `originalDescription`                                    | `descripcion_original`                                                 | diagnosticos                                                                           |
| `structuredData`                                         | `datos_estructurados`                                                  | diagnosticos                                                                           |
| `totalMinor`                                             | `monto_total`                                                          | presupuestos                                                                           |
| `unitAmountMinor`                                        | `monto_unitario`                                                       | lineas_presupuesto                                                                     |
| `metadata`                                               | `metadatos`                                                            | evidencias_trabajo, auditoria_trabajo                                                  |
| `occurredAt`                                             | `fecha_ocurrencia`                                                     | evidencias_trabajo                                                                     |
| `source`                                                 | `origen`                                                               | múltiples                                                                              |
| `outcome`                                                | `resultado`                                                            | auditorías, casos, decisiones, reporting                                               |
| `action`                                                 | `accion`                                                               | auditorías                                                                             |
| `name`                                                   | `nombre`                                                               | prestadores, publicaciones, calendarios, zonas, planes                                 |
| `description`                                            | `descripcion`                                                          | publicaciones, lineas_factura                                                          |
| `cohort`                                                 | `cohorte`                                                              | prestadores, publicaciones                                                             |
| `locationId`                                             | `ubicacion_id`                                                         | prestadores, publicaciones                                                             |
| `timezone`                                               | `zona_horaria`                                                         | prestadores, calendarios                                                               |
| `staffRoles`                                             | `roles_personal`                                                       | prestadores                                                                            |
| `price`                                                  | `precio`                                                               | publicaciones                                                                          |
| `stock`                                                  | `existencias`                                                          | publicaciones                                                                          |
| `capacity`                                               | `capacidad`                                                            | publicaciones, reglas_calendario                                                       |
| `durationMinutes`                                        | `duracion_minutos`                                                     | publicaciones                                                                          |
| `estimatedDurationMinutes`                               | `duracion_estimada_minutos`                                            | publicaciones                                                                          |
| `bookingMode`                                            | `modalidad_reserva`                                                    | publicaciones                                                                          |
| `priceMode`                                              | `modalidad_precio`                                                     | publicaciones                                                                          |
| `calendarId`                                             | `calendario_id`                                                        | reservas (contrato canónico)                                                           |
| `providerId`                                             | `prestador_id`                                                         | calendarios                                                                            |
| `granularityMinutes`                                     | `granularidad_minutos`                                                 | calendarios                                                                            |
| `bufferMinutes`                                          | `buffer_minutos`                                                       | calendarios                                                                            |
| `listingId`                                              | `publicacion_id`                                                       | reservas (contrato canónico)                                                           |
| `workingHours`                                           | `horario_trabajo`                                                      | publicaciones                                                                          |
| `quantity`                                               | `cantidad`                                                             | compromisos_mercado_servicios, lineas_factura                                          |
| `slotStart` / `slotEnd`                                  | `franja_inicio` / `franja_fin`                                         | compromisos_mercado_servicios                                                          |
| `weekday`                                                | `dia_semana`                                                           | reglas_calendario                                                                      |
| `startsAt` / `endsAt`                                    | `fecha_inicio` / `fecha_fin` (o `hora_inicio`/`hora_fin` en reglas)    | calendario, turnos, reservas                                                           |
| `postalCodes`                                            | `codigos_postales`                                                     | zonas_entrega                                                                          |
| `recipientName`                                          | `nombre_destinatario`                                                  | evidencias_entrega                                                                     |
| `capturedAt`                                             | `fecha_captura`                                                        | evidencias_entrega                                                                     |
| `evidenceSource`                                         | `origen_evidencia`                                                     | evidencias_entrega                                                                     |
| `proof`                                                  | `evidencia`                                                            | tareas_entrega                                                                         |
| `incident`                                               | `incidente`                                                            | tareas_entrega                                                                         |
| `pickup` / `dropoff`                                     | `retiro` / `entrega`                                                   | tareas_entrega                                                                         |
| `settlementClaim`                                        | `reclamo_liquidacion`                                                  | tareas_entrega                                                                         |
| `failureReason`                                          | `motivo_fallo`                                                         | tareas_entrega                                                                         |
| `party`                                                  | `parte`                                                                | evidencias_soporte                                                                     |
| `summary`                                                | `resumen`                                                              | evidencias_soporte                                                                     |
| `submittedBy`                                            | `presentada_por`                                                       | evidencias_soporte                                                                     |
| `openedBy`                                               | `abierto_por`                                                          | casos_soporte                                                                          |
| `category`                                               | `categoria`                                                            | casos_soporte                                                                          |
| `recipientId`                                            | `destinatario_id`                                                      | mensajes_whatsapp, consentimientos_whatsapp                                            |
| `recipientType`                                          | `tipo_destinatario`                                                    | consentimientos_whatsapp                                                               |
| `senderId`                                               | `remitente_id`                                                         | confirmaciones_whatsapp, auditoria_whatsapp                                            |
| `template`                                               | `plantilla`                                                            | mensajes_whatsapp                                                                      |
| `templateVersion`                                        | `version_plantilla`                                                    | mensajes_whatsapp                                                                      |
| `consentId`                                              | `consentimiento_id`                                                    | mensajes_whatsapp                                                                      |
| `provider`                                               | `proveedor`                                                            | intenciones_pago, eventos_webhook_pago                                                 |
| `providerReference`                                      | `referencia_proveedor`                                                 | intenciones_pago, instantaneas_comision, registros_conciliacion                        |
| `providerStatus`                                         | `estado_proveedor`                                                     | intenciones_pago                                                                       |
| `providerEventId`                                        | `evento_proveedor_id`                                                  | eventos_webhook                                                                        |
| `providerAmount`                                         | `monto_proveedor`                                                      | registros_conciliacion                                                                 |
| `providerCapture`                                        | `captura_proveedor`                                                    | comprobantes_pos                                                                       |
| `signature`                                              | `firma`                                                                | eventos_webhook                                                                        |
| `commercialStatus`                                       | `estado_comercial`                                                     | intenciones_pago                                                                       |
| `credentialsCollected`                                   | `credenciales_recolectadas`                                            | intenciones_pago                                                                       |
| `merchantOfRecord`                                       | `comerciante_registro`                                                 | intenciones_pago                                                                       |
| `collectionModel`                                        | `modelo_cobro`                                                         | intenciones_pago                                                                       |
| `splitPolicy`                                            | `politica_distribucion`                                                | intenciones_pago                                                                       |
| `orderId`                                                | `orden_id`                                                             | intenciones_pago, facturas, dependientes                                               |
| `posOperationId`                                         | `operacion_pos_id`                                                     | intenciones_pago, facturas, dependientes                                               |
| `grossAmount`                                            | `monto_bruto`                                                          | instantaneas_comision                                                                  |
| `deductions`                                             | `deducciones`                                                          | instantaneas_comision                                                                  |
| `commissionableBase`                                     | `base_comisionable`                                                    | instantaneas_comision                                                                  |
| `commissionAmount`                                       | `monto_comision`                                                       | instantaneas_comision                                                                  |
| `netAmount`                                              | `monto_neto`                                                           | instantaneas_comision                                                                  |
| `ruleVersion`                                            | `version_regla`                                                        | instantaneas_comision                                                                  |
| `rateBps`                                                | `tasa_puntos_base`                                                     | instantaneas_comision (decisión documentada)                                           |
| `ledgerStatus`                                           | `estado_contable`                                                      | instantaneas_comision, registros_operaciones                                           |
| `taxAmount` / `feeAmount`                                | `monto_impuestos` / `monto_tarifas`                                    | facturas                                                                               |
| `subtotalMinor` / `taxMinor` / `feeMinor` / `totalMinor` | `subtotal_menor` / `impuestos_menor` / `tarifas_menor` / `total_menor` | facturas                                                                               |
| `unitMinor`                                              | `unitario_menor`                                                       | lineas_factura                                                                         |
| `invoiceType`                                            | `tipo_factura`                                                         | facturas                                                                               |
| `taxReference`                                           | `referencia_fiscal`                                                    | facturas                                                                               |
| `taxSnapshot`                                            | `instantanea_fiscal`                                                   | facturas                                                                               |
| `snapshotVersion`                                        | `version_instantanea`                                                  | facturas                                                                               |
| `taxIdentity`                                            | `identidad_fiscal`                                                     | perfiles_fiscales                                                                      |
| `taxCategory`                                            | `categoria_fiscal`                                                     | perfiles_fiscales                                                                      |
| `ivaTreatment`                                           | `tratamiento_iva`                                                      | perfiles_fiscales                                                                      |
| `withholdingTreatment`                                   | `tratamiento_retencion`                                                | perfiles_fiscales                                                                      |
| `authority`                                              | `autoridad`                                                            | perfiles_fiscales                                                                      |
| `externalApprovalReference`                              | `referencia_aprobacion_externa`                                        | perfiles_fiscales, exportaciones_contables                                             |
| `partyId`                                                | `parte_id`                                                             | perfiles_fiscales, cuentas_facturacion                                                 |
| `role`                                                   | `rol`                                                                  | cuentas_facturacion                                                                    |
| `interval`                                               | `intervalo`                                                            | suscripciones, planes_suscripcion                                                      |
| `dunningAttempt`                                         | `intento_mora`                                                         | suscripciones                                                                          |
| `cancelReason`                                           | `motivo_cancelacion`                                                   | suscripciones                                                                          |
| `planSnapshot`                                           | `instantanea_plan`                                                     | suscripciones                                                                          |
| `attempt`                                                | `intento`                                                              | gestion_mora                                                                           |
| `retryAt`                                                | `fecha_reintento`                                                      | gestion_mora                                                                           |
| `nextNumber`                                             | `siguiente_numero`                                                     | secuencias_numeracion                                                                  |
| `exportId`                                               | `exportacion_id`                                                       | exportaciones_contables                                                                |
| `invoiceIds`                                             | `ids_facturas`                                                         | exportaciones_contables                                                                |
| `ledgerEntryIds`                                         | `ids_entradas_contables`                                               | exportaciones_contables                                                                |
| `postedExternally`                                       | `publicada_externamente`                                               | exportaciones_contables                                                                |
| `capability`                                             | `capacidad`                                                            | evidencias_habilitacion, decisiones_habilitacion                                       |
| `gate`                                                   | `requisito`                                                            | evidencias_habilitacion                                                                |
| `owner`                                                  | `propietario`                                                          | evidencias_habilitacion                                                                |
| `scope`                                                  | `alcance`                                                              | evidencias_habilitacion, decisiones_habilitacion                                       |
| `profile`                                                | `perfil`                                                               | evidencias_habilitacion, decisiones_habilitacion                                       |
| `execution`                                              | `ejecucion`                                                            | evidencias_habilitacion                                                                |
| `evidenceClass`                                          | `clase_evidencia`                                                      | evidencias_habilitacion                                                                |
| `liveConformance`                                        | `conformidad_produccion`                                               | evidencias_habilitacion                                                                |
| `disposition`                                            | `resultado_habilitacion`                                               | decisiones_habilitacion                                                                |
| `failedGates`                                            | `requisitos_fallidos`                                                  | decisiones_habilitacion                                                                |
| `evidenceIds`                                            | `ids_evidencia`                                                        | decisiones_habilitacion                                                                |
| `evidenceType`                                           | `tipo_evidencia`                                                       | evidencias_habilitacion                                                                |
| `evidenceRef`                                            | `referencia_evidencia`                                                 | evidencias_habilitacion, perfiles_fiscales                                             |
| `availableAt`                                            | `disponible_desde`                                                     | outbox                                                                                 |
| `attempts`                                               | `intentos`                                                             | outbox                                                                                 |
| `lastError`                                              | `ultimo_error`                                                         | outbox                                                                                 |
| `claimId`                                                | `reclamo_procesamiento_id`                                             | outbox                                                                                 |
| `claimUntil`                                             | `reclamado_hasta`                                                      | outbox                                                                                 |
| `publishedAt`                                            | `fecha_publicacion`                                                    | outbox                                                                                 |
| `retentionUntil`                                         | `retencion_hasta`                                                      | outbox, mensajes_whatsapp, auditoria_whatsapp                                          |
| `channel`                                                | `canal`                                                                | registros_operaciones                                                                  |
| `geography`                                              | `geografia`                                                            | registros_operaciones                                                                  |
| `whatsappActions`                                        | `acciones_whatsapp`                                                    | registros_operaciones                                                                  |
| `posOffline`                                             | `pos_fuera_linea`                                                      | registros_operaciones                                                                  |

**Marcas temporales** (aplican a todas las tablas):

| Nombre físico pre-migración | Nombre físico actual     |
| --------------------------- | ------------------------ |
| `createdAt`                 | `fecha_creacion`         |
| `updatedAt`                 | `fecha_actualizacion`    |
| `issuedAt`                  | `fecha_emision`          |
| `expiresAt`                 | `fecha_expiracion`       |
| `occurredAt`                | `fecha_ocurrencia`       |
| `evaluatedAt`               | `fecha_evaluacion`       |
| `confirmedAt`               | `fecha_confirmacion`     |
| `capturedAt`                | `fecha_captura`          |
| `grantedAt`                 | `fecha_otorgamiento`     |
| `revokedAt`                 | `fecha_revocacion`       |
| `consumedAt`                | `fecha_consumo`          |
| `openedAt`                  | `fecha_apertura`         |
| `closedAt`                  | `fecha_cierre`           |
| `resolvedAt`                | `fecha_resolucion`       |
| `cancelledAt`               | `fecha_cancelacion`      |
| `releaseAt`                 | `fecha_liberacion`       |
| `providerEventAt`           | `fecha_evento_proveedor` |

**Versiones** (aplican a todas las tablas):

| Nombre físico pre-migración | Nombre físico actual         |
| --------------------------- | ---------------------------- |
| `contractVersion`           | `version_contrato`           |
| `policyVersion`             | `version_politica`           |
| `availabilityVersion`       | `version_disponibilidad`     |
| `schemaVersion`             | `version_esquema`            |
| `snapshotVersion`           | `version_instantanea`        |
| `templateVersion`           | `version_plantilla`          |
| `operatingPolicyVersion`    | `version_politica_operativa` |

---

## 3. Matriz de PK

| TABLA                               | PK   | TIPO    | RAZÓN                                    | BUSINESS ID             | UNIQUE TENANT-SCOPED                                                                      |
| ----------------------------------- | ---- | ------- | ---------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| `prestadores`                       | `id` | varchar | Surrogate estable e inmutable            | `prestador_id`          | `(tenant_id, prestador_id)` [FISICA_ACTUAL]                                               |
| `publicaciones`                     | `id` | varchar | Surrogate; cambia versión/disponibilidad | —                       | `(tenant_id, id)` [FISICA_ACTUAL]                                                         |
| `compromisos_mercado_servicios`     | `id` | varchar | Surrogate                                | `compromiso_id`         | `(tenant_id, compromiso_id)`                                                              |
| `auditoria_mercado_servicios`       | `id` | varchar | Surrogate                                | —                       | —                                                                                         |
| `compromisos`                       | `id` | varchar | Surrogate del agregado                   | `compromiso_id`         | `(tenant_id, compromiso_id)`                                                              |
| `transiciones_compromiso`           | `id` | varchar | Surrogate histórico                      | —                       | `(tenant_id, compromiso_id, version)`                                                     |
| `compensaciones_compromiso`         | `id` | varchar | Surrogate                                | `compensacion_id`       | `(tenant_id, compensacion_id)`                                                            |
| `referencias_auditoria`             | `id` | varchar | Surrogate                                | `referencia_id`         | `(tenant_id, referencia_id)`                                                              |
| `calendarios`                       | `id` | varchar | Surrogate                                | —                       | `(tenant_id, prestador_id)` [FISICA_NUEVA; NULL legacy]                                   |
| `reglas_calendario`                 | `id` | varchar | Surrogate                                | —                       | `(tenant_id, calendario_id, dia_semana, hora_inicio, hora_fin)`                           |
| `excepciones_calendario`            | `id` | varchar | Surrogate                                | —                       | —                                                                                         |
| `reservas`                          | `id` | varchar | Surrogate                                | `reserva_id`            | `(tenant_id, reserva_id)`                                                                 |
| `zonas_entrega`                     | `id` | varchar | Surrogate                                | `zona_id`               | `(tenant_id, zona_id)`                                                                    |
| `turnos_entrega`                    | `id` | varchar | Surrogate                                | `turno_id`              | `(tenant_id, turno_id)`                                                                   |
| `tareas_entrega`                    | `id` | varchar | Surrogate                                | `tarea_id`              | `(tenant_id, tarea_id)`                                                                   |
| `evidencias_entrega`                | `id` | varchar | Surrogate                                | `evidencia_id`          | `(tenant_id, evidencia_id)`                                                               |
| `incidentes_entrega`                | `id` | varchar | Surrogate                                | `incidente_id`          | `(tenant_id, incidente_id)`                                                               |
| `auditoria_entrega`                 | `id` | varchar | Surrogate                                | `auditoria_id`          | `(tenant_id, auditoria_id)`                                                               |
| `operaciones_pos`                   | `id` | varchar | Surrogate                                | `operacion_id`          | `(tenant_id, operacion_id)` + `(tenant_id, clave_idempotencia)`                           |
| `versiones_pos`                     | `id` | varchar | Surrogate                                | —                       | `(tenant_id, turno_id)`                                                                   |
| `comprobantes_pos`                  | `id` | varchar | Surrogate                                | `comprobante_id`        | `(tenant_id, comprobante_id)`                                                             |
| `dispositivos_pos`                  | `id` | varchar | Surrogate                                | `dispositivo_id`        | `(tenant_id, dispositivo_id)`                                                             |
| `sesiones_pos`                      | `id` | varchar | Surrogate                                | `sesion_id`             | `(tenant_id, sesion_id)`                                                                  |
| `conflictos_pos`                    | `id` | varchar | Surrogate                                | `conflicto_id`          | `(tenant_id, conflicto_id)`                                                               |
| `auditoria_pos`                     | `id` | varchar | Surrogate                                | `auditoria_id`          | `(tenant_id, auditoria_id)`                                                               |
| `casos_soporte`                     | `id` | varchar | Surrogate                                | `caso_id`               | `(tenant_id, caso_id)`                                                                    |
| `evidencias_soporte`                | `id` | varchar | Surrogate                                | `evidencia_id`          | `(tenant_id, evidencia_id)`                                                               |
| `lineas_tiempo_soporte`             | `id` | varchar | Surrogate                                | `entrada_id`            | `(tenant_id, entrada_id)`                                                                 |
| `compensaciones_soporte`            | `id` | varchar | Surrogate                                | `entrada_id`            | `(tenant_id, entrada_id)`                                                                 |
| `acciones_whatsapp`                 | `id` | varchar | Surrogate                                | —                       | `(tenant_id, clave_idempotencia)`                                                         |
| `confirmaciones_whatsapp`           | `id` | varchar | Surrogate                                | `confirmacion_id`       | `(tenant_id, confirmacion_id)`                                                            |
| `auditoria_whatsapp`                | `id` | varchar | Surrogate                                | —                       | —                                                                                         |
| `consentimientos_whatsapp`          | `id` | varchar | Surrogate                                | —                       | `(tenant_id, tipo_destinatario, destinatario_id)`                                         |
| `mensajes_whatsapp`                 | `id` | varchar | Surrogate                                | `mensaje_id`            | `(tenant_id, mensaje_id)`                                                                 |
| `eventos_webhook_whatsapp`          | `id` | varchar | Surrogate                                | —                       | `(tenant_id, evento_proveedor_id)`                                                        |
| `evidencias_habilitacion`           | `id` | varchar | Surrogate                                | —                       | `(tenant_id, capacidad, requisito, referencia_evidencia)`                                 |
| `decisiones_habilitacion`           | `id` | varchar | Surrogate (append-only)                  | —                       | —                                                                                         |
| `intenciones_pago`                  | `id` | varchar | Surrogate                                | `pago_id`               | `(tenant_id, pago_id)` + `(tenant_id, compromiso_id)` + `(tenant_id, clave_idempotencia)` |
| `idempotencia_financiera`           | `id` | varchar | Surrogate                                | —                       | `(tenant_id, clave_idempotencia)`                                                         |
| `instantaneas_comision`             | `id` | varchar | Surrogate                                | `instantanea_id`        | `(tenant_id, instantanea_id)` + `(tenant_id, compromiso_id)`                              |
| `movimientos_contables`             | `id` | varchar | Surrogate (append-only)                  | `entrada_id`            | `(tenant_id, entrada_id)`                                                                 |
| `evidencias_financieras`            | `id` | varchar | Surrogate                                | `evidencia_id`          | `(tenant_id, evidencia_id)`                                                               |
| `confirmaciones_financieras`        | `id` | varchar | Surrogate                                | `confirmacion_id`       | `(tenant_id, confirmacion_id)` + `(tenant_id, compromiso_id)`                             |
| `bloqueos_financieros`              | `id` | varchar | Surrogate                                | `bloqueo_id`            | `(tenant_id, bloqueo_id)` + `(tenant_id, compromiso_id)`                                  |
| `registros_conciliacion`            | `id` | varchar | Surrogate                                | `conciliacion_id`       | `(tenant_id, conciliacion_id)` + `(tenant_id, compromiso_id)`                             |
| `eventos_webhook_pago`              | `id` | varchar | Surrogate                                | —                       | `(tenant_id, proveedor, evento_proveedor_id)`                                             |
| `facturas`                          | `id` | varchar | Surrogate (append-only)                  | `factura_id`            | `(tenant_id, factura_id)`                                                                 |
| `lineas_factura`                    | `id` | varchar | Surrogate                                | —                       | `(tenant_id, id)` (redundante con PK)                                                     |
| `notas_credito`                     | `id` | varchar | Surrogate (append-only)                  | `nota_credito_id`       | `(tenant_id, nota_credito_id)`                                                            |
| `suscripciones`                     | `id` | varchar | Surrogate                                | `suscripcion_id`        | `(tenant_id, suscripcion_id)`                                                             |
| `perfiles_fiscales`                 | `id` | varchar | Surrogate                                | —                       | `(tenant_id, parte_id)`                                                                   |
| `cuentas_facturacion`               | `id` | varchar | Surrogate                                | `cuenta_facturacion_id` | `(tenant_id, cuenta_facturacion_id)`                                                      |
| `planes_suscripcion`                | `id` | varchar | Surrogate                                | `plan_id`               | `(tenant_id, plan_id)`                                                                    |
| `reintegros_facturacion`            | `id` | varchar | Surrogate (append-only)                  | `reintegro_id`          | `(tenant_id, reintegro_id)`                                                               |
| `movimientos_contables_facturacion` | `id` | varchar | Surrogate (append-only)                  | `entrada_id`            | `(tenant_id, entrada_id)`                                                                 |
| `idempotencia_facturacion`          | `id` | varchar | Surrogate                                | —                       | `(tenant_id, clave)`                                                                      |
| `auditoria_facturacion`             | `id` | varchar | Surrogate (append-only)                  | `auditoria_id`          | `(tenant_id, auditoria_id)`                                                               |
| `gestion_mora`                      | `id` | varchar | Surrogate                                | `mora_id`               | `(tenant_id, mora_id)`                                                                    |
| `secuencias_numeracion`             | `id` | varchar | Surrogate                                | —                       | `tenant_id` (1:1)                                                                         |
| `exportaciones_contables`           | `id` | varchar | Surrogate (append-only)                  | `exportacion_id`        | `(tenant_id, exportacion_id)`                                                             |
| `outbox_entrega`                    | `id` | varchar | Surrogate                                | `evento_id`             | `(tenant_id, evento_id)`                                                                  |
| `outbox_pos`                        | `id` | varchar | Surrogate                                | `evento_id`             | `(tenant_id, evento_id)`                                                                  |
| `outbox_soporte`                    | `id` | varchar | Surrogate                                | `evento_id`             | `(tenant_id, evento_id)`                                                                  |
| `outbox_whatsapp`                   | `id` | varchar | Surrogate                                | `evento_id`             | `(tenant_id, evento_id)`                                                                  |
| `outbox_facturacion`                | `id` | varchar | Surrogate                                | `evento_id`             | `(tenant_id, evento_id)`                                                                  |
| `registros_operaciones`             | `id` | varchar | Surrogate                                | —                       | —                                                                                         |

**Regla de PK:** no se necesitan PK compuestas en el núcleo TUS. La identidad de negocio se protege por UNIQUE tenant-scoped; la PK queda surrogada y simple.

---

## 4. Matriz de FK

| ORIGEN                                                                 | COLUMNAS                                                                                    | DESTINO                         | ESTADO        | RAZÓN                                                                                | CARDINALIDAD | NULLABLE | ON DELETE | ON UPDATE | REQUIERE AUDITAR DATOS                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- | ------------- | ------------------------------------------------------------------------------------ | ------------ | -------- | --------- | --------- | ------------------------------------------ |
| `lineas_factura`                                                       | `(tenant_id, factura_id)`                                                                   | `facturas`                      | FISICA_ACTUAL | Línea depende de su factura                                                          | N:1          | NO       | NO ACTION | NO ACTION | No                                         |
| `publicaciones`                                                        | `(tenant_id, prestador_id)`                                                                 | `prestadores`                   | FISICA_ACTUAL | Publicación pertenece a un prestador                                                 | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `calendarios`                                                          | `(tenant_id, prestador_id)`                                                                 | `prestadores`                   | FISICA_NUEVA  | Agenda principal del prestador; NULL para legacy                                     | N:1          | SÍ       | RESTRICT  | NO ACTION | No                                         |
| `compromisos`                                                          | `(tenant_id, prestador_id)`                                                                 | `prestadores`                   | FISICA_ACTUAL | Obligación comercial con prestador                                                   | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `transiciones_compromiso`                                              | `(tenant_id, compromiso_id)`                                                                | `compromisos`                   | FISICA_ACTUAL | Histórico de un compromiso                                                           | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `compensaciones_compromiso`                                            | `(tenant_id, compromiso_id)`                                                                | `compromisos`                   | FISICA_ACTUAL | Compensación de un compromiso                                                        | 1:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `compromisos_mercado_servicios`                                        | `(prestador_tenant_id, publicacion_id)`                                                     | `publicaciones`                 | FISICA_NUEVA  | Línea de checkout cliente referencia listing del prestador                           | N:1          | NO       | RESTRICT  | NO ACTION | Backfill determinista por `publicacion_id` |
| `trabajos`                                                             | `(tenant_id, compromiso_id, prestador_tenant_id, prestador_id, publicacion_id)`             | `compromisos_mercado_servicios` | FISICA_NUEVA  | Impide enlazar un trabajo con otro prestador o publicación del compromiso            | 1:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `obligaciones_pago_servicio`                                           | `(tenant_id, trabajo_id, compromiso_id, prestador_tenant_id, prestador_id, publicacion_id)` | `trabajos`                      | FISICA_NUEVA  | WEB-09A: la obligación no puede mezclar tenant, prestador, publicación ni compromiso | 1:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `obligaciones_pago_servicio`                                           | `(tenant_id, presupuesto_id, presupuesto_version)`                                          | `presupuestos`                  | FISICA_NUEVA  | Importe derivado de la versión aceptada                                              | N:1          | SÍ       | RESTRICT  | NO ACTION | No                                         |
| `intenciones_pago` / `instantaneas_comision` / `movimientos_contables` | `(tenant_id, obligacion_id)`                                                                | `obligaciones_pago_servicio`    | FISICA_NUEVA  | Sujeto financiero de servicios; excluyente con `compromiso_id`                       | N:1          | SÍ       | RESTRICT  | NO ACTION | No                                         |
| `reglas_calendario`                                                    | `(tenant_id, calendario_id)`                                                                | `calendarios`                   | FISICA_ACTUAL | Regla depende del calendario (mismo tenant)                                          | N:1          | NO       | CASCADE   | NO ACTION | No                                         |
| `excepciones_calendario`                                               | `(tenant_id, calendario_id)`                                                                | `calendarios`                   | FISICA_ACTUAL | Excepción depende del calendario (mismo tenant)                                      | N:1          | NO       | CASCADE   | NO ACTION | No                                         |
| `reservas`                                                             | `(tenant_id, calendario_id)`                                                                | `calendarios`                   | FISICA_ACTUAL | Reserva ocupa franja de un calendario (mismo tenant)                                 | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `reservas`                                                             | `(tenant_id, publicacion_id)`                                                               | `publicaciones`                 | FISICA_NUEVA  | Reserva consume una publicación; NULL para legacy                                    | N:1          | SÍ       | RESTRICT  | NO ACTION | No                                         |
| `turnos_entrega`                                                       | `(tenant_id, zona_id)`                                                                      | `zonas_entrega`                 | FISICA_ACTUAL | Turno en una zona                                                                    | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `evidencias_entrega`                                                   | `(tenant_id, tarea_id)`                                                                     | `tareas_entrega`                | FISICA_ACTUAL | Comprobante de una tarea                                                             | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `incidentes_entrega`                                                   | `(tenant_id, tarea_id)`                                                                     | `tareas_entrega`                | FISICA_ACTUAL | Incidente de una tarea                                                               | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `comprobantes_pos`                                                     | `(tenant_id, operacion_id)`                                                                 | `operaciones_pos`               | FISICA_ACTUAL | Comprobante de una operación                                                         | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `conflictos_pos`                                                       | `(tenant_id, operacion_id)`                                                                 | `operaciones_pos`               | FISICA_ACTUAL | Conflicto de una operación                                                           | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `evidencias_soporte`                                                   | `(tenant_id, caso_id)`                                                                      | `casos_soporte`                 | FISICA_ACTUAL | Evidencia de un caso                                                                 | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `lineas_tiempo_soporte`                                                | `(tenant_id, caso_id)`                                                                      | `casos_soporte`                 | FISICA_ACTUAL | Timeline de un caso                                                                  | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `compensaciones_soporte`                                               | `(tenant_id, caso_id)`                                                                      | `casos_soporte`                 | FISICA_ACTUAL | Compensación de un caso                                                              | 1:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `intenciones_pago`                                                     | `(tenant_id, compromiso_id)`                                                                | `compromisos`                   | FISICA_ACTUAL | Pago de un compromiso                                                                | 1:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `instantaneas_comision`                                                | `(tenant_id, compromiso_id)`                                                                | `compromisos`                   | FISICA_ACTUAL | Snapshot de un compromiso                                                            | 1:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `movimientos_contables`                                                | `(tenant_id, compromiso_id)`                                                                | `compromisos`                   | FISICA_ACTUAL | Movimiento de un compromiso                                                          | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `evidencias_financieras`                                               | `(tenant_id, compromiso_id)`                                                                | `compromisos`                   | FISICA_ACTUAL | Evidencia de un compromiso                                                           | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `confirmaciones_financieras`                                           | `(tenant_id, compromiso_id)`                                                                | `compromisos`                   | FISICA_ACTUAL | Confirmación de un compromiso                                                        | 1:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `bloqueos_financieros`                                                 | `(tenant_id, compromiso_id)`                                                                | `compromisos`                   | FISICA_ACTUAL | Congelamiento de un compromiso                                                       | 1:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `registros_conciliacion`                                               | `(tenant_id, compromiso_id)`                                                                | `compromisos`                   | FISICA_ACTUAL | Conciliación de un compromiso                                                        | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `facturas`                                                             | `(tenant_id, compromiso_id)`                                                                | `compromisos`                   | FISICA_ACTUAL | Documento sobre un compromiso; la aplicación debe rechazar `""`                      | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `notas_credito`                                                        | `(tenant_id, factura_id)`                                                                   | `facturas`                      | FISICA_ACTUAL | NC reduce una factura                                                                | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `reintegros_facturacion`                                               | `(tenant_id, factura_id)`                                                                   | `facturas`                      | FISICA_ACTUAL | Reintegro de una factura                                                             | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `movimientos_contables_facturacion`                                    | `(tenant_id, factura_id)`                                                                   | `facturas`                      | FISICA_ACTUAL | Ledger de una factura                                                                | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `gestion_mora`                                                         | `(tenant_id, suscripcion_id)`                                                               | `suscripciones`                 | FISICA_ACTUAL | Mora de una suscripción                                                              | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |
| `suscripciones`                                                        | `(tenant_id, plan_id)`                                                                      | `planes_suscripcion`            | FISICA_ACTUAL | Suscripción a un plan; la aplicación debe rechazar `""`                              | N:1          | NO       | RESTRICT  | NO ACTION | No                                         |

---

## 5. Matriz de relaciones NO-FK

| TABLA                               | CAMPO                                                                | TIPO           | DESTINO CONCEPTUAL                | RAZÓN DE NO FK                            | PROTECCIÓN DE INTEGRIDAD   |
| ----------------------------------- | -------------------------------------------------------------------- | -------------- | --------------------------------- | ----------------------------------------- | -------------------------- |
| `tareas_entrega`                    | `compromiso_id`                                                      | LOGICA         | compromisos                       | Entrega puede vivir más que el compromiso | Aplicación                 |
| `tareas_entrega`                    | `operador_id`                                                        | EXTERNA        | Personal                          | Actor no persistido como entidad propia   | Aplicación                 |
| `tareas_entrega`                    | `prestador_id`                                                       | LOGICA         | prestadores                       | Referencia de negocio                     | Aplicación                 |
| `tareas_entrega`                    | `zona_id`, `turno_id`                                                | LOGICA         | zonas/turnos                      | Referencias operativas                    | Aplicación                 |
| `casos_soporte`                     | `compromiso_id`, `disputa_id`                                        | LOGICA         | compromisos/disputas              | Soporte puede existir sin compromiso      | Aplicación                 |
| `referencias_auditoria`             | `compromiso_id`                                                      | LOGICA         | compromisos                       | Traza puede sobrevivir al agregado        | Aplicación                 |
| `movimientos_contables`             | `entrada_vinculada_id`                                               | LOGICA         | movimientos_contables (self)      | Auto-referencia append-only               | Aplicación                 |
| `movimientos_contables_facturacion` | `entrada_vinculada_id`, `nota_credito_id`, `reintegro_id`            | LOGICA         | ledger/NC/reintegro               | Auto-referencia                           | Aplicación                 |
| `facturas`                          | `cuenta_id`, `pago_id`, `orden_id`, `operacion_pos_id`               | LOGICA         | cuentas/pagos/ordenes/operaciones | `""` permitidos; referencias de negocio   | Aplicación                 |
| `suscripciones`                     | `cliente_id`                                                         | EXTERNA/LOGICA | cliente                           | Cliente no es entidad TUS persistida      | Aplicación                 |
| `perfiles_fiscales`                 | `parte_id`                                                           | POLIMORFICA    | parte fiscal                      | Parte polimórfica                         | Aplicación                 |
| `cuentas_facturacion`               | `parte_id`                                                           | POLIMORFICA    | parte                             | Parte polimórfica                         | Aplicación                 |
| `mensajes_whatsapp`                 | `consentimiento_id`                                                  | LOGICA         | consentimientos_whatsapp          | Referencia lógica                         | Aplicación                 |
| `evidencias_habilitacion`           | `capacidad`, `requisito`, `propietario`, `alcance`                   | POLIMORFICA    | capacidad/gate                    | Referencias polimórficas                  | Evaluación de habilitación |
| `decisiones_habilitacion`           | `capacidad`, `perfil`, `alcance`                                     | POLIMORFICA    | capacidad                         | Referencias polimórficas                  | Evaluación de habilitación |
| `auditoria_*` (todas)               | `tipo_recurso` + `recurso_id`                                        | POLIMORFICA    | agregados                         | Recurso polimórfico                       | Aplicación                 |
| `auditoria_*`                       | `actor_id`, `correlacion_id`                                         | TECNICA        | actor/correlación                 | Identificadores de contexto               | Aplicación                 |
| `intenciones_pago`                  | `proveedor`, `referencia_proveedor`, `estado_proveedor`              | EXTERNA        | Mercado Pago/pasarela             | Integración externa                       | Contrato de proveedor      |
| `instantaneas_comision`             | `referencia_proveedor`                                               | EXTERNA        | proveedor                         | Integración externa                       | Contrato de proveedor      |
| `registros_conciliacion`            | `referencia_proveedor`, `monto_proveedor`                            | EXTERNA        | proveedor                         | Integración externa                       | Contrato de proveedor      |
| `eventos_webhook_pago`              | `proveedor`, `evento_proveedor_id`, `firma`, `datos_evento`          | EXTERNA        | webhook de proveedor              | Integración externa                       | Verificación de firma      |
| `eventos_webhook_whatsapp`          | `evento_proveedor_id`, `firma`                                       | EXTERNA        | Meta/WhatsApp                     | Integración externa                       | Verificación de firma      |
| `confirmaciones_whatsapp`           | `remitente_id`                                                       | EXTERNA        | número Meta                       | Integración externa                       | Contrato Meta              |
| `mensajes_whatsapp`                 | `destinatario_id`, `plantilla`, `version_plantilla`                  | EXTERNA        | Meta/WhatsApp                     | Integración externa                       | Contrato Meta              |
| `consentimientos_whatsapp`          | `destinatario_id`, `tipo_destinatario`                               | EXTERNA        | identidad externa                 | Integración externa                       | Aplicación                 |
| `evidencias_habilitacion`           | `referencia_evidencia`                                               | EXTERNA        | evidencia externa                 | Referencia externa                        | Aplicación                 |
| `perfiles_fiscales`                 | `autoridad`, `referencia_aprobacion_externa`, `referencia_evidencia` | EXTERNA        | AFIP/ARCA                         | Integración externa                       | Contrato fiscal            |
| `exportaciones_contables`           | `referencia_aprobacion_externa`                                      | EXTERNA        | contabilidad externa              | Integración externa                       | Contrato contable          |
| `calendarios`                       | `servicio_id`                                                        | LEGACY         | TusService                        | Acoplamiento legacy                       | Pendiente migración        |
| `reservas`                          | `servicio_id`                                                        | LEGACY         | TusService                        | Acoplamiento legacy                       | Pendiente migración        |
| `reservas`                          | `cliente_id`                                                         | EXTERNA/LOGICA | cliente                           | Cliente no es entidad persistida          | Aplicación                 |
| `reservas`                          | `cliente_tenant_id`                                                  | LOGICA         | tenant cliente                    | NULL en legado sin backfill determinista  | Aplicación                 |
| `outbox_*` (todos)                  | `agregado_id`                                                        | POLIMORFICA    | agregado                          | Agregado polimórfico                      | Dispatcher de worker       |
| `outbox_*` (todos)                  | `tipo_evento`                                                        | TECNICA        | —                                 | Identificador técnico congelado           | Constante                  |
| `registros_operaciones`             | `contexto`, `canal`, `geografia`                                     | TECNICA        | —                                 | Dimensiones de reporting                  | Aplicación                 |

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

- `tenant_id` identifica al cliente; `prestador_tenant_id` identifica al propietario de la publicación.
- La migración WEB-08A reemplaza la FK incorrecta `(tenant_id, publicacion_id)` por
  `(prestador_tenant_id, publicacion_id) → publicaciones`, con backfill determinista por la PK global `publicacion_id`.

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
  **`reservas`** — FK física actual `calendario_id → calendarios` RESTRICT y nueva FK nullable `(tenant_id, publicacion_id) → publicaciones` RESTRICT; `cliente_tenant_id` conserva ownership cliente de reservas nuevas y queda NULL en legado sin backfill determinista; `cliente_id` externa/lógica; `servicio_id` legacy.

En WEB-04D2/WEB-04D3 la agenda se resuelve por `(tenant_id, prestador_id)`. El `calendarId` externo es una comprobación opcional de
la agenda encontrada, no una autoridad para cambiar de prestador. `publicacion_id` ya existente se escribe para
bookings canónicos; las reservas legacy pueden continuar con `servicio_id`.

WEB-04D3 no agrega tablas, columnas, índices, constraints, relaciones físicas ni providers. La ausencia de agenda y el
presupuesto requerido son estados de aplicación (`not_configured` y `BUDGET_REQUIRED`), no nuevos estados persistidos.

WEB-08 mantiene esta frontera física: `BUDGET_REQUIRED` no implica una tabla de presupuesto por sí solo. Un compromiso de
marketplace sin franja puede originar un `Trabajo`; no crea una `Reserva` ni ocupa capacidad. El trabajo y sus presupuestos
siguen siendo hechos separados, versionados y auditables.

### 7.4 Entrega

`zonas_entrega` → `turnos_entrega` (FK zona RESTRICT) → `tareas_entrega` (referencias lógicas) ← `evidencias_entrega` / `incidentes_entrega` (FK tarea RESTRICT). `operador_id` nullable/externa.

### 7.5 POS

`operaciones_pos` (agregado, idempotencia) ← `comprobantes_pos` / `conflictos_pos` (FK RESTRICT). `versiones_pos`, `dispositivos_pos`, `sesiones_pos` de soporte.

### 7.6 Soporte

`casos_soporte` ← `evidencias_soporte`, `lineas_tiempo_soporte`, `compensaciones_soporte` (FK RESTRICT).

### 7.7 WhatsApp

Canal gobernado; referencias externas a Meta (`remitente_id`, `destinatario_id`, `plantilla`, `evento_proveedor_id`, `firma`) nunca son FK. `consentimiento_id` lógica. El `origen` del consentimiento se normaliza a `web_linking`, `whatsapp_inbound`, `operator_console` u `opt_out`; `whatsapp_inbound` representa conversación y no marketing.

### 7.8 Habilitación

`evidencias_habilitacion` y `decisiones_habilitacion` — históricas/append-only; `capacidad`/`requisito`/`propietario`/`alcance`/`perfil` polimórficos. Valores congelados (`resultado_habilitacion`, `requisitos_fallidos`, `ids_evidencia`).

### 7.9 Trabajo y presupuesto WEB-08A/B

- `trabajos.origen` (`20261009100000_tus_trabajo_desde_solicitud`): `marketplace` (con `compromiso_id` y
  `publicacion_id`, como hasta ahora) o `solicitud` (con `solicitud_id`, sin compromiso ni publicación). El CHECK
  `ck_trabajos_origen_coherente` exige una sola de las dos formas; `uq_trabajos_solicitud` (parcial) permite como máximo
  un trabajo por solicitud y `fk_trabajos_solicitud_asignada` `(solicitud_id, prestador_tenant_id, prestador_id)` →
  `solicitudes_servicio (id, prestador_tenant_id, prestador_id)` garantiza en la base que el prestador del trabajo es el
  prestador que el cliente eligió (y bloquea cambiarlo o borrar la solicitud mientras exista el trabajo).
- `trabajos` es el agregado de ejecución de un servicio. `tenant_id` es el tenant cliente del compromiso de marketplace;
  `prestador_tenant_id` es el tenant del prestador, publicación y reserva. La unicidad de negocio es `(tenant_id, trabajo_id)`
  y solo existe un trabajo por `(tenant_id, compromiso_id)`.
- `diagnosticos` conserva `descripcion_original` y opcionalmente `datos_estructurados`; sus versiones son append-only por
  `(tenant_id, trabajo_id, version)`.
- `presupuestos` modela una versión de propuesta con `monto_total` en bigint/minor units, `alcance`, `moneda`, `fecha_validez`
  y estado. `lineas_presupuesto` son hijos estrictamente dependientes del registro de versión.
- `aceptaciones_presupuesto` guarda una única decisión por versión y tenant; una nueva propuesta debe crear otra versión, no
  reescribir una versión aceptada.
- `trabajos.presupuesto_aceptado_id` y `presupuesto_aceptado_version` referencian la versión aceptada mediante la FK compuesta
  `(tenant_id, presupuesto_id, version)`.
- `transiciones_trabajo` y `auditoria_trabajo` son append-only. `evidencias_trabajo` solo guarda referencia y metadata durable;
  no contiene binarios ni sustituye B2/S3.
- Todas las FK nuevas de entidades tenant-scoped usan claves compuestas. La FK opcional a `reservas` usa
  `(reserva_tenant_id, reserva_id)` para conservar el ownership del prestador.
- WEB-08B opera estas tablas en transacciones in-memory o Prisma serializables, con idempotencia, locking optimista,
  auditoría y outbox para cada mutación.

### 7.9 Finanzas

**WEB-09A.** `obligaciones_pago_servicio` es la identidad financiera canónica de un servicio WEB-08: una fila por
`(tenant_id, trabajo_id)`, con FK compuesta a `trabajos (tenant_id, trabajo_id, compromiso_id, prestador_tenant_id,
prestador_id, publicacion_id)` y FK opcional a la versión aceptada de `presupuestos`. `monto` es bigint en minor units y
se deriva en servidor del presupuesto aceptado o del compromiso de precio fijo. `intenciones_pago`, `instantaneas_comision`
y `movimientos_contables` conservan un único ledger/tabla: agregan `obligacion_id` nullable y relajan `compromiso_id`; el
CHECK `ck_*_sujeto_unico` (NOT VALID, aplica a filas nuevas) exige exactamente un sujeto. El relajamiento de NOT NULL no
reescribe ni elimina datos.

**WEB-09B.** Las intenciones de servicio usan `intenciones_pago` con `obligacion_id`, `intento` (único por obligación),
`estado_despacho` y `prestador_tenant_id`. `eventos_webhook_pago` es el inbox durable: agrega `pago_id`, `obligacion_id`,
`referencia_proveedor`, `estado_proveedor`, `monto`, `moneda`, `motivo` y `fecha_recepcion`; `datos_evento` guarda el raw
body y `estado` el resultado de procesamiento. `auditoria_finanzas_servicio` es append-only y referencia la obligación.

**WEB-09C.** `liquidaciones_servicio` guarda la liquidación interna única por obligación (bruto, comisión y neto en bigint,
`estado` `held | eligible | frozen | reversed`, `estado_desembolso` fijo en `not_executed` por CHECK y
`monto_comision + monto_neto = monto_bruto`). `conciliaciones_servicio` guarda corridas append-only con `hallazgos` JSON.
La comisión reutiliza `instantaneas_comision` y los asientos `movimientos_contables` con `obligacion_id`.

**DB-09-SAFETY.** `20260924100000_tus_finance_subject_hardening` valida los CHECK XOR, reserva el espacio `svc-*` del
ledger para `obligacion_id`, agrega `uq_obligaciones_pago_identidad_prestador` y las FKs
`fk_intenciones_pago_obligacion_prestador`, `fk_liquidaciones_servicio_obligacion_prestador` y
`fk_eventos_webhook_pago_intenciones` (todas RESTRICT, NOT VALID + VALIDATE). Ver matriz en
`docs/WEB-09_AUDITORIA_PRODUCTOS_TUS.md`.

**WEB-09D.** `20260925100000_tus_service_payment_configuration` (aditiva): `instantaneas_comision` agrega
`politica_comision_id`, `comision_proveedor_pago`, `fee_proveedor_a_cargo` y `neto_prestador` (nullable; filas históricas
NULL; CHECK validado de no negativos y valores permitidos). `politicas_comision_servicio` (append-only por trigger; tasa
0..3000 bp por CHECK; `clave_alcance` + `version` únicos) y `configuraciones_pagos_servicio` (append-only; `version` única)
son configuración de plataforma sin tenant. `cuentas_cobro_prestador` guarda el vínculo OAuth del prestador (una fila por
tenant prestador y proveedor, versión optimista, `connected` exige `cuenta_externa_id`). `credenciales_cuenta_cobro` guarda
tokens cifrados AES-256-GCM con la clave en `TUS_PAYMENT_CREDENTIALS_KEY` (fuera de la DB). `estados_oauth_cobro` guarda el
`state` OAuth solo como sha256 y el verificador PKCE cifrado, con consumo atómico de un solo uso. Ninguna tabla guarda
credenciales de la plataforma.

**WEB-09E.** `20260926100000_tus_service_payment_checkout` (aditiva): `intenciones_pago` agrega la preferencia de
Checkout Pro (`preferencia_id`, único por proveedor; `url_checkout` https; `checkout_expira_en`), la comisión congelada al
crear el checkout (`tasa_comision_bps`, `version_regla_comision`, `politica_comision_id`, `comision_marketplace` ≤ `monto`;
tasa y monto juntos o ambos NULL), el reclamo de despacho `despacho_reclamado_hasta` y `entorno_proveedor`
(`sandbox | production | deterministic`). Filas previas quedan con NULL. `reembolsos_servicio` registra intentos de
reembolso total (FK a la intención exacta, únicos por intento y por clave de idempotencia, estados
`requested | submitted | requires_review | failed`); el estado monetario sigue cambiando solo con el webhook verificado.

**IDENTITY-NOSIS.** `20260927100000_tus_identity_verification` (aditiva, solo tablas nuevas):
`verificaciones_identidad` (estado con CHECK; `verified` exige DNI, método y fecha; DNI 6–9 dígitos y CUIL 11 dígitos por
CHECK; índices únicos parciales sobre `numero_documento` y `cuil_verificado` donde `estado = 'verified'`; versión
optimista; lecturas OCR/visión y snapshot externo mínimo en JSONB). `documentos_identidad` (imagen sin metadata cifrada
AES-256-GCM, un lado por verificación). `cola_verificacion_identidad` (FIFO por `encolado_en`, lease con `lease_owner` /
`lease_hasta`, un trabajo activo por verificación por índice parcial). `consultas_proveedor_identidad` (append-only; una
fila por búsqueda enviada, base de la ventana deslizante 7/h). `estado_proveedor_identidad` (running/paused/
session_required/circuit_open con versión). `sesiones_navegador_proveedor` (estado Playwright cifrado).
`auditoria_identidad` (append-only, DNI/CUIL enmascarados). Relaciones lógicas sin FK: `verificacion_id` y `tenant_id`.

**GOOGLE SIGN-IN.** `20260929100000_tus_google_federated_auth` (aditiva, solo tablas nuevas):
**IDENTIDAD POR TELÉFONO.** `20261019100000_tus_identidad_telefono` (aditiva). En `"User"` (la persona):
`"phoneNumber"` (E.164, UNIQUE `User_phoneNumber_key`, NULL en cuentas sin teléfono; CHECK `ck_user_phone_e164`),
`"phoneVerifiedAt"` (CHECK `ck_user_phone_verified_pair`: ambos o ninguno) y `"phonePending"` (número a verificar, CHECK
E.164, sin UNIQUE). El teléfono se escribe solo al verificarlo desde WhatsApp. `desafios_telefono`: `id`, `cuenta_id`
(FK `"Account"(id)` ON DELETE CASCADE), `telefono` (E.164 esperado), `proposito` (CHECK `verificar_telefono |
cambiar_telefono | recuperar_contrasena`), `hash_desafio` (SHA-256, UNIQUE; el código nunca se guarda),
`hash_secreto_consulta` (flujos sin sesión), `expira_en` (10 min), `usado_en`, `invalidado_en` + `motivo_invalidacion`
(CHECK `reemplazado | intentos | conflicto`), `intentos_fallidos` (desde un número equivocado; 5 invalidan),
`wamid_verificacion` (idempotencia), `entregado_en` (autorización de recuperación entregada una vez),
`confirmacion_enviada_en` / `confirmacion_error` (resultado del transporte, nunca revierte la identidad), `creado_en`.
Índice parcial único `uq_desafios_telefono_activo (cuenta_id, proposito) WHERE usado_en IS NULL AND invalidado_en IS
NULL`: un desafío vivo por cuenta y propósito.

`identidades_externas` (identidad federada permanente `(proveedor, emisor, sujeto)` única; FK física a `"Account"(id)`
ON DELETE RESTRICT / ON UPDATE NO ACTION; `proveedor` con CHECK `google`; el email es solo informativo y nunca identifica).
`transacciones_oauth` (state/nonce/PKCE de cada intento; solo el sha256 del `state`, único; consumo atómico de un solo uso;
expira en minutos). `codigos_ingreso_oauth` (código de un solo uso que entrega el resultado del callback a la Web sin
poner un token de sesión en la URL; solo el sha256; `tipo` con CHECK `session | signup | link`; TTL 2/15/15 min).
No se guardan access tokens ni refresh tokens de Google. Relación lógica sin FK: `datos.accountId` de los códigos.

**SOLICITUDES DE SERVICIO.** `20260930100000_tus_solicitudes_servicio` (aditiva, una tabla nueva): `solicitudes_servicio`
guarda lo que un cliente necesita (categoría, título, descripción opcional, barrio, presupuesto máximo opcional, urgencia)
para el mapa público de la home. FK física `cuenta_id → "Account"(id)` ON DELETE RESTRICT / ON UPDATE NO ACTION. Privacidad:
no hay columnas de dirección, teléfono ni email; `latitud`/`longitud` son el centro del barrio con un desplazamiento
determinístico de ±~300 m, redondeado a 3 decimales; `nombre_publico` es nombre + inicial. CHECKs de categoría, urgencia,
estado, longitudes, presupuesto y rango de coordenadas. Vigencia 30 días (`expira_en`); límites de 5 publicaciones por
cuenta cada 24 h y 10 abiertas a la vez (aplicación). Índices para el listado público y para "mis solicitudes".

**DIRECTORIO Y SOLICITUDES DIRIGIDAS.** `20261001100000_tus_directorio_prestadores` (aditiva: dos tablas nuevas y
 columnas/constraints nuevos en `solicitudes_servicio`; no modifica constraints ni datos existentes):
`perfiles_publicos_prestador` (lo que el prestador elige mostrar en "Buscar trabajador": nombre público, oficio del
catálogo canónico, barrio, descripción y años de experiencia declarados; uno por prestador; FK compuesta a `prestadores`
RESTRICT; su `id` es el único identificador que sale a la Web). La migración aditiva
`20261003100000_tus_directorio_ubicaciones` hace `zona` nullable para perfiles sin zona declarada y agrega
`zonas_cobertura` (hasta 8 zonas canónicas), `modalidad_atencion` (`local | domicilio | mixto`) y
`radio_cobertura_km` (1–100 opcional). La ubicación pública puede usar un área normalizada proveniente de una verificación
de identidad, pero solo se expone como zona/localidad y como centro aproximado; no se copia la dirección exacta.
En `solicitudes_servicio`: `origen`
(`web_publica | web_assistant | web_directory | whatsapp`, default `web_publica`), `visibilidad` (`publica | dirigida`,
default `publica`), `prestador_tenant_id`/`prestador_id` (FK compuesta a `prestadores` RESTRICT, solo en dirigidas),
`estado_asignacion` (`pendiente | aceptada | rechazada | cancelada`) y `respondida_en`. Un CHECK de coherencia impide
dirigidas sin prestador o públicas con prestador. "Elegido" no es "confirmado": la asignación nace `pendiente` y solo el
prestador destino la pasa a `aceptada` o `rechazada`. `imagenes_solicitud`: hasta 2 fotos por solicitud (orden 1/2
único), JPEG/PNG/WEBP de hasta 3 MB, guardadas sin EXIF/GPS/XMP; públicas solo si la solicitud es pública y está
abierta, privadas (dueña y prestador destino) si es dirigida. Las filas existentes quedan `web_publica`/`publica`.

`postulaciones_solicitud` (20261002100000): un prestador aprobado con perfil público visible, de cualquier oficio, se
ofrece para una solicitud pública abierta (`estado` nace `pendiente`, `mensaje` opcional de hasta 300 caracteres sin datos
de contacto). Una postulación por prestador y solicitud (`uq_postulaciones_solicitud_prestador`). El cliente decide: al
aceptar una, en una transacción la solicitud pasa a `visibilidad = dirigida`, `prestador_*` del postulante y
`estado_asignacion = aceptada` (sale del mapa), esa postulación queda `aceptada` y el resto de las pendientes `rechazada`;
el índice parcial `uq_postulaciones_solicitud_aceptada` (solo SQL) garantiza un único aceptado aunque haya dos
aceptaciones concurrentes. El cliente también puede rechazar a un postulante; el prestador puede retirarse (`retirada`)
mientras siga pendiente, y cerrar la solicitud rechaza a los pendientes. FKs RESTRICT a `solicitudes_servicio` y a
`prestadores (tenant_id, prestador_id)`.

**MATCH Y CANCELACIÓN.** Elegir un postulante (o que el prestador acepte una solicitud dirigida) es el match: en la MISMA
transacción se asigna la solicitud, se acepta esa postulación, se rechazan las pendientes y nace el trabajo
(`trabajos.origen = 'solicitud'`). `20261010100000_tus_solicitud_cancelacion` (aditiva): `cancelada_en` y
`cancelada_por` registran la cancelación de la dueña, que solo procede antes del match (abierta, pública o dirigida
pendiente, sin trabajo); una solicitud cancelada queda `cerrada` y nunca se borra
(`ck_solicitudes_servicio_cancelacion`). Con prestador elegido la API responde `409 WORK_ACTIVE`: la cancelación pasa a
ser una operación del trabajo.

Filas legacy: todas referencian `compromiso_id` mediante FKs físicas actuales RESTRICT, mayormente 1:1. Referencias externas: `proveedor`, `referencia_proveedor`, `estado_proveedor`, `evento_proveedor_id`, `firma`. Ledger append-only con trigger; `entrada_vinculada_id` auto-referencia lógica. `tasa_puntos_base` (ex `rateBps`): decisión de españolizar el identificador; el valor numérico (basis points) conserva su semántica financiera.

### 7.9 bis Chat privado del trabajo

- `mensajes_trabajo` (`20261011100000_tus_mensajes_trabajo`, aditiva): conversación privada entre el cliente y el
  prestador de un trabajo, después del match. No es WhatsApp (que sigue siendo contacto ↔ número oficial de TUS).
- La FK compuesta `(tenant_id, trabajo_id, prestador_tenant_id)` → `trabajos` (índice único
  `uq_trabajos_tenant_trabajo_prestador`, superconjunto de `uq_trabajos_tenant_trabajo`) impide que un mensaje pertenezca a
  la conversación de otro prestador; `autor_cuenta_id` es una cuenta real.
- `autor_rol` (`cliente` | `prestador`) lo deriva la API del tenant de la sesión frente al trabajo; `texto` tiene entre 1 y
  2000 caracteres y admite datos de contacto (las reglas anti-contacto de los textos públicos no aplican). Append-only;
  el id incluye el `clientMessageId` del navegador para que un reintento no duplique el mensaje.

### 7.10 Facturación

`facturas` (append-only) ← `lineas_factura` (FK física actual compuesta) ← `notas_credito` / `reintegros_facturacion` / `movimientos_contables_facturacion` (FKs físicas actuales RESTRICT). `suscripciones` (`plan_id` FK física actual, `cliente_id` externa). `perfiles_fiscales`/`cuentas_facturacion` (`parte_id` polimórfica). `gestion_mora` FK física actual a `suscripciones`. `secuencias_numeracion` 1:1 por tenant.

### 7.11 Outbox TUS

`tipo_evento` técnico congelado; `agregado_id` polimórfico. Sin FK.

### 7.12 Reporting

`registros_operaciones` — métrica operativa; sin FK.

### 7.13 Catálogo administrado (servicios y ubicaciones)

Migraciones `20261007100000_tus_catalogo` (tablas y semilla) y `20261008100000_tus_barrios_poligono` (aditiva). La fuente de verdad es PostgreSQL; la API mantiene una copia vigente en memoria que se recarga al iniciar, después de cada cambio del panel y cada minuto. Nada se borra físicamente: `activo = false` saca el registro de los flujos nuevos y conserva el historial.

- `categorias_servicio`: agrupa oficios (Hogar y reparaciones, Otros, ...). La agrupación "Otros" es solo visual: cada oficio es una fila propia administrable.
- `oficios_servicio`: cada servicio/oficio (alta, edición, activación, desactivación). `profesion` es la etiqueta del profesional; `icono` es una clave de la interfaz; el `id` es estable porque `perfiles_publicos_prestador.oficio` y `solicitudes_servicio.categoria` lo guardan.
- `sinonimos_oficio`: palabras clave de búsqueda del oficio, guardadas normalizadas (minúsculas, sin acentos, espacios simples; 2 a 40 caracteres, hasta 80 por oficio, sin duplicados). El intérprete de la búsqueda y del asistente compara con la misma normalización.
- `localidades` → `zonas_ubicacion` → `barrios`: árbol de ubicaciones. Una zona agrupa barrios (buscar "Norte" cubre sus barrios). Un barrio se ofrece solo si él, su zona y su localidad están activos.

| Columna | Tabla | Tipo lógico | Almacenamiento | Nulo | Propósito |
|---|---|---|---|---|---|
| `poligono` | `barrios` | GeoJSON `Polygon` (un anillo exterior cerrado, posiciones `[longitud, latitud]` WGS84) | `jsonb` | NULL (desde `20261016100000`) | Área del barrio. La dibuja, edita y puede quitar el panel (Leaflet, editor de vértices); el catálogo público (`GET /tus/v1/public/oficios`, `locations.localities[].neighbourhoods[].polygon`) la expone (o `null`). Sin polígono, el punto es el fallback. |
| `latitud`, `longitud` | `barrios` | punto de referencia | `double precision` | NULL (ambos o ninguno) | Punto de referencia del barrio, obligatorio en la API (fallback cuando no hay polígono). Ubica solicitudes por barrio y da la distancia aproximada entre barrios. Nunca una dirección exacta. |
| `poligono` | `zonas_ubicacion` | GeoJSON `Polygon` (mismo formato que `barrios.poligono`) | `jsonb` | NULL | Área de la zona (p. ej. "Alta Gracia"). CHECK `ck_zonas_ubicacion_poligono_geojson`. Autoridad para asociar puntos que no caen en ningún barrio. |
| `latitud`, `longitud` | `zonas_ubicacion` | punto de referencia | `double precision` | NULL (ambos o ninguno) | Punto de referencia de la zona (CHECK de rango y de ambos-o-ninguno). Fallback cuando no hay polígono. |

Reglas de `poligono` (barrios y zonas):

- CHECK `ck_barrios_poligono_geojson` / `ck_zonas_ubicacion_poligono_geojson`: NULL o `type = 'Polygon'`, exactamente un anillo, al menos 4 posiciones (3 vértices + cierre).
- La API valida además: 3 a 200 vértices distintos, coordenadas en rango, anillo cerrado (lo cierra si falta), sin autointersecciones y con superficie (vértices colineales se rechazan); un vértice repetido consecutivo (doble clic) se descarta. Un polígono inválido se rechaza con 422 y `campos: ['poligono']`.
- Auditoría: `poligono_creado`, `poligono_modificado`, `poligono_eliminado` y `punto_modificado` (evento `catalog.<entidad>_<accion>`).
- La migración aditiva completó las filas existentes con un cuadrado de ±0,003° alrededor del punto (o del centro de Corrientes si no tenía punto) antes de pasar la columna a NOT NULL. No se usa PostGIS: GeoJSON + JSONB + Leaflet es la decisión vigente.

Relación con búsqueda y mapa: los barrios y zonas activos son los lugares que reconoce el intérprete (`ubicacionesReconocibles`), los que aceptan las validaciones de solicitudes y perfiles (`zonasCorrientes`) y los que publica el catálogo público con su polígono. Un barrio desactivado deja de ofrecerse, pero `buscarBarrio` lo sigue resolviendo para los registros históricos. Renombrar un barrio usado por perfiles o solicitudes se rechaza (409 `IN_USE_RENAME`) porque esos registros guardan el nombre.

#### 7.13 bis Servicios del prestador y ubicación en el mapa (`20261015100000`, `20261016100000`)

`perfil_servicios` (Prestador N:M Servicio; decisión DIR-05):

| Columna | Tipo | Nulo | Propósito |
|---|---|---|---|
| `perfil_id` | `text` | NOT NULL | FK a `perfiles_publicos_prestador.id` ON DELETE CASCADE. PK (`perfil_id`, `oficio_id`). |
| `oficio_id` | `text` | NOT NULL | FK a `oficios_servicio.id` RESTRICT. Índice `ix_perfil_servicios_oficio` para filtrar por servicio/categoría. |
| `orden` | `integer` | NOT NULL | 0 = principal; CHECK 0..99. |
| `fecha_creacion` | `timestamp(3)` | NOT NULL | Alta del servicio en el perfil (backfill: la del perfil). |

`perfiles_publicos_prestador.oficio` es el servicio principal: FK compuesta `fk_perfiles_servicio_principal (id, oficio) → perfil_servicios (perfil_id, oficio_id)` `DEFERRABLE INITIALLY DEFERRED` (la aplicación escribe perfil y servicios en una transacción).

Ubicación del prestador en `perfiles_publicos_prestador` (DIR-06/DIR-07):

| Columna | Tipo | Nulo | Propósito |
|---|---|---|---|
| `latitud`, `longitud` | `double precision` | NULL (ambos o ninguno; CHECK de rango) | Pin elegido en el mapa por el prestador o el admin. Se guarda para TUS; solo se publica si `mostrar_ubicacion_exacta`. |
| `mostrar_ubicacion_exacta` | `boolean` | NOT NULL, default `false` | Privacidad: sin permiso el mapa muestra el barrio o la zona. |
| `barrio_id` | `text` | NULL | FK `fk_perfiles_publicos_prestador_barrio` a `barrios` (RESTRICT; los barrios no se borran, se desactivan). Barrio asociado al guardar el punto. |
| `zona_id` | `text` | NULL | FK `fk_perfiles_publicos_prestador_zona` a `zonas_ubicacion` (RESTRICT). Zona asociada. |
| `ubicacion_asociacion` | `text` | NULL | CHECK `poligono_barrio | poligono_zona | geocodificador | manual | sin_asociar`: cómo se asoció el punto. |

Ninguna de estas columnas sale como tal en el DTO público: la API publica un único `mapPoint` (`exact | barrio | zona | reference`) calculado con la prioridad de DIR-06.

`prestadores.estado` admite `approved` y, desde la edición del admin (DIR-09), `suspended` (sale del directorio; sin CHECK en la base).

Listados del panel: `GET /tus/v1/admin/catalogo/:entidad` pagina en PostgreSQL (`ORDER BY orden, nombre, id` + `LIMIT/OFFSET`; 10, 25 o 50 por página, nunca más de 50) y agrega los conteos de prestadores y solicitudes con consultas agregadas (`GROUP BY`, `unnest(zonas_cobertura)`), nunca una consulta por fila.

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

| Término     | Motivo                                                                   |
| ----------- | ------------------------------------------------------------------------ |
| `id`        | PK surrogate técnica                                                     |
| `tenant_id` | excepción técnica de aislamiento                                         |
| `actor_id`  | identificador técnico transversal del actor                              |
| `POS`       | sigla del punto de venta (dentro de `operaciones_pos`, etc.)             |
| `WhatsApp`  | nombre propio del canal Meta                                             |
| `sla`       | acrónimo estándar de servicio                                            |
| `plan_id`   | semántica clara y sin traducción natural necesaria (plan de suscripción) |

Los **valores** almacenados en columnas como `tipo_evento`, `resultado_habilitacion`, `requisitos_fallidos`, `tipo_agregado`, `proveedor`, enums contractuales y payloads externos **permanecen congelados** en su forma original.

### 7.14 Perfil personal y geografía (PERFIL-GEO-01, `20261021100000_tus_perfil_geografia`)

- `paises` → `provincias` → `localidades`: geografía normalizada. `localidades` ya existía como catálogo de servicio
  (de ella cuelgan zonas y barrios); gana `provincia_id` (FK), `latitud`/`longitud` (punto de referencia para centrar
  el mapa) y `cobertura`. Solo las localidades con `cobertura = true` forman el catálogo de servicio; el resto es
  geografía para la residencia de las personas. La columna de texto `provincia` se conserva (índice único histórico).
  Semilla: Argentina, 24 jurisdicciones y 88 localidades (capitales, provincia de Corrientes y ciudades principales);
  las coordenadas son el centro aproximado de cada localidad.
- `"User"` (la persona) gana el perfil personal: `firstName`, `lastName`, `documentType` (`DNI`, `LC`, `LE`,
  `PASAPORTE`), `documentNumber` (normalizado: solo dígitos, o alfanumérico en mayúsculas para pasaporte), `localidadId`
  (FK RESTRICT), `addressStreet`, `addressNumber`, `addressUnit` (opcional), `postalCode`, `profileComplete` y
  `profileUpdatedAt`. Son datos **privados**: solo los ve su titular (`/tus/v1/perfil`) y la administración de
  plataforma. Invariantes en la base: `ck_user_documento` (tipo y número juntos y con el formato del tipo),
  `uq_user_documento` (una persona por documento, índice único parcial), `ck_user_perfil_completo` (el indicador solo
  puede ser verdadero con todos los campos obligatorios presentes). Los usuarios existentes quedan con
  `profileComplete = false` y sin ningún dato inventado.

### 7.15 Canal del asistente (ASISTENTE-WEB-01, `20261020100000_tus_asistente_canal_web`)

- `contactos_whatsapp.canal` y `conversaciones_whatsapp.canal`: `whatsapp` (por defecto, todas las filas previas) o
  `web`. Un contacto Web guarda en `wa_id` la clave `web:acct:<cuenta>` o `web:anon:<id del navegador>`
  (`ck_contactos_whatsapp_wa_id` valida el formato por canal) y nunca está vinculado a una cuenta
  (`ck_contactos_whatsapp_web_sin_vinculo`): su autoridad es la sesión de cada petición.

### 7.16 Turnos de la administración (TURNOS-ADMIN-01, `20261022100000_tus_turnos_admin`)

- Un turno es una fila de `reservas` (no hay tabla paralela). `calendarios.servicio_id` pasa a ser opcional (la agenda
  es del prestador). `reservas.creado_por_admin_id`: administrador que creó el turno (general o forzado).
  `ck_reservas_forzado_auditado` (NOT VALID): un turno forzado siempre tiene motivo (≥ 5 caracteres) y autor. El
  forzado ignora los horarios publicados pero no la exclusión `ex_reservas_sin_solapamiento`; además se registra el
  evento de auditoría `turnos.turno_forzado` en la misma transacción.

### 7.17 Disponibilidad semanal y agenda de turnos (TURNOS-AGENDA-01, `20261023100000_tus_turnos_intervalo_dia`)

La disponibilidad de un prestador vive en el dominio existente de calendario; no hay tablas nuevas.

- **Intervalo general**: `calendarios.granularidad_minutos` (ya existía). Cada cuánto puede EMPEZAR un turno en toda la semana.
- **Intervalo propio de un día**: `reglas_calendario.intervalo_minutos` (columna nueva, nullable). `NULL` = usar el general. `ck_reglas_calendario_intervalo`: `NULL` o uno de 15, 30, 60, 90, 120. Todas las franjas de un mismo día llevan el mismo valor (lo valida `validarHorariosSemanales`).
- **Días y horarios**: filas de `reglas_calendario` (`dia_semana`, `hora_inicio`, `hora_fin`). Un día sin filas es un día no laboral.
- **Excepciones** (feriado, vacaciones, bloqueo manual, horario reducido): `excepciones_calendario` con `estado = 'active'`. Quitar un bloqueo lo deja en `cancelled` (historial); nunca reescribe las reglas semanales.
- **Duración**: es del servicio (`perfil_servicios.duracion_minutos`) o de la tarifa elegida. Un inicio existe solo si `inicio + duración <= hora_fin`.
- **Generación**: una sola función (`agendaDelDia`, `apps/api/src/tus/calendar/agenda.ts`) decide cada inicio y su estado (`disponible`, `ocupado`, `bloqueado`, `pasado`). La usan la vista de un día, la agenda semanal y la validación de una reserva.
- **Concurrencia**: sin cambios. `ex_reservas_sin_solapamiento` impide dos reservas solapadas en un calendario; el perdedor recibe 409 `SLOT_OCCUPIED`.

### 7.18 Integridad tras la auditoría de la base (INTEGRIDAD-01, `20261024100000` y `20261025100000`)

Clasificación de hallazgos, plan y consultas de verificación: `docs/database/AUDITORIA_INTEGRIDAD_2026-10.md`.
Sin tablas nuevas; una sola columna nueva (`reservas_alojamiento.pago_en_revision_desde`). Las constraints nuevas son NOT VALID (aplican a toda fila nueva o
modificada; las históricas se validan después de verificar producción en modo lectura).

**Alojamientos**

| Tabla | Regla | Objeto |
|---|---|---|
| `alojamientos` | Un alojamiento por slug | `uq_alojamientos_slug` (duplicados previos resueltos con sufijo del id) |
| `alojamientos` | Punto válido, estado del catálogo, rating 1–5, horas HH:MM | `ck_alojamientos_punto`, `_estado`, `_rating`, `_horas` |
| `alojamientos` | El propietario es una cuenta real (NULL = administrado por la plataforma) | `fk_alojamientos_propietario` → `"Account".id`, RESTRICT |
| `reservas_alojamiento` | Pago recibido cuando la reserva ya no tenía sus fechas: pendiente de conciliación | `pago_en_revision_desde` (columna nueva, nullable) + índice parcial `ix_reservas_alojamiento_pago_en_revision` |
| `unidades_alojamiento` | Capacidad ≥ 1, baños ≥ 0, estado del catálogo | `ck_unidades_alojamiento_capacidad`, `_estado` |
| `tarifas_alojamiento` | Precio ≥ 0, modalidad del catálogo, duración ≥ 1, estadía mín ≤ máx, moneda ISO, días 0–6 | `ck_tarifas_alojamiento_*` |
| `bloqueos_unidad_alojamiento` | fin > inicio | `ck_bloqueos_unidad_alojamiento_rango` |
| `reservas_alojamiento` | fin > inicio, estado y modalidad del catálogo, personas ≥ 1, precios ≥ 0, moneda ISO, hold con vencimiento | `ck_reservas_alojamiento_*` |
| `reservas_alojamiento` | La unidad pertenece al alojamiento de la reserva | `fk_reservas_alojamiento_unidad_alojamiento` → `unidades_alojamiento(id, alojamiento_id)` |
| `calificaciones_alojamiento` | La calificación cuenta para el alojamiento de su reserva | `fk_calificaciones_alojamiento_reserva_alojamiento` → `reservas_alojamiento(id, alojamiento_id)` |

Reglas que quedan en el servicio (no son invariantes de fila): capacidad de la unidad contra la
reserva, estadía mínima, transiciones de estado, y que una reserva y un bloqueo manual no se
superpongan (ambas operaciones toman `FOR UPDATE` sobre la fila de la unidad). Un hold vencido se
marca `expired` en la misma transacción que vuelve a usar sus fechas. El precio de una estadía sale
de una sola función (`apps/api/src/tus/alojamientos/cotizacion.ts`): noche por noche con la tarifa
cuyo `dias_semana` incluye ese día; una tarifa con `temporada` no se aplica (no hay fechas de
temporada en el modelo).

**Tarifas de prestadores**: `fk_tarifas_servicio_perfil_servicio` (`(perfil_id, oficio_id)` →
`perfil_servicios`, ON DELETE NO ACTION: el directorio borra las tarifas junto con el servicio),
`ck_tarifas_servicio_prestador_duracion`, `ck_tarifas_servicio_prestador_precio`. El reemplazo de
tarifas es una transacción con `FOR UPDATE` sobre la fila de `perfil_servicios`.

**Turnos**: sin cambios de esquema. Toda escritura de una agenda toma `FOR UPDATE` sobre la fila de
`calendarios`; el descanso (`buffer_minutos`) se respeta antes y después de cada reserva.

**Geografía**: `localidades.provincia` es derivado de `provincia_id`
(`tr_localidades_provincia_derivada`, `tr_provincias_renombrada`); `fk_barrios_zona_localidad`
(`(zona_id, localidad_id)` → `zonas_ubicacion`, vía `uq_zonas_ubicacion_id_localidad`).

### 7.19 Solicitud de reserva de turnos (TURNOS-SOLICITUD-01, `20261026100000_tus_turnos_solicitud_reserva`)

El cliente **no confirma** un turno: lo **solicita**. La solicitud no es una tabla nueva: es la fila de
`reservas` (prestador, servicio, fecha, horario y cliente ya están ahí) en el estado `pending`.

| Estado (`reservas.estado`) | Significado | ¿Retiene el horario? |
| --- | --- | --- |
| `pending` | Solicitada por el cliente; espera la respuesta del prestador | Sí, hasta `solicitud_expira_en` |
| `awaiting_payment` | El prestador la aceptó; espera el pago verificado de la seña | Sí, hasta `solicitud_expira_en` |
| `confirmed` | Mercado Pago aprobó la seña y el backend validó la cadena comercial; también puede ser un turno manual/administrativo | Sí |
| `rejected` | El prestador la rechazó, o el horario ya no estaba libre al aceptar | No |
| `expired` | Nadie respondió antes de `solicitud_expira_en` | No |
| `cancelled`, `cancelled-late`, `no-show` | Cancelaciones y ausencia | No |
| `completed` | Turno realizado | Sí |

Transiciones permitidas: `pending` → `awaiting_payment` \| `confirmed` \| `rejected` \| `cancelled` \| `expired`;
`awaiting_payment` → `confirmed` \| `cancelled` \| `expired`; `confirmed` → `completed` \| `cancelled` \|
`cancelled-late` \| `no-show`. Nada sale de un estado final
(`TRANSICIONES_TURNO` en `packages/contracts/src/tus-turnos.ts`).

Qué hace la aceptación del prestador (regla de seña, igual a W09-05):

| Situación | Aceptar | Motivo |
|---|---|---|
| Turno con precio, pagos online activos y prestador que puede cobrar | `pending` → `awaiting_payment` | La seña pagada y verificada es lo que confirma |
| Pagos online activos, pero el prestador no conectó Mercado Pago o no verificó su identidad | 409 `PROVIDER_PAYMENT_ACCOUNT_REQUIRED`; sigue `pending` | Nunca se confirma gratis ni se deja esperando un pago imposible |
| Pagos online apagados en toda la plataforma, o turno sin precio | `pending` → `confirmed` | No existe seña que esperar (comportamiento previo a la seña) |

`awaiting_payment` → `confirmed` lo escribe únicamente la transacción financiera que aplica la aprobación
verificada de Mercado Pago. Ni el cliente, ni el prestador, ni la administración, ni el asistente tienen
un camino para escribirlo (`PATCH .../estado` rechaza `confirmed` y `awaiting_payment`).

Con pagos online activos, un servicio sin precio publicado no admite solicitudes
(409 `SERVICE_PRICE_REQUIRED`): no habría de dónde calcular la seña.

- `reservas.solicitud_expira_en` (timestamp, NULL): vigencia de `pending`; al aceptar se reemplaza por
  una ventana de pago de 24 horas, siempre acotada por el inicio. `ck_reservas_solicitud_vigencia`
  exige fecha tanto para `pending` como para `awaiting_payment`. Índices parciales
  `ix_reservas_solicitudes_pendientes` e `ix_reservas_esperando_pago`.
- `ck_reservas_estado` (NOT VALID): el estado es uno de los nueve anteriores. No se validó sobre las
  filas históricas; `scripts/db/diagnostico-not-valid.mjs` dice cuáles bloquearían la validación.
- `ex_reservas_sin_solapamiento`: mismas columnas y operadores; su predicado deja afuera también
  `rejected` y `expired`. Sigue siendo la autoridad final contra la doble reserva.
- **Datos del cliente**: una solicitud guarda `cliente_id` (la cuenta de la sesión) y
  `cliente_tenant_id`. No copia nombre, teléfono ni email: `cliente_nombre`, `cliente_telefono` y
  `cliente_email` quedan NULL y se leen de la cuenta. Esas columnas siguen existiendo para clientes
  **sin** cuenta (invitado cargado por la administración, turno manual del prestador).
- Una solicitud vencida se marca `expired` en la siguiente escritura de su agenda (con la fila del
  calendario bloqueada); hasta entonces toda lectura ya la trata como vencida y su horario como libre.
- Límite: 3 solicitudes `pending` por cliente en una misma agenda.

**Una sola semántica para toda reserva de un cliente.** La reserva de una publicación del marketplace
(`POST /tus/v1/calendar/bookings`, pantallas `/tus/mercado` y `/tus/calendario`) usa el mismo modelo:
la fila nace `pending` con `solicitud_expira_en` y retiene su horario. En el flujo de Trabajos del
marketplace la confirmación sigue siendo la aceptación del trabajo: `lockForWork` pasa la solicitud
vigente a `confirmed` en la misma transacción que crea el trabajo (UPDATE condicional: vigente, de un
horario futuro, sin bloqueo del prestador; dos aceptaciones simultáneas la confirman una vez). Ese flujo
no tiene seña: un trabajo del marketplace se cobra al completarse (W09-02), así que no hay pago previo
que esperar. Una solicitud vencida, rechazada o cancelada no se vincula a un trabajo.

El 50% se deriva de `reservas.precio_final`; no existe `reservas.precio_sena`. La obligación usa
`origen_importe = 'booked_price'`, `tramo = 'sena'` y cuelga de un `trabajos.origen = 'turno'` enlazado
1:1 con la reserva. El webhook valida reserva, cliente, prestador, importe, moneda, estado y vigencia.

Un pago aprobado cuya reserva ya no espera pago (la ventana venció o el turno se canceló mientras el
cliente pagaba) **se registra igual** (obligación `paid`, comisión, asiento contable): el dinero fue
cobrado. No confirma nada ni le quita el horario a quien lo tenga; queda en
`auditoria_finanzas_servicio` como `appointment.deposit_without_turno` (`requires_refund_review`) y en
el outbox como `tus.turno.deposit_without_turno`, para que la plataforma lo reintegre con el reembolso
existente.

Quiénes pueden escribir `confirmed`: (1) la transacción financiera del pago verificado de la seña;
(2) el prestador al aceptar una solicitud **sin seña** (sin precio, o con los pagos online apagados en
toda la plataforma); (3) el prestador al crear un turno manual propio o al aceptar un trabajo del
marketplace; (4) la administración (turno general o forzado). Ningún endpoint de cliente, ningún cambio
genérico de estado y ninguna herramienta del asistente puede escribirlo.

### 7.20 Seña e identificación de turnos (TURNOS-SENA-01, `20261027100000_tus_turnos_sena`)

La migración no crea tablas ni duplica datos personales. Amplía `reservas.estado`, reutiliza
`solicitud_expira_en`, habilita `trabajos.origen = 'turno'` y `obligaciones_pago_servicio.origen_importe =
'booked_price'`. La relación `trabajos(reserva_tenant_id, reserva_id)` mantiene una sola orden por reserva.

`conversaciones_whatsapp.cuenta_identificada_id` referencia `Account.id` y
`conversaciones_whatsapp.identificada_en` limita la vigencia de esa identificación. Nombre y DNI se leen
de `User`; no se copian a la conversación ni a la reserva. El índice parcial
`ix_conversaciones_whatsapp_cuenta_identificada` permite ubicar las conversaciones a las que se envían
los avisos del turno.
