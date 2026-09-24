-- WEB-09D: configurable service payments without enabling any real charge.
-- Forward-only and additive. Commission policies and the payments switch are append-only and
-- versioned; commission snapshots gain the policy id and the PSP fee breakdown as nullable
-- columns (historical rows keep NULL). Provider (prestador) Mercado Pago links store only safe
-- references; OAuth tokens live encrypted in a separate table and are never returned by the API.
-- No platform secret is stored in the database.

ALTER TABLE public."instantaneas_comision"
  ADD COLUMN "politica_comision_id" text,
  ADD COLUMN "comision_proveedor_pago" bigint,
  ADD COLUMN "fee_proveedor_a_cargo" text,
  ADD COLUMN "neto_prestador" bigint;
ALTER TABLE public."instantaneas_comision"
  ADD CONSTRAINT "ck_instantaneas_comision_fee_proveedor" CHECK (
    ("comision_proveedor_pago" IS NULL OR "comision_proveedor_pago" >= 0)
    AND ("neto_prestador" IS NULL OR "neto_prestador" >= 0)
    AND ("fee_proveedor_a_cargo" IS NULL OR "fee_proveedor_a_cargo" IN ('undetermined', 'provider', 'platform'))
  ) NOT VALID;
ALTER TABLE public."instantaneas_comision" VALIDATE CONSTRAINT "ck_instantaneas_comision_fee_proveedor";

CREATE TABLE public."politicas_comision_servicio" (
  "id" text NOT NULL,
  "politica_id" text NOT NULL,
  "alcance" text NOT NULL,
  "alcance_ref" text,
  "clave_alcance" text NOT NULL,
  "version" integer NOT NULL,
  "tasa_puntos_base" integer NOT NULL,
  "version_regla" text NOT NULL,
  "fee_psp_a_cargo" text NOT NULL,
  "motivo" text NOT NULL,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "politicas_comision_servicio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_politicas_comision_alcance" CHECK ("alcance" IN ('global', 'categoria', 'prestador')),
  CONSTRAINT "ck_politicas_comision_alcance_ref" CHECK (("alcance" = 'global') = ("alcance_ref" IS NULL)),
  CONSTRAINT "ck_politicas_comision_clave" CHECK ("clave_alcance" = CASE WHEN "alcance" = 'global' THEN 'global' ELSE "alcance" || ':' || "alcance_ref" END),
  CONSTRAINT "ck_politicas_comision_tasa" CHECK ("tasa_puntos_base" >= 0 AND "tasa_puntos_base" <= 3000),
  CONSTRAINT "ck_politicas_comision_fee_psp" CHECK ("fee_psp_a_cargo" IN ('undetermined', 'provider', 'platform')),
  CONSTRAINT "ck_politicas_comision_version" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "uq_politicas_comision_politica" ON public."politicas_comision_servicio"("politica_id");
CREATE UNIQUE INDEX "uq_politicas_comision_clave_version" ON public."politicas_comision_servicio"("clave_alcance", "version");

CREATE OR REPLACE FUNCTION public.tus_politica_comision_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'politicas_comision_servicio is append-only; record a new policy version';
END;
$$;
CREATE TRIGGER tus_politica_comision_append_only_trigger
  BEFORE UPDATE OR DELETE ON public."politicas_comision_servicio"
  FOR EACH ROW EXECUTE FUNCTION public.tus_politica_comision_append_only();

CREATE TABLE public."configuraciones_pagos_servicio" (
  "id" text NOT NULL,
  "configuracion_id" text NOT NULL,
  "version" integer NOT NULL,
  "pagos_habilitados" boolean NOT NULL,
  "proveedor" text NOT NULL,
  "moneda" text NOT NULL,
  "motivo" text NOT NULL,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "configuraciones_pagos_servicio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_configuraciones_pagos_proveedor" CHECK ("proveedor" = 'mercado-pago'),
  CONSTRAINT "ck_configuraciones_pagos_moneda" CHECK ("moneda" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ck_configuraciones_pagos_version" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "uq_configuraciones_pagos_configuracion" ON public."configuraciones_pagos_servicio"("configuracion_id");
CREATE UNIQUE INDEX "uq_configuraciones_pagos_version" ON public."configuraciones_pagos_servicio"("version");

CREATE OR REPLACE FUNCTION public.tus_configuracion_pagos_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'configuraciones_pagos_servicio is append-only; record a new configuration version';
END;
$$;
CREATE TRIGGER tus_configuracion_pagos_append_only_trigger
  BEFORE UPDATE OR DELETE ON public."configuraciones_pagos_servicio"
  FOR EACH ROW EXECUTE FUNCTION public.tus_configuracion_pagos_append_only();

CREATE TABLE public."cuentas_cobro_prestador" (
  "id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "proveedor" text NOT NULL,
  "estado" text NOT NULL,
  "cuenta_externa_id" text,
  "modo_productivo" boolean,
  "alcances" text NOT NULL DEFAULT '',
  "conectada_en" timestamp(3),
  "expira_en" timestamp(3),
  "version" integer NOT NULL DEFAULT 1,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "cuentas_cobro_prestador_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_cuentas_cobro_proveedor" CHECK ("proveedor" = 'mercado-pago'),
  CONSTRAINT "ck_cuentas_cobro_estado" CHECK ("estado" IN ('not_connected', 'connected', 'revoked', 'expired', 'error')),
  CONSTRAINT "ck_cuentas_cobro_conectada" CHECK ("estado" <> 'connected' OR ("cuenta_externa_id" IS NOT NULL AND "conectada_en" IS NOT NULL)),
  CONSTRAINT "ck_cuentas_cobro_version" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "uq_cuentas_cobro_prestador_proveedor" ON public."cuentas_cobro_prestador"("prestador_tenant_id", "proveedor");

CREATE TABLE public."credenciales_cuenta_cobro" (
  "id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "proveedor" text NOT NULL,
  "credencial_cifrada" text NOT NULL,
  "version_clave" text NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "credenciales_cuenta_cobro_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_credenciales_cuenta_cobro_proveedor" CHECK ("proveedor" = 'mercado-pago')
);
CREATE UNIQUE INDEX "uq_credenciales_cuenta_cobro_prestador" ON public."credenciales_cuenta_cobro"("prestador_tenant_id", "proveedor");

CREATE TABLE public."estados_oauth_cobro" (
  "id" text NOT NULL,
  "huella_estado" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "actor_id" text NOT NULL,
  "proveedor" text NOT NULL,
  "verificador_cifrado" text NOT NULL,
  "expira_en" timestamp(3) NOT NULL,
  "consumido_en" timestamp(3),
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "estados_oauth_cobro_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_estados_oauth_cobro_proveedor" CHECK ("proveedor" = 'mercado-pago'),
  CONSTRAINT "ck_estados_oauth_cobro_huella" CHECK ("huella_estado" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "uq_estados_oauth_cobro_huella" ON public."estados_oauth_cobro"("huella_estado");
CREATE INDEX "idx_estados_oauth_cobro_prestador" ON public."estados_oauth_cobro"("prestador_tenant_id", "fecha_creacion");
