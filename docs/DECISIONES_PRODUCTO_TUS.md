# Decisiones de producto TUS

> **Fuente canonica de decisiones.** Una Build no puede introducir una decision de arquitectura, producto o
> dominio sin registrarla aqui. Ultima actualizacion: 2026-09-16. Build: `WEB-04D2`. Commit de referencia:
> `65df852`.

## WEB-04D2: disponibilidad y reservas por Publicacion

**Estado:** implementada en API, contracts y adapters. La migracion de la superficie Web queda pendiente.

### D2-01: Publicacion es la identidad de servicio

- `Publicacion` es la identidad comercial canónica de un servicio dentro del marketplace.
- El contrato HTTP usa `listingId` para identificarla.
- `serviceId` solo se conserva en rutas y cuerpos legacy del calendario.
- No se crea una entidad puente ni se inventa un ID alternativo.

**Razón:** discovery, disponibilidad, precio, modalidad y reserva deben referirse a la misma oferta visible.

### D2-02: Una agenda principal por Prestador y Tenant

- La agenda canónica se resuelve por `(tenantId, prestadorId)`.
- La selección exige una única agenda; ausencia, duplicidad efectiva o estado inactivo no se convierten en una
  agenda arbitraria.
- `calendarId` enviado por el cliente es una comprobación opcional: si no coincide con la agenda resuelta, la
  operación falla con `CALENDAR_MISMATCH`.

**Razón:** evita reservas cruzadas entre publicaciones, prestadores o tenants y elimina dependencia de un
`serviceId` artificial.

### D2-03: Modalidades de reserva y precio son explícitas

La frontera pública soporta únicamente:

| Campo         | Valor               | Regla                                                           |
| ------------- | ------------------- | --------------------------------------------------------------- |
| `bookingMode` | `fixed_shift`       | Requiere `durationMinutes` entero positivo.                     |
| `bookingMode` | `variable_duration` | Requiere `estimatedDurationMinutes` entero positivo.            |
| `priceMode`   | `fixed`             | Permite disponibilidad y booking automático.                    |
| `priceMode`   | `requires_budget`   | Impide slots y booking automático hasta contar con presupuesto. |

Los adapters traducen estos valores a los valores físicos históricos en español y aceptan las formas legacy
equivalentes en lectura. No se amplía el contrato con modalidades no implementadas.

### D2-04: Disponibilidad no configurada es un estado verificable

- `configured` solo se devuelve cuando existe una agenda activa del prestador.
- `not_configured` se devuelve cuando la publicación no tiene una agenda activa.
- Un item `not_configured` no expone `calendarId`.
- Consultar slots o reservar una publicación sin agenda activa falla con `NOT_CONFIGURED`.

**Razón:** la UI debe distinguir una oferta publicada de una oferta que todavía no puede reservarse.

### D2-05: Presupuesto requerido bloquea antes de generar o reservar

Cuando `priceMode` es `requires_budget`, tanto slots como booking responden `BUDGET_REQUIRED`. No se genera una
reserva provisional ni se ocupa capacidad antes de crear/aceptar un presupuesto.

### D2-06: Slot y capacidad pertenecen al calendario, duración a la Publicacion

- El slot canónico se identifica como `calendarId:listingId:start`.
- La duración efectiva se toma de la modalidad de la publicación.
- La generación considera zona horaria, horarios, excepciones, granularidad, buffer, cutoff y capacidad.
- Las reservas confirmadas ocupan capacidad solo cuando sus intervalos se superponen.

### D2-07: Persistencia sin cambio físico en D2

WEB-04D2 no agrega ni modifica tablas, columnas, índices, constraints o migraciones. Usa los campos ya existentes
del modelo WEB-04D1:

- `Publicacion.modalidadReserva`, `Publicacion.duracionEstimadaMinutos` y `Publicacion.modalidadPrecio`;
- `Calendario.prestadorId` y su unique tenant-scoped;
- `Calendario.granularidadMinutos` y `Calendario.bufferMinutos`;
- `Reserva.publicacionId`, nullable para conservar reservas legacy.

El DER y el diccionario deben registrar esta distinción: D2 cambia el uso canónico en la aplicación, no el modelo
físico.

### D2-08: Autoridad, idempotencia y evidencia

- Tenant y actor se derivan de la sesión, nunca de campos confiados del cliente.
- Booking reclama `Idempotency-Key` por tenant y verifica `requestHash`.
- Replay devuelve el resultado original; una clave reutilizada con otro hash produce `CONFLICT`.
- Reserva, auditoría y outbox se escriben dentro de la frontera transaccional del store.

## Alcance de la Build

Incluido:

- API marketplace y calendario;
- contratos TypeScript y JSON Schema;
- adapters in-memory y Prisma;
- tests focales D2;
- documentación canónica y README.

No incluido:

- migración física nueva;
- cambio de la pantalla Web legacy;
- D1 o reset de base de datos;
- activación de producción, proveedores o jobs;
- traducción breaking de `listingId`, `calendarId` o `serviceId` en payloads existentes.

## Evidencia de implementación

- Commit: `65df852`.
- Tests focales: 25/25 pass.
- Typechecks contracts/API/Web: pass.
- JSON Schemas: 98 pass, con warnings AJV no bloqueantes.
- Build API directo: pass.
- Suite global: no verde por timeout y gates independientes preexistentes; ver `docs/ROADMAP_TUS.md`.
