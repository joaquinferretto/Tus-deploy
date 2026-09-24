-- IDENTITY-NOSIS: automatic identity verification of providers (prestadores).
-- Forward-only and additive: new tables only, no change to existing data.
-- DNI images are stored encrypted (AES-256-GCM, key outside the DB) and never exposed through a
-- public URL. The Mi Nosis browser session is stored encrypted as well. Searches against the
-- external source and the identity audit trail are append-only. A DNI or CUIL can be verified for
-- a single provider only (partial unique indexes on verified rows).

CREATE TABLE public."verificaciones_identidad" (
  "id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "usuario_id" text NOT NULL,
  "proveedor_id" text NOT NULL,
  "tipo_documento" text NOT NULL DEFAULT 'dni',
  "numero_documento" text,
  "nombre_extraido" text,
  "apellido_extraido" text,
  "fecha_nacimiento_extraida" text,
  "sexo_extraido" text,
  "cuil_verificado" text,
  "estado" text NOT NULL,
  "metodo_verificacion" text,
  "referencia_proveedor" text,
  "motivo_revision" text,
  "nota_decision" text,
  "consentimiento_aceptado_en" timestamp(3),
  "consentimiento_version" text,
  "consentimiento_proposito" text,
  "lectura_ocr" jsonb,
  "lectura_vision" jsonb,
  "resultado_externo" jsonb,
  "intentos" integer NOT NULL DEFAULT 0,
  "version" integer NOT NULL DEFAULT 1,
  "fecha_creacion" timestamp(3) NOT NULL,
  "encolada_en" timestamp(3),
  "procesamiento_iniciado_en" timestamp(3),
  "verificada_en" timestamp(3),
  "rechazada_en" timestamp(3),
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "verificaciones_identidad_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_verificaciones_identidad_estado" CHECK ("estado" IN ('pending_upload', 'queued', 'processing', 'retry_pending', 'session_required', 'review_required', 'verified', 'rejected', 'failed')),
  CONSTRAINT "ck_verificaciones_identidad_tipo" CHECK ("tipo_documento" = 'dni'),
  CONSTRAINT "ck_verificaciones_identidad_metodo" CHECK ("metodo_verificacion" IS NULL OR "metodo_verificacion" IN ('nosis_browser', 'nosis_api', 'demo', 'manual')),
  CONSTRAINT "ck_verificaciones_identidad_documento" CHECK ("numero_documento" IS NULL OR "numero_documento" ~ '^[0-9]{6,9}$'),
  CONSTRAINT "ck_verificaciones_identidad_cuil" CHECK ("cuil_verificado" IS NULL OR "cuil_verificado" ~ '^[0-9]{11}$'),
  CONSTRAINT "ck_verificaciones_identidad_sexo" CHECK ("sexo_extraido" IS NULL OR "sexo_extraido" IN ('M', 'F', 'X')),
  CONSTRAINT "ck_verificaciones_identidad_verificada" CHECK ("estado" <> 'verified' OR ("numero_documento" IS NOT NULL AND "metodo_verificacion" IS NOT NULL AND "verificada_en" IS NOT NULL)),
  CONSTRAINT "ck_verificaciones_identidad_version" CHECK ("version" > 0 AND "intentos" >= 0)
);
CREATE INDEX "ix_verificaciones_identidad_tenant" ON public."verificaciones_identidad"("tenant_id", "fecha_creacion");
CREATE INDEX "ix_verificaciones_identidad_estado" ON public."verificaciones_identidad"("estado", "fecha_creacion");
CREATE UNIQUE INDEX "uq_verificaciones_identidad_documento_verificado" ON public."verificaciones_identidad"("numero_documento") WHERE "estado" = 'verified';
CREATE UNIQUE INDEX "uq_verificaciones_identidad_cuil_verificado" ON public."verificaciones_identidad"("cuil_verificado") WHERE "estado" = 'verified';

CREATE TABLE public."documentos_identidad" (
  "id" text NOT NULL,
  "verificacion_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "lado" text NOT NULL,
  "tipo_mime" text NOT NULL,
  "tamano" integer NOT NULL,
  "sha256" text NOT NULL,
  "contenido_cifrado" text NOT NULL,
  "version_clave" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "documentos_identidad_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_documentos_identidad_lado" CHECK ("lado" IN ('front', 'back')),
  CONSTRAINT "ck_documentos_identidad_mime" CHECK ("tipo_mime" IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT "ck_documentos_identidad_tamano" CHECK ("tamano" > 0 AND "tamano" <= 8388608),
  CONSTRAINT "ck_documentos_identidad_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "uq_documentos_identidad_lado" ON public."documentos_identidad"("verificacion_id", "lado");

CREATE TABLE public."cola_verificacion_identidad" (
  "id" text NOT NULL,
  "verificacion_id" text NOT NULL,
  "etapa" text NOT NULL,
  "estado" text NOT NULL,
  "encolado_en" timestamp(3) NOT NULL,
  "disponible_en" timestamp(3) NOT NULL,
  "intentos" integer NOT NULL DEFAULT 0,
  "lease_owner" text,
  "lease_hasta" timestamp(3),
  "ultimo_error" text,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "cola_verificacion_identidad_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_cola_verificacion_identidad_etapa" CHECK ("etapa" IN ('lectura', 'consulta')),
  CONSTRAINT "ck_cola_verificacion_identidad_estado" CHECK ("estado" IN ('queued', 'leased', 'done', 'cancelled')),
  CONSTRAINT "ck_cola_verificacion_identidad_lease" CHECK ("estado" <> 'leased' OR ("lease_owner" IS NOT NULL AND "lease_hasta" IS NOT NULL)),
  CONSTRAINT "ck_cola_verificacion_identidad_intentos" CHECK ("intentos" >= 0)
);
CREATE UNIQUE INDEX "uq_cola_verificacion_identidad_activo" ON public."cola_verificacion_identidad"("verificacion_id") WHERE "estado" IN ('queued', 'leased');
CREATE INDEX "ix_cola_verificacion_identidad_fifo" ON public."cola_verificacion_identidad"("estado", "encolado_en", "disponible_en");

CREATE TABLE public."consultas_proveedor_identidad" (
  "id" text NOT NULL,
  "proveedor_id" text NOT NULL,
  "verificacion_id" text NOT NULL,
  "consumida_en" timestamp(3) NOT NULL,
  CONSTRAINT "consultas_proveedor_identidad_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ix_consultas_proveedor_identidad_ventana" ON public."consultas_proveedor_identidad"("proveedor_id", "consumida_en");

CREATE OR REPLACE FUNCTION public.tus_consultas_identidad_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consultas_proveedor_identidad is append-only';
END;
$$;
CREATE TRIGGER tus_consultas_identidad_append_only_trigger
  BEFORE UPDATE OR DELETE ON public."consultas_proveedor_identidad"
  FOR EACH ROW EXECUTE FUNCTION public.tus_consultas_identidad_append_only();

CREATE TABLE public."estado_proveedor_identidad" (
  "proveedor_id" text NOT NULL,
  "estado" text NOT NULL,
  "errores_consecutivos" integer NOT NULL DEFAULT 0,
  "motivo" text,
  "version" integer NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "estado_proveedor_identidad_pkey" PRIMARY KEY ("proveedor_id"),
  CONSTRAINT "ck_estado_proveedor_identidad_estado" CHECK ("estado" IN ('running', 'paused', 'session_required', 'circuit_open')),
  CONSTRAINT "ck_estado_proveedor_identidad_errores" CHECK ("errores_consecutivos" >= 0 AND "version" >= 0)
);

CREATE TABLE public."sesiones_navegador_proveedor" (
  "proveedor_id" text NOT NULL,
  "estado_cifrado" text NOT NULL,
  "version_clave" text NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "sesiones_navegador_proveedor_pkey" PRIMARY KEY ("proveedor_id")
);

CREATE TABLE public."auditoria_identidad" (
  "id" text NOT NULL,
  "accion" text NOT NULL,
  "verificacion_id" text,
  "tenant_id" text,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "metadata" jsonb NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "auditoria_identidad_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ix_auditoria_identidad_verificacion" ON public."auditoria_identidad"("verificacion_id", "fecha_creacion");

CREATE OR REPLACE FUNCTION public.tus_auditoria_identidad_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auditoria_identidad is append-only';
END;
$$;
CREATE TRIGGER tus_auditoria_identidad_append_only_trigger
  BEFORE UPDATE OR DELETE ON public."auditoria_identidad"
  FOR EACH ROW EXECUTE FUNCTION public.tus_auditoria_identidad_append_only();
