---
name: tus-payments
description: Pagos, comisiones, cobros de prestadores y Mercado Pago en TUS. Usar al tocar obligaciones de pago, checkout, comisiones, liquidaciones, reembolsos, webhooks de pago o cuentas de cobro.
---

# TUS: pagos

Referencia canónica: `docs/PRODUCCION_TUS.md` (activación de Mercado Pago).

## Reglas de dinero
- El cliente paga exactamente el total del presupuesto aceptado (o el precio fijo del servicio); nunca un monto enviado por el cliente o por un modelo de IA.
- `netoPrestador = totalCliente - comisionTus - feeMercadoPago`. Nunca hardcodear tarifas de Mercado Pago; un fee desconocido es desconocido, no cero.
- Montos siempre en unidades menores enteras (`BigInt`/`bigint`), nunca `float`.
- La comisión (tasa en puntos básicos, regla y política) se congela en un snapshot al crear el cobro.

## Integridad
- Idempotencia en cada operación que crea o cambia dinero (claves por intento).
- El estado de un pago solo cambia con el webhook verificado y la consulta server-to-server al proveedor; la URL de retorno nunca confirma un pago.
- Conciliación: pagos no correlacionables se ponen en cuarentena, no se descartan en silencio.
- Reembolsos, cambios de comisión y aprobaciones solo por flujos administrativos autorizados, nunca desde el asistente.

## Activación
- Pagos reales apagados (fail closed) hasta validación explícita en sandbox y autorización del dueño.
