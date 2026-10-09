# Alojamientos en TUS

Buscar, reservar y administrar alojamientos con la misma cuenta TUS. Documento canónico del módulo.

## Estado inicial (auditoría del 2026-10-06)

| Parte | Qué había | Estado |
| --- | --- | --- |
| Modelo (`alojamientos`, unidades, tarifas, bloqueos, reservas, calificaciones) | Completo, con exclusión anti-solape en PostgreSQL | Útil, se reutiliza |
| Búsqueda y detalle públicos | Filtraban en la API por fechas, huéspedes, tipo y precio | Útil; sin validar fechas y exponían dueño, dirección y GPS exactos |
| Reserva | Hold de 15 minutos + pago | El pago real nunca se integró: en producción nadie podía confirmar una reserva |
| Propietario | Rutas para unidades, tarifas, imágenes por URL y bloqueos; alta solo por Admin | Sin editar, publicar, listar lo propio ni quitar bloqueos |
| Web propietario | Pantalla que listaba todos los alojamientos públicos, con botones sin acción | Prototipo, reemplazado |
| Cliente | Sin "Mis reservas" ni cancelación | Faltaba |

## Modelo

No hay identidad de "host": el propietario es la cuenta TUS (`alojamientos.propietario_id` →
`Account`). Un alojamiento tiene unidades (lo que se reserva), cada una con tarifas y bloqueos.
El formulario del propietario maneja un lugar con una unidad ("Alojamiento completo"); el modelo
de varias unidades sigue disponible para Admin.

Migración `20261107100000_tus_alojamientos_gestion` (aditiva):

- `archivos_imagen_alojamiento`: bytes de las fotos subidas.
- `historial_reservas_alojamiento`: cada cambio de estado, con estado anterior, actor y rol.
- Índice de reservas por cliente.

## Estados

| Alojamiento | Significado |
| --- | --- |
| `borrador` | Recién creado; no se ve ni se reserva |
| `publicado` | En la búsqueda y reservable |
| `pausado` | Despublicado por el propietario |
| `suspendido` | Lo fijó la administración; solo Admin lo vuelve a publicar |

| Reserva | Significado |
| --- | --- |
| `confirmed` | Reserva hecha; ocupa sus fechas |
| `checked_in` | El propietario registró el ingreso |
| `completed` | Estadía terminada |
| `cancelled` | Cancelada (cliente, propietario o Admin); libera las fechas |
| `pending_payment` / `expired` | Solo el flujo de hold + pago, hoy sin uso en producción |

Una reserva terminada o cancelada no vuelve a un estado que ocupe fechas.

## Decisión: reserva inmediata, sin pago online

Una cuenta con sesión reserva y la reserva queda `confirmed` en el momento; se paga en el
alojamiento. No hay confirmación del propietario ni checkout. El hold + pago (`/reservas/hold`,
`checkout-preference`) queda como estaba para cuando exista el cobro real: sigue cerrado en
producción. Reservar exige sesión; un visitante puede buscar y ver.

## Fechas

Una estadía son fechas de calendario (`AAAA-MM-DD`): día de entrada y día de salida, guardadas a
las 00:00 UTC de su día. Reglas, iguales en búsqueda y reserva:

- entrada anterior a la salida, al menos una noche, como máximo un año;
- ambas fechas o ninguna; fechas imposibles se rechazan;
- se puede reservar para hoy (hora de Argentina), no para el pasado;
- el día de salida de una reserva puede ser el de entrada de otra.

## Búsqueda

`GET /api/alojamientos?q=&checkIn=&checkOut=&personas=&tipoSlug=&precioMin=&precioMax=`. La API es
la autoridad: solo devuelve alojamientos publicados, con una unidad activa de capacidad suficiente,
sin reserva vigente ni bloqueo en esas fechas. `q` busca en nombre, barrio y zona, nunca en la
dirección. Con fechas, el precio mostrado es el total de la estadía.

## Disponibilidad y concurrencia

- Dos reservas vigentes de una unidad no se solapan: lo impide la restricción de exclusión
  `ex_reservas_alojamiento_sin_solapamiento`. La que pierde recibe 409 `SLOT_OCCUPIED`.
- Reservas y bloqueos de una unidad corren de a uno (bloqueo de fila de la unidad): una reserva y
  un bloqueo simultáneos de las mismas fechas nunca quedan ambos.

## Bloqueos del propietario

Un día o varios consecutivos, con motivo privado. Un bloqueo sobre una reserva vigente se rechaza
(409 `UNIT_HAS_RESERVATIONS`): primero se resuelve la reserva. Quitar el bloqueo devuelve las
fechas. Las fechas bloqueadas no aparecen en la búsqueda ni se pueden reservar (409 `UNIT_BLOCKED`).

## Precio

Montos enteros en pesos (`BigInt`), moneda ARS. El total es `noches × precio por noche`, calculado
por el backend (`cotizacion.ts`) y guardado en la reserva; un total enviado por el cliente se
rechaza como campo desconocido. Cambiar el precio retira la tarifa anterior y crea otra: las
reservas hechas conservan la suya.

## Cancelación

- Cliente: su propia reserva, hasta el día anterior a la entrada. Después, 409
  `CANCELLATION_NOT_ALLOWED`.
- Propietario o Admin: `PATCH /reservas/:id/estado`.
- Nunca se borra la fila: cambia el estado y se agrega una línea al historial con el actor. No hay
  penalidades.

## Fotos

Hasta 12 por alojamiento, JPG, PNG o WEBP de hasta 2 MB. El tipo se decide por el contenido, no por
el nombre ni el encabezado; se quita la metadata y se acotan las dimensiones, con la misma
preparación que la foto de perfil de un prestador. Los bytes se guardan en PostgreSQL y los sirve
la API. La primera foto del orden es la principal.

## Privacidad

Las respuestas públicas no llevan el propietario ni la dirección, y el punto del mapa está
corrido entre 150 y 400 metros de forma estable. La dirección exacta la ve el huésped en "Mis
reservas" mientras su reserva está confirmada, en curso o finalizada. El motivo de un bloqueo y
los datos de contacto de los huéspedes solo los ve el propietario o Admin.

## Permisos

| Operación | Quién |
| --- | --- |
| Buscar, ver detalle, fotos | Cualquiera |
| Reservar, mis reservas, cancelar la propia | Cuenta con sesión |
| Crear alojamiento propio | Cuenta con sesión (queda como propietaria) |
| Editar, publicar, fotos, bloqueos, reservas del alojamiento | Su propietario o Admin |
| Levantar una suspensión, alta para otra cuenta | Admin |

El propietario, el cliente, el estado y el total nunca se leen del cuerpo de la petición.

## Web

- `/alojamientos`: búsqueda por destino, fechas y huéspedes.
- `/alojamientos/[id]`: detalle, fechas, total y reserva.
- `/alojamientos/reservas`: mis reservas, con estado y cancelación.
- `/propietario/alojamientos`: mis alojamientos (datos y precio, fotos, disponibilidad, reservas).

## Pendiente

- Pago online: no integrado; hoy se paga en el alojamiento.
- Reseñas: el modelo y la ruta existen (solo reservas finalizadas); sin pantalla nueva en esta etapa.
- Aviso al propietario cuando entra o se cancela una reserva.
- Límite de reservas simultáneas por cuenta (hoy no hay).

## Validación

- `tests/foundation/tus-alojamientos-gestion-postgres.test.mjs` (PostgreSQL real).
- `tests/foundation/tus-alojamientos-http.test.mjs`, `-dominio`, `-cotizacion`, `-postgres`.
- `scripts/dev/alojamientos-ausencias-smoke.mjs` (navegador, 1280 y 390).

## Auditoría del 2026-10-09 y administración (ALOJAMIENTOS-ADMIN-01)

### Qué existe (fuente canónica: `main`)

| # | Tema | Estado |
| --- | --- | --- |
| 1 | Qué existe | Módulo completo en `apps/api/src/tus/alojamientos/` (servicio, gestión, rutas, entrada, cotización), contratos en `packages/contracts/src/tus-alojamientos.ts`, Web en `apps/web/src/features/alojamientos/` y este documento |
| 2 | Qué funciona | Alta por el propietario (borrador → publicado → pausado), fotos subidas, bloqueos de fechas, búsqueda y detalle públicos, reserva inmediata, "Mis reservas", cancelación, panel del propietario, historial de cada reserva |
| 3 | Qué estaba incompleto | Admin era un prototipo: listaba solo lo público y creaba alojamientos de prueba; no veía borradores, pausados, dueños ni reservas. El estado `suspendido` estaba definido y documentado pero ninguna operación lo aplicaba |
| 4 | Qué es legacy | El flujo hold + pago (`/reservas/hold`, `checkout-preference`, `simular-pago`): sigue en el código, cerrado en producción. No se toca. No hay otro código de "hotel/hospedaje/property" que adoptar: las demás coincidencias de `booking`/`reserva` son de turnos y del calendario de servicios, otro dominio |
| 5 | Modelo | `alojamientos`, `unidades_alojamiento`, `tarifas_alojamiento`, `bloqueos_unidad_alojamiento`, `reservas_alojamiento`, `historial_reservas_alojamiento`, `imagenes_alojamiento`, `archivos_imagen_alojamiento`, `calificaciones_alojamiento`, `tipos_alojamiento` |
| 6 | Endpoints | 31 rutas bajo `/api/alojamientos` + 3 nuevas de administración (abajo) |
| 7 | Pantallas | `/alojamientos`, `/alojamientos/[id]`, `/alojamientos/reservas`, `/propietario/alojamientos`, `/tus/admin/alojamientos` |
| 8 | Migraciones | `20261018100000` (concurrencia), `20261024100000` (integridad), `20261107100000` (gestión). Esta etapa no agrega ninguna |
| 9 | Tests | 6 archivos `tus-alojamientos-*` y `tus-validaciones-alojamientos` (28 tests) + smoke de navegador `scripts/dev/alojamientos-ausencias-smoke.mjs` |
| 10 | Ramas / WIP | `feat/alojamientos-y-ausencias` ya está mergeada en `main` (`2d4ad66`). Sin stashes de alojamientos |

Calendario: alojamientos NO reutiliza el motor de turnos (franjas por hora de un prestador). Una estadía son noches entre dos
fechas de calendario sobre una unidad; comparte la técnica (restricción de exclusión en PostgreSQL y bloqueo de fila) pero es
otro dominio, con sus propias tablas. Forzar el modelo de turnos sería incorrecto.

### Administración (nuevo en esta etapa)

Solo la administración de plataforma (`tus:providers:admin`, sesión elevada con MFA):

| Ruta | Qué hace |
| --- | --- |
| `GET /api/alojamientos/admin/listado?estado=&q=&pagina=&tamano=` | Todos los alojamientos en cualquier estado, con su propietario (cuenta, nombre, email), unidades y reservas vigentes. Paginado en la base. Sin dirección ni punto exacto |
| `GET /api/alojamientos/admin/reservas?estado=&pagina=&tamano=` | Las reservas de todos los alojamientos |
| `POST /api/alojamientos/:id/suspension` | `{ suspendido, motivo }`. Suspende o levanta la suspensión. Motivo obligatorio (5 a 300 caracteres) |

Suspender: el alojamiento pasa a `suspendido`, sale de la búsqueda, no admite reservas nuevas y su propietario no puede volver
a publicarlo (409 `LISTING_SUSPENDED`). **Las reservas ya hechas no cambian**: cancelarlas es una acción aparte y explícita
(`PATCH /reservas/:id/estado`), porque no hay política de penalidad ni de devolución que aplicar. Levantar la suspensión lo deja
`pausado`; volver a publicarlo es un paso del propietario o de la administración. Cada cambio queda en `AuditEvent`
(`lodging.admin_suspended` / `lodging.admin_suspension_lifted`) con administrador, alojamiento, estado anterior y nuevo, motivo
y cuenta propietaria.

Web: `/tus/admin/alojamientos` muestra Alojamientos (estado, propietario, unidades, reservas vigentes, suspender / levantar con
motivo) y Reservas (alojamiento, huésped, fechas, personas, estado, total), con filtro por estado y paginación. El alta de
alojamientos de prueba se conserva.

### Pendiente por decisión de producto (no se implementó)

- **Cobro online, seña, comisión, quién cobra y cuándo se libera.** Hoy se paga en el alojamiento. El flujo de pago existente
  sigue cerrado.
- **Política de cancelación con penalidad o devolución.** Hoy el cliente cancela hasta el día anterior, sin penalidad.
- **Qué pasa con las reservas vigentes cuando se suspende un alojamiento** (hoy: nada; se resuelven a mano).
- **Límite de reservas simultáneas por cuenta.**
- **Aviso al propietario** cuando entra o se cancela una reserva (falta definir canal y texto; por WhatsApp requiere plantilla
  aprobada en Meta).
- **Reseñas:** el modelo y la ruta existen; falta la pantalla.
