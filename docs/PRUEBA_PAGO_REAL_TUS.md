# Primera prueba de pago real — checklist

> Estado al 2026-10-10: **sin ejecutar.** Ningún agente hace pagos, retiros ni reembolsos reales.
> Esto lo hace el dueño, con dos cuentas reales (un cliente y un prestador) y montos mínimos.
> El retiro se prueba aparte, después, y no forma parte de esta prueba.

## Antes de empezar

- [ ] Producción en el commit que se quiere probar (`https://api.tusservicios.shop/version`).
- [ ] `/health` y `/ready` en 200.
- [ ] Admin → Pagos: pagos de servicios **habilitados**, cuenta de la plataforma CONFIGURADA, comisión cargada.
- [ ] Mercado Pago (panel de la aplicación): Webhooks activos para pagos, apuntando a `https://api.tusservicios.shop/tus/v1/integrations/mercado-pago/webhooks`.
- [ ] Un prestador de prueba aprobado, visible, con un servicio con turnos y un **precio bajo** (por ejemplo $200) y horarios cargados.
- [ ] Una cuenta de cliente distinta, con su perfil personal completo.
- [ ] Un medio de pago real propio en Mercado Pago, que **no** sea la misma cuenta de Mercado Pago que cobra para TUS.
- [ ] Tener a mano Admin → Pagos y los logs de Hostinger.

## Parte 1 — la seña

| Paso | Qué hacer | Qué tiene que pasar |
| --- | --- | --- |
| 1 | Cliente: pedir un turno del servicio barato | En Mis turnos: "Esperando respuesta" |
| 2 | Prestador: aceptar la solicitud | El turno pasa a "Esperando el pago"; el cliente ve el botón para pagar la seña |
| 3 | Cliente: pagar la **seña** (50%) | Se abre Mercado Pago; el cobro es a la cuenta de **TUS** |
| 4 | Volver a TUS | La vuelta sola no confirma nada: confirma el aviso firmado |
| 5 | Esperar el aviso (segundos) | Logs: aviso de Mercado Pago recibido, firma válida, resultado `applied` |
| 6 | Admin → Pagos / el turno | Intención `approved`; obligación de la seña **pagada**; turno **confirmado**; fondos **retenidos** |
| 7 | Anotar el **payment ID** de Mercado Pago | Sirve para medir la calidad de integración (`docs/MERCADO_PAGO_CALIDAD_100.md`) |

Si el paso 5 no llega: no reintentar el pago. Revisar que el webhook esté activo en el panel y los logs; el pago se puede conciliar después desde Admin.

## Parte 2 — cierre y saldo

| Paso | Qué hacer | Qué tiene que pasar |
| --- | --- | --- |
| 8 | Esperar a que pase el horario del turno | Recién ahí el prestador puede finalizarlo |
| 9 | Prestador: finalizar el turno con su evidencia | El cliente ve "Finalizado, esperando tu confirmación" |
| 10 | Cliente: confirmar que se realizó | El turno queda "Completado"; aparece el **saldo** a pagar |
| 11 | Cliente: pagar el saldo (el otro 50%) | Segundo aviso firmado, `applied` |
| 12 | Admin → Pagos | Obligación total satisfecha; seña y saldo **liberados**; comisión de TUS descontada una vez por tramo |
| 13 | Prestador → Ganancias | El saldo interno muestra lo liberado. Sin Mercado Pago vinculado dice que lo vincule **para retirar**; igual cobró |
| 14 | Cliente: dejar una opinión del turno | Se acepta una sola vez (desde esta versión el turno llega a "completado") |

## Qué NO hacer en esta prueba

- No pedir el retiro (se prueba aparte).
- No probar reembolsos ni cancelaciones con dinero real.
- No usar la conciliación manual salvo que un aviso no llegue.
- No repetir un pago "para ver": cada pago real cuesta la comisión de Mercado Pago.

## Qué anotar

Fecha y hora, commit, payment ID de la seña y del saldo, montos, comisión de Mercado Pago y de TUS vistas en Admin, y cualquier diferencia entre lo que pasó y esta tabla. Sin capturas que muestren tokens ni datos de tarjeta.

## Variante — pago total por adelantado

Igual hasta el paso 2; en el 3 elegir **pagar el total**. Después de los pasos 9 y 10 no hay saldo: la confirmación del cierre completa el turno y libera el total.
