# Roadmap de TUS

> **Fuente canonica de estado.** Ultima actualizacion: 2026-09-16. Build actual: `WEB-04D2`. Commit:
> `65df852` más el ajuste actual de modalidades y concurrencia.

## Estado de fases

| Fase     | Estado                | Evidencia                                                                        |
| -------- | --------------------- | -------------------------------------------------------------------------------- |
| WEB-01   | Completada            | Workspace Web preparado en `e263a39`.                                            |
| WEB-02   | Completada            | Mercado de servicios en `e9e72b2`.                                               |
| WEB-03   | Completada            | Compromisos de cliente en `a75497f`.                                             |
| WEB-04   | Completada            | Calendario y reservas Web en `d659e85`; mantiene flujo legacy.                   |
| WEB-04D1 | Schema/migración preparada | Modelo Prisma/DB y migración en `29e8977`; aplicación física al target pendiente. |
| WEB-04D2 | Ajuste backend entregado | Disponibilidad y reserva canónicas por `listingId`; base `65df852`, modalidades físicas y concurrencia alineadas. |

## WEB-04D2 entregado

- `Publicacion` es la identidad canónica de un servicio.
- Discovery expone `calendarId`, modalidad y `availabilityStatus` solo según la agenda principal real.
- Agenda principal se resuelve por `(tenantId, prestadorId)`.
- `turno_fijo`, `visita_diagnostico`, `duracion_estimada`, `requiere_presupuesto` y modalidades de precio físicas tienen reglas explícitas, con aliases legacy.
- `NOT_CONFIGURED`, `BUDGET_REQUIRED` y `CALENDAR_MISMATCH` bloquean acciones no verificables.
- Booking persiste `publicacion_id` usando el campo existente y conserva aliases legacy.
- Contratos, schemas, adapters, auditoría, outbox e idempotencia quedaron alineados; el adapter Prisma usa transacciones serializables con reintento.

## Siguiente fase

### WEB-04D3: conectar Web con el contrato canónico

Pendiente:

- cambiar la pantalla Web de calendario para consumir discovery y slots por `listingId`;
- eliminar la dependencia de `serviceId` en el journey nuevo sin retirar el alias legacy;
- mostrar `configured`, `not_configured`, `BUDGET_REQUIRED`, `CALENDAR_MISMATCH` y errores de capacidad de forma
  verificable y accesible;
- agregar smoke Web contra la ruta canónica sin inventar `calendarId`.

### Validación operativa posterior

Pendiente cuando exista un target autorizado:

- smoke HTTP con PostgreSQL real y descartable;
- comprobar la paridad de `publicacion_id`, `prestador_id`, unique e índices contra DER;
- validar el historial de migraciones antes de cualquier despliegue.

## Deuda y bloqueos conocidos

- `render.yaml` aún declara `prisma migrate deploy`; la política TUS exige baseline forward-only target-specific
  cuando el historial diverge.
- La suite global excede el timeout y mezcla gates no focales: seguridad del workflow, secret store Render,
  imports TypeScript sin extensión, disponibilidad de `pnpm` y smoke PostgreSQL.
- El target PostgreSQL físico no se valida sin `DATABASE_URL` y autorización de un entorno descartable.
- Las rutas TUS, provider actions, jobs y consumidores externos permanecen deshabilitados por defecto.
- El worker Python sigue siendo un scaffold bloqueado, no un consumidor productivo.

## Regla de actualización

Cada Build que cambie arquitectura, producto o dominio debe actualizar este archivo y
`docs/DECISIONES_PRODUCTO_TUS.md`, además de `ARCHITECTURE.md`, `docs/GLOSARIO_TUS.md` y la documentación DB si
corresponde. La fecha, la fase, el commit y los documentos modificados deben quedar indicados antes del commit
final.

## Documentos modificados en WEB-04D2

- `README.md` — operación y descripción de marketplace/agenda.
- `ARCHITECTURE.md` — arquitectura implementada y límites D2.
- `docs/DECISIONES_PRODUCTO_TUS.md` — decisiones D2.
- `docs/ROADMAP_TUS.md` — estado y próximos pasos.
- `docs/GLOSARIO_TUS.md` — términos de agenda y disponibilidad.
- `docs/database/DER_TUS.dbml` — valores físicos/canónicos de modalidad y nota de alcance.
- `docs/database/DICCIONARIO_DATOS_TUS.md` — semántica D2 y ausencia de delta físico.
