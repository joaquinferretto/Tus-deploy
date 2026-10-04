-- PRECIOS-INICIALES-01: initial price of the services that exist TODAY, so that a turno can be
-- requested for every one of them (a turno with deposit needs a published price).
--
-- DATA migration, no schema change. The source of truth of the price of a service a provider
-- offers is unchanged and stays unique:
--   * "tarifas_servicio_prestador"."precio": the price of each variant of a service;
--   * "perfil_servicios"."precio_base": the price of a service that has no variants.
-- Both hold WHOLE PESOS (bigint; "A price in whole pesos" in turnos-sena.ts), so ARS $200 is 200
-- (the deposit, half of it, is computed by the backend when a turno is requested).
--
-- Scope: only rows that exist when the migration runs, of trades that are active in the
-- administered catalog; for variants, only the active ones. Nothing is inserted: a provider gets a
-- price only for the services it already offers. No default is added to any column, so services
-- and variants created later keep the normal price configuration flow.
--
-- Not touched: reservations and their stored price ("reservas"."precio_final"), payments,
-- obligations, ledger, earnings, payouts or any other historical snapshot.
--
-- Deterministic and repeatable: a second run changes no row.

UPDATE public."perfil_servicios" AS servicio
SET "precio_base" = 200
FROM public."oficios_servicio" AS oficio
WHERE oficio."id" = servicio."oficio_id"
  AND oficio."activo" = true
  AND servicio."precio_base" IS DISTINCT FROM 200;

UPDATE public."tarifas_servicio_prestador" AS tarifa
SET "precio" = 200,
    "fecha_actualizacion" = CURRENT_TIMESTAMP
FROM public."oficios_servicio" AS oficio
WHERE oficio."id" = tarifa."oficio_id"
  AND oficio."activo" = true
  AND tarifa."activo" = true
  AND tarifa."precio" IS DISTINCT FROM 200;
