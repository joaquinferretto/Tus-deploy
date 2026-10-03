-- TUS-GANANCIAS-02: one Mercado Pago account belongs to ONE provider.
--
-- Payment notifications are resolved by the collecting account (Mercado Pago `user_id`), so the
-- same account connected by two providers would make every notification ambiguous (a payment, an
-- earning or a deposit could be attributed to the wrong provider). The application already refuses
-- the second link; this index makes the database refuse it too, even when two OAuth completions
-- race. Additive: it creates nothing but the index and rewrites no row. A provider that
-- disconnects (status other than 'connected') frees the account for another provider.

CREATE UNIQUE INDEX "uq_cuentas_cobro_prestador_cuenta_externa"
  ON public."cuentas_cobro_prestador"("proveedor", "cuenta_externa_id")
  WHERE "estado" = 'connected' AND "cuenta_externa_id" IS NOT NULL;
