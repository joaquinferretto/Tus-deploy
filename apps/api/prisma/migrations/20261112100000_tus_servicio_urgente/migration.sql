-- SERVICIO-URGENTE-01. A client asks for immediate attention and authorizes TUS to offer the
-- request to every compatible provider at once; the first that accepts is assigned.
--
-- Nothing parallel is built: the request is a row of solicitudes_servicio (urgencia 'urgente'),
-- its winner is the provider of that same row and its work is the one work of the request
-- (uq_trabajos_solicitud). New here:
--   1. solicitudes_servicio: the address (shown only to the providers it is offered to and to the
--      administration, never public), the mark of a broadcast, how many times it was reopened and
--      why it closed without a winner;
--   2. perfiles_publicos_prestador.acepta_urgencias: the provider opts in (default: no);
--   3. ofertas_urgentes: one row per candidate (notified or not, its answer, when), which is also
--      the history of who accepted and who gave the assignment back;
--   4. the FK that ties a work to the assigned provider of its request becomes DEFERRABLE (still
--      immediate by default): when the winner gives the assignment back and another provider
--      takes it, the request and its ONE work move to the new provider in the same transaction.
-- Forward-only and additive: no existing row changes meaning.

ALTER TABLE public."solicitudes_servicio"
  ADD COLUMN "direccion" TEXT,
  ADD COLUMN "difusion_urgente" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cierre_urgente" TEXT,
  ADD COLUMN "reaperturas_urgente" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "ck_solicitudes_servicio_direccion" CHECK ("direccion" IS NULL OR length("direccion") BETWEEN 5 AND 160),
  -- A broadcast is always an urgent request with an address; only a broadcast has them.
  ADD CONSTRAINT "ck_solicitudes_servicio_difusion" CHECK (
    ("difusion_urgente" AND "urgencia" = 'urgente' AND "direccion" IS NOT NULL)
    OR (NOT "difusion_urgente" AND "direccion" IS NULL AND "cierre_urgente" IS NULL AND "reaperturas_urgente" = 0)
  ),
  ADD CONSTRAINT "ck_solicitudes_servicio_reaperturas" CHECK ("reaperturas_urgente" BETWEEN 0 AND 20),
  -- Closed without a winner: nobody to offer it to, everybody said no, or nobody answered in time.
  ADD CONSTRAINT "ck_solicitudes_servicio_cierre_urgente" CHECK (
    "cierre_urgente" IS NULL
    OR ("cierre_urgente" IN ('sin_candidatos', 'todos_rechazaron', 'vencida') AND "estado" = 'cerrada' AND "estado_asignacion" IS DISTINCT FROM 'aceptada')
  );

-- The sweep that expires broadcasts nobody took.
CREATE INDEX "ix_solicitudes_servicio_difusion_abierta"
  ON public."solicitudes_servicio" ("expira_en")
  WHERE "difusion_urgente" AND "estado" = 'abierta';

ALTER TABLE public."perfiles_publicos_prestador"
  ADD COLUMN "acepta_urgencias" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE public."ofertas_urgentes" (
  "id" TEXT NOT NULL,
  "solicitud_id" TEXT NOT NULL,
  "prestador_tenant_id" TEXT NOT NULL,
  "prestador_id" TEXT NOT NULL,
  -- The account the offer was sent to (prestadores.cuenta_id at that moment); null: none linked.
  "cuenta_id" TEXT,
  "estado" TEXT NOT NULL,
  "canal" TEXT,
  "motivo_no_enviada" TEXT,
  -- Which round of notices this provider was last told in (1: the first broadcast; +1 per reopening).
  "ronda" INTEGER NOT NULL DEFAULT 1,
  "notificada_en" TIMESTAMP(3),
  "respondida_en" TIMESTAMP(3),
  "canal_respuesta" TEXT,
  -- The history of an assignment: when this provider took the request and, if it gave it back,
  -- when, from where and why (its own words, when it gave any).
  "aceptada_en" TIMESTAMP(3),
  "renuncia_en" TIMESTAMP(3),
  "canal_renuncia" TEXT,
  "motivo_renuncia" TEXT,
  "fecha_creacion" TIMESTAMP(3) NOT NULL,
  "fecha_actualizacion" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ofertas_urgentes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_ofertas_urgentes_solicitud" FOREIGN KEY ("solicitud_id") REFERENCES public."solicitudes_servicio"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_ofertas_urgentes_prestador" FOREIGN KEY ("prestador_tenant_id", "prestador_id") REFERENCES public."prestadores"("tenant_id", "prestador_id") ON DELETE RESTRICT,
  -- notificada: the notice left. no_enviada: a candidate TUS could not write to (the reason is
  -- kept). acepto: the assigned provider. no_puede: said no. cerrada_por_otro: somebody else took
  -- it. renuncio: it took the request and gave it back (never offered again). vencida: nobody
  -- took it in time.
  CONSTRAINT "ck_ofertas_urgentes_estado" CHECK ("estado" IN ('notificada', 'no_enviada', 'acepto', 'no_puede', 'cerrada_por_otro', 'renuncio', 'vencida')),
  CONSTRAINT "ck_ofertas_urgentes_canal" CHECK ("canal" IS NULL OR "canal" IN ('whatsapp')),
  CONSTRAINT "ck_ofertas_urgentes_canal_respuesta" CHECK ("canal_respuesta" IS NULL OR "canal_respuesta" IN ('whatsapp', 'web')),
  CONSTRAINT "ck_ofertas_urgentes_canal_renuncia" CHECK ("canal_renuncia" IS NULL OR "canal_renuncia" IN ('whatsapp', 'web')),
  CONSTRAINT "ck_ofertas_urgentes_no_enviada" CHECK ("estado" <> 'no_enviada' OR "motivo_no_enviada" IS NOT NULL),
  -- Whoever is or was assigned accepted at some moment; only who accepted can give it back.
  CONSTRAINT "ck_ofertas_urgentes_aceptacion" CHECK ("estado" NOT IN ('acepto', 'renuncio') OR "aceptada_en" IS NOT NULL),
  CONSTRAINT "ck_ofertas_urgentes_renuncia" CHECK (("estado" = 'renuncio') = ("renuncia_en" IS NOT NULL)),
  CONSTRAINT "ck_ofertas_urgentes_motivo_renuncia" CHECK ("motivo_renuncia" IS NULL OR length("motivo_renuncia") <= 300)
);
-- One offer per provider and request.
CREATE UNIQUE INDEX "uq_ofertas_urgentes_prestador" ON public."ofertas_urgentes" ("solicitud_id", "prestador_tenant_id");
-- At most ONE assigned provider per request at any moment, whatever the code does.
CREATE UNIQUE INDEX "uq_ofertas_urgentes_ganador" ON public."ofertas_urgentes" ("solicitud_id") WHERE "estado" = 'acepto';
-- The offers a provider still has to answer.
CREATE INDEX "ix_ofertas_urgentes_prestador" ON public."ofertas_urgentes" ("prestador_tenant_id", "estado", "fecha_creacion");

-- SEGURIDAD-DATA-API-01: deny by default for any role that is not the owner (no policy).
ALTER TABLE public."ofertas_urgentes" ENABLE ROW LEVEL SECURITY;

-- The work of a request stays tied to the assigned provider of that request. Deferrable (and
-- still checked at once unless a transaction asks otherwise) so a reassignment can move both
-- rows together; nothing else changes for the rest of the system.
ALTER TABLE public."trabajos" ALTER CONSTRAINT "fk_trabajos_solicitud_asignada" DEFERRABLE INITIALLY IMMEDIATE;
