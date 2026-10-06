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
