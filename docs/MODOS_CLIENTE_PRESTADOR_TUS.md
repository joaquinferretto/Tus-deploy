# Modos Cliente y Prestador

Una persona tiene UNA cuenta en TUS. Con esa cuenta puede contratar servicios (Cliente) y, si su
prestador está aprobado, ofrecerlos (Prestador), y cambiar de una experiencia a la otra sin cerrar
sesión. Estado: rama `feat/modo-cliente-prestador`, sin merge ni deploy.

## 1. Tres conceptos que no se mezclan

| Concepto | Qué es | Dónde vive |
| --- | --- | --- |
| Identidad | La cuenta. No existe "cuenta cliente" ni "cuenta prestador". | `Account` |
| Capacidades | Lo que la cuenta puede hacer de verdad. Las calcula el servidor con datos reales. | estado de la cuenta + estado del prestador |
| Modo activo | Cómo está usando TUS ahora: inicio, navegación y la vista de pantallas compartidas. | `Session.activeMode` |

El modo es contexto. No concede permisos, no cambia de quién es un recurso y no autoriza nada: cada
operación se autoriza por la capacidad real, y un modo guardado o enviado que ya no es válido se ignora.

## 2. Estados: cuenta y prestador son cosas distintas

- **Cuenta** (`Account.status`): afecta a toda la identidad. Una cuenta suspendida no resuelve
  sesión: no opera ni como Cliente ni como Prestador. Se usa solo para un bloqueo global.
- **Prestador** (`prestadores.estado`): `approved` o `suspended`. Lo cambia la administración desde
  la ficha del prestador (acción existente, auditada como `provider.admin_approved` /
  `provider.admin_suspended` con fecha y administrador). Afecta solo al lado profesional.

| Cuenta | Prestador | Cliente | Prestador |
| --- | --- | --- | --- |
| activa | no tiene | sí | no |
| activa | `approved` | sí | sí |
| activa | `suspended` | sí | no |
| suspendida | cualquiera | no | no |

Suspender al prestador no borra nada (trabajos, calificaciones, pagos, evidencias, auditoría) y se
revierte volviendo a `approved`: mismo perfil, misma cuenta, mismo historial.

En el modelo actual no existe un estado "pendiente": el alta de prestador lo deja `approved` en el
momento. Una cuenta sin prestador solo tiene el modo Cliente y sigue viendo la entrada para darse de
alta como profesional.

## 3. Modos disponibles y modo activo

`availableModes` (servidor): `[CLIENT]` siempre que haya sesión; `[CLIENT, PROVIDER]` si además el
prestador de ese tenant existe y está `approved`. No se exige tener un servicio publicado.

`activeMode` de una sesión, en este orden:

1. el modo guardado en la sesión, si sigue disponible;
2. si la sesión estaba en `PROVIDER` y ya no puede: `CLIENT`, con el aviso `provider_unavailable`;
3. con un solo modo disponible: `CLIENT`;
4. con los dos: `Account.lastMode` si sigue disponible; si no, `null` (la Web pregunta).

Lo resuelto se guarda en la sesión, para que otra sesión de la misma cuenta no la mueva.

- `Session.activeMode`: modo de ESA sesión. `Account.lastMode`: preferencia para el próximo
  ingreso. Columnas anulables, sin backfill (migración `20261106100000_tus_modo_cliente_prestador`).

## 4. API

- `GET /auth/session` → `capabilities.availableModes`, `activeMode`, `providerStatus`
  (`none` | `approved` | `suspended`) y `modeNotice`. `capabilities.provider` es verdadero solo para un
  prestador aprobado.
- `POST /auth/session/mode` con cuerpo cerrado `{ "mode": "CLIENT" | "PROVIDER" }`. Cuenta, tenant y
  sesión salen de la sesión. Respuestas: 200 con los modos; 422 `INVALID_MODE` o `INVALID_REQUEST`
  (campo desconocido); 403 `MODE_NOT_AVAILABLE` (pide `PROVIDER` sin capacidad); 401 sin sesión.
- **Prestador suspendido**: toda escritura sobre `/tus/v1/prestador/*` y `/tus/v1/provider/*`, y
  tomar trabajo nuevo (`/work/commitments/:id/accept`), responde 403 `PROVIDER_SUSPENDED`. Las
  lecturas (historial, ganancias) y todo lo que la misma persona hace como cliente siguen
  funcionando. Postularse a solicitudes ya exigía prestador aprobado (`PROVIDER_NOT_AVAILABLE`).

Qué depende de qué: las operaciones dependen SIEMPRE de la capacidad real. Del modo activo dependen
solo la navegación, el inicio y la vista de `/trabajos`.

## 5. Web

- **Ingreso**: la administración va a su panel, como siempre. Una cuenta con un solo modo entra como
  Cliente. Con los dos modos: si hay un último modo válido entra directo; si no, `/elegir-modo`
  ("¿Cómo querés usar TUS?"), sin volver a pedir la contraseña.
- **Menú de cuenta** (escritorio: desplegable "Mi cuenta" con el modo; móvil: dentro del menú, con
  "Modo actual"): Mi cuenta, "Cambiar a modo cliente / prestador" solo si la cuenta tiene ambos,
  "Perfil de prestador suspendido" cuando corresponde, Cerrar sesión.
- **Cambio de modo**: pide el modo a la API y, si lo acepta, carga el inicio de ese modo
  (`/` o `/prestador/solicitudes`). No cierra sesión.
- **Navegación por modo** (`accountLinks`): Cliente → Mis solicitudes, Mis turnos, Mis trabajos, Mi
  perfil. Prestador → Solicitudes, Agenda, Trabajos, Servicios y perfil, Pagos y ganancias, Mi
  perfil, Manual. Las pantallas `/prestador/*` comparten una sola barra (`ProviderNav`).
- **`/prestador/*`**: sin sesión → ingreso; cuenta sin capacidad → inicio de Cliente (con aviso si es
  una suspensión); prestador aprobado en modo Cliente → pasa a modo Prestador (lo valida la API). No
  se dibuja nada hasta que la API respondió. La cookie de sesión es HttpOnly y del dominio de la API:
  el servidor de la Web no puede leerla, así que la redirección es del lado del navegador y la
  autoridad es la API.
- **Rutas compartidas**: `/trabajos` muestra la vista del modo activo; `/mi-perfil` es la misma.

## 6. Contratar siendo prestador

Un prestador contrata como cualquier cliente: otro oficio o su mismo oficio. Lo único bloqueado es
contratarse a sí mismo (`SELF_REQUEST`, `SELF_WORK`), que no cambia con los modos.

## 7. Administración, WhatsApp y memoria

- **Administración**: fuera del selector. Entra a su panel y conserva su navegación. No hay
  impersonación ni cambio Admin → Cliente / Prestador.
- **WhatsApp**: no usa el modo de la Web. Decide por identidad y capacidad real; una suspensión del
  prestador también le quita las acciones profesionales por ese canal.
- **Memoria conversacional**: es de la cuenta. No hay una memoria por modo.

## 8. Tests y smoke

- `tests/foundation/tus-modos-cliente-prestador.test.mjs`: resolución de modos, API de cambio,
  suspensión y reactivación, manipulación, y navegación Web por modo.
- `tests/foundation/tus-modos-cliente-prestador-postgres.test.mjs`: migración como actualización con
  datos, almacén del modo, restricciones y estado del prestador leído desde la base.
- `tests/foundation/tus-postulaciones.test.mjs` ("MODOS contratar"): otro oficio, mismo oficio,
  nunca a sí mismo, suspendido y reactivado.
- `node scripts/dev/modos-browser-smoke.mjs`: Web de producción local + API real local + PostgreSQL
  16 descartable, escritorio (1280) y móvil (390).

## 9. Limitaciones y pendientes

- **Motivo de la suspensión**: la auditoría guarda estado, fecha y administrador. No guarda un
  motivo: el registro de auditoría del mercado no tiene campo para texto libre.
- **Trabajos en curso de un prestador suspendido**: no se bloquean iniciar, completar ni registrar
  evidencia de un trabajo ya tomado, para no dejar al cliente sin cierre. Se bloquea tomar trabajo
  nuevo y toda escritura de la superficie de prestador.
- **Nombre en el menú de cuenta**: muestra "Mi cuenta" y el modo, no el nombre de la persona.
- **Estado "pendiente" de prestador**: no existe en el modelo (ver §2); no hay pantalla de
  "Continuar alta" distinta del alta actual.
- **Valores históricos de `prestadores.estado`**: solo `suspended` suspende; cualquier otro valor se
  sigue leyendo como aprobado, como hasta ahora.
