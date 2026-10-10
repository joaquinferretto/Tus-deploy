# Reembolsos y cancelaciones — auditoría del estado actual (2026-10-10)

> Solo auditoría. No se cambió ninguna regla, no se implementó dinero real y no se ejecutó ningún
> reembolso. Las decisiones vigentes del dueño se mantienen (ver
> `docs/TURNOS_RECORDATORIOS_Y_CANCELACION_TUS.md`).

## Qué existe hoy

| Pieza | Estado | Dónde |
| --- | --- | --- |
| Política de cancelación en dos ventanas (y su versión aceptada por el cliente al pagar) | Implementada | `packages/contracts/src/tus-turnos.ts`, `apps/api/src/tus/calendar/turnos-service.ts` |
| Cálculo de cuánto correspondería devolver y cuánto se retiene (penalización, cargo de TUS) | Implementado: se **calcula y se registra** en cada cancelación | `turnos-service.ts` (desglose de la cancelación) |
| Confirmación explícita del cliente cuando cancelar le hace perder dinero | Implementada | `cancelarTurnoCliente` (`confirmaPerdida`) |
| Cancela el prestador o Administración: el cliente no es penalizado | Implementado | `turnos-service.ts` |
| Comando de reembolso **total** de un pago aprobado | Implementado, solo para Administración de pagos | `POST /tus/v1/admin/payments/refunds` → `solicitarReembolso` (`finance/servicios/servicio.ts`) |
| De qué cuenta sale el reembolso | De la cuenta que cobró: un pago cobrado por TUS se reembolsa desde la cuenta de TUS | `mercado-pago.ts` → `reembolsar` |
| Idempotencia del reembolso | Por clave obligatoria (`idempotency-key`); una clave repetida devuelve el mismo reembolso | `solicitarReembolso` |
| Reembolso rechazado por Mercado Pago | Queda visible como `requires_review`; TUS no cubre nada automáticamente | `servicio.ts` |
| Avisos `refunded` / `charged_back` de Mercado Pago | Se reciben, se verifican y se reflejan en el pago | `mercado-pago.ts` (normalización de estados) |
| Cierre: un turno con reembolso en curso o contracargo no se confirma solo | Implementado (bloqueos del cierre automático) | `work/cierre.ts`, `bloqueosDeCierre` |

## Qué NO existe (y no se implementó)

1. **Ejecución automática de la devolución.** La política dice cuánto corresponde; nadie devuelve el dinero. Hoy una cancelación con derecho a devolución termina con el importe **calculado y registrado**, y la devolución real depende de que Administración use el comando de reembolso.
2. **Reembolso parcial.** El único reembolso que existe devuelve el pago **entero**. Dos casos de la política (período de gracia y total cancelado en la regla intermedia) son devoluciones parciales: no se pueden ejecutar tal cual con lo que hay.
3. **Destino de la penalización retenida.** Queda retenida y registrada. No se libera al prestador ni se contabiliza como ingreso de TUS.
4. **Cargo de TUS cuando cancela el prestador.** No está definido si se le devuelve al cliente o lo absorbe TUS.
5. **Alojamientos.** No tienen pago online: no hay nada que reembolsar ni penalizar ahí.

## Decisiones que siguen siendo del dueño

| Decisión | Por qué no la tomó un agente |
| --- | --- |
| ¿La devolución se dispara sola al cancelar, o la aprueba Administración caso por caso? | Mueve dinero real y define responsabilidad ante errores |
| ¿Se implementa el reembolso parcial contra Mercado Pago? | Cambia cómo se concilia cada pago y su comisión |
| ¿La penalización retenida va al prestador, a TUS o se reparte? | Es política financiera |
| ¿Quién absorbe el cargo de TUS cuando cancela el prestador? | Es política financiera |
| ¿Qué pasa con la comisión de Mercado Pago de un pago reembolsado? | Depende de lo que Mercado Pago devuelva en cada caso; hay que verlo con un reembolso real |

## Riesgos a tener presentes hasta decidir

- Un cliente con derecho a devolución no la recibe sola: hay que mirar las cancelaciones con importe a devolver y reembolsar a mano desde Administración. No hay hoy una lista dedicada en Admin de "cancelaciones con devolución pendiente".
- El reembolso total devuelve más de lo que la política indica en los casos parciales. Usarlo en esos casos es una decisión consciente de devolver de más.
- El reembolso nunca se probó con dinero real en producción.

## Qué se recomienda como siguiente paso (cuando haya decisión)

1. Decidir las cinco preguntas de arriba.
2. Agregar en Admin la lista de cancelaciones con devolución pendiente (solo lectura).
3. Implementar el reembolso parcial y probarlo en sandbox.
4. Probar un reembolso real barato, aparte de la primera prueba de pago (`docs/PRUEBA_PAGO_REAL_TUS.md`).
