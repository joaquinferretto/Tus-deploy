# Progreso del plan maestro TUS — 2026-10-10

> Checkpoint de trabajo autónomo. Si la sesión se corta: leer este archivo y continuar desde
> **Siguiente acción exacta**. No repetir trabajo pesado ya validado salvo que el código haya cambiado.

## Estado

| Campo | Valor |
| --- | --- |
| Rama actual | `feat/experiencia-operativa-tus` (desde `main` local) |
| HEAD | ver `git log -1` (este archivo se commitea con cada fase) |
| Producción | `44e34fe` (API, Web y remotos). Nada de este plan está desplegado |
| `main` local | `1107b40` = `44e34fe` + merge de `feat/prestador-tipo-persona-empresa` (sin push) |
| Fase actual | 3 — búsqueda geográfica del cliente |
| Último paso terminado | Fase 2: intervalo de comienzo por servicio (backend, pantalla, tests PG) |
| Siguiente acción exacta | Auditar `apps/api/src/tus/directorio/servicio.ts` (búsqueda, cobertura, `publicArea`) y `apps/web/src/features/directory/worker-directory.tsx`; diseñar los tres modos (cerca de mí 8 km / localidad / provincia) |
| Procesos vivos | ninguno (los smokes y tests son autocontenidos) |
| Archivos fuera de alcance | `opencode.json`, `odd/`, `.env`, secretos, respaldos, logs |

## Commits creados (sobre `44e34fe`)

En `feat/prestador-tipo-persona-empresa` (mergeada a `main` local):
- `f2d81ee` feat(prestadores): tipo de prestador Persona física / Empresa desde Admin
- `397da2b` test(smoke): Admin → Prestador → Tipo de prestador
- `1338e42` fix(admin): enlace a Alojamientos en el menú de Admin
- `bd2ee0b` feat(prestadores): nombre público de persona física = nombre completo del titular
- `9c0cfdd` test(smoke): nombre derivado, rechazo de la API, menú Admin → Alojamientos
- `d47fba7` fix(admin): texto de ayuda del nombre derivado
- `1107b40` merge a `main` local (tag previo: `respaldo/2026-10-10/main-antes-de-tipo-prestador`)

En `feat/experiencia-operativa-tus`: ver `git log main..HEAD`.

## Migraciones creadas (en orden; ninguna desplegada)

1. `20261121100000_tus_prestador_tipo` — columna `perfiles_publicos_prestador.tipo_prestador` + CHECK; clasifica los perfiles existentes (persona física solo si el nombre público ya es el nombre completo del titular; el resto Empresa). No reescribe nombres públicos. **Ensayada** sobre el respaldo `2026-10-10T00-03-50` en PostgreSQL 17 (96 → 97, segunda corrida limpia, ninguna otra tabla tocada, los 3 perfiles quedan Empresa con su nombre).
2. `20261122100000_tus_servicio_intervalo_inicio` — columna nullable `perfil_servicios.intervalo_inicio_minutos` + CHECK (NULL, 15, 30, 45, 60). Sin default: los servicios existentes conservan su comportamiento. Pendiente de ensayo sobre respaldo.

## Fases

| Fase | Estado | Nota |
| --- | --- | --- |
| 0 Persona física / Empresa | HECHA | Los 3 perfiles históricos quedan Empresa con su nombre (decisión del dueño). Cambio de tipo solo por Admin |
| 1 Respaldo y ensayo | PARCIAL | Ensayo hecho sobre el respaldo existente `2026-10-10T00-03-50`. **Respaldo NUEVO: bloqueado** (ver Bloqueos). Merge local a `main` hecho |
| 2 Agenda: duración vs intervalo | HECHA | Ver abajo |
| 3 Búsqueda geográfica | pendiente | |
| 4 Cobertura del prestador | pendiente | |
| 5 Atiendo en un lugar | pendiente | |
| 6–9 UX/UI, panel, solicitudes, ayuda | pendiente | |
| 10 Opiniones de turnos | pendiente | |
| 11 Rate limit auth/admin | pendiente | |
| 12–13 Mercado Pago OAuth / calidad | pendiente | Solo auditoría y documentación; sin vincular cuentas ni pagos reales |
| 14 Nosis | pendiente | Rama aparte, apagada |
| 15 Rotación de credencial DB | pendiente | Solo runbook |
| 16 Dependencias | pendiente | Rama `chore/security-dependencies` |
| 17 Alojamientos | pendiente | Solo no financiero |
| 18–19 Prueba real / refunds | pendiente | Solo checklist y reporte |
| 20 Documentación | en curso | |

## Fase 2 — auditoría y solución

Evidencia (código en `44e34fe`):
1. La duración se guarda por servicio (`perfil_servicios.duracion_minutos`, default 60) y por variante (`tarifas_servicio_prestador.duracion_minutos`); la variante manda.
2. El intervalo de comienzo **no existía como dato**. El paso era siempre `duración + descanso` (`pasoDeTurnos` en `apps/api/src/tus/calendar/agenda.ts`). No estaba fijo en 60: un servicio de 90 minutos empezaba cada 90.
3. `calendarios.granularidad_minutos` y `reglas_calendario.intervalo_minutos` existen pero son legacy: se guardan y nadie los lee.
4. Un solo generador: `agendaDelDia` (API). La Web y WhatsApp muestran lo que devuelve la API; la Web no calcula comienzos.
5. La Web no tenía ninguna pantalla para que el prestador configure la duración de un servicio (la API sí: `PUT /tus/v1/prestador/servicios/:oficioId/turnos-config`).

Solución: `perfil_servicios.intervalo_inicio_minutos` (por servicio). `NULL` = como siempre (cuando termina el anterior). Con valor, los comienzos van cada 15/30/45/60 minutos desde la apertura; el turno sigue ocupando toda su duración y un turno tomado quita todos los comienzos que pisa. Pantalla: Prestador → Agenda → "Duración y comienzo de los turnos".

## Tests ya ejecutados

- `tus-prestador-tipo-postgres.test.mjs`: 3/3 (PG).
- 100 archivos afectados por Persona/Empresa: 574 pass, 0 fail (PG).
- Smoke `pagos-servicios-smoke.mjs`: 284/284 (1280 y 390). Smoke `alojamientos-ausencias-smoke.mjs`: 96/96.
- `tus-turnos-intervalo-postgres.test.mjs`: 2/2 (PG).
- typecheck API y Web limpios tras Fase 2.

## Tests pendientes

- Tests existentes de turnos/agenda tras el cambio de firma interna (correr los afectados).
- Lint, build y **una** suite completa al final. Smokes de navegador al final de las fases de UI.

## Decisiones tomadas (sin consultar, reversibles)

- Persona física nueva: nace así solo si el titular tiene nombre y apellido; si no, Empresa.
- Alta de prestador por Admin con un nombre distinto al del titular: queda Empresa.
- La migración de tipo no reescribe nombres (evita depender del locale de la base para capitalizar).
- Intervalo de comienzo: por servicio, nullable, valores 15/30/45/60. El descanso (`buffer_minutos`) sigue aplicando a la ocupación.

## Bloqueos reales

- **Respaldo nuevo de producción**: `scripts/db/respaldo-produccion.mjs` necesita `TUS_BACKUP_URL`, que solo el dueño carga en su terminal. El agente no tiene (ni debe usar) credenciales de la base. Antes de desplegar: correr el respaldo y repetir el ensayo de las migraciones pendientes sobre él.

## Hallazgos abiertos

- Opiniones de turnos: en el cableado de tests el trabajo de un turno queda `accepted` aun pagado y confirmado (Fase 10).
- Limitador de `/auth`: 40 pedidos / 15 min por IP incluye `/auth/mfa/status` en cada carga del Admin (Fase 11).
