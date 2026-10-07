# Contacto de una cuenta desde Admin: teléfono y WhatsApp

Un administrador de plataforma puede dejar el contacto de una cuenta listo sin que la persona
reciba un código ni escriba primero por WhatsApp. La administración certifica el dato; todo queda
auditado.

## Qué se reutiliza

No hay tablas, normalizador ni resolvedor nuevos.

| Dato | Dónde vive |
| --- | --- |
| Teléfono verificado y pendiente | `Account.phoneNumber` / `phonePending` (almacén `AlmacenTelefonos`) |
| Normalización | `normalizarTelefono` de `@factory/contracts` (E.164) |
| Vínculo de WhatsApp | fila de `contactos_whatsapp` con `cuenta_vinculada_id`, `tenant_vinculado_id` y `vinculado_en`, la misma que crea la verificación por código |
| Creación del vínculo | `vincularContactoPorVerificacion` (`apps/api/src/tus/asistente/vinculacion.ts`) |
| Destinatario de los avisos | `NotificadorTurnosWhatsapp`: contactos vinculados a la cuenta |

"WhatsApp vinculado" no es un booleano: es la existencia de ese contacto vinculado a la cuenta.

## El `wa_id`

Se deriva del teléfono verificado: el E.164 sin el `+`. No se acepta desde el cuerpo de la
petición ni se inventa. Si el contacto ya existía (por ejemplo, con la forma equivalente argentina
con o sin el 9), se reutiliza esa fila en lugar de crear otra.

## Ruta

`POST /tus/v1/admin/usuarios/:id/telefono`, con sesión de administrador elevada (MFA). El actor
sale siempre de la sesión.

| `accion` | Lleva `telefono` | Efecto |
| --- | --- | --- |
| `pendiente` | sí | Guarda el número como pendiente |
| `guardar_verificar` | sí | Guarda y verifica |
| `guardar_verificar_vincular` | sí | Guarda, verifica y vincula WhatsApp |
| `verificar` | no | Verifica el número pendiente |
| `verificar_vincular` | no | Verifica el pendiente y vincula WhatsApp |
| `vincular_whatsapp` | no | Vincula el WhatsApp del teléfono verificado |
| `desvincular_whatsapp` | no | Desvincula; el teléfono sigue verificado |
| `desverificar` | no | Quita la verificación (vuelve a pendiente) y desvincula el WhatsApp de ese número |
| `quitar` | no | Quita el número: desvincula, invalida desafíos pendientes y deja la cuenta sin teléfono |

El cuerpo es cerrado: una acción fuera de la lista responde 422 `INVALID_ACTION`; cualquier campo
de más (estado, fecha, `wa_id`, actor) responde 422 `INVALID_CHANGE` con los campos sobrantes.
Cada acción es una sola transacción: si el vínculo falla, el teléfono no cambia.

Reemplazar es guardar otro número con `guardar_verificar` o `guardar_verificar_vincular`: el
WhatsApp del número anterior deja de estar vinculado a la cuenta y el número anterior queda libre.

## Conflictos

| Caso | Respuesta |
| --- | --- |
| El número es el teléfono verificado de otra cuenta | 409 `PHONE_IN_USE` |
| El WhatsApp de ese número está vinculado a otra cuenta | 409 `WHATSAPP_IN_USE` |
| Vincular sin teléfono verificado | 422 `PHONE_NOT_VERIFIED` |
| Acción sobre un número que no existe | 422 `NO_PHONE` |
| Número inválido | 422 `INVALID_PHONE` |
| Cuenta inexistente | 404 `NOT_FOUND` |
| Vinculación no disponible | 503 `UNAVAILABLE` |

Ninguna respuesta dice de qué cuenta es el número o el WhatsApp en conflicto. Dos administradores
que asignan el mismo número a cuentas distintas a la vez: gana uno, el otro recibe 409.

## Auditoría

Eventos con el administrador como actor, la cuenta como destino y el teléfono enmascarado (nunca
completo): `phone.assigned_by_admin`, `phone.verified_by_admin`, `phone.unverified_by_admin`,
`phone.removed_by_admin`, `whatsapp.linked_by_admin`, `whatsapp.unlinked_by_admin`. El contacto
registra además `whatsapp.linked` con origen `admin` y el consentimiento con procedencia
`OPERATOR_CONSOLE`.

## Ficha de la cuenta (Web)

La tarjeta Contacto muestra un solo estado y solo sus acciones:

| Estado | Acciones |
| --- | --- |
| Sin teléfono | Formulario: guardar, verificar y vincular / guardar y verificar / guardar como pendiente |
| Pendiente | Verificar y vincular WhatsApp, Verificar, Quitar número |
| Verificado, sin WhatsApp | Vincular WhatsApp, Quitar verificación, Quitar número |
| Verificado y vinculado | Desvincular WhatsApp, Quitar número |

Con un número cargado, el formulario queda plegado bajo "Reemplazar número". Las acciones que
certifican o quitan algo piden confirmación en el diálogo propio de Admin.

## Límite: quién recibe mensajes de verdad

El número vinculado por Admin es el destinatario que resuelven los avisos de turnos. Pero TUS hoy
solo envía texto libre, y Meta lo permite únicamente dentro de las 24 horas posteriores al último
mensaje de la persona. Un número que nunca escribió queda vinculado y **no recibe nada** hasta que
escriba una vez. Escribirle primero requiere plantillas aprobadas por Meta, que no están
implementadas.

## Prestadores: la cuenta detrás de cada perfil

La identidad es la cuenta. Un prestador está vinculado a UNA cuenta por id:
`prestadores.cuenta_id → "Account".id` (migración `20261109100000_tus_prestador_cuenta`, FK e
índice único: una cuenta es la de un solo prestador). Ese vínculo es el único que usan los avisos
de turnos, el email, la respuesta por WhatsApp, Admin y la auditoría
(`apps/api/src/tus/directorio/cuenta-prestador.ts`). No se elige una cuenta por antigüedad, nombre
ni email: un prestador sin vínculo, con un vínculo ambiguo o con una cuenta inactiva o de otro
titular no resuelve a nadie, no recibe avisos y Admin muestra el motivo.

El vínculo se escribe cuando una cuenta se registra como prestador y cuando Admin da de alta un
prestador para una cuenta. Los prestadores anteriores se vincularon solos únicamente donde no
había nada que elegir (un tenant con una sola cuenta y un solo prestador); el resto queda para
reconciliar a mano. `scripts/db/auditoria-prestadores.sql` (solo lectura) los lista.

En Admin, la tabla de Prestadores muestra nombre público, cuenta (nombre real y email), teléfono
y WhatsApp; la ficha separa **Cuenta asociada** de **Perfil profesional**.

| Dato | Evidencia |
| --- | --- |
| Teléfono verificado | `User.phoneNumber` con `phoneVerifiedAt` (código respondido, o certificado por Admin). Un número pendiente no cuenta |
| WhatsApp vinculado | Contacto de WhatsApp con esa cuenta en `cuenta_vinculada_id`. Tener teléfono no alcanza |
| Listo | Vinculado y con un mensaje suyo en las últimas 24 horas: recibe solicitudes con botones |
| Por plantilla | Vinculado, fuera de las 24 horas, con `turno_solicitud_recibida` aprobada |
| No recibe ahora | Vinculado, fuera de las 24 horas y sin plantilla aprobada |
| Sin cuenta vinculada | El prestador no tiene `cuenta_id`: hay que asociarle una cuenta a mano |
| Vínculo ambiguo / Cuenta inválida | Más de una cuenta vinculada en el tenant, o la vinculada no existe, no está activa o es de otro titular |

## Validación

- `tests/foundation/tus-telefono-postgres.test.mjs` (PostgreSQL real): vínculo canónico,
  idempotencia, conflictos con rollback, carrera, reemplazo, quitar, auditoría y resolución del
  destinatario de un aviso de turno dentro y fuera de la ventana.
- `tests/foundation/tus-admin-identidad.test.mjs`: contrato HTTP de la ruta.
- `tests/foundation/tus-telefono-http-web.test.mjs`: la tarjeta.
- `scripts/dev/admin-usuario-real-smoke.mjs`: navegador contra API y PostgreSQL reales, 1280 y 390.

## Aviso al prestador (ADMIN-WHATSAPP-AVISOS-01)

Admin → WhatsApp responde "¿TUS le avisó al prestador?" sin mirar logs ni Meta. Al abrir la
conversación de un cliente, cada solicitud de turno hecha desde esa conversación muestra un bloque
con el prestador, su WhatsApp enmascarado, el estado real del aviso, la hora y, si respondió,
"Aceptó" o "Rechazó". "Ver mensajes" abre la conversación del prestador con el mensaje tal como
salió y su estado.

Fuentes (no hay otra fuente de verdad):

| Qué se muestra | De dónde sale |
| --- | --- |
| Enviado / Entregado / Leído / Falló | El mensaje del aviso en la conversación del prestador (`mensajes_conversacion_whatsapp`, correlación `turno-solicitado:<reserva>`) con el estado que informa Meta por webhook |
| Se intentó enviar, sin confirmación | El mismo mensaje en `pending_send` / `unknown` |
| No enviado + motivo | `auditoria_asistente`, acción `whatsapp.appointment_notice_not_sent` (sin teléfonos) |
| Aceptó / Rechazó | Estado del turno + auditoría `turnos.solicitud_respondida` |
| Qué solicitudes son de la conversación | Confirmaciones ejecutadas de `book_appointment` de esa conversación |

"Enviado" significa que Meta aceptó el mensaje, no que llegó al teléfono: eso es "Entregado".
Nada se infiere de que la solicitud exista: sin mensaje ni registro, el aviso figura "Pendiente".

Motivos de "No enviado": `no_whatsapp_linked` (la cuenta del prestador no tiene WhatsApp
vinculado), `template_required` (fuera de la ventana de 24 h y sin plantilla aprobada),
`conversation_with_operator` (su conversación está tomada por una persona de TUS) y
`provider_without_account` (el prestador no tiene cuenta asociada).

La migración `20261111100000_tus_whatsapp_avisos_correlacion` solo agrega dos índices.

La bandeja pagina de verdad (página, tamaño, filtro y total los resuelve el backend) y su
paginación es un pie compacto del panel: una fila en escritorio, dos como máximo en 390 px. Cambiar
de página, de tamaño o de filtro conserva la conversación abierta.

Verificación: `tests/foundation/tus-admin-whatsapp-avisos-postgres.test.mjs`,
`tests/foundation/tus-admin-whatsapp-paginacion.test.mjs` y, en navegador (1280 y 390 px),
`node scripts/dev/admin-whatsapp-smoke.mjs`. Meta es un sustituto en todos: prueban el código, no
una entrega real.
