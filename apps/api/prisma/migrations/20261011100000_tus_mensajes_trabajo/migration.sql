-- Private chat between the client and the provider of a work (after the match). Forward-only and
-- additive: one new table and one new unique index (a superset of uq_trabajos_tenant_trabajo, so
-- it can never reject an existing row). Messages are append-only: the application never updates or
-- deletes them.
--
-- The composite FK binds every message to the work's client tenant AND its provider tenant, so a
-- message can never belong to another provider's conversation. The author is a real account.

CREATE UNIQUE INDEX "uq_trabajos_tenant_trabajo_prestador" ON public."trabajos"("tenant_id", "trabajo_id", "prestador_tenant_id");

CREATE TABLE public."mensajes_trabajo" (
  "id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "trabajo_id" text NOT NULL,
  "prestador_tenant_id" text NOT NULL,
  "autor_cuenta_id" text NOT NULL,
  "autor_rol" text NOT NULL,
  "texto" text NOT NULL,
  "fecha_creacion" timestamp(3) NOT NULL,
  CONSTRAINT "mensajes_trabajo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_mensajes_trabajo_rol" CHECK ("autor_rol" IN ('cliente', 'prestador')),
  CONSTRAINT "ck_mensajes_trabajo_texto" CHECK (length(btrim("texto")) BETWEEN 1 AND 2000),
  CONSTRAINT "fk_mensajes_trabajo_trabajo" FOREIGN KEY ("tenant_id", "trabajo_id", "prestador_tenant_id")
    REFERENCES public."trabajos"("tenant_id", "trabajo_id", "prestador_tenant_id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "fk_mensajes_trabajo_autor" FOREIGN KEY ("autor_cuenta_id")
    REFERENCES public."Account"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "ix_mensajes_trabajo_conversacion" ON public."mensajes_trabajo"("tenant_id", "trabajo_id", "fecha_creacion", "id");
