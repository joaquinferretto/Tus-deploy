-- WEB-08G/H: una reserva vincula como maximo un trabajo.
-- Forward-only y aditiva. No inserta, actualiza ni borra filas.
--
-- Filas sin reserva tienen reserva_tenant_id/reserva_id NULL y no colisionan (NULLs distintos).
-- Si el destino real ya tuviera dos trabajos sobre la misma reserva, la creacion del indice
-- falla sin modificar datos y la duplicacion debe resolverse manualmente antes de reintentar.
CREATE UNIQUE INDEX "uq_trabajos_reserva" ON public."trabajos"("reserva_tenant_id", "reserva_id");
