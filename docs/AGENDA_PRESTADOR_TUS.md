# Agenda del prestador: horario habitual y ausencias

Cómo se decide qué horarios ofrece un prestador. Documento canónico.

## Estado inicial (auditoría del 2026-10-06)

Ya existían el horario semanal (`reglas_calendario`), las excepciones (`excepciones_calendario`),
un motor único de franjas y un formulario de "Bloquear horario" con fecha y hora de inicio y fin.
Faltaba: impedir un bloqueo sobre un turno tomado, editar un bloqueo, y una forma simple de cargar
un día completo o unas vacaciones. No se creó ninguna tabla ni un segundo calendario.

## Horario habitual

Un calendario por prestador (`calendarios`) con sus reglas por día de la semana: día, hora de
inicio y hora de fin, con la posibilidad de horario cortado. Los turnos se ofrecen uno detrás de
otro según la duración del servicio.

## Excepciones (ausencias)

Una fila de `excepciones_calendario` es un rango de instantes en que el horario habitual no
aplica. El horario semanal no se modifica.

| Tipo | Cómo se guarda |
| --- | --- |
| Día completo | De las 00:00 de ese día a las 00:00 del siguiente (hora de Argentina) |
| Franja horaria | De una hora a otra del mismo día |
| Varios días (vacaciones) | De las 00:00 del primer día a las 00:00 del día siguiente al último |

Un rango dura como máximo un año. El motivo es opcional (Vacaciones, Médico, Trámite, Personal,
Otro) y privado: solo lo ve el prestador. Un cliente ve "No disponible".

Quitar una ausencia la deja como historial (`cancelled`) y los horarios vuelven a calcularse con
el horario habitual y los turnos existentes.

## Motor de franjas

Uno solo (`agendaDelDia`, usado por `ServicioTurnos`):

```
horario habitual − ausencias − turnos tomados (con su descanso) − horarios ya pasados
```

Una franja se ofrece solo si el turno entero entra: con un servicio de 60 minutos y una ausencia
desde las 12:00, las 11:30 no se ofrecen. Lo mismo al final de la ausencia.

La Web (agenda semanal y vista del día), la reserva y el asistente (Web y WhatsApp) leen ese
motor: el asistente llama a `disponibilidadPublica` y no tiene reglas propias en el prompt.
Reservar un horario que el motor no ofrece se rechaza.

## Conflictos con turnos

- Bloquear, o mover una ausencia, sobre un turno tomado responde 409 `BLOCK_HAS_BOOKINGS` y no
  cambia nada: el turno no se cancela. Primero se reprograma o cancela el turno.
- Una solicitud todavía sin responder no impide la ausencia; al aceptarla se vuelve a mirar la
  agenda y, si quedó bloqueada, se rechaza.
- El prestador no puede cargar un turno manual sobre su propia ausencia (409 `SLOT_BLOCKED`).

## Concurrencia

Crear o editar una ausencia y tomar un turno corren con la agenda del prestador tomada (bloqueo
de fila del calendario). Un turno y una ausencia simultáneos del mismo horario: gana uno y el otro
recibe su 409. No queda un turno tomado dentro de una ausencia.

## Rutas

| Ruta | Efecto |
| --- | --- |
| `POST /tus/v1/prestador/turnos/bloquear` | Crea una ausencia (`inicio`, `fin`, `motivo` opcional) |
| `GET /tus/v1/prestador/turnos/bloqueos` | Ausencias vigentes propias |
| `PUT /tus/v1/prestador/turnos/bloqueos/:id` | Cambia rango o motivo |
| `DELETE /tus/v1/prestador/turnos/bloqueos/:id` | Quita la ausencia |

El prestador sale de la sesión; una ausencia de otro prestador responde 404. Campos de más se
rechazan. Un prestador suspendido puede leer su agenda y no puede cambiarla (403
`PROVIDER_SUSPENDED`). Admin no crea ausencias: el prestador es dueño de su disponibilidad.

## Web

En `/prestador/turnos`, debajo del horario semanal, la sección **Excepciones** lista las ausencias
("20 oct — No disponible todo el día", "14 oct — 08:00 a 12:30", "20 dic → 5 ene — No
disponible") con Editar y Quitar, y el botón **Agregar ausencia** (todo el día, unas horas o
varios días). La agenda de abajo muestra esos horarios como "No disponible".

## Validación

- `tests/foundation/tus-turnos-ausencias-postgres.test.mjs` (PostgreSQL real, incluye la carrera
  turno contra ausencia).
- `tests/foundation/tus-turnos-agenda-postgres.test.mjs`, `tus-turnos-solicitud-postgres.test.mjs`.
- `scripts/dev/alojamientos-ausencias-smoke.mjs` (navegador, 1280 y 390).
