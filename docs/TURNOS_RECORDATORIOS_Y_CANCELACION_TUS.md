# Turnos: política de cancelación y recordatorios

Identificadores en el código: `TURNOS-CANCELACION-01` y `TURNOS-RECORDATORIOS-01`.
Migración (aditiva, tres tablas nuevas): `20261114100000_tus_turnos_recordatorios_cancelacion`.

## 1. Política de cancelación

La decide el backend con su propio reloj, en el momento de cancelar. Nunca con la hora en que se
mostró una pantalla o un mensaje.

| Quién cancela | Cuándo | Qué pasa con lo pagado |
| --- | --- | --- |
| Cliente | faltan **más de 24 horas** | corresponde la devolución (`corresponde`) |
| Cliente | faltan **24 horas exactas o menos** | no es reembolsable (`no_reembolsable`); el turno queda `cancelled-late` |
| Prestador o Administración | cualquier momento | la penalización no aplica: corresponde la devolución |
| Cualquiera | sin nada pagado | `sin_pago` |

Regla: `fechaTurno - ahora <= 24 h` → cancelación tardía del cliente (`esCancelacionTardia`, en
`packages/contracts/src/tus-turnos.ts`).

- Dentro de las 24 h y con algo pagado, la API **no cancela** si el pedido no trae la
  confirmación explícita de la pérdida: responde `409 LATE_CANCELLATION_CONFIRMATION_REQUIRED` con
  el texto de la segunda confirmación. Con `confirmaPerdida: true` cancela.
- Cada cancelación queda en `cancelaciones_turno`: quién, cuándo, canal, si fue tardía, qué
  corresponde con lo pagado y la versión de la política.
- **La cancelación no mueve dinero.** La obligación sigue pagada y la liquidación sigue retenida;
  no se reembolsa ni se libera nada de forma automática. El reembolso sigue siendo el comando
  auditado de Administración. Queda pendiente de decisión del dueño qué se hace con una seña no
  reembolsable (ver §6).

### Aceptación antes de pagar

El checkout de un pago anticipado (seña o total) solo se abre si el cliente aceptó la política para
ese turno. La aceptación se guarda en `aceptaciones_politica_cancelacion`: cuenta, turno, fecha y
hora, canal (`web` o `whatsapp`) y versión del texto (`VERSION_POLITICA_CANCELACION`).

- Sin aceptación, o con otra versión: `409 CANCELLATION_POLICY_ACCEPTANCE_REQUIRED` y no se crea
  ningún checkout.
- Web: `POST /tus/v1/cliente/turnos/:id/pago/checkout` con `{ tramo, aceptaPolitica: "<versión>" }`.
- WhatsApp: antes del link, el asistente muestra el texto con los botones **Aceptar y pagar** y
  **Volver**.
- El aviso de "el prestador aceptó" ya no lleva el link de pago salvo que la política ya esté
  aceptada para ese turno.
- El saldo (posterior al servicio) no la requiere.

## 2. Recordatorios

Dos por turno confirmado y por destinatario (cliente y prestador): 24 horas y 2 horas antes.

- Cada recordatorio es una fila de `recordatorios_turno` con el instante en que vence. No hay
  temporizadores por turno ni nada en memoria.
- Un barrido (`ServicioRecordatoriosTurno.procesar`, cada 60 s dentro de la API) calcula los que
  faltan, invalida los pendientes de un turno cuya hora cambió y envía los vencidos.
- Idempotencia: índice único `turno + destinatario + tipo (+ instante del turno)`. Cada envío toma
  su fila en un solo `UPDATE` (`pending → sending`): dos procesos no mandan el mismo recordatorio y
  reiniciar la API no repite ni pierde ninguno.
- No depende de ningún modelo de IA.

Reglas:

- Solo turnos `confirmed`. Cancelado, rechazado, vencido o completado: no se envía (queda `skipped`
  con el motivo).
- Confirmado con menos de 24 h: el de 24 h no se manda tarde; el de 2 h sí, si todavía corresponde.
- Si la API estuvo caída y el de 24 h venció hace rato, se descarta cuando ya faltan 2 h o menos.
- Un invitado de la agenda del prestador (sin cuenta) no recibe; su prestador sí.
- Si no se le puede escribir a esa cuenta (sin WhatsApp vinculado, conversación tomada por un
  operador, o ventana cerrada y plantilla sin aprobar) queda registrado el motivo y no se reintenta.
- Una fila tomada por un proceso que murió antes de registrar el resultado se cierra como `failed`
  (`interrumpido`) a los 10 minutos y **no se reenvía**: el mensaje pudo haber salido.

### Ventana de 24 horas de WhatsApp

- Ventana abierta: mensaje interactivo con los dos botones.
- Ventana cerrada: **solo** la plantilla aprobada. Nunca texto libre fuera de ventana.
- Una plantilla se usa solo si está en `WHATSAPP_APPROVED_TEMPLATES`. Esa lista es configuración:
  agregar un nombre ahí antes de que Meta la apruebe hace que Meta rechace el envío.

### Botones

Cliente y prestador reciben **Confirmar asistencia** y **No puedo asistir**.

- *Confirmar asistencia* registra la respuesta.
- *No puedo asistir* **no cancela**: pregunta, con **Sí, cancelar turno** y **Volver**.
  - Cliente dentro de las 24 h con algo pagado: "Este turno comienza dentro de las próximas 24
    horas. Si cancelás ahora, la seña no será reembolsada. ¿Querés continuar?"
  - Prestador: nunca se le habla de pérdida de seña; se le avisa que al cliente le corresponde la
    devolución.
- Al confirmar, la API vuelve a evaluar las 24 horas. Si mientras tanto el turno entró en la
  ventana, pide la confirmación de la pérdida antes de cancelar.

### Auditoría

`recordatorios_turno` guarda: turno, destinatario, tipo, instante programado, estado y motivo,
vía (`plantilla` o `ventana`), plantilla, `wamid`, fecha de envío, respuesta al botón con su fecha,
quién respondió y por qué canal, y si de ahí salió una cancelación. El estado de entrega que
informa Meta queda en el mensaje (se cruza por `wamid`). No se guardan teléfonos ni secretos.

## 3. Plantillas de WhatsApp

Definición canónica: `apps/api/src/tus/asistente/plantillas.ts`. Todas son categoría **Utilidad**,
idioma **es_AR**.

| Nombre | Variables | Botones |
| --- | --- | --- |
| `turno_recordatorio_24h` | 1 nombre · 2 servicio · 3 fecha · 4 hora · 5 prestador | Confirmar asistencia · No puedo asistir |
| `turno_recordatorio_2h` | 1 nombre · 2 servicio · 3 hora · 4 prestador | Confirmar asistencia · No puedo asistir |
| `turno_recordatorio_24h_prestador` | 1 nombre · 2 servicio · 3 fecha · 4 hora · 5 cliente | Confirmar asistencia · No puedo asistir |
| `turno_recordatorio_2h_prestador` | 1 nombre · 2 servicio · 3 hora · 4 cliente | Confirmar asistencia · No puedo asistir |
| `continuar_atencion_tus` | 1 nombre | Continuar atención |

Cuerpos:

- `turno_recordatorio_24h`: `Hola, {{1}}. Te recordamos que mañana tenés un turno de {{2}} el {{3}} a las {{4}} con {{5}}. Como se informó al reservar, desde este momento la seña no es reembolsable si cancelás el turno.`
- `turno_recordatorio_2h`: `Hola, {{1}}. Te recordamos que tu turno de {{2}} es hoy a las {{3}} con {{4}}. Si cancelás ahora, la seña abonada no es reembolsable.`
- `turno_recordatorio_24h_prestador`: `Hola, {{1}}. Te recordamos que mañana tenés un turno de {{2}} el {{3}} a las {{4}} con {{5}}.`
- `turno_recordatorio_2h_prestador`: `Hola, {{1}}. Te recordamos que tu turno de {{2}} es hoy a las {{3}} con {{4}}.`
- `continuar_atencion_tus`: `Hola, {{1}}. Queremos continuar con tu solicitud en TUS. Respondé este mensaje y seguimos con la atención por acá.`

Ejemplos para Meta: Joaquin · Masaje · 9 de octubre · 15:00 · Flor Perez.

El prestador tiene su propio par porque una plantilla es texto fijo: las del cliente mencionan la
seña, que nunca es asunto del prestador.

La plantilla del cliente menciona la seña aunque ese turno no tenga nada pagado (el texto de una
plantilla no se puede condicionar). Con la ventana abierta el mensaje sí se adapta.

## 4. Scripts de Meta

Usan la configuración que ya usa la API (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WABA_ID`,
`WHATSAPP_GRAPH_API_VERSION`, `WHATSAPP_APPROVED_TEMPLATES`) y no imprimen credenciales.

```
node scripts/meta/listar-plantillas.mjs [--json]
node scripts/meta/sincronizar-plantillas.mjs [--solo=nombre1,nombre2] [--aplicar] [--json]
```

- `listar`: solo lectura. Estado real de cada plantilla en Meta, su id, si TUS la tiene habilitada
  y si es utilizable ahora.
- `sincronizar`: **dry-run por defecto**. Compara y dice qué haría: crear, actualizar, nada o "no
  editable ahora". Solo escribe en Meta con `--aplicar` **y** `--solo=<nombres>`.
- Crear o editar una plantilla la envía a revisión de Meta. Editar una aprobada la saca de
  "aprobada" hasta que la revisen (Meta limita a 1 edición por día y 10 por mes).
- Una plantilla en revisión no se puede editar: el script lo informa y sugiere esperar o crear una
  versión con otro nombre.
- Nunca borra plantillas ni modifica `WHATSAPP_APPROVED_TEMPLATES`.

Una plantilla es utilizable en producción solo si existe en Meta, está aprobada, coincide con la
definición de TUS (nombre, idioma, cuerpo, botones) y está en `WHATSAPP_APPROVED_TEMPLATES`.

## 5. Activación en producción

1. Aplicar la migración (con respaldo y ensayo previos, como toda migración).
2. Crear las plantillas en Meta (a mano o con `sincronizar --aplicar --solo=...`) y esperar la
   aprobación.
3. Recién aprobadas, agregar sus nombres a `WHATSAPP_APPROVED_TEMPLATES` en Hostinger:
   `turno_recordatorio_24h,turno_recordatorio_2h,turno_recordatorio_24h_prestador,turno_recordatorio_2h_prestador`
   (y `continuar_atencion_tus`, `turno_solicitud_recibida`, `servicio_urgente_disponible` cuando
   estén aprobadas).

Sin las plantillas habilitadas el barrido funciona igual: recuerda solo a quien tenga la ventana
abierta y deja registrado `requiere_plantilla` para el resto.

## 6. Decisiones pendientes del dueño

- **Destino de la seña no reembolsable.** Hoy queda retenida y marcada. Falta definir si se libera
  al prestador (menos la comisión), si queda para TUS, o si lo resuelve Administración caso por caso.
- **Devolución cuando corresponde.** Hoy queda marcada como `corresponde` y la ejecuta
  Administración con el reembolso existente. Falta definir si debe ser automática.
- **Pago total cancelado tarde.** El texto dice que no se devuelve ningún monto; no existe el
  reembolso parcial.
