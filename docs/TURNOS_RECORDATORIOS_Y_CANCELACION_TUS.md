# Turnos: política de cancelación y recordatorios

Identificadores en el código: `TURNOS-CANCELACION-01` y `TURNOS-RECORDATORIOS-01`.
Migración (aditiva, tres tablas nuevas): `20261114100000_tus_turnos_recordatorios_cancelacion`.

## 1. Política de cancelación

La decide el backend con su propio reloj, en el momento de cancelar. Nunca con la hora en que se
mostró una pantalla o un mensaje. Mira dos ventanas: el tiempo desde que se hizo la reserva y el
tiempo que falta para el turno.

Lo que pagó el cliente tiene dos partes, que se contabilizan por separado:

- **valor del servicio** pagado;
- **cargo de TUS**: la comisión de TUS, que va dentro de cada pago. Nunca se le devuelve a un
  cliente que cancela.

Se evalúa en este orden (la primera que aplica gana):

| # | Regla | Cuándo | Qué pasa con el servicio pagado |
| --- | --- | --- | --- |
| 1 | `ultimo_momento` | faltan **24 horas exactas o menos** para el turno | no se devuelve nada; el turno queda `cancelled-late` |
| 2 | `gracia` | pasaron **24 horas o menos desde la reserva** | se devuelve todo el servicio pagado |
| 3 | `intermedia` | cualquier otro momento | se retiene la mitad del valor del servicio; se devuelve lo pagado por encima |

- Con seña (la mitad del precio), la regla intermedia retiene la seña entera: no hay devolución.
- Con pago total, la regla intermedia devuelve la otra mitad del servicio.
- Una reserva hecha hoy para mañana cae en la regla 1: el período de gracia no la contradice.
- La penalización nunca supera lo que se pagó: cancelar no genera ningún cobro adicional (no se
  crea saldo ni otra obligación).
- Si cancela el **prestador** o **Administración** no hay penalización: corresponde devolver todo
  el servicio pagado. Queda por definir si el cargo de TUS también se devuelve o lo absorbe TUS
  (hoy se registra aparte y no se incluye en lo reembolsable).

Ejemplo, servicio de $20.000 con cargo de TUS del 10 %, reservado un lunes para el viernes:

| Caso | Servicio pagado | Cargo TUS | Se devuelve | Se retiene |
| --- | --- | --- | --- | --- |
| Seña, cancela el lunes a la noche | $9.000 | $1.000 | $9.000 | $0 |
| Seña, cancela el martes | $9.000 | $1.000 | $0 | $9.000 |
| Total, cancela el martes | $18.000 | $2.000 | $9.000 | $9.000 |
| Seña, cancela con 24 h o menos | $9.000 | $1.000 | $0 | $9.000 |
| Total, cancela con 24 h o menos | $18.000 | $2.000 | $0 | $18.000 |

Cálculo: `calcularCancelacion` en `packages/contracts/src/tus-turnos.ts` (función pura, la misma
para la API y los tests). Siempre se cumple `servicio + cargo = pagado` y
`reembolsable + penalización = servicio`; la base lo exige con un CHECK.

- Si cancelar le cuesta algo al cliente (la penalización, o al menos el cargo de TUS), la API **no
  cancela** sin su confirmación explícita: responde `409 LATE_CANCELLATION_CONFIRMATION_REQUIRED`
  con el texto y los importes de ese turno en ese momento. Con `confirmaPerdida: true` cancela.
- Cada cancelación queda en `cancelaciones_turno`: quién, cuándo, canal, regla aplicada, versión
  de la política y los importes (precio, pagado, cargo de TUS, servicio, reembolsable,
  penalización).
- **La cancelación no mueve dinero.** La obligación sigue pagada y la liquidación sigue retenida;
  no se reembolsa ni se libera nada de forma automática. El reembolso sigue siendo el comando
  auditado de Administración, que hoy solo sabe devolver el pago entero (ver §6).

### Aceptación antes de pagar

El checkout de un pago anticipado (seña o total) solo se abre si el cliente aceptó la política para
ese turno. La aceptación se guarda en `aceptaciones_politica_cancelacion`: cuenta, turno, fecha y
hora, canal (`web` o `whatsapp`) y versión del texto (`VERSION_POLITICA_CANCELACION`).

- Sin aceptación, o con otra versión: `409 CANCELLATION_POLICY_ACCEPTANCE_REQUIRED` y no se le
  entrega ningún link de pago. (La orden del turno y su pago se preparan al aceptar el prestador,
  como siempre; lo que espera a la aceptación es la entrega del link.)
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

## 6. Reprogramación de turnos (`TURNOS-REPROGRAMACION-01`)

Migración `20261116100000_tus_turnos_reprogramacion` (aditiva): `calendarios.permite_reprogramacion`
y `reservas.admite_reprogramacion` (ambas `false` por defecto) y la tabla `reprogramaciones_turno`.

**Configuración del prestador.** "Permitir reprogramación de turnos", en su agenda, apagado por
defecto. Vale para los turnos que se reserven desde ese momento: cada turno copia el valor cuando
se crea la reserva y no cambia más (el prestador no puede modificar las condiciones de un turno que
ya existe, ni para dar ni para quitar).

**Quién y cuándo.** El cliente puede mover su propio turno si:

- el turno se reservó admitiendo reprogramación;
- está confirmado;
- faltan **más de 24 horas** (con 24 exactas o menos: `RESCHEDULE_WINDOW_CLOSED`);
- no tiene nada que haga inseguro moverlo: cierre iniciado (el prestador ya lo finalizó), pago
  reembolsado o con contracargo, reembolso en curso o liquidación congelada
  (`RESCHEDULE_BLOCKED`).

El nuevo horario también debe quedar a más de 24 horas (`RESCHEDULE_TARGET_TOO_SOON`); esos
horarios directamente no se ofrecen. Todo se decide en el backend con su reloj.

**Qué es reprogramar.** No es cancelar y crear otro turno. Es la misma reserva: conserva su orden
de trabajo, cliente, prestador, servicio, pagos aprobados, seña, modalidad, comisión congelada y
política de cancelación aceptada. Solo cambian fecha, hora y franja. No se crea reembolso,
comisión, seña ni obligación.

**Disponibilidad.** El mismo motor de agenda que usa toda reserva, ignorando solo la franja que el
propio turno ocupa hoy. El cambio se hace con la agenda bloqueada y se vuelve a validar la franja
en ese momento; además la base impide dos turnos en el mismo horario. Si dos clientes eligen la
misma franja a la vez, uno la obtiene y el otro recibe "horario ocupado".

**Prestador.** No se le pide una segunda aceptación (el cliente eligió una franja que él publicó
como libre). Se le avisa con cliente, servicio, horario anterior y nuevo. Por WhatsApp el aviso
sale solo si tiene la ventana de 24 h abierta: todavía no hay plantilla para este aviso.

**Recordatorios.** Los pendientes de la fecha vieja se invalidan en la misma operación y nunca se
envían; el barrido calcula los de 24 h y 2 h para la fecha nueva.

**Cancelación posterior.** Reprogramar no penaliza y no reinicia el período de gracia: la gracia se
sigue midiendo desde la creación original de la reserva; el tiempo que falta se mide contra la
fecha nueva.

**Auditoría.** `reprogramaciones_turno`: turno, quién, canal, horario anterior y nuevo, momento y
versión de la política. Es historial: nunca se sobrescribe.

**Rutas.**

| Ruta | Uso |
| --- | --- |
| `GET` / `PUT /tus/v1/prestador/turnos/reprogramacion` | Interruptor del prestador (`{ permite }`). |
| `GET /tus/v1/cliente/turnos/:id/reprogramacion/horarios?desde=YYYY-MM-DD` | Semana de horarios a los que ese turno se puede mover. |
| `POST /tus/v1/cliente/turnos/:id/reprogramar` | Cuerpo: solo `inicio`. |

Web ("Mis turnos": botón, selector por semana y confirmación) y WhatsApp ("quiero cambiar mi
turno", lista numerada de horarios, confirmación con dos botones) usan esas mismas operaciones.

## 7. Decisiones pendientes del dueño

- **Ejecución de la devolución.** La política ya calcula cuánto corresponde devolver, pero no
  devuelve. Dos casos (gracia y total cancelado en la regla intermedia) son devoluciones
  **parciales** del pago, y el reembolso que existe solo devuelve el pago entero: hace falta
  implementar el reembolso parcial contra Mercado Pago y decidir si se dispara solo o lo aprueba
  Administración.
- **Destino de la penalización retenida.** Hoy queda retenida y registrada. Falta definir si se
  libera al prestador o queda para TUS.
- **Cargo de TUS cuando cancela el prestador.** Falta definir si se le devuelve al cliente o lo
  absorbe TUS.
