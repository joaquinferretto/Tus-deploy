-- DB-09-SAFETY: hardening of the dual-subject (compromiso XOR obligacion) finance tables.
-- Forward-only and additive. No row is inserted, updated or deleted.
--
-- 1. Validate the XOR checks added NOT VALID by 20260923100000. Every historical row satisfies
--    them by construction: `compromiso_id` was NOT NULL until that migration and
--    `obligacion_id` was created empty. VALIDATE takes SHARE UPDATE EXCLUSIVE (reads and writes
--    continue) and fails, without changing data, if any unexpected row exists.
ALTER TABLE public."intenciones_pago" VALIDATE CONSTRAINT "ck_intenciones_pago_sujeto_unico";
ALTER TABLE public."instantaneas_comision" VALIDATE CONSTRAINT "ck_instantaneas_comision_sujeto_unico";
ALTER TABLE public."movimientos_contables" VALIDATE CONSTRAINT "ck_movimientos_contables_sujeto_unico";
-- Legacy intents have NULL obligacion_id; the service completeness check holds for all rows.
ALTER TABLE public."intenciones_pago" VALIDATE CONSTRAINT "ck_intenciones_pago_servicio_completa";
-- `monto` in the inbox is a new nullable column; every historical row is NULL.
ALTER TABLE public."eventos_webhook_pago" VALIDATE CONSTRAINT "ck_eventos_webhook_pago_monto_no_negativo";
-- Amount checks on legacy tables stay NOT VALID: historical amounts were only guarded by the
-- domain and must be audited on the real target before validating them.

-- 2. Service ledger entries own the `svc-` id namespace, so a legacy entry can never occupy
--    the deterministic id of a service effect (and vice versa) under (tenant_id, entrada_id).
ALTER TABLE public."movimientos_contables"
  ADD CONSTRAINT "ck_movimientos_contables_espacio_sujeto" CHECK (("obligacion_id" IS NOT NULL) = ("entrada_id" LIKE 'svc-%')) NOT VALID;

-- New FKs/checks are added NOT VALID and validated in a separate statement: the ADD holds its
-- lock only briefly and the validation scan does not block concurrent writes.

-- 3. Pin the provider tenant and work of service rows to their obligation, not only the
--    obligation id: a settlement or intent cannot name another provider or work.
CREATE UNIQUE INDEX "uq_obligaciones_pago_identidad_prestador" ON public."obligaciones_pago_servicio"("tenant_id", "obligacion_id", "prestador_tenant_id", "trabajo_id");

ALTER TABLE public."intenciones_pago"
  ADD CONSTRAINT "fk_intenciones_pago_obligacion_prestador" FOREIGN KEY ("tenant_id", "obligacion_id", "prestador_tenant_id", "orden_id")
  REFERENCES public."obligaciones_pago_servicio"("tenant_id", "obligacion_id", "prestador_tenant_id", "trabajo_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."intenciones_pago" VALIDATE CONSTRAINT "fk_intenciones_pago_obligacion_prestador";

ALTER TABLE public."liquidaciones_servicio"
  ADD CONSTRAINT "fk_liquidaciones_servicio_obligacion_prestador" FOREIGN KEY ("tenant_id", "obligacion_id", "prestador_tenant_id", "trabajo_id")
  REFERENCES public."obligaciones_pago_servicio"("tenant_id", "obligacion_id", "prestador_tenant_id", "trabajo_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."liquidaciones_servicio" VALIDATE CONSTRAINT "fk_liquidaciones_servicio_obligacion_prestador";

-- 4. Inbox rows reference the exact service intent (tenant, payment, obligation). Both columns
--    are set together, so MATCH SIMPLE cannot skip the FK through a partial NULL. Historical
--    rows have both NULL (columns created by 20260923110000), so the check is validated now.
ALTER TABLE public."eventos_webhook_pago"
  ADD CONSTRAINT "ck_eventos_webhook_pago_sujeto_completo" CHECK (("pago_id" IS NULL) = ("obligacion_id" IS NULL)) NOT VALID;
ALTER TABLE public."eventos_webhook_pago" VALIDATE CONSTRAINT "ck_eventos_webhook_pago_sujeto_completo";
CREATE UNIQUE INDEX "uq_intenciones_pago_tenant_pago_obligacion" ON public."intenciones_pago"("tenant_id", "pago_id", "obligacion_id");

ALTER TABLE public."eventos_webhook_pago"
  ADD CONSTRAINT "fk_eventos_webhook_pago_intenciones" FOREIGN KEY ("tenant_id", "pago_id", "obligacion_id")
  REFERENCES public."intenciones_pago"("tenant_id", "pago_id", "obligacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION NOT VALID;
ALTER TABLE public."eventos_webhook_pago" VALIDATE CONSTRAINT "fk_eventos_webhook_pago_intenciones";
