-- WEB-08A: canonical service work, diagnosis, budget, decision and evidence.
-- Work ownership remains split: tenant_id is the customer/commitment tenant;
-- prestador_tenant_id identifies the provider side of a cross-tenant service.

-- Existing reservas use tenant_id for the provider because it owns the calendar.
-- Customer tenant cannot be inferred from cliente_id, so legacy rows stay NULL and
-- cannot be linked to a Trabajo until an explicit, future reconciliation occurs.
ALTER TABLE public."reservas" ADD COLUMN "cliente_tenant_id" text;

CREATE TABLE public."trabajos" (
  "id" text NOT NULL,
  "version_contrato" text NOT NULL,
  "trabajo_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "compromiso_id" text NOT NULL,
  "prestador_id" text NOT NULL,
  "publicacion_id" text NOT NULL,
  "reserva_tenant_id" text,
  "reserva_id" text,
  "cliente_id" text,
  "estado" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "requiere_presupuesto" boolean NOT NULL,
  "presupuesto_aceptado_id" text,
  "presupuesto_aceptado_version" integer,
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "trabajos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_trabajos_estado" CHECK ("estado" IN ('requested', 'in_diagnosis', 'budget_pending', 'accepted', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT "ck_trabajos_version_positiva" CHECK ("version" > 0),
  CONSTRAINT "ck_trabajos_reserva_completa" CHECK (("reserva_tenant_id" IS NULL) = ("reserva_id" IS NULL)),
  CONSTRAINT "ck_trabajos_presupuesto_aceptado_completo" CHECK (("presupuesto_aceptado_id" IS NULL) = ("presupuesto_aceptado_version" IS NULL))
);

CREATE TABLE public."diagnosticos" (
  "id" text NOT NULL,
  "version_contrato" text NOT NULL,
  "diagnostico_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "trabajo_id" text NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "estado" text NOT NULL,
  "descripcion_original" text NOT NULL,
  "datos_estructurados" jsonb,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "fecha_confirmacion" timestamp(3),
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "diagnosticos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_diagnosticos_estado" CHECK ("estado" IN ('draft', 'confirmed', 'cancelled')),
  CONSTRAINT "ck_diagnosticos_version_positiva" CHECK ("version" > 0)
);

CREATE TABLE public."presupuestos" (
  "id" text NOT NULL,
  "version_contrato" text NOT NULL,
  "presupuesto_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "trabajo_id" text NOT NULL,
  "version" integer NOT NULL,
  "estado" text NOT NULL,
  "moneda" text NOT NULL,
  "monto_total" bigint NOT NULL,
  "alcance" text NOT NULL,
  "fecha_validez" timestamp(3),
  "creado_por" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "presupuestos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_presupuestos_estado" CHECK ("estado" IN ('draft', 'issued', 'accepted', 'rejected', 'expired', 'cancelled')),
  CONSTRAINT "ck_presupuestos_version_positiva" CHECK ("version" > 0),
  CONSTRAINT "ck_presupuestos_monto_no_negativo" CHECK ("monto_total" >= 0)
);

CREATE TABLE public."lineas_presupuesto" (
  "id" text NOT NULL,
  "linea_id" text NOT NULL,
  "presupuesto_registro_id" text NOT NULL,
  "descripcion" text NOT NULL,
  "cantidad" integer NOT NULL,
  "monto_unitario" bigint NOT NULL,
  "monto_total" bigint NOT NULL,
  "orden" integer NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "lineas_presupuesto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_lineas_presupuesto_cantidad_positiva" CHECK ("cantidad" > 0),
  CONSTRAINT "ck_lineas_presupuesto_montos_no_negativos" CHECK ("monto_unitario" >= 0 AND "monto_total" >= 0),
  CONSTRAINT "ck_lineas_presupuesto_orden_no_negativo" CHECK ("orden" >= 0)
);

CREATE TABLE public."aceptaciones_presupuesto" (
  "id" text NOT NULL,
  "aceptacion_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "presupuesto_registro_id" text NOT NULL,
  "decision" text NOT NULL,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "motivo" text,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "aceptaciones_presupuesto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_aceptaciones_presupuesto_decision" CHECK ("decision" IN ('accepted', 'rejected'))
);

CREATE TABLE public."transiciones_trabajo" (
  "id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "trabajo_id" text NOT NULL,
  "estado_anterior" text,
  "estado_nuevo" text NOT NULL,
  "version" integer NOT NULL,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "motivo" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "transiciones_trabajo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_transiciones_trabajo_version_positiva" CHECK ("version" > 0)
);

CREATE TABLE public."evidencias_trabajo" (
  "id" text NOT NULL,
  "evidencia_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "trabajo_id" text NOT NULL,
  "fase" text NOT NULL,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "referencia" text NOT NULL,
  "metadatos" jsonb NOT NULL,
  "fecha_ocurrencia" timestamp(3) NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "evidencias_trabajo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_evidencias_trabajo_fase" CHECK ("fase" IN ('request', 'diagnosis', 'budget', 'execution', 'completion'))
);

CREATE TABLE public."auditoria_trabajo" (
  "id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "trabajo_tenant_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "trabajo_id" text NOT NULL,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "accion" text NOT NULL,
  "tipo_recurso" text NOT NULL,
  "recurso_id" text NOT NULL,
  "resultado" text NOT NULL,
  "metadatos" jsonb NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "auditoria_trabajo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_trabajos_tenant_trabajo" ON public."trabajos" ("tenant_id", "trabajo_id");
CREATE UNIQUE INDEX "uq_trabajos_tenant_compromiso" ON public."trabajos" ("tenant_id", "compromiso_id");
CREATE UNIQUE INDEX "uq_trabajos_tenant_presupuesto_aceptado" ON public."trabajos" ("tenant_id", "presupuesto_aceptado_id", "presupuesto_aceptado_version");
CREATE INDEX "idx_trabajos_tenant_estado" ON public."trabajos" ("tenant_id", "estado");
CREATE INDEX "idx_trabajos_prestador_estado" ON public."trabajos" ("prestador_tenant_id", "prestador_id", "estado");
CREATE UNIQUE INDEX "uq_diagnosticos_tenant_diagnostico" ON public."diagnosticos" ("tenant_id", "diagnostico_id");
CREATE UNIQUE INDEX "uq_diagnosticos_tenant_trabajo_version" ON public."diagnosticos" ("tenant_id", "trabajo_id", "version");
CREATE INDEX "idx_diagnosticos_tenant_trabajo_estado" ON public."diagnosticos" ("tenant_id", "trabajo_id", "estado");
CREATE UNIQUE INDEX "uq_presupuestos_tenant_presupuesto_version" ON public."presupuestos" ("tenant_id", "presupuesto_id", "version");
CREATE INDEX "idx_presupuestos_tenant_trabajo_version" ON public."presupuestos" ("tenant_id", "trabajo_id", "version");
CREATE UNIQUE INDEX "uq_lineas_presupuesto_registro_linea" ON public."lineas_presupuesto" ("presupuesto_registro_id", "linea_id");
CREATE INDEX "idx_lineas_presupuesto_registro_orden" ON public."lineas_presupuesto" ("presupuesto_registro_id", "orden");
CREATE UNIQUE INDEX "uq_aceptaciones_presupuesto_tenant_aceptacion" ON public."aceptaciones_presupuesto" ("tenant_id", "aceptacion_id");
CREATE UNIQUE INDEX "uq_aceptaciones_presupuesto_tenant_version" ON public."aceptaciones_presupuesto" ("tenant_id", "presupuesto_registro_id");
CREATE INDEX "idx_aceptaciones_presupuesto_tenant_fecha_creacion" ON public."aceptaciones_presupuesto" ("tenant_id", "fecha_creacion");
CREATE UNIQUE INDEX "uq_transiciones_trabajo_tenant_trabajo_version" ON public."transiciones_trabajo" ("tenant_id", "trabajo_id", "version");
CREATE INDEX "idx_transiciones_trabajo_tenant_trabajo_fecha_creacion" ON public."transiciones_trabajo" ("tenant_id", "trabajo_id", "fecha_creacion");
CREATE UNIQUE INDEX "uq_evidencias_trabajo_tenant_evidencia" ON public."evidencias_trabajo" ("tenant_id", "evidencia_id");
CREATE INDEX "idx_evidencias_trabajo_tenant_trabajo_fase" ON public."evidencias_trabajo" ("tenant_id", "trabajo_id", "fase", "fecha_ocurrencia");
CREATE INDEX "idx_evidencias_trabajo_prestador_trabajo_fecha" ON public."evidencias_trabajo" ("prestador_tenant_id", "trabajo_id", "fecha_ocurrencia");
CREATE INDEX "idx_auditoria_trabajo_tenant_fecha_creacion" ON public."auditoria_trabajo" ("tenant_id", "fecha_creacion");
CREATE INDEX "idx_auditoria_trabajo_trabajo_fecha_creacion" ON public."auditoria_trabajo" ("trabajo_tenant_id", "trabajo_id", "fecha_creacion");
CREATE INDEX "idx_auditoria_trabajo_prestador_trabajo_fecha" ON public."auditoria_trabajo" ("prestador_tenant_id", "trabajo_id", "fecha_creacion");

-- Marketplace commitments belong to the customer tenant while their listing belongs
-- to the provider tenant. Backfill is deterministic because publicaciones.id is global.
ALTER TABLE public."compromisos_mercado_servicios"
  ADD COLUMN "prestador_tenant_id" text;

UPDATE public."compromisos_mercado_servicios" AS compromiso
SET "prestador_tenant_id" = publicacion."tenant_id"
FROM public."publicaciones" AS publicacion
WHERE compromiso."publicacion_id" = publicacion."id";

ALTER TABLE public."compromisos_mercado_servicios"
  ALTER COLUMN "prestador_tenant_id" SET NOT NULL,
  DROP CONSTRAINT "fk_compromisos_mercado_servicios_publicaciones",
  ADD CONSTRAINT "fk_compromisos_mercado_servicios_publicaciones"
  FOREIGN KEY ("prestador_tenant_id", "publicacion_id") REFERENCES public."publicaciones" ("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE UNIQUE INDEX "uq_compromisos_ms_tenant_proveedor_publicacion" ON public."compromisos_mercado_servicios" ("tenant_id", "compromiso_id", "prestador_tenant_id", "prestador_id", "publicacion_id");

ALTER TABLE public."trabajos"
  ADD CONSTRAINT "fk_trabajos_compromisos_ms"
  FOREIGN KEY ("tenant_id", "compromiso_id", "prestador_tenant_id", "prestador_id", "publicacion_id") REFERENCES public."compromisos_mercado_servicios" ("tenant_id", "compromiso_id", "prestador_tenant_id", "prestador_id", "publicacion_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "fk_trabajos_prestadores"
  FOREIGN KEY ("prestador_tenant_id", "prestador_id") REFERENCES public."prestadores" ("tenant_id", "prestador_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "fk_trabajos_publicaciones"
  FOREIGN KEY ("prestador_tenant_id", "publicacion_id") REFERENCES public."publicaciones" ("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "fk_trabajos_reservas"
  FOREIGN KEY ("reserva_tenant_id", "reserva_id") REFERENCES public."reservas" ("tenant_id", "reserva_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public."diagnosticos"
  ADD CONSTRAINT "fk_diagnosticos_trabajos"
  FOREIGN KEY ("tenant_id", "trabajo_id") REFERENCES public."trabajos" ("tenant_id", "trabajo_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public."presupuestos"
  ADD CONSTRAINT "fk_presupuestos_trabajos"
  FOREIGN KEY ("tenant_id", "trabajo_id") REFERENCES public."trabajos" ("tenant_id", "trabajo_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public."lineas_presupuesto"
  ADD CONSTRAINT "fk_lineas_presupuesto_presupuestos"
  FOREIGN KEY ("presupuesto_registro_id") REFERENCES public."presupuestos" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE public."aceptaciones_presupuesto"
  ADD CONSTRAINT "fk_aceptaciones_presupuesto_presupuestos"
  FOREIGN KEY ("presupuesto_registro_id") REFERENCES public."presupuestos" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public."transiciones_trabajo"
  ADD CONSTRAINT "fk_transiciones_trabajo_trabajos"
  FOREIGN KEY ("tenant_id", "trabajo_id") REFERENCES public."trabajos" ("tenant_id", "trabajo_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public."evidencias_trabajo"
  ADD CONSTRAINT "fk_evidencias_trabajo_trabajos"
  FOREIGN KEY ("tenant_id", "trabajo_id") REFERENCES public."trabajos" ("tenant_id", "trabajo_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public."auditoria_trabajo"
  ADD CONSTRAINT "fk_auditoria_trabajo_trabajos"
  FOREIGN KEY ("trabajo_tenant_id", "trabajo_id") REFERENCES public."trabajos" ("tenant_id", "trabajo_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE public."trabajos"
  ADD CONSTRAINT "fk_trabajos_presupuesto_aceptado"
  FOREIGN KEY ("tenant_id", "presupuesto_aceptado_id", "presupuesto_aceptado_version") REFERENCES public."presupuestos" ("tenant_id", "presupuesto_id", "version") ON DELETE RESTRICT ON UPDATE NO ACTION;
