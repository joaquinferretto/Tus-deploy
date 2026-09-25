-- WHATSAPP-AI-01: WhatsApp Cloud API conversations, account linking, confirmations and the TUS
-- knowledge base for RAG. Forward-only and additive: new tables only. Vectors reuse the existing
-- P3 table "RagEmbedding" (vector(1024) + HNSW cosine index) under tenant 'tus-platform' and
-- workspace 'conocimiento-tus'; no other vector database is introduced.
-- The earlier scaffolding tables (acciones_whatsapp, mensajes_whatsapp, consentimientos_whatsapp,
-- eventos_webhook_whatsapp, outbox_whatsapp, confirmaciones_whatsapp) are left untouched.

CREATE TABLE public."contactos_whatsapp" (
  "id" text NOT NULL,
  "wa_id" text NOT NULL,
  "nombre_perfil" text,
  "cuenta_vinculada_id" text,
  "tenant_vinculado_id" text,
  "vinculado_en" timestamp(3),
  "bloqueado_hasta" timestamp(3),
  "motivo_bloqueo" text,
  "ultimo_entrante_en" timestamp(3),
  "version" integer NOT NULL DEFAULT 1,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "contactos_whatsapp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_contactos_whatsapp_wa_id" CHECK ("wa_id" ~ '^[0-9]{6,20}$'),
  CONSTRAINT "ck_contactos_whatsapp_vinculo" CHECK (("cuenta_vinculada_id" IS NULL) = ("tenant_vinculado_id" IS NULL)),
  CONSTRAINT "ck_contactos_whatsapp_version" CHECK ("version" > 0)
);
-- The external identity is unique; linked-account lookups serve "my linked numbers" and unlink.
CREATE UNIQUE INDEX "uq_contactos_whatsapp_wa_id" ON public."contactos_whatsapp"("wa_id");
CREATE INDEX "ix_contactos_whatsapp_cuenta" ON public."contactos_whatsapp"("cuenta_vinculada_id") WHERE "cuenta_vinculada_id" IS NOT NULL;

CREATE TABLE public."conversaciones_whatsapp" (
  "id" text NOT NULL,
  "contacto_id" text NOT NULL,
  "estado" text NOT NULL,
  "modo" text NOT NULL,
  "motivo_derivacion" text,
  "derivada_en" timestamp(3),
  "operador_id" text,
  "abierta_en" timestamp(3) NOT NULL,
  "ultimo_mensaje_en" timestamp(3) NOT NULL,
  "ultimo_entrante_en" timestamp(3),
  "no_leidos" integer NOT NULL DEFAULT 0,
  "resumen" text,
  "mensajes_resumidos" integer NOT NULL DEFAULT 0,
  "estado_conversacional" jsonb NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "conversaciones_whatsapp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_conversaciones_whatsapp_contacto" FOREIGN KEY ("contacto_id") REFERENCES public."contactos_whatsapp"("id") ON DELETE RESTRICT,
  CONSTRAINT "ck_conversaciones_whatsapp_estado" CHECK ("estado" IN ('active', 'closed')),
  CONSTRAINT "ck_conversaciones_whatsapp_modo" CHECK ("modo" IN ('bot', 'human')),
  CONSTRAINT "ck_conversaciones_whatsapp_contadores" CHECK ("no_leidos" >= 0 AND "mensajes_resumidos" >= 0 AND "version" > 0)
);
-- One active conversation per contact; the support panel lists by mode and recent activity.
CREATE UNIQUE INDEX "uq_conversaciones_whatsapp_activa" ON public."conversaciones_whatsapp"("contacto_id") WHERE "estado" = 'active';
CREATE INDEX "ix_conversaciones_whatsapp_panel" ON public."conversaciones_whatsapp"("modo", "ultimo_mensaje_en");

CREATE TABLE public."mensajes_conversacion_whatsapp" (
  "id" text NOT NULL,
  "conversacion_id" text NOT NULL,
  "contacto_id" text NOT NULL,
  "wamid" text,
  "direccion" text NOT NULL,
  "tipo" text NOT NULL,
  "texto" text,
  "estado" text NOT NULL,
  "estado_en" timestamp(3),
  "fecha_externa" timestamp(3),
  "responde_a_wamid" text,
  "actor" text NOT NULL,
  "metadata" jsonb NOT NULL,
  "correlacion_id" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "mensajes_conversacion_whatsapp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_mensajes_conversacion_whatsapp_conversacion" FOREIGN KEY ("conversacion_id") REFERENCES public."conversaciones_whatsapp"("id") ON DELETE RESTRICT,
  CONSTRAINT "ck_mensajes_conversacion_whatsapp_direccion" CHECK ("direccion" IN ('inbound', 'outbound')),
  CONSTRAINT "ck_mensajes_conversacion_whatsapp_estado" CHECK ("estado" IN ('received', 'processed', 'ignored', 'rate_limited', 'pending_send', 'sent', 'delivered', 'read', 'failed', 'unknown')),
  CONSTRAINT "ck_mensajes_conversacion_whatsapp_texto" CHECK ("texto" IS NULL OR length("texto") <= 4096)
);
-- Webhook idempotency: a wamid is stored once (replays are detected by this constraint).
CREATE UNIQUE INDEX "uq_mensajes_conversacion_whatsapp_wamid" ON public."mensajes_conversacion_whatsapp"("wamid") WHERE "wamid" IS NOT NULL;
CREATE INDEX "ix_mensajes_conversacion_whatsapp_historial" ON public."mensajes_conversacion_whatsapp"("conversacion_id", "fecha_creacion");
-- Per-contact inbound rate limit window.
CREATE INDEX "ix_mensajes_conversacion_whatsapp_entrantes" ON public."mensajes_conversacion_whatsapp"("contacto_id", "fecha_creacion") WHERE "direccion" = 'inbound';
CREATE INDEX "ix_mensajes_conversacion_whatsapp_pendientes" ON public."mensajes_conversacion_whatsapp"("conversacion_id") WHERE "estado" = 'received';

CREATE TABLE public."cola_conversacion_whatsapp" (
  "id" text NOT NULL,
  "conversacion_id" text NOT NULL,
  "estado" text NOT NULL,
  "disponible_en" timestamp(3) NOT NULL,
  "lease_owner" text,
  "lease_hasta" timestamp(3),
  "intentos" integer NOT NULL DEFAULT 0,
  "ultimo_error" text,
  "correlacion_id" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "cola_conversacion_whatsapp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_cola_conversacion_whatsapp_estado" CHECK ("estado" IN ('queued', 'leased', 'done')),
  CONSTRAINT "ck_cola_conversacion_whatsapp_lease" CHECK ("estado" <> 'leased' OR ("lease_owner" IS NOT NULL AND "lease_hasta" IS NOT NULL)),
  CONSTRAINT "ck_cola_conversacion_whatsapp_intentos" CHECK ("intentos" >= 0)
);
-- Debounce/coalescing: at most one queued job per conversation; the worker scans pending jobs.
CREATE UNIQUE INDEX "uq_cola_conversacion_whatsapp_encolado" ON public."cola_conversacion_whatsapp"("conversacion_id") WHERE "estado" = 'queued';
CREATE INDEX "ix_cola_conversacion_whatsapp_pendientes" ON public."cola_conversacion_whatsapp"("estado", "disponible_en") WHERE "estado" <> 'done';

CREATE TABLE public."tokens_vinculacion_whatsapp" (
  "id" text NOT NULL,
  "contacto_id" text NOT NULL,
  "hash_token" text NOT NULL,
  "expira_en" timestamp(3) NOT NULL,
  "usado_en" timestamp(3),
  "usado_por_cuenta_id" text,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "tokens_vinculacion_whatsapp_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_tokens_vinculacion_whatsapp_contacto" FOREIGN KEY ("contacto_id") REFERENCES public."contactos_whatsapp"("id") ON DELETE RESTRICT,
  CONSTRAINT "ck_tokens_vinculacion_whatsapp_hash" CHECK ("hash_token" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ck_tokens_vinculacion_whatsapp_uso" CHECK (("usado_en" IS NULL) = ("usado_por_cuenta_id" IS NULL))
);
-- Only the sha256 of the token is stored; lookups go by hash.
CREATE UNIQUE INDEX "uq_tokens_vinculacion_whatsapp_hash" ON public."tokens_vinculacion_whatsapp"("hash_token");

CREATE TABLE public."confirmaciones_asistente" (
  "id" text NOT NULL,
  "conversacion_id" text NOT NULL,
  "contacto_id" text NOT NULL,
  "cuenta_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "herramienta" text NOT NULL,
  "argumentos" jsonb NOT NULL,
  "hash_argumentos" text NOT NULL,
  "resumen" text NOT NULL,
  "estado" text NOT NULL,
  "resultado" jsonb,
  "expira_en" timestamp(3) NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  "decidida_en" timestamp(3),
  CONSTRAINT "confirmaciones_asistente_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_confirmaciones_asistente_conversacion" FOREIGN KEY ("conversacion_id") REFERENCES public."conversaciones_whatsapp"("id") ON DELETE RESTRICT,
  CONSTRAINT "ck_confirmaciones_asistente_estado" CHECK ("estado" IN ('pending', 'confirmed', 'cancelled', 'expired', 'executed', 'failed'))
);
CREATE INDEX "ix_confirmaciones_asistente_conversacion" ON public."confirmaciones_asistente"("conversacion_id", "fecha_creacion");

CREATE TABLE public."auditoria_asistente" (
  "id" text NOT NULL,
  "accion" text NOT NULL,
  "contacto_id" text,
  "conversacion_id" text,
  "actor_id" text NOT NULL,
  "correlacion_id" text NOT NULL,
  "metadata" jsonb NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "auditoria_asistente_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ix_auditoria_asistente_conversacion" ON public."auditoria_asistente"("conversacion_id", "fecha_creacion");

CREATE OR REPLACE FUNCTION public.tus_auditoria_asistente_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auditoria_asistente is append-only';
END;
$$;
CREATE TRIGGER tus_auditoria_asistente_append_only_trigger
  BEFORE UPDATE OR DELETE ON public."auditoria_asistente"
  FOR EACH ROW EXECUTE FUNCTION public.tus_auditoria_asistente_append_only();

CREATE TABLE public."documentos_conocimiento" (
  "id" text NOT NULL,
  "fuente" text NOT NULL,
  "titulo" text NOT NULL,
  "version" text NOT NULL,
  "visibilidad" text NOT NULL,
  "audiencia" text NOT NULL,
  "idioma" text NOT NULL,
  "activo" boolean NOT NULL,
  "checksum" text NOT NULL,
  "version_embeddings" text,
  "fecha_actualizacion" timestamp(3) NOT NULL,
  CONSTRAINT "documentos_conocimiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_documentos_conocimiento_visibilidad" CHECK ("visibilidad" IN ('public', 'authenticated-client', 'authenticated-provider', 'internal-admin')),
  CONSTRAINT "ck_documentos_conocimiento_audiencia" CHECK ("audiencia" IN ('all', 'client', 'provider')),
  CONSTRAINT "ck_documentos_conocimiento_checksum" CHECK ("checksum" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public."fragmentos_conocimiento" (
  "id" text NOT NULL,
  "documento_id" text NOT NULL,
  "version_documento" text NOT NULL,
  "indice" integer NOT NULL,
  "seccion" text NOT NULL,
  "texto" text NOT NULL,
  "visibilidad" text NOT NULL,
  "audiencia" text NOT NULL,
  "idioma" text NOT NULL,
  "activo" boolean NOT NULL,
  "busqueda" tsvector GENERATED ALWAYS AS (to_tsvector('spanish', "seccion" || ' ' || "texto")) STORED,
  CONSTRAINT "fragmentos_conocimiento_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_fragmentos_conocimiento_documento" FOREIGN KEY ("documento_id") REFERENCES public."documentos_conocimiento"("id") ON DELETE RESTRICT,
  CONSTRAINT "ck_fragmentos_conocimiento_texto" CHECK (length("texto") <= 4000)
);
CREATE UNIQUE INDEX "uq_fragmentos_conocimiento_documento_indice" ON public."fragmentos_conocimiento"("documento_id", "indice");
-- Lexical half of the hybrid retrieval (Spanish full-text).
CREATE INDEX "ix_fragmentos_conocimiento_busqueda" ON public."fragmentos_conocimiento" USING gin ("busqueda");
