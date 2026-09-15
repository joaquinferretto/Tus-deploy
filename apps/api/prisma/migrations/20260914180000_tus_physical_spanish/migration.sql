-- BUILD 13/15: rename TUS Core PostgreSQL objects to the canonical Spanish snake_case DER.
-- Generated from the verified pre-migration catalog. No data or JSON values are modified.

-- Remove superseded or explicitly logical foreign keys before renaming objects.
ALTER TABLE public."TusDeliveryIncident" DROP CONSTRAINT "TusDeliveryIncident_tenant_task_fk";
ALTER TABLE public."TusDeliveryProof" DROP CONSTRAINT "TusDeliveryProof_tenant_task_fk";
ALTER TABLE public."TusDeliveryShift" DROP CONSTRAINT "TusDeliveryShift_tenant_zone_fk";
ALTER TABLE public."TusDeliveryTask" DROP CONSTRAINT "TusDeliveryTask_tenant_shift_fk";
ALTER TABLE public."TusListing" DROP CONSTRAINT "TusListing_tenantId_fkey";
ALTER TABLE public."TusPosConflict" DROP CONSTRAINT "TusPosConflict_tenant_operation_fk";
ALTER TABLE public."TusPosReceipt" DROP CONSTRAINT "TusPosReceipt_tenant_operation_fk";
ALTER TABLE public."TusPosSession" DROP CONSTRAINT "TusPosSession_tenant_device_fk";

-- Rename the 66 DER-controlled tables.
ALTER TABLE public."TusMerchant" RENAME TO "prestadores";
ALTER TABLE public."TusListing" RENAME TO "publicaciones";
ALTER TABLE public."TusMarketplaceCommitment" RENAME TO "compromisos_mercado_servicios";
ALTER TABLE public."TusMarketplaceAudit" RENAME TO "auditoria_mercado_servicios";
ALTER TABLE public."TusCommitment" RENAME TO "compromisos";
ALTER TABLE public."TusCommitmentTransition" RENAME TO "transiciones_compromiso";
ALTER TABLE public."TusCommitmentCompensation" RENAME TO "compensaciones_compromiso";
ALTER TABLE public."TusAuditReference" RENAME TO "referencias_auditoria";
ALTER TABLE public."TusCalendar" RENAME TO "calendarios";
ALTER TABLE public."TusCalendarRule" RENAME TO "reglas_calendario";
ALTER TABLE public."TusCalendarException" RENAME TO "excepciones_calendario";
ALTER TABLE public."TusBooking" RENAME TO "reservas";
ALTER TABLE public."TusDeliveryZone" RENAME TO "zonas_entrega";
ALTER TABLE public."TusDeliveryShift" RENAME TO "turnos_entrega";
ALTER TABLE public."TusDeliveryTask" RENAME TO "tareas_entrega";
ALTER TABLE public."TusDeliveryProof" RENAME TO "evidencias_entrega";
ALTER TABLE public."TusDeliveryIncident" RENAME TO "incidentes_entrega";
ALTER TABLE public."TusDeliveryAudit" RENAME TO "auditoria_entrega";
ALTER TABLE public."TusPosOperation" RENAME TO "operaciones_pos";
ALTER TABLE public."TusPosVersion" RENAME TO "versiones_pos";
ALTER TABLE public."TusPosReceipt" RENAME TO "comprobantes_pos";
ALTER TABLE public."TusPosDevice" RENAME TO "dispositivos_pos";
ALTER TABLE public."TusPosSession" RENAME TO "sesiones_pos";
ALTER TABLE public."TusPosConflict" RENAME TO "conflictos_pos";
ALTER TABLE public."TusPosAudit" RENAME TO "auditoria_pos";
ALTER TABLE public."TusSupportCase" RENAME TO "casos_soporte";
ALTER TABLE public."TusSupportEvidence" RENAME TO "evidencias_soporte";
ALTER TABLE public."TusSupportTimeline" RENAME TO "lineas_tiempo_soporte";
ALTER TABLE public."TusSupportCompensation" RENAME TO "compensaciones_soporte";
ALTER TABLE public."TusWhatsAppAction" RENAME TO "acciones_whatsapp";
ALTER TABLE public."TusWhatsAppConfirmation" RENAME TO "confirmaciones_whatsapp";
ALTER TABLE public."TusWhatsAppAudit" RENAME TO "auditoria_whatsapp";
ALTER TABLE public."TusWhatsAppConsent" RENAME TO "consentimientos_whatsapp";
ALTER TABLE public."TusWhatsAppMessage" RENAME TO "mensajes_whatsapp";
ALTER TABLE public."TusWhatsAppWebhookEvent" RENAME TO "eventos_webhook_whatsapp";
ALTER TABLE public."TusReadinessEvidence" RENAME TO "evidencias_habilitacion";
ALTER TABLE public."TusReadinessDecision" RENAME TO "decisiones_habilitacion";
ALTER TABLE public."TusPaymentIntent" RENAME TO "intenciones_pago";
ALTER TABLE public."TusFinanceIdempotency" RENAME TO "idempotencia_financiera";
ALTER TABLE public."TusCommissionSnapshot" RENAME TO "instantaneas_comision";
ALTER TABLE public."TusLedgerEntry" RENAME TO "movimientos_contables";
ALTER TABLE public."TusFinancialEvidence" RENAME TO "evidencias_financieras";
ALTER TABLE public."TusFinancialConfirmation" RENAME TO "confirmaciones_financieras";
ALTER TABLE public."TusFinancialFreeze" RENAME TO "bloqueos_financieros";
ALTER TABLE public."TusReconciliationRecord" RENAME TO "registros_conciliacion";
ALTER TABLE public."TusPaymentWebhookEvent" RENAME TO "eventos_webhook_pago";
ALTER TABLE public."TusInvoice" RENAME TO "facturas";
ALTER TABLE public."TusInvoiceLine" RENAME TO "lineas_factura";
ALTER TABLE public."TusCreditNote" RENAME TO "notas_credito";
ALTER TABLE public."TusSubscription" RENAME TO "suscripciones";
ALTER TABLE public."TusTaxProfile" RENAME TO "perfiles_fiscales";
ALTER TABLE public."TusBillingAccount" RENAME TO "cuentas_facturacion";
ALTER TABLE public."TusSubscriptionPlan" RENAME TO "planes_suscripcion";
ALTER TABLE public."TusBillingRefund" RENAME TO "reintegros_facturacion";
ALTER TABLE public."TusBillingLedger" RENAME TO "movimientos_contables_facturacion";
ALTER TABLE public."TusBillingIdempotency" RENAME TO "idempotencia_facturacion";
ALTER TABLE public."TusBillingAudit" RENAME TO "auditoria_facturacion";
ALTER TABLE public."TusBillingDunning" RENAME TO "gestion_mora";
ALTER TABLE public."TusBillingNumberSequence" RENAME TO "secuencias_numeracion";
ALTER TABLE public."TusAccountingExport" RENAME TO "exportaciones_contables";
ALTER TABLE public."TusDeliveryOutbox" RENAME TO "outbox_entrega";
ALTER TABLE public."TusPosOutbox" RENAME TO "outbox_pos";
ALTER TABLE public."TusSupportOutbox" RENAME TO "outbox_soporte";
ALTER TABLE public."TusWhatsAppOutbox" RENAME TO "outbox_whatsapp";
ALTER TABLE public."TusBillingOutbox" RENAME TO "outbox_facturacion";
ALTER TABLE public."TusOperationsRecord" RENAME TO "registros_operaciones";

-- Rename columns using the canonical dictionary; values and types remain unchanged.
DO $$
DECLARE
  rename_rule record;
  current_table_name text;
  old_column_exists boolean;
  new_column_exists boolean;
BEGIN
  FOR current_table_name IN SELECT unnest(ARRAY['prestadores', 'publicaciones', 'compromisos_mercado_servicios', 'auditoria_mercado_servicios', 'compromisos', 'transiciones_compromiso', 'compensaciones_compromiso', 'referencias_auditoria', 'calendarios', 'reglas_calendario', 'excepciones_calendario', 'reservas', 'zonas_entrega', 'turnos_entrega', 'tareas_entrega', 'evidencias_entrega', 'incidentes_entrega', 'auditoria_entrega', 'operaciones_pos', 'versiones_pos', 'comprobantes_pos', 'dispositivos_pos', 'sesiones_pos', 'conflictos_pos', 'auditoria_pos', 'casos_soporte', 'evidencias_soporte', 'lineas_tiempo_soporte', 'compensaciones_soporte', 'acciones_whatsapp', 'confirmaciones_whatsapp', 'auditoria_whatsapp', 'consentimientos_whatsapp', 'mensajes_whatsapp', 'eventos_webhook_whatsapp', 'evidencias_habilitacion', 'decisiones_habilitacion', 'intenciones_pago', 'idempotencia_financiera', 'instantaneas_comision', 'movimientos_contables', 'evidencias_financieras', 'confirmaciones_financieras', 'bloqueos_financieros', 'registros_conciliacion', 'eventos_webhook_pago', 'facturas', 'lineas_factura', 'notas_credito', 'suscripciones', 'perfiles_fiscales', 'cuentas_facturacion', 'planes_suscripcion', 'reintegros_facturacion', 'movimientos_contables_facturacion', 'idempotencia_facturacion', 'auditoria_facturacion', 'gestion_mora', 'secuencias_numeracion', 'exportaciones_contables', 'outbox_entrega', 'outbox_pos', 'outbox_soporte', 'outbox_whatsapp', 'outbox_facturacion', 'registros_operaciones']) LOOP
    FOR rename_rule IN SELECT * FROM (VALUES
      ('contractVersion', 'version_contrato'),
      ('tenantId', 'tenant_id'),
      ('merchantId', 'prestador_id'),
      ('listingId', 'publicacion_id'),
      ('commitmentId', 'compromiso_id'),
      ('fromStatus', 'estado_anterior'),
      ('toStatus', 'estado_nuevo'),
      ('cartId', 'carrito_id'),
      ('lineIds', 'ids_lineas'),
      ('bookingId', 'reserva_id'),
      ('serviceId', 'servicio_id'),
      ('calendarId', 'calendario_id'),
      ('customerId', 'cliente_id'),
      ('zoneId', 'zona_id'),
      ('shiftId', 'turno_id'),
      ('taskId', 'tarea_id'),
      ('operatorIds', 'ids_operadores'),
      ('operatorId', 'operador_id'),
      ('actorId', 'actor_id'),
      ('proofId', 'evidencia_id'),
      ('incidentId', 'incidente_id'),
      ('auditId', 'auditoria_id'),
      ('operationId', 'operacion_id'),
      ('receiptId', 'comprobante_id'),
      ('deviceId', 'dispositivo_id'),
      ('sessionId', 'sesion_id'),
      ('conflictId', 'conflicto_id'),
      ('caseId', 'caso_id'),
      ('disputeId', 'disputa_id'),
      ('evidenceId', 'evidencia_id'),
      ('entryId', 'entrada_id'),
      ('paymentId', 'pago_id'),
      ('invoiceId', 'factura_id'),
      ('lineId', 'linea_id'),
      ('creditNoteId', 'nota_credito_id'),
      ('refundId', 'reintegro_id'),
      ('subscriptionId', 'suscripcion_id'),
      ('dunningId', 'mora_id'),
      ('billingAccountId', 'cuenta_facturacion_id'),
      ('snapshotId', 'instantanea_id'),
      ('confirmationId', 'confirmacion_id'),
      ('freezeId', 'bloqueo_id'),
      ('reconciliationId', 'conciliacion_id'),
      ('referenceId', 'referencia_id'),
      ('compensationId', 'compensacion_id'),
      ('eventId', 'evento_id'),
      ('eventType', 'tipo_evento'),
      ('aggregateType', 'tipo_agregado'),
      ('aggregateId', 'agregado_id'),
      ('payload', 'datos_evento'),
      ('idempotencyKey', 'clave_idempotencia'),
      ('requestHash', 'hash_solicitud'),
      ('integrityHash', 'hash_integridad'),
      ('correlationId', 'correlacion_id'),
      ('resourceType', 'tipo_recurso'),
      ('resourceId', 'recurso_id'),
      ('referenceType', 'tipo_referencia'),
      ('entryType', 'tipo_entrada'),
      ('linkedEntryId', 'entrada_vinculada_id'),
      ('status', 'estado'),
      ('capacity', 'capacidad'),
      ('kind', 'tipo'),
      ('context', 'contexto'),
      ('amount', 'monto'),
      ('currency', 'moneda'),
      ('reason', 'motivo'),
      ('source', 'origen'),
      ('outcome', 'resultado'),
      ('action', 'accion'),
      ('name', 'nombre'),
      ('description', 'descripcion'),
      ('cohort', 'cohorte'),
      ('locationId', 'ubicacion_id'),
      ('timezone', 'zona_horaria'),
      ('staffRoles', 'roles_personal'),
      ('operatingPolicyVersion', 'version_politica_operativa'),
      ('price', 'precio'),
      ('availabilityVersion', 'version_disponibilidad'),
      ('published', 'publicada'),
      ('policyVersion', 'version_politica'),
      ('stock', 'existencias'),
      ('durationMinutes', 'duracion_minutos'),
      ('workingHours', 'horario_trabajo'),
      ('quantity', 'cantidad'),
      ('slotStart', 'franja_inicio'),
      ('slotEnd', 'franja_fin'),
      ('weekday', 'dia_semana'),
      ('postalCodes', 'codigos_postales'),
      ('recipientName', 'nombre_destinatario'),
      ('label', 'etiqueta'),
      ('fingerprint', 'huella'),
      ('capturedAt', 'fecha_captura'),
      ('evidenceSource', 'origen_evidencia'),
      ('proof', 'evidencia'),
      ('incident', 'incidente'),
      ('pickup', 'retiro'),
      ('dropoff', 'entrega'),
      ('cancelledAt', 'fecha_cancelacion'),
      ('failureReason', 'motivo_fallo'),
      ('settlementClaim', 'reclamo_liquidacion'),
      ('party', 'parte'),
      ('summary', 'resumen'),
      ('submittedBy', 'presentada_por'),
      ('openedBy', 'abierto_por'),
      ('category', 'categoria'),
      ('recipientId', 'destinatario_id'),
      ('recipientType', 'tipo_destinatario'),
      ('senderId', 'remitente_id'),
      ('template', 'plantilla'),
      ('templateVersion', 'version_plantilla'),
      ('consentId', 'consentimiento_id'),
      ('provider', 'proveedor'),
      ('providerReference', 'referencia_proveedor'),
      ('providerStatus', 'estado_proveedor'),
      ('providerEventId', 'evento_proveedor_id'),
      ('providerAmount', 'monto_proveedor'),
      ('providerCapture', 'captura_proveedor'),
      ('signature', 'firma'),
      ('commercialStatus', 'estado_comercial'),
      ('credentialsCollected', 'credenciales_recolectadas'),
      ('merchantOfRecord', 'comerciante_registro'),
      ('collectionModel', 'modelo_cobro'),
      ('splitPolicy', 'politica_distribucion'),
      ('orderId', 'orden_id'),
      ('accountId', 'cuenta_id'),
      ('number', 'numero'),
      ('snapshot', 'instantanea'),
      ('posOperationId', 'operacion_pos_id'),
      ('grossAmount', 'monto_bruto'),
      ('deductions', 'deducciones'),
      ('commissionableBase', 'base_comisionable'),
      ('rateBps', 'tasa_puntos_base'),
      ('ruleVersion', 'version_regla'),
      ('commissionAmount', 'monto_comision'),
      ('netAmount', 'monto_neto'),
      ('ledgerStatus', 'estado_contable'),
      ('taxAmount', 'monto_impuestos'),
      ('feeAmount', 'monto_tarifas'),
      ('subtotalMinor', 'subtotal_menor'),
      ('taxMinor', 'impuestos_menor'),
      ('feeMinor', 'tarifas_menor'),
      ('totalMinor', 'total_menor'),
      ('unitMinor', 'unitario_menor'),
      ('amountMinor', 'monto_menor'),
      ('invoiceType', 'tipo_factura'),
      ('taxReference', 'referencia_fiscal'),
      ('taxSnapshot', 'instantanea_fiscal'),
      ('snapshotVersion', 'version_instantanea'),
      ('taxIdentity', 'identidad_fiscal'),
      ('taxCategory', 'categoria_fiscal'),
      ('ivaTreatment', 'tratamiento_iva'),
      ('withholdingTreatment', 'tratamiento_retencion'),
      ('authority', 'autoridad'),
      ('externalApprovalReference', 'referencia_aprobacion_externa'),
      ('partyId', 'parte_id'),
      ('role', 'rol'),
      ('interval', 'intervalo'),
      ('dunningAttempt', 'intento_mora'),
      ('cancelReason', 'motivo_cancelacion'),
      ('planId', 'plan_id'),
      ('planSnapshot', 'instantanea_plan'),
      ('attempt', 'intento'),
      ('retryAt', 'fecha_reintento'),
      ('key', 'clave'),
      ('nextNumber', 'siguiente_numero'),
      ('exportId', 'exportacion_id'),
      ('invoiceIds', 'ids_facturas'),
      ('ledgerEntryIds', 'ids_entradas_contables'),
      ('postedExternally', 'publicada_externamente'),
      ('capability', 'capacidad'),
      ('gate', 'requisito'),
      ('owner', 'propietario'),
      ('scope', 'alcance'),
      ('evidenceType', 'tipo_evidencia'),
      ('evidenceRef', 'referencia_evidencia'),
      ('issuedAt', 'fecha_emision'),
      ('expiresAt', 'fecha_expiracion'),
      ('revoked', 'revocada'),
      ('profile', 'perfil'),
      ('execution', 'ejecucion'),
      ('evidenceClass', 'clase_evidencia'),
      ('liveConformance', 'conformidad_produccion'),
      ('evaluatedAt', 'fecha_evaluacion'),
      ('enabled', 'habilitada'),
      ('disposition', 'resultado_habilitacion'),
      ('failedGates', 'requisitos_fallidos'),
      ('evidenceIds', 'ids_evidencia'),
      ('deterministic', 'determinista'),
      ('conflicts', 'conflictos'),
      ('evidencePreserved', 'evidencia_preservada'),
      ('auditPreserved', 'auditoria_preservada'),
      ('jobId', 'trabajo_id'),
      ('availableAt', 'disponible_desde'),
      ('attempts', 'intentos'),
      ('lastError', 'ultimo_error'),
      ('claimId', 'reclamo_procesamiento_id'),
      ('claimUntil', 'reclamado_hasta'),
      ('publishedAt', 'fecha_publicacion'),
      ('retentionUntil', 'retencion_hasta'),
      ('channel', 'canal'),
      ('geography', 'geografia'),
      ('whatsappActions', 'acciones_whatsapp'),
      ('disputes', 'disputas'),
      ('posOffline', 'pos_fuera_linea'),
      ('items', 'elementos'),
      ('response', 'respuesta'),
      ('metadata', 'metadatos'),
      ('createdAt', 'fecha_creacion'),
      ('updatedAt', 'fecha_actualizacion'),
      ('occurredAt', 'fecha_ocurrencia'),
      ('confirmedAt', 'fecha_confirmacion'),
      ('grantedAt', 'fecha_otorgamiento'),
      ('consumedAt', 'fecha_consumo'),
      ('openedAt', 'fecha_apertura'),
      ('closedAt', 'fecha_cierre'),
      ('resolvedAt', 'fecha_resolucion'),
      ('releaseAt', 'fecha_liberacion'),
      ('providerEventAt', 'fecha_evento_proveedor'),
      ('providerError', 'error_proveedor'),
      ('schemaVersion', 'version_esquema'),
      ('expectedVersion', 'version_esperada'),
      ('actualVersion', 'version_actual'),
      ('settlement', 'liquidacion'),
      ('immutable', 'inmutable'),
      ('active', 'activo'),
      ('revokedAt', 'fecha_revocacion'),
      ('messageId', 'mensaje_id')
    ) AS rules(old_name, new_name) LOOP
      SELECT EXISTS (SELECT 1 FROM information_schema.columns AS ic WHERE ic.table_schema = current_schema() AND ic.table_name = current_table_name AND ic.column_name = rename_rule.old_name) INTO old_column_exists;
      SELECT EXISTS (SELECT 1 FROM information_schema.columns AS ic WHERE ic.table_schema = current_schema() AND ic.table_name = current_table_name AND ic.column_name = rename_rule.new_name) INTO new_column_exists;
      IF old_column_exists AND new_column_exists THEN
        RAISE EXCEPTION 'Both legacy and canonical columns exist on %.%', current_table_name, rename_rule.old_name;
      ELSIF old_column_exists THEN
        EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', current_table_name, rename_rule.old_name, rename_rule.new_name);
      END IF;
    END LOOP;
  END LOOP;
  FOR rename_rule IN SELECT * FROM (VALUES
    ('reglas_calendario', 'startsAt', 'hora_inicio'),
    ('reglas_calendario', 'endsAt', 'hora_fin'),
    ('excepciones_calendario', 'startsAt', 'fecha_inicio'),
    ('excepciones_calendario', 'endsAt', 'fecha_fin'),
    ('reservas', 'startsAt', 'fecha_inicio'),
    ('reservas', 'endsAt', 'fecha_fin'),
    ('turnos_entrega', 'startsAt', 'fecha_inicio'),
    ('turnos_entrega', 'endsAt', 'fecha_fin')
  ) AS special_rules(table_name, old_name, new_name) LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns AS ic WHERE ic.table_schema = current_schema() AND ic.table_name = rename_rule.table_name AND ic.column_name = rename_rule.old_name) INTO old_column_exists;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns AS ic WHERE ic.table_schema = current_schema() AND ic.table_name = rename_rule.table_name AND ic.column_name = rename_rule.new_name) INTO new_column_exists;
    IF old_column_exists AND new_column_exists THEN
      RAISE EXCEPTION 'Both legacy and canonical columns exist on %.%', rename_rule.table_name, rename_rule.old_name;
    ELSIF old_column_exists THEN
      EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', rename_rule.table_name, rename_rule.old_name, rename_rule.new_name);
    END IF;
  END LOOP;
END $$;

-- Convert legacy floating-point monetary columns only when every value is an exact int64.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public."compromisos_mercado_servicios" WHERE CASE WHEN "monto"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto"::numeric <> trunc("monto"::numeric) OR "monto"::numeric < -9223372036854775808 OR "monto"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column compromisos_mercado_servicios.monto contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."compromisos" WHERE CASE WHEN "monto"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto"::numeric <> trunc("monto"::numeric) OR "monto"::numeric < -9223372036854775808 OR "monto"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column compromisos.monto contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."compensaciones_compromiso" WHERE CASE WHEN "monto"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto"::numeric <> trunc("monto"::numeric) OR "monto"::numeric < -9223372036854775808 OR "monto"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column compensaciones_compromiso.monto contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."registros_operaciones" WHERE CASE WHEN "monto"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto"::numeric <> trunc("monto"::numeric) OR "monto"::numeric < -9223372036854775808 OR "monto"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column registros_operaciones.monto contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."intenciones_pago" WHERE CASE WHEN "monto"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto"::numeric <> trunc("monto"::numeric) OR "monto"::numeric < -9223372036854775808 OR "monto"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column intenciones_pago.monto contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."instantaneas_comision" WHERE CASE WHEN "monto_bruto"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto_bruto"::numeric <> trunc("monto_bruto"::numeric) OR "monto_bruto"::numeric < -9223372036854775808 OR "monto_bruto"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column instantaneas_comision.monto_bruto contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."instantaneas_comision" WHERE CASE WHEN "deducciones"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "deducciones"::numeric <> trunc("deducciones"::numeric) OR "deducciones"::numeric < -9223372036854775808 OR "deducciones"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column instantaneas_comision.deducciones contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."instantaneas_comision" WHERE CASE WHEN "base_comisionable"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "base_comisionable"::numeric <> trunc("base_comisionable"::numeric) OR "base_comisionable"::numeric < -9223372036854775808 OR "base_comisionable"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column instantaneas_comision.base_comisionable contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."instantaneas_comision" WHERE CASE WHEN "monto_comision"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto_comision"::numeric <> trunc("monto_comision"::numeric) OR "monto_comision"::numeric < -9223372036854775808 OR "monto_comision"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column instantaneas_comision.monto_comision contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."instantaneas_comision" WHERE CASE WHEN "monto_neto"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto_neto"::numeric <> trunc("monto_neto"::numeric) OR "monto_neto"::numeric < -9223372036854775808 OR "monto_neto"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column instantaneas_comision.monto_neto contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."movimientos_contables" WHERE CASE WHEN "monto"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto"::numeric <> trunc("monto"::numeric) OR "monto"::numeric < -9223372036854775808 OR "monto"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column movimientos_contables.monto contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."operaciones_pos" WHERE CASE WHEN "monto"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto"::numeric <> trunc("monto"::numeric) OR "monto"::numeric < -9223372036854775808 OR "monto"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column operaciones_pos.monto contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."comprobantes_pos" WHERE CASE WHEN "monto"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto"::numeric <> trunc("monto"::numeric) OR "monto"::numeric < -9223372036854775808 OR "monto"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column comprobantes_pos.monto contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."registros_conciliacion" WHERE CASE WHEN "monto_proveedor"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto_proveedor"::numeric <> trunc("monto_proveedor"::numeric) OR "monto_proveedor"::numeric < -9223372036854775808 OR "monto_proveedor"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column registros_conciliacion.monto_proveedor contains a non-integral or out-of-range value';
  END IF;
  IF EXISTS (SELECT 1 FROM public."compensaciones_soporte" WHERE CASE WHEN "monto"::text IN ('NaN', 'Infinity', '-Infinity') THEN true ELSE "monto"::numeric <> trunc("monto"::numeric) OR "monto"::numeric < -9223372036854775808 OR "monto"::numeric > 9223372036854775807 END) THEN
    RAISE EXCEPTION 'Monetary column compensaciones_soporte.monto contains a non-integral or out-of-range value';
  END IF;
END $$;
ALTER TABLE public."compromisos_mercado_servicios" ALTER COLUMN "monto" TYPE BIGINT USING "monto"::numeric::bigint;
ALTER TABLE public."compromisos" ALTER COLUMN "monto" TYPE BIGINT USING "monto"::numeric::bigint;
ALTER TABLE public."compensaciones_compromiso" ALTER COLUMN "monto" TYPE BIGINT USING "monto"::numeric::bigint;
ALTER TABLE public."registros_operaciones" ALTER COLUMN "monto" TYPE BIGINT USING "monto"::numeric::bigint;
ALTER TABLE public."intenciones_pago" ALTER COLUMN "monto" TYPE BIGINT USING "monto"::numeric::bigint;
ALTER TABLE public."instantaneas_comision" ALTER COLUMN "monto_bruto" TYPE BIGINT USING "monto_bruto"::numeric::bigint;
ALTER TABLE public."instantaneas_comision" ALTER COLUMN "deducciones" TYPE BIGINT USING "deducciones"::numeric::bigint;
ALTER TABLE public."instantaneas_comision" ALTER COLUMN "base_comisionable" TYPE BIGINT USING "base_comisionable"::numeric::bigint;
ALTER TABLE public."instantaneas_comision" ALTER COLUMN "monto_comision" TYPE BIGINT USING "monto_comision"::numeric::bigint;
ALTER TABLE public."instantaneas_comision" ALTER COLUMN "monto_neto" TYPE BIGINT USING "monto_neto"::numeric::bigint;
ALTER TABLE public."movimientos_contables" ALTER COLUMN "monto" TYPE BIGINT USING "monto"::numeric::bigint;
ALTER TABLE public."operaciones_pos" ALTER COLUMN "monto" TYPE BIGINT USING "monto"::numeric::bigint;
ALTER TABLE public."comprobantes_pos" ALTER COLUMN "monto" TYPE BIGINT USING "monto"::numeric::bigint;
ALTER TABLE public."registros_conciliacion" ALTER COLUMN "monto_proveedor" TYPE BIGINT USING "monto_proveedor"::numeric::bigint;
ALTER TABLE public."compensaciones_soporte" ALTER COLUMN "monto" TYPE BIGINT USING "monto"::numeric::bigint;

-- Rename primary-key and DER index names; preserve approved operational indexes.

-- Rename existing constraints while their backing indexes remain owned by PostgreSQL.
ALTER TABLE public."exportaciones_contables" RENAME CONSTRAINT "TusAccountingExport_pkey" TO "exportaciones_contables_pkey";
ALTER TABLE public."exportaciones_contables" RENAME CONSTRAINT "TusAccountingExport_tenantId_exportId_key" TO "uq_exportaciones_tenant_exportacion";
ALTER TABLE public."referencias_auditoria" RENAME CONSTRAINT "TusAuditReference_pkey" TO "referencias_auditoria_pkey";
ALTER TABLE public."cuentas_facturacion" RENAME CONSTRAINT "TusBillingAccount_pkey" TO "cuentas_facturacion_pkey";
ALTER TABLE public."cuentas_facturacion" RENAME CONSTRAINT "TusBillingAccount_tenantId_billingAccountId_key" TO "uq_cuentas_facturacion_tenant_cuenta";
ALTER TABLE public."auditoria_facturacion" RENAME CONSTRAINT "TusBillingAudit_pkey" TO "auditoria_facturacion_pkey";
ALTER TABLE public."auditoria_facturacion" RENAME CONSTRAINT "TusBillingAudit_tenantId_auditId_key" TO "uq_auditoria_fact_tenant_auditoria";
ALTER TABLE public."gestion_mora" RENAME CONSTRAINT "TusBillingDunning_pkey" TO "gestion_mora_pkey";
ALTER TABLE public."gestion_mora" RENAME CONSTRAINT "TusBillingDunning_tenantId_dunningId_key" TO "uq_gestion_mora_tenant_mora";
ALTER TABLE public."idempotencia_facturacion" RENAME CONSTRAINT "TusBillingIdempotency_pkey" TO "idempotencia_facturacion_pkey";
ALTER TABLE public."idempotencia_facturacion" RENAME CONSTRAINT "TusBillingIdempotency_tenantId_key_key" TO "uq_idempotencia_fact_tenant_clave";
ALTER TABLE public."movimientos_contables_facturacion" RENAME CONSTRAINT "TusBillingLedger_pkey" TO "movimientos_contables_facturacion_pkey";
ALTER TABLE public."movimientos_contables_facturacion" RENAME CONSTRAINT "TusBillingLedger_tenantId_entryId_key" TO "uq_movimientos_fact_tenant_entrada";
ALTER TABLE public."secuencias_numeracion" RENAME CONSTRAINT "TusBillingNumberSequence_pkey" TO "secuencias_numeracion_pkey";
ALTER TABLE public."secuencias_numeracion" RENAME CONSTRAINT "TusBillingNumberSequence_tenantId_key" TO "uq_secuencias_numeracion_tenant_id";
ALTER TABLE public."outbox_facturacion" RENAME CONSTRAINT "TusBillingOutbox_pkey" TO "outbox_facturacion_pkey";
ALTER TABLE public."outbox_facturacion" RENAME CONSTRAINT "TusBillingOutbox_tenantId_eventId_key" TO "uq_outbox_facturacion_tenant_evento";
ALTER TABLE public."reintegros_facturacion" RENAME CONSTRAINT "TusBillingRefund_pkey" TO "reintegros_facturacion_pkey";
ALTER TABLE public."reintegros_facturacion" RENAME CONSTRAINT "TusBillingRefund_tenantId_refundId_key" TO "uq_reintegros_fact_tenant_reintegro";
ALTER TABLE public."reservas" RENAME CONSTRAINT "TusBooking_pkey" TO "reservas_pkey";
ALTER TABLE public."reservas" RENAME CONSTRAINT "TusBooking_tenant_fk" TO "fk_reservas_tenant";
ALTER TABLE public."calendarios" RENAME CONSTRAINT "TusCalendar_pkey" TO "calendarios_pkey";
ALTER TABLE public."excepciones_calendario" RENAME CONSTRAINT "TusCalendarException_pkey" TO "excepciones_calendario_pkey";
ALTER TABLE public."reglas_calendario" RENAME CONSTRAINT "TusCalendarRule_pkey" TO "reglas_calendario_pkey";
ALTER TABLE public."instantaneas_comision" RENAME CONSTRAINT "TusCommissionSnapshot_pkey" TO "instantaneas_comision_pkey";
ALTER TABLE public."compromisos" RENAME CONSTRAINT "TusCommitment_pkey" TO "compromisos_pkey";
ALTER TABLE public."compromisos" RENAME CONSTRAINT "TusCommitment_tenant_fk" TO "fk_compromisos_tenant";
ALTER TABLE public."compensaciones_compromiso" RENAME CONSTRAINT "TusCommitmentCompensation_pkey" TO "compensaciones_compromiso_pkey";
ALTER TABLE public."transiciones_compromiso" RENAME CONSTRAINT "TusCommitmentTransition_pkey" TO "transiciones_compromiso_pkey";
ALTER TABLE public."notas_credito" RENAME CONSTRAINT "TusCreditNote_pkey" TO "notas_credito_pkey";
ALTER TABLE public."auditoria_entrega" RENAME CONSTRAINT "TusDeliveryAudit_pkey" TO "auditoria_entrega_pkey";
ALTER TABLE public."incidentes_entrega" RENAME CONSTRAINT "TusDeliveryIncident_pkey" TO "incidentes_entrega_pkey";
ALTER TABLE public."outbox_entrega" RENAME CONSTRAINT "TusDeliveryOutbox_pkey" TO "outbox_entrega_pkey";
ALTER TABLE public."evidencias_entrega" RENAME CONSTRAINT "TusDeliveryProof_pkey" TO "evidencias_entrega_pkey";
ALTER TABLE public."turnos_entrega" RENAME CONSTRAINT "TusDeliveryShift_pkey" TO "turnos_entrega_pkey";
ALTER TABLE public."tareas_entrega" RENAME CONSTRAINT "TusDeliveryTask_pkey" TO "tareas_entrega_pkey";
ALTER TABLE public."tareas_entrega" RENAME CONSTRAINT "TusDeliveryTask_settlement_claim_check" TO "chk_tareas_entrega_reclamo_liquidacion";
ALTER TABLE public."zonas_entrega" RENAME CONSTRAINT "TusDeliveryZone_pkey" TO "zonas_entrega_pkey";
ALTER TABLE public."idempotencia_financiera" RENAME CONSTRAINT "TusFinanceIdempotency_pkey" TO "idempotencia_financiera_pkey";
ALTER TABLE public."confirmaciones_financieras" RENAME CONSTRAINT "TusFinancialConfirmation_pkey" TO "confirmaciones_financieras_pkey";
ALTER TABLE public."evidencias_financieras" RENAME CONSTRAINT "TusFinancialEvidence_pkey" TO "evidencias_financieras_pkey";
ALTER TABLE public."bloqueos_financieros" RENAME CONSTRAINT "TusFinancialFreeze_pkey" TO "bloqueos_financieros_pkey";
ALTER TABLE public."facturas" RENAME CONSTRAINT "TusInvoice_pkey" TO "facturas_pkey";
ALTER TABLE public."facturas" RENAME CONSTRAINT "TusInvoice_tenant_fk" TO "fk_facturas_tenant";
ALTER TABLE public."lineas_factura" RENAME CONSTRAINT "TusInvoiceLine_pkey" TO "lineas_factura_pkey";
ALTER TABLE public."lineas_factura" RENAME CONSTRAINT "TusInvoiceLine_tenant_invoice_fk" TO "fk_lineas_factura_facturas";
ALTER TABLE public."movimientos_contables" RENAME CONSTRAINT "TusLedgerEntry_pkey" TO "movimientos_contables_pkey";
ALTER TABLE public."movimientos_contables" RENAME CONSTRAINT "TusLedgerEntry_tenant_fk" TO "fk_movimientos_contables_tenant";
ALTER TABLE public."publicaciones" RENAME CONSTRAINT "TusListing_pkey" TO "publicaciones_pkey";
ALTER TABLE public."publicaciones" RENAME CONSTRAINT "TusListing_tenant_fk" TO "fk_publicaciones_tenant";
ALTER TABLE public."auditoria_mercado_servicios" RENAME CONSTRAINT "TusMarketplaceAudit_pkey" TO "auditoria_mercado_servicios_pkey";
ALTER TABLE public."compromisos_mercado_servicios" RENAME CONSTRAINT "TusMarketplaceCommitment_pkey" TO "compromisos_mercado_servicios_pkey";
ALTER TABLE public."prestadores" RENAME CONSTRAINT "TusMerchant_pkey" TO "prestadores_pkey";
ALTER TABLE public."prestadores" RENAME CONSTRAINT "TusMerchant_tenant_fk" TO "fk_prestadores_tenant";
ALTER TABLE public."registros_operaciones" RENAME CONSTRAINT "TusOperationsRecord_pkey" TO "registros_operaciones_pkey";
ALTER TABLE public."intenciones_pago" RENAME CONSTRAINT "TusPaymentIntent_pkey" TO "intenciones_pago_pkey";
ALTER TABLE public."intenciones_pago" RENAME CONSTRAINT "TusPaymentIntent_tenant_fk" TO "fk_intenciones_pago_tenant";
ALTER TABLE public."eventos_webhook_pago" RENAME CONSTRAINT "TusPaymentWebhookEvent_pkey" TO "eventos_webhook_pago_pkey";
ALTER TABLE public."auditoria_pos" RENAME CONSTRAINT "TusPosAudit_pkey" TO "auditoria_pos_pkey";
ALTER TABLE public."conflictos_pos" RENAME CONSTRAINT "TusPosConflict_pkey" TO "conflictos_pos_pkey";
ALTER TABLE public."dispositivos_pos" RENAME CONSTRAINT "TusPosDevice_pkey" TO "dispositivos_pos_pkey";
ALTER TABLE public."operaciones_pos" RENAME CONSTRAINT "TusPosOperation_amount_non_negative_check" TO "chk_operaciones_pos_monto_no_negativo";
ALTER TABLE public."operaciones_pos" RENAME CONSTRAINT "TusPosOperation_context_kind_check" TO "chk_operaciones_pos_contexto_tipo";
ALTER TABLE public."operaciones_pos" RENAME CONSTRAINT "TusPosOperation_pkey" TO "operaciones_pos_pkey";
ALTER TABLE public."operaciones_pos" RENAME CONSTRAINT "TusPosOperation_tenant_fk" TO "fk_operaciones_pos_tenant";
ALTER TABLE public."outbox_pos" RENAME CONSTRAINT "TusPosOutbox_pkey" TO "outbox_pos_pkey";
ALTER TABLE public."outbox_pos" RENAME CONSTRAINT "TusPosOutbox_status_check" TO "chk_outbox_pos_estado_intentos";
ALTER TABLE public."comprobantes_pos" RENAME CONSTRAINT "TusPosReceipt_pkey" TO "comprobantes_pos_pkey";
ALTER TABLE public."comprobantes_pos" RENAME CONSTRAINT "TusPosReceipt_provider_settlement_unclaimed_check" TO "chk_comprobantes_pos_captura_liquidacion_no_reclamados";
ALTER TABLE public."sesiones_pos" RENAME CONSTRAINT "TusPosSession_pkey" TO "sesiones_pos_pkey";
ALTER TABLE public."versiones_pos" RENAME CONSTRAINT "TusPosVersion_pkey" TO "versiones_pos_pkey";
ALTER TABLE public."versiones_pos" RENAME CONSTRAINT "TusPosVersion_version_non_negative_check" TO "chk_versiones_pos_version_no_negativa";
ALTER TABLE public."decisiones_habilitacion" RENAME CONSTRAINT "TusReadinessDecision_pkey" TO "decisiones_habilitacion_pkey";
ALTER TABLE public."evidencias_habilitacion" RENAME CONSTRAINT "TusReadinessEvidence_pkey" TO "evidencias_habilitacion_pkey";
ALTER TABLE public."registros_conciliacion" RENAME CONSTRAINT "TusReconciliationRecord_pkey" TO "registros_conciliacion_pkey";
ALTER TABLE public."suscripciones" RENAME CONSTRAINT "TusSubscription_pkey" TO "suscripciones_pkey";
ALTER TABLE public."planes_suscripcion" RENAME CONSTRAINT "TusSubscriptionPlan_pkey" TO "planes_suscripcion_pkey";
ALTER TABLE public."planes_suscripcion" RENAME CONSTRAINT "TusSubscriptionPlan_tenantId_planId_key" TO "uq_planes_suscripcion_tenant_plan";
ALTER TABLE public."casos_soporte" RENAME CONSTRAINT "TusSupportCase_pkey" TO "casos_soporte_pkey";
ALTER TABLE public."compensaciones_soporte" RENAME CONSTRAINT "TusSupportCompensation_pkey" TO "compensaciones_soporte_pkey";
ALTER TABLE public."evidencias_soporte" RENAME CONSTRAINT "TusSupportEvidence_pkey" TO "evidencias_soporte_pkey";
ALTER TABLE public."outbox_soporte" RENAME CONSTRAINT "TusSupportOutbox_pkey" TO "outbox_soporte_pkey";
ALTER TABLE public."lineas_tiempo_soporte" RENAME CONSTRAINT "TusSupportTimeline_pkey" TO "lineas_tiempo_soporte_pkey";
ALTER TABLE public."perfiles_fiscales" RENAME CONSTRAINT "TusTaxProfile_pkey" TO "perfiles_fiscales_pkey";
ALTER TABLE public."acciones_whatsapp" RENAME CONSTRAINT "TusWhatsAppAction_pkey" TO "acciones_whatsapp_pkey";
ALTER TABLE public."auditoria_whatsapp" RENAME CONSTRAINT "TusWhatsAppAudit_pkey" TO "auditoria_whatsapp_pkey";
ALTER TABLE public."confirmaciones_whatsapp" RENAME CONSTRAINT "TusWhatsAppConfirmation_pkey" TO "confirmaciones_whatsapp_pkey";
ALTER TABLE public."consentimientos_whatsapp" RENAME CONSTRAINT "TusWhatsAppConsent_pkey" TO "consentimientos_whatsapp_pkey";
ALTER TABLE public."mensajes_whatsapp" RENAME CONSTRAINT "TusWhatsAppMessage_pkey" TO "mensajes_whatsapp_pkey";
ALTER TABLE public."outbox_whatsapp" RENAME CONSTRAINT "TusWhatsAppOutbox_pkey" TO "outbox_whatsapp_pkey";
ALTER TABLE public."eventos_webhook_whatsapp" RENAME CONSTRAINT "TusWhatsAppWebhookEvent_pkey" TO "eventos_webhook_whatsapp_pkey";
ALTER INDEX public."TusAccountingExport_tenantId_createdAt_idx" RENAME TO "idx_exportaciones_tenant_fecha_creacion";
ALTER INDEX public."TusAuditReference_tenantId_commitmentId_createdAt_idx" RENAME TO "idx_referencias_tenant_compromiso_fecha_creacion";
ALTER INDEX public."TusAuditReference_tenantId_correlationId_idx" RENAME TO "idx_referencias_tenant_correlacion";
ALTER INDEX public."TusAuditReference_tenantId_referenceId_key" RENAME TO "uq_referencias_tenant_referencia";
ALTER INDEX public."TusBillingAccount_tenantId_partyId_status_idx" RENAME TO "idx_cuentas_facturacion_tenant_parte_estado";
ALTER INDEX public."TusBillingAudit_tenantId_correlationId_createdAt_idx" RENAME TO "idx_auditoria_fact_tenant_correlacion_fecha_creacion";
ALTER INDEX public."TusBillingDunning_tenantId_subscriptionId_createdAt_idx" RENAME TO "idx_gestion_mora_tenant_suscripcion_fecha_creacion";
ALTER INDEX public."TusBillingIdempotency_tenantId_createdAt_idx" RENAME TO "idx_idempotencia_fact_tenant_fecha_creacion";
ALTER INDEX public."TusBillingLedger_tenantId_invoiceId_createdAt_idx" RENAME TO "idx_movimientos_fact_tenant_factura_fecha_creacion";
ALTER INDEX public."TusBillingOutbox_tenantId_status_availableAt_idx" RENAME TO "idx_outbox_facturacion_tenant_estado_disponible";
ALTER INDEX public."TusBillingRefund_tenantId_invoiceId_idx" RENAME TO "idx_reintegros_fact_tenant_factura";
ALTER INDEX public."TusBooking_tenantId_bookingId_key" RENAME TO "uq_reservas_tenant_reserva";
ALTER INDEX public."TusCalendar_tenantId_id_key" RENAME TO "uq_calendarios_tenant_id";
ALTER INDEX public."TusCalendarRule_tenant_calendar_time_key" RENAME TO "uq_reglas_tenant_calendario_franja";
ALTER INDEX public."TusCommissionSnapshot_tenantId_commitmentId_key" RENAME TO "uq_instantaneas_comision_tenant_compromiso";
ALTER INDEX public."TusCommissionSnapshot_tenantId_ruleVersion_idx" RENAME TO "idx_instantaneas_comision_tenant_version_regla";
ALTER INDEX public."TusCommissionSnapshot_tenantId_snapshotId_key" RENAME TO "uq_instantaneas_comision_tenant_instantanea";
ALTER INDEX public."TusCommitment_tenantId_cartId_idx" RENAME TO "idx_compromisos_tenant_carrito";
ALTER INDEX public."TusCommitment_tenantId_commitmentId_key" RENAME TO "uq_compromisos_tenant_compromiso";
ALTER INDEX public."TusCommitment_tenantId_createdAt_idx" RENAME TO "idx_compromisos_tenant_fecha_creacion";
ALTER INDEX public."TusCommitmentCompensation_tenantId_commitmentId_createdAt_idx" RENAME TO "idx_compensaciones_tenant_compromiso_fecha_creacion";
ALTER INDEX public."TusCommitmentCompensation_tenantId_commitmentId_key" RENAME TO "uq_compensaciones_tenant_compromiso";
ALTER INDEX public."TusCommitmentCompensation_tenantId_compensationId_key" RENAME TO "uq_compensaciones_tenant_compensacion";
ALTER INDEX public."TusCommitmentTransition_tenantId_commitmentId_createdAt_idx" RENAME TO "idx_transiciones_tenant_compromiso_fecha_creacion";
ALTER INDEX public."TusCommitmentTransition_tenantId_commitmentId_version_key" RENAME TO "uq_transiciones_tenant_compromiso_version";
ALTER INDEX public."TusCreditNote_tenantId_creditNoteId_key" RENAME TO "uq_notas_credito_tenant_nota";
ALTER INDEX public."TusDeliveryAudit_tenantId_auditId_key" RENAME TO "uq_auditoria_entrega_tenant_auditoria";
ALTER INDEX public."TusDeliveryAudit_tenantId_createdAt_idx" RENAME TO "idx_auditoria_entrega_tenant_fecha_creacion";
ALTER INDEX public."TusDeliveryIncident_tenantId_incidentId_key" RENAME TO "uq_incidentes_tenant_incidente";
ALTER INDEX public."TusDeliveryIncident_tenantId_taskId_status_idx" RENAME TO "idx_incidentes_tenant_tarea_estado";
ALTER INDEX public."TusDeliveryOutbox_tenantId_eventId_key" RENAME TO "uq_outbox_entrega_tenant_evento";
ALTER INDEX public."TusDeliveryOutbox_tenantId_status_createdAt_idx" RENAME TO "idx_outbox_entrega_tenant_estado_fecha_creacion";
ALTER INDEX public."TusDeliveryProof_tenantId_proofId_key" RENAME TO "uq_evidencias_tenant_evidencia";
ALTER INDEX public."TusDeliveryProof_tenantId_taskId_idx" RENAME TO "idx_evidencias_tenant_tarea";
ALTER INDEX public."TusDeliveryShift_tenantId_shiftId_key" RENAME TO "uq_turnos_tenant_turno";
ALTER INDEX public."TusDeliveryShift_tenantId_zoneId_status_idx" RENAME TO "idx_turnos_tenant_zona_estado";
ALTER INDEX public."TusDeliveryTask_tenantId_commitmentId_idx" RENAME TO "idx_tareas_tenant_compromiso";
ALTER INDEX public."TusDeliveryTask_tenantId_commitmentId_status_idx" RENAME TO "idx_tareas_tenant_compromiso_estado";
ALTER INDEX public."TusDeliveryTask_tenantId_shiftId_status_idx" RENAME TO "idx_tareas_tenant_turno_estado";
ALTER INDEX public."TusDeliveryTask_tenantId_taskId_key" RENAME TO "uq_tareas_tenant_tarea";
ALTER INDEX public."TusDeliveryZone_tenantId_active_idx" RENAME TO "idx_zonas_tenant_activo";
ALTER INDEX public."TusDeliveryZone_tenantId_zoneId_key" RENAME TO "uq_zonas_tenant_zona";
ALTER INDEX public."TusFinanceIdempotency_tenantId_idempotencyKey_key" RENAME TO "uq_idempotencia_fin_tenant_clave_idempotencia";
ALTER INDEX public."TusFinanceIdempotency_tenantId_updatedAt_idx" RENAME TO "idx_idempotencia_fin_tenant_fecha_actualizacion";
ALTER INDEX public."TusFinancialConfirmation_tenantId_commitmentId_confirmedAt_idx" RENAME TO "idx_confirmaciones_fin_tenant_compromiso_confirmacion";
ALTER INDEX public."TusFinancialConfirmation_tenantId_commitmentId_key" RENAME TO "uq_confirmaciones_fin_tenant_compromiso";
ALTER INDEX public."TusFinancialConfirmation_tenantId_confirmationId_key" RENAME TO "uq_confirmaciones_fin_tenant_confirmacion";
ALTER INDEX public."TusFinancialEvidence_tenantId_commitmentId_kind_idx" RENAME TO "idx_evidencias_fin_tenant_compromiso_tipo";
ALTER INDEX public."TusFinancialEvidence_tenantId_evidenceId_key" RENAME TO "uq_evidencias_fin_tenant_evidencia";
ALTER INDEX public."TusFinancialFreeze_tenantId_commitmentId_key" RENAME TO "uq_bloqueos_fin_tenant_compromiso";
ALTER INDEX public."TusFinancialFreeze_tenantId_freezeId_key" RENAME TO "uq_bloqueos_fin_tenant_bloqueo";
ALTER INDEX public."TusFinancialFreeze_tenantId_reason_active_idx" RENAME TO "idx_bloqueos_fin_tenant_motivo_activo";
ALTER INDEX public."TusInvoice_tenantId_invoiceId_key" RENAME TO "uq_facturas_tenant_factura";
ALTER INDEX public."TusInvoiceLine_tenantId_id_key" RENAME TO "uq_lineas_factura_tenant_id";
ALTER INDEX public."TusLedgerEntry_tenantId_commitmentId_createdAt_idx" RENAME TO "idx_movimientos_tenant_compromiso_fecha_creacion";
ALTER INDEX public."TusLedgerEntry_tenantId_entryId_key" RENAME TO "uq_movimientos_tenant_entrada";
ALTER INDEX public."TusLedgerEntry_tenantId_linkedEntryId_idx" RENAME TO "idx_movimientos_tenant_entrada_vinculada";
ALTER INDEX public."TusListing_merchantId_kind_idx" RENAME TO "idx_publicaciones_prestador_tipo";
ALTER INDEX public."TusListing_tenantId_availabilityVersion_idx" RENAME TO "idx_publicaciones_tenant_version_disponibilidad";
ALTER INDEX public."TusListing_tenantId_kind_locationId_published_idx" RENAME TO "idx_publicaciones_tenant_tipo_ubicacion_publicada";
ALTER INDEX public."TusListing_tenantId_published_idx" RENAME TO "idx_publicaciones_tenant_publicada";
ALTER INDEX public."TusMarketplaceAudit_tenantId_createdAt_idx" RENAME TO "idx_auditoria_ms_tenant_fecha_creacion";
ALTER INDEX public."TusMarketplaceAudit_tenantId_resourceType_resourceId_idx" RENAME TO "idx_auditoria_ms_tenant_recurso";
ALTER INDEX public."TusMarketplaceCommitment_listingId_slotStart_slotEnd_idx" RENAME TO "idx_compromisos_ms_publicacion_franja";
ALTER INDEX public."TusMarketplaceCommitment_listingId_status_slot_idx" RENAME TO "idx_compromisos_ms_publicacion_estado_franja";
ALTER INDEX public."TusMarketplaceCommitment_merchantId_context_status_idx" RENAME TO "idx_compromisos_ms_prestador_contexto_estado";
ALTER INDEX public."TusMarketplaceCommitment_tenantId_commitmentId_key" RENAME TO "uq_compromisos_ms_tenant_compromiso";
ALTER INDEX public."TusMarketplaceCommitment_tenantId_createdAt_idx" RENAME TO "idx_compromisos_ms_tenant_fecha_creacion";
ALTER INDEX public."TusMarketplaceCommitment_tenantId_listingId_idx" RENAME TO "idx_compromisos_ms_tenant_publicacion";
DROP INDEX public."TusMerchant_tenantId_key";
ALTER INDEX public."TusMerchant_tenantId_status_idx" RENAME TO "idx_prestadores_tenant_estado";
ALTER INDEX public."TusOperationsRecord_tenantId_context_channel_geography_idx" RENAME TO "idx_registros_operaciones_tenant_contexto_canal_geografia";
ALTER INDEX public."TusOperationsRecord_tenantId_createdAt_idx" RENAME TO "idx_registros_operaciones_tenant_fecha_creacion";
ALTER INDEX public."TusPaymentIntent_tenantId_commercialStatus_idx" RENAME TO "idx_intenciones_pago_tenant_estado_comercial";
ALTER INDEX public."TusPaymentIntent_tenantId_commitmentId_key" RENAME TO "uq_intenciones_pago_tenant_compromiso";
ALTER INDEX public."TusPaymentIntent_tenantId_idempotencyKey_key" RENAME TO "uq_intenciones_pago_tenant_clave_idempotencia";
ALTER INDEX public."TusPaymentIntent_tenantId_orderId_idx" RENAME TO "idx_intenciones_pago_tenant_orden";
ALTER INDEX public."TusPaymentIntent_tenantId_paymentId_key" RENAME TO "uq_intenciones_pago_tenant_pago";
ALTER INDEX public."TusPaymentIntent_tenantId_providerStatus_idx" RENAME TO "idx_intenciones_pago_tenant_estado_proveedor";
ALTER INDEX public."TusPaymentWebhookEvent_tenant_provider_event_key" RENAME TO "uq_eventos_webhook_pago_tenant_evento";
ALTER INDEX public."TusPosAudit_tenantId_auditId_key" RENAME TO "uq_auditoria_pos_tenant_auditoria";
ALTER INDEX public."TusPosAudit_tenantId_operationId_createdAt_idx" RENAME TO "idx_auditoria_pos_tenant_operacion_fecha_creacion";
ALTER INDEX public."TusPosConflict_tenantId_conflictId_key" RENAME TO "uq_conflictos_pos_tenant_conflicto";
ALTER INDEX public."TusPosConflict_tenantId_operationId_status_idx" RENAME TO "idx_conflictos_pos_tenant_operacion_estado";
ALTER INDEX public."TusPosConflict_tenantId_status_createdAt_idx" RENAME TO "idx_conflictos_pos_tenant_estado_fecha_creacion";
ALTER INDEX public."TusPosDevice_tenantId_deviceId_key" RENAME TO "uq_dispositivos_pos_tenant_dispositivo";
ALTER INDEX public."TusPosDevice_tenantId_status_idx" RENAME TO "idx_dispositivos_pos_tenant_estado";
ALTER INDEX public."TusPosOperation_tenantId_context_kind_idx" RENAME TO "idx_operaciones_pos_tenant_contexto_tipo";
ALTER INDEX public."TusPosOperation_tenantId_idempotencyKey_idx" RENAME TO "idx_operaciones_pos_tenant_clave_idempotencia";
ALTER INDEX public."TusPosOperation_tenantId_idempotencyKey_key" RENAME TO "uq_operaciones_pos_tenant_clave_idempotencia";
ALTER INDEX public."TusPosOperation_tenantId_operationId_key" RENAME TO "uq_operaciones_pos_tenant_operacion";
ALTER INDEX public."TusPosOperation_tenantId_shiftId_createdAt_idx" RENAME TO "idx_operaciones_pos_tenant_turno_fecha_creacion";
ALTER INDEX public."TusPosOutbox_tenantId_aggregateId_status_idx" RENAME TO "idx_outbox_pos_tenant_agregado_estado";
ALTER INDEX public."TusPosOutbox_tenantId_eventId_key" RENAME TO "uq_outbox_pos_tenant_evento";
ALTER INDEX public."TusPosOutbox_tenantId_status_availableAt_idx" RENAME TO "idx_outbox_pos_tenant_estado_disponible_reclamado";
ALTER INDEX public."TusPosOutbox_tenantId_status_createdAt_idx" RENAME TO "idx_outbox_pos_tenant_estado_fecha_creacion";
ALTER INDEX public."TusPosReceipt_tenantId_operationId_createdAt_idx" RENAME TO "idx_comprobantes_pos_tenant_operacion_fecha_creacion";
ALTER INDEX public."TusPosReceipt_tenantId_operationId_idx" RENAME TO "idx_comprobantes_pos_tenant_operacion";
ALTER INDEX public."TusPosReceipt_tenantId_receiptId_key" RENAME TO "uq_comprobantes_pos_tenant_comprobante";
ALTER INDEX public."TusPosSession_tenantId_deviceId_shiftId_status_idx" RENAME TO "idx_sesiones_pos_tenant_dispositivo_turno_estado";
ALTER INDEX public."TusPosSession_tenantId_sessionId_key" RENAME TO "uq_sesiones_pos_tenant_sesion";
ALTER INDEX public."TusPosVersion_tenantId_shiftId_key" RENAME TO "uq_versiones_pos_tenant_turno";
ALTER INDEX public."TusPosVersion_tenantId_shiftId_version_idx" RENAME TO "idx_versiones_pos_tenant_turno_version";
ALTER INDEX public."TusReadinessDecision_tenantId_capability_enabled_idx" RENAME TO "idx_decisiones_hab_tenant_capacidad_habilitada";
ALTER INDEX public."TusReadinessDecision_tenantId_capability_evaluatedAt_idx" RENAME TO "idx_decisiones_hab_tenant_capacidad_evaluacion";
ALTER INDEX public."TusReadinessDecision_tenantId_correlationId_idx" RENAME TO "idx_decisiones_hab_tenant_correlacion";
ALTER INDEX public."TusReadinessEvidence_expiresAt_idx" RENAME TO "idx_evidencias_hab_fecha_expiracion";
ALTER INDEX public."TusReadinessEvidence_tenantId_capability_gate_evidenceRef_key" RENAME TO "uq_evidencias_hab_tenant_requisito_ref";
ALTER INDEX public."TusReadinessEvidence_tenantId_capability_gate_revoked_idx" RENAME TO "idx_evidencias_hab_tenant_requisito_revocada";
ALTER INDEX public."TusReconciliationRecord_tenantId_commitmentId_key" RENAME TO "uq_conciliacion_tenant_compromiso";
ALTER INDEX public."TusReconciliationRecord_tenantId_reconciliationId_key" RENAME TO "uq_conciliacion_tenant_conciliacion";
ALTER INDEX public."TusReconciliationRecord_tenantId_status_createdAt_idx" RENAME TO "idx_conciliacion_tenant_estado_fecha_creacion";
ALTER INDEX public."TusSubscription_tenantId_subscriptionId_key" RENAME TO "uq_suscripciones_tenant_suscripcion";
ALTER INDEX public."TusSubscriptionPlan_tenantId_status_idx" RENAME TO "idx_planes_suscripcion_tenant_estado";
ALTER INDEX public."TusSupportCase_tenantId_caseId_key" RENAME TO "uq_casos_soporte_tenant_caso";
ALTER INDEX public."TusSupportCase_tenantId_commitmentId_idx" RENAME TO "idx_casos_soporte_tenant_compromiso";
ALTER INDEX public."TusSupportCase_tenantId_status_createdAt_idx" RENAME TO "idx_casos_soporte_tenant_estado_fecha_creacion";
ALTER INDEX public."TusSupportCompensation_tenantId_caseId_key" RENAME TO "uq_compensaciones_soporte_tenant_caso";
ALTER INDEX public."TusSupportCompensation_tenantId_entryId_key" RENAME TO "uq_compensaciones_soporte_tenant_entrada";
ALTER INDEX public."TusSupportEvidence_tenantId_caseId_party_idx" RENAME TO "idx_evidencias_soporte_tenant_caso_parte";
ALTER INDEX public."TusSupportEvidence_tenantId_evidenceId_key" RENAME TO "uq_evidencias_soporte_tenant_evidencia";
ALTER INDEX public."TusSupportOutbox_tenantId_correlationId_idx" RENAME TO "idx_outbox_soporte_tenant_correlacion";
ALTER INDEX public."TusSupportOutbox_tenantId_eventId_key" RENAME TO "uq_outbox_soporte_tenant_evento";
ALTER INDEX public."TusSupportOutbox_tenantId_status_createdAt_idx" RENAME TO "idx_outbox_soporte_tenant_estado_fecha_creacion";
ALTER INDEX public."TusSupportTimeline_tenantId_caseId_createdAt_idx" RENAME TO "idx_lineas_tiempo_tenant_caso_fecha_creacion";
ALTER INDEX public."TusSupportTimeline_tenantId_entryId_key" RENAME TO "uq_lineas_tiempo_tenant_entrada";
ALTER INDEX public."TusTaxProfile_tenantId_partyId_key" RENAME TO "uq_perfiles_fiscales_tenant_parte";
ALTER INDEX public."TusWhatsAppAction_tenantId_createdAt_idx" RENAME TO "idx_acciones_whatsapp_tenant_fecha_creacion";
ALTER INDEX public."TusWhatsAppAction_tenantId_idempotencyKey_key" RENAME TO "uq_acciones_whatsapp_tenant_clave_idempotencia";
ALTER INDEX public."TusWhatsAppAudit_tenantId_correlationId_idx" RENAME TO "idx_auditoria_whatsapp_tenant_correlacion";
ALTER INDEX public."TusWhatsAppAudit_tenantId_createdAt_idx" RENAME TO "idx_auditoria_whatsapp_tenant_fecha_creacion";
ALTER INDEX public."TusWhatsAppConfirmation_tenantId_confirmationId_key" RENAME TO "uq_confirmaciones_whatsapp_tenant_confirmacion";
ALTER INDEX public."TusWhatsAppConfirmation_tenantId_senderId_expiresAt_idx" RENAME TO "idx_confirmaciones_whatsapp_tenant_remitente_expiracion";
ALTER INDEX public."TusWhatsAppConsent_tenantId_recipientId_key" RENAME TO "uq_consentimientos_whatsapp_tenant_destinatario";
ALTER INDEX public."TusWhatsAppMessage_tenantId_messageId_key" RENAME TO "uq_mensajes_whatsapp_tenant_mensaje";
ALTER INDEX public."TusWhatsAppOutbox_tenantId_correlationId_idx" RENAME TO "idx_outbox_whatsapp_tenant_correlacion";
ALTER INDEX public."TusWhatsAppOutbox_tenantId_eventId_key" RENAME TO "uq_outbox_whatsapp_tenant_evento";
ALTER INDEX public."TusWhatsAppOutbox_tenantId_status_createdAt_idx" RENAME TO "idx_outbox_whatsapp_tenant_estado_fecha_creacion";
ALTER INDEX public."TusWhatsAppWebhookEvent_tenantId_providerEventId_key" RENAME TO "uq_eventos_webhook_whatsapp_tenant_evento";

-- Create canonical unique indexes required for tenant-scoped composite foreign keys.
CREATE UNIQUE INDEX "uq_prestadores_tenant_prestador" ON public."prestadores" ("tenant_id", "prestador_id");
CREATE UNIQUE INDEX "uq_publicaciones_tenant_id" ON public."publicaciones" ("tenant_id", "id");

-- Preserve append-only guards and update only physical references changed by this migration.
CREATE OR REPLACE FUNCTION public.tus_ledger_entry_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TusLedgerEntry is append-only; preserve ledger history with a compensating entry';
END;
$$;
CREATE OR REPLACE FUNCTION public.tus_reject_billing_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'facturas' AND OLD.estado = 'draft' AND NEW.estado = 'issued' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'billing history is append-only';
END;
$$;

-- Install canonical tenant-scoped foreign keys as NOT VALID, then validate them explicitly.
ALTER TABLE public."lineas_factura" VALIDATE CONSTRAINT "fk_lineas_factura_facturas";
ALTER TABLE public."publicaciones" ADD CONSTRAINT "fk_publicaciones_prestadores" FOREIGN KEY ("tenant_id", "prestador_id") REFERENCES public."prestadores" ("tenant_id", "prestador_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."compromisos_mercado_servicios" ADD CONSTRAINT "fk_compromisos_mercado_servicios_publicaciones" FOREIGN KEY ("tenant_id", "publicacion_id") REFERENCES public."publicaciones" ("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."compromisos" ADD CONSTRAINT "fk_compromisos_prestadores" FOREIGN KEY ("tenant_id", "prestador_id") REFERENCES public."prestadores" ("tenant_id", "prestador_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."transiciones_compromiso" ADD CONSTRAINT "fk_transiciones_compromiso_compromisos" FOREIGN KEY ("tenant_id", "compromiso_id") REFERENCES public."compromisos" ("tenant_id", "compromiso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."compensaciones_compromiso" ADD CONSTRAINT "fk_compensaciones_compromiso_compromisos" FOREIGN KEY ("tenant_id", "compromiso_id") REFERENCES public."compromisos" ("tenant_id", "compromiso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."reglas_calendario" ADD CONSTRAINT "fk_reglas_calendario_calendarios" FOREIGN KEY ("tenant_id", "calendario_id") REFERENCES public."calendarios" ("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."excepciones_calendario" ADD CONSTRAINT "fk_excepciones_calendario_calendarios" FOREIGN KEY ("tenant_id", "calendario_id") REFERENCES public."calendarios" ("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."reservas" ADD CONSTRAINT "fk_reservas_calendarios" FOREIGN KEY ("tenant_id", "calendario_id") REFERENCES public."calendarios" ("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."turnos_entrega" ADD CONSTRAINT "fk_turnos_entrega_zonas_entrega" FOREIGN KEY ("tenant_id", "zona_id") REFERENCES public."zonas_entrega" ("tenant_id", "zona_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."evidencias_entrega" ADD CONSTRAINT "fk_evidencias_entrega_tareas_entrega" FOREIGN KEY ("tenant_id", "tarea_id") REFERENCES public."tareas_entrega" ("tenant_id", "tarea_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."incidentes_entrega" ADD CONSTRAINT "fk_incidentes_entrega_tareas_entrega" FOREIGN KEY ("tenant_id", "tarea_id") REFERENCES public."tareas_entrega" ("tenant_id", "tarea_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."comprobantes_pos" ADD CONSTRAINT "fk_comprobantes_pos_operaciones_pos" FOREIGN KEY ("tenant_id", "operacion_id") REFERENCES public."operaciones_pos" ("tenant_id", "operacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."conflictos_pos" ADD CONSTRAINT "fk_conflictos_pos_operaciones_pos" FOREIGN KEY ("tenant_id", "operacion_id") REFERENCES public."operaciones_pos" ("tenant_id", "operacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."evidencias_soporte" ADD CONSTRAINT "fk_evidencias_soporte_casos_soporte" FOREIGN KEY ("tenant_id", "caso_id") REFERENCES public."casos_soporte" ("tenant_id", "caso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."lineas_tiempo_soporte" ADD CONSTRAINT "fk_lineas_tiempo_soporte_casos_soporte" FOREIGN KEY ("tenant_id", "caso_id") REFERENCES public."casos_soporte" ("tenant_id", "caso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."compensaciones_soporte" ADD CONSTRAINT "fk_compensaciones_soporte_casos_soporte" FOREIGN KEY ("tenant_id", "caso_id") REFERENCES public."casos_soporte" ("tenant_id", "caso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."intenciones_pago" ADD CONSTRAINT "fk_intenciones_pago_compromisos" FOREIGN KEY ("tenant_id", "compromiso_id") REFERENCES public."compromisos" ("tenant_id", "compromiso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."instantaneas_comision" ADD CONSTRAINT "fk_instantaneas_comision_compromisos" FOREIGN KEY ("tenant_id", "compromiso_id") REFERENCES public."compromisos" ("tenant_id", "compromiso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."movimientos_contables" ADD CONSTRAINT "fk_movimientos_contables_compromisos" FOREIGN KEY ("tenant_id", "compromiso_id") REFERENCES public."compromisos" ("tenant_id", "compromiso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."evidencias_financieras" ADD CONSTRAINT "fk_evidencias_financieras_compromisos" FOREIGN KEY ("tenant_id", "compromiso_id") REFERENCES public."compromisos" ("tenant_id", "compromiso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."confirmaciones_financieras" ADD CONSTRAINT "fk_confirmaciones_financieras_compromisos" FOREIGN KEY ("tenant_id", "compromiso_id") REFERENCES public."compromisos" ("tenant_id", "compromiso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."bloqueos_financieros" ADD CONSTRAINT "fk_bloqueos_financieros_compromisos" FOREIGN KEY ("tenant_id", "compromiso_id") REFERENCES public."compromisos" ("tenant_id", "compromiso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."registros_conciliacion" ADD CONSTRAINT "fk_registros_conciliacion_compromisos" FOREIGN KEY ("tenant_id", "compromiso_id") REFERENCES public."compromisos" ("tenant_id", "compromiso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."facturas" ADD CONSTRAINT "fk_facturas_compromisos" FOREIGN KEY ("tenant_id", "compromiso_id") REFERENCES public."compromisos" ("tenant_id", "compromiso_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."notas_credito" ADD CONSTRAINT "fk_notas_credito_facturas" FOREIGN KEY ("tenant_id", "factura_id") REFERENCES public."facturas" ("tenant_id", "factura_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."reintegros_facturacion" ADD CONSTRAINT "fk_reintegros_facturacion_facturas" FOREIGN KEY ("tenant_id", "factura_id") REFERENCES public."facturas" ("tenant_id", "factura_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."movimientos_contables_facturacion" ADD CONSTRAINT "fk_movimientos_contables_facturacion_facturas" FOREIGN KEY ("tenant_id", "factura_id") REFERENCES public."facturas" ("tenant_id", "factura_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."gestion_mora" ADD CONSTRAINT "fk_gestion_mora_suscripciones" FOREIGN KEY ("tenant_id", "suscripcion_id") REFERENCES public."suscripciones" ("tenant_id", "suscripcion_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."suscripciones" ADD CONSTRAINT "fk_suscripciones_planes_suscripcion" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES public."planes_suscripcion" ("tenant_id", "plan_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."publicaciones" VALIDATE CONSTRAINT "fk_publicaciones_prestadores";
ALTER TABLE public."compromisos_mercado_servicios" VALIDATE CONSTRAINT "fk_compromisos_mercado_servicios_publicaciones";
ALTER TABLE public."compromisos" VALIDATE CONSTRAINT "fk_compromisos_prestadores";
ALTER TABLE public."transiciones_compromiso" VALIDATE CONSTRAINT "fk_transiciones_compromiso_compromisos";
ALTER TABLE public."compensaciones_compromiso" VALIDATE CONSTRAINT "fk_compensaciones_compromiso_compromisos";
ALTER TABLE public."reglas_calendario" VALIDATE CONSTRAINT "fk_reglas_calendario_calendarios";
ALTER TABLE public."excepciones_calendario" VALIDATE CONSTRAINT "fk_excepciones_calendario_calendarios";
ALTER TABLE public."reservas" VALIDATE CONSTRAINT "fk_reservas_calendarios";
ALTER TABLE public."turnos_entrega" VALIDATE CONSTRAINT "fk_turnos_entrega_zonas_entrega";
ALTER TABLE public."evidencias_entrega" VALIDATE CONSTRAINT "fk_evidencias_entrega_tareas_entrega";
ALTER TABLE public."incidentes_entrega" VALIDATE CONSTRAINT "fk_incidentes_entrega_tareas_entrega";
ALTER TABLE public."comprobantes_pos" VALIDATE CONSTRAINT "fk_comprobantes_pos_operaciones_pos";
ALTER TABLE public."conflictos_pos" VALIDATE CONSTRAINT "fk_conflictos_pos_operaciones_pos";
ALTER TABLE public."evidencias_soporte" VALIDATE CONSTRAINT "fk_evidencias_soporte_casos_soporte";
ALTER TABLE public."lineas_tiempo_soporte" VALIDATE CONSTRAINT "fk_lineas_tiempo_soporte_casos_soporte";
ALTER TABLE public."compensaciones_soporte" VALIDATE CONSTRAINT "fk_compensaciones_soporte_casos_soporte";
ALTER TABLE public."intenciones_pago" VALIDATE CONSTRAINT "fk_intenciones_pago_compromisos";
ALTER TABLE public."instantaneas_comision" VALIDATE CONSTRAINT "fk_instantaneas_comision_compromisos";
ALTER TABLE public."movimientos_contables" VALIDATE CONSTRAINT "fk_movimientos_contables_compromisos";
ALTER TABLE public."evidencias_financieras" VALIDATE CONSTRAINT "fk_evidencias_financieras_compromisos";
ALTER TABLE public."confirmaciones_financieras" VALIDATE CONSTRAINT "fk_confirmaciones_financieras_compromisos";
ALTER TABLE public."bloqueos_financieros" VALIDATE CONSTRAINT "fk_bloqueos_financieros_compromisos";
ALTER TABLE public."registros_conciliacion" VALIDATE CONSTRAINT "fk_registros_conciliacion_compromisos";
ALTER TABLE public."facturas" VALIDATE CONSTRAINT "fk_facturas_compromisos";
ALTER TABLE public."notas_credito" VALIDATE CONSTRAINT "fk_notas_credito_facturas";
ALTER TABLE public."reintegros_facturacion" VALIDATE CONSTRAINT "fk_reintegros_facturacion_facturas";
ALTER TABLE public."movimientos_contables_facturacion" VALIDATE CONSTRAINT "fk_movimientos_contables_facturacion_facturas";
ALTER TABLE public."gestion_mora" VALIDATE CONSTRAINT "fk_gestion_mora_suscripciones";
ALTER TABLE public."suscripciones" VALIDATE CONSTRAINT "fk_suscripciones_planes_suscripcion";
