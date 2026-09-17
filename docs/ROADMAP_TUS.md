# Roadmap de TUS

> **Fuente canonica de estado.** Ultima actualizacion: 2026-09-17. Build actual: `WEB-04D3`. Commit base:
> `5f56c84`; commit objetivo: `feat(web): usar agenda del prestador en servicios`.

## Estado de fases

| Fase     | Estado                | Evidencia                                                                        |
| -------- | --------------------- | -------------------------------------------------------------------------------- |
| WEB-01   | Completada            | Workspace Web preparado en `e263a39`.                                            |
| WEB-02   | Completada            | Mercado de servicios en `e9e72b2`.                                               |
| WEB-03   | Completada            | Compromisos de cliente en `a75497f`.                                             |
| WEB-04   | Completada            | Calendario y reservas Web en `d659e85`; mantiene flujo legacy.                   |
| WEB-04D1 | Schema/migración preparada | Modelo Prisma/DB y migración en `29e8977`; aplicación física al target pendiente. |
| WEB-04D2 | Ajuste backend entregado | Disponibilidad y reserva canónicas por `listingId`; base `5f56c84`, modalidades físicas y concurrencia alineadas. |
| WEB-04D3 | Completada | Discovery, slots, booking y checkout de servicios consumen el contrato canónico; sin delta físico. |

## WEB-04D2 entregado

- `Publicacion` es la identidad canónica de un servicio.
- Discovery expone `calendarId`, modalidad y `availabilityStatus` solo según la agenda principal real.
- Agenda principal se resuelve por `(tenantId, prestadorId)`.
- `turno_fijo`, `visita_diagnostico`, `duracion_estimada`, `requiere_presupuesto` y modalidades de precio físicas tienen reglas explícitas, con aliases legacy.
- `NOT_CONFIGURED`, `BUDGET_REQUIRED` y `CALENDAR_MISMATCH` bloquean acciones no verificables.
- Booking persiste `publicacion_id` usando el campo existente y conserva aliases legacy.
- Contratos, schemas, adapters, auditoría, outbox e idempotencia quedaron alineados; el adapter Prisma usa transacciones serializables con reintento.

## WEB-04D3 completada

- El detalle de una publicación usa discovery para decidir si la agenda está `configured`, `not_configured` o bloqueada
  por `BUDGET_REQUIRED`.
- La agenda consulta slots por `listingId` y el booking canónico conserva `calendarId` solo como comprobación opcional.
- El journey de servicio ejecuta slot real → booking → checkout con `slotStart`/`slotEnd` del servidor.
- Los productos mantienen checkout directo; el journey nuevo no usa `serviceId` ni fechas sintéticas.
- El calendario legacy continúa disponible solo para consumidores explícitos.
- Cambiar o refrescar una franja invalida la intención anterior; checkout conserva el intervalo confirmado por booking.

Evidencia de cierre:

- tests Web D3/UX 34/34, D2/marketplace 20/20 e integración catálogo/calendario/UI 22/22;
- typechecks Contracts, API y Web, builds Contracts/API y 98 JSON Schemas correctos;
- build Web completo con standalone deshabilitado por la limitación de symlinks `EPERM` de Windows;
- smoke Web HTTP 200 en `/`, `/tus/mercado` y `/tus/mercado/listing-smoke`;
- commit objetivo `feat(web): usar agenda del prestador en servicios`, sin push.

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

## Documentos modificados en WEB-04D3

- `README.md` — journey Web canónico y límites legacy.
- `ARCHITECTURE.md` — arquitectura Web implementada y límites D3.
- `docs/DECISIONES_PRODUCTO_TUS.md` — decisiones D2 y D3.
- `docs/ROADMAP_TUS.md` — estado y evidencia de D3.
- `docs/GLOSARIO_TUS.md` — términos de agenda y disponibilidad.
- `docs/database/DICCIONARIO_DATOS_TUS.md` — ausencia de delta físico D3.
