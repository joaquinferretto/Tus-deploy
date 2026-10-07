-- ADMIN-WHATSAPP-AVISOS-01. Admin reads, for a turno request, the notice TUS sent to the provider
-- (its message and the status Meta reported for it) and the record of a notice that was NOT sent.
-- Both are looked up by the correlation of the request. Indexes only: no data changes.

CREATE INDEX IF NOT EXISTS "ix_mensajes_conversacion_whatsapp_correlacion"
  ON public."mensajes_conversacion_whatsapp" ("correlacion_id");

CREATE INDEX IF NOT EXISTS "ix_auditoria_asistente_correlacion"
  ON public."auditoria_asistente" ("correlacion_id", "accion");
