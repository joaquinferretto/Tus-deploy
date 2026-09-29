-- Safe cancellation of request-born works (FASE 8). Forward-only and additive: existing rows keep
-- every value (all new columns are NULL). The transition log already records actor, date and the
-- previous state; these columns keep who cancelled (role) and why, plus a client's request to
-- cancel a started work, which never cancels by itself.

ALTER TABLE public."trabajos" ADD COLUMN "cancelado_por_rol" text;
ALTER TABLE public."trabajos" ADD COLUMN "motivo_cancelacion" text;
ALTER TABLE public."trabajos" ADD COLUMN "cancelacion_solicitada_en" timestamp(3);
ALTER TABLE public."trabajos" ADD COLUMN "cancelacion_solicitada_motivo" text;

ALTER TABLE public."trabajos" ADD CONSTRAINT "ck_trabajos_cancelacion" CHECK (
  ("cancelado_por_rol" IS NULL) = ("motivo_cancelacion" IS NULL)
  AND ("cancelado_por_rol" IS NULL OR ("cancelado_por_rol" IN ('cliente', 'prestador', 'admin') AND "estado" = 'cancelled'))
  AND ("motivo_cancelacion" IS NULL OR length("motivo_cancelacion") BETWEEN 1 AND 500)
);
ALTER TABLE public."trabajos" ADD CONSTRAINT "ck_trabajos_cancelacion_solicitada" CHECK (
  ("cancelacion_solicitada_en" IS NULL) = ("cancelacion_solicitada_motivo" IS NULL)
  AND ("cancelacion_solicitada_motivo" IS NULL OR length("cancelacion_solicitada_motivo") BETWEEN 1 AND 500)
);
