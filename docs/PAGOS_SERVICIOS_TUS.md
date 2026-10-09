# Pagos de servicios: seña, total, saldo, retención y cierre

Describe cómo se cobra un servicio en TUS (turnos y trabajos con presupuesto), cuándo el dinero
queda retirable para el prestador y cómo se cierra un trabajo. Complementa
`docs/activation-gates.md` (habilitación técnica) y `docs/PRODUCCION_TUS.md` (despliegue).

## 1. Reglas de producto

1. **Todo pago anticipado se cobra por la cuenta de plataforma de TUS.** Un pago es anticipado
   mientras el servicio no está realizado. No hay caída silenciosa a la cuenta de Mercado Pago del
   prestador: sin cuenta de plataforma configurada el cobro se rechaza con
   `PLATFORM_ACCOUNT_REQUIRED`. El split directo queda solo para pagos posteriores al servicio.
2. **Pago aprobado no es dinero retirable.** Lo cobrado por adelantado (seña, total o saldo) queda
   retenido hasta el cierre del trabajo.
3. **Seña o total.** Antes del primer pago aprobado el cliente elige pagar la seña (50 %, valor por
   defecto) o el total (100 %). Después de un pago aprobado la modalidad queda fija
   (`PAYMENT_MODALITY_FIXED`).
4. **Saldo canónico.** `saldoPendiente = totalFinal − pagosAprobadosAplicables`. Nunca es negativo,
   la suma de cobros nunca supera el total y hay una sola obligación por tramo
   (`total`, `sena`, `saldo`). El pago total genera una única obligación, sin seña ni saldo.
5. **Liberación de fondos.** Exige a la vez: trabajo realizado; confirmación del cliente o
   autoconfirmación válida; total pagado mayor o igual al total final; ninguna obligación requerida
   pendiente; ninguna liquidación congelada o revertida; ninguna observación abierta. La ausencia de
   una obligación de saldo nunca cuenta como pago.
6. **Servicios sin precio publicado.** Se presupuestan: no admiten turno donde el turno se confirma
   pagando. Nunca se inventa un precio (ver §6).

## 2. Modelo de datos

Una sola migración, aditiva: `20261113100000_tus_pagos_retencion_liberacion`.

| Objeto | Cambio |
| --- | --- |
| `liquidaciones_servicio.retencion_activa` | `boolean`, default `false`. `true` mientras el dinero está retenido. |
| `liquidaciones_servicio.liberada_en` | Instante de la liberación. CHECK `ck_liquidaciones_servicio_liberacion`. |
| `cierres_trabajo` | Tabla nueva (PK `tenant_id` + `trabajo_id`): finalización, evidencia, vencimiento de la ventana, confirmación y su origen, observación. RLS activa. |
| `ck_obligaciones_pago_estado` | Suma el estado `voided` (obligación anulada al cambiar de modalidad). |
| `ck_obligaciones_pago_tramo_cadena` | Admite `total`, `sena` y `saldo` con origen `accepted_budget` o `booked_price`. |

No reescribe datos históricos: las liquidaciones existentes quedan con `retencion_activa = false`
y siguen el circuito anterior.

## 3. Estados

- **Obligación**: `pending_payment`, `paid`, `refunded`, `charged_back`, `voided`.
- **Liquidación**: `held`, `eligible`, `frozen`, `reversed`, más `retained` y `releasedAt`.
- **Turno**: `pending` → (el prestador acepta) `awaiting_payment` → (pago verificado) `confirmed`
  → (cierre) `completed`.
- **Cierre**: finalizado por el prestador → confirmado por el cliente, autoconfirmado, u observado.

Las ganancias del prestador muestran lo retenido aparte (`heldMinor`) y un retiro nunca lo incluye.

## 4. Cierre del trabajo

1. El prestador **finaliza** con evidencia (`ServicioCierreTrabajo.finalizar`). Un turno cobrado por
   TUS no se puede marcar "completado" a mano: responde `FINALIZATION_REQUIRED`.
2. El cliente **confirma** que se realizó o **reporta un problema** (observación).
3. Sin respuesta, se **autoconfirma a las 72 horas**. El vencimiento se persiste en la base y lo
   procesa un barrido idempotente (cada 60 s en la API); no hay temporizadores en memoria.
4. La autoconfirmación no ocurre si hay: observación abierta, cancelación, solicitud de cancelación
   pendiente, reembolso o reembolso en curso, contracargo o liquidación congelada.
5. Una observación la resuelve Admin; al resolverla se reevalúan los pagos y la liberación.

## 5. Rutas HTTP

| Ruta | Uso |
| --- | --- |
| `POST /tus/v1/cliente/turnos/:id/pago/checkout` | Cuerpo: solo `tramo` (`sena`, `total`, `saldo`). El importe lo determina TUS; cualquier otro campo de pago se rechaza (`UNTRUSTED_PAYMENT_FIELDS`). |
| Checkout del trabajo (router principal) | Acepta `modalidad` (`sena` o `total`). |
| `POST /tus/v1/trabajos/:id/finalizacion` · `POST /tus/v1/prestador/turnos/:id/finalizar` | El prestador finaliza con evidencia. |
| `POST /tus/v1/trabajos/:id/confirmacion` · `POST /tus/v1/cliente/turnos/:id/confirmar` | El cliente confirma que se realizó. |
| `POST /tus/v1/trabajos/:id/observacion` · `POST /tus/v1/cliente/turnos/:id/observar` | El cliente reporta un problema. |
| `GET /tus/v1/trabajos/:id/cierre` · `GET /tus/v1/turnos/:id/cierre` | Estado del cierre. |
| `GET /tus/v1/admin/payments/observations` | Observaciones abiertas. |
| `POST /tus/v1/admin/payments/observations/resolve` | Resolver una observación. |

El detalle de un turno incluye `pago` (`PagoTurnoDTO`: modalidad, total, pagado, saldo
pendiente, próximo tramo, opciones, fondos retenidos o liberados y su cierre `CierreTurnoDTO`). La Web nunca calcula una seña ni un porcentaje: muestra
los importes que devuelve la API.

## 6. Servicios sin precio (a presupuestar)

Un servicio tiene `modalidadCobro`:

- `precio_fijo`: tiene precio base o una variante con precio. Admite turno con seña o total.
- `a_presupuestar`: no tiene precio publicado; su precio sale de un presupuesto.

Donde el turno se confirma pagando, un servicio `a_presupuestar` devuelve
`requierePresupuesto: true` en la agenda semanal y en la lista de servicios, y la solicitud de turno
responde `409 SERVICE_REQUIRES_BUDGET` con la explicación. No se crea turno, orden ni obligación.

- **Web**: el formulario de turno muestra el aviso "se presupuesta", deshabilita el pedido y deriva
  a **Solicitar servicio** en el mismo perfil (solicitud → presupuesto).
- **WhatsApp y asistente Web**: explica que el servicio se presupuesta y envía el enlace al perfil
  con el botón "Pedir presupuesto".

Con los pagos en línea apagados, un servicio sin precio sigue tomando turnos como antes.

El encadenamiento turno de diagnóstico → presupuesto queda para una rama posterior.

## 7. Web y WhatsApp

- **Cliente (Mis turnos / Trabajo)**: elegir seña o total, pagar el saldo, confirmar que se realizó
  o reportar un problema.
- **Prestador**: "Finalizar turno" con evidencia; ve si los fondos están retenidos o liberados.
- **Admin → Trabajos**: observaciones abiertas y su resolución.
- **WhatsApp**: "pagar la seña", "pagar total", "pagar el saldo"; aviso de finalización con botones
  para confirmar o reportar un problema; aviso de saldo habilitado.

## 8. Comisión de TUS (`COMISION-TRABAJO-01`)

**Una sola fuente.** La comisión es la política persistida y versionada de
`politicas_comision_servicio` (alcance global; pueden existir además por categoría o por
prestador, que ganan sobre la global). No se lee de variables de entorno. Mientras nadie la
modifique rige el 10 % por defecto.

**Admin → Pagos → Comisión TUS.** Un porcentaje (0 a 100, hasta dos decimales, guardado en puntos
base enteros) y Guardar. Muestra el valor vigente, desde cuándo, quién lo modificó y el valor
anterior, y avisa si el valor es excepcionalmente alto.

- Cada cambio es una **versión nueva** (nunca se edita una existente): queda el valor, el anterior
  (la versión previa), el administrador, el motivo y la fecha.
- Dos administradores a la vez: se guarda un solo cambio; el otro recibe `VERSION_CONFLICT` y debe
  recargar.
- Ruta: `POST /tus/v1/admin/payments/commission-policies` con `{ scope: "global", rateBps,
  expectedVersion, reason, pspFeeBearer }` (ya existía).

**Instantánea por trabajo.** Cambiar la comisión no modifica ninguna operación existente. La tasa
queda congelada en `comisiones_trabajo` cuando el trabajo se contrata: al crearse su primera
obligación (el prestador acepta el turno, o se acepta el presupuesto), antes de cualquier cobro.
Se guardan la tasa, la versión de la regla, la política de origen, la base (el total del trabajo)
y el importe de comisión de esa base.

- Seña, saldo y total de un mismo trabajo se cobran con esa misma tasa. El saldo nunca se recalcula
  con una comisión global nueva.
- Cada pago además guarda la tasa y el importe que se le aplicó (como antes), y su liquidación el
  bruto, la comisión y el neto.
- La política de cancelación y los reembolsos usan esos importes históricos: el cargo de TUS de un
  turno es la comisión con la que se cobró, no la vigente.
- Un trabajo que ya tenía pagos antes de esta migración conserva la tasa de sus pagos.

Ejemplo: lunes, comisión 10 %, se contrata el turno A. Martes, Admin la cambia a 7 %. El turno A
sigue con 10 % (seña de $10.000 → $1.000; saldo de $10.000 → $1.000). El turno B, nuevo, usa 7 %.

Migración `20261115100000_tus_comision_por_trabajo`: crea `comisiones_trabajo` y reemplaza por
otras más amplias las dos restricciones que topeaban la tasa en 30 % (ahora 100 %). No toca filas.

## 9. Antes de desplegar

- Configurar `MERCADO_PAGO_PLATFORM_ACCESS_TOKEN` y `MERCADO_PAGO_PLATFORM_USER_ID`: sin ellos todo
  pago anticipado se rechaza.
- Las evidencias de lanzamiento público ya no bloquean el cobro real (ver
  `docs/activation-gates.md`): habilitar los pagos es una decisión operativa.
- Los servicios sin precio dejan de aceptar turnos donde la seña es cobrable.
- Respaldo manual verificado y ensayo de `migrate-deploy` sobre el respaldo restaurado antes de
  aplicar la migración en producción.

## Qué necesita un prestador para cobrar (PAGOS-MP-VINCULADO-01, decisión del dueño, 2026-10-09)

Para cobrar en TUS un prestador necesita únicamente:

1. su cuenta TUS activa;
2. un perfil de prestador válido;
3. su cuenta de Mercado Pago vinculada por OAuth.

TUS no hace una verificación de identidad propia (KYC/KYB) para habilitar cobros ni retiros: la verificación regulatoria del dueño de la cuenta la hace Mercado Pago. No importa si esa cuenta es de una persona, un monotributista o una empresa. El vínculo es por ids (`cuentas_cobro_prestador.prestador_tenant_id` y `cuenta_externa_id`), nunca por nombres: el nombre público del prestador puede cambiar sin tocar el vínculo.

- Regla en el código: `PoliticaCobroPersistida.disponibilidad` responde `PROVIDER_ACCOUNT_NOT_CONNECTED` si el prestador no tiene la cuenta en estado `connected`. Ya no existe el motivo `PROVIDER_IDENTITY_NOT_VERIFIED` en pagos ni `IDENTITY_NOT_VERIFIED` en retiros.
- Vinculación: `POST /tus/v1/prestador/cuenta-cobro/mercado-pago/conectar` devuelve la URL oficial de autorización (state de un solo uso + PKCE S256); Mercado Pago vuelve a `GET /tus/v1/integrations/mercado-pago/oauth/callback`; el backend canjea el código y guarda los tokens cifrados (AES-256-GCM, `TUS_PAYMENT_CREDENTIALS_KEY`). Nada de eso pasa por el navegador ni se le pide al prestador.
- Estados que se muestran: No vinculado (`not_connected`, `revoked`), Vinculado (`connected`), Requiere reconexión (`expired`, `error`).
- Auditoría: `payment_account.connected`, `payment_account.reconnected` y `payment_account.disconnected` en `AuditEvent`, con actor, estado anterior y nuevo y la cuenta de Mercado Pago enmascarada. Nunca un token.
- Para qué se usa la cuenta vinculada: (a) es el requisito para cobrar; (b) un pago hecho después de terminado el trabajo se cobra con esa cuenta (split, TUS toma su comisión como `marketplace_fee`); (c) es el destino de los retiros de ganancias.
- Lo que no cambió: una seña o un pago anticipado lo cobra TUS con su propia cuenta y lo retiene hasta el cierre del servicio; al liberarse queda como saldo del prestador en TUS. Ese saldo NO se transfiere solo: el prestador pide el retiro y la administración lo procesa (Mercado Pago Payouts si está configurado, u otro medio con su referencia).
- Identidad de TUS (PRESTADOR-SIN-KYC-01, decisión del dueño): es un dato opcional (confianza, moderación, soporte, futura insignia). No autoriza ni bloquea nada: ni crear el perfil, ni publicar, ni aparecer en búsquedas, ni recibir o aceptar solicitudes y turnos, ni cobrar, ni retirar. `identidadVerificada()` solo se lee en el directorio para mostrar la insignia, el filtro opcional "verificados" y el orden de los resultados. El módulo y su historial se conservan.
