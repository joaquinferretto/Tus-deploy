# Progreso del plan maestro TUS — 2026-10-10

> Checkpoint de trabajo autónomo. Si la sesión se corta: leer este archivo y continuar desde
> **Siguiente acción exacta**. No repetir trabajo pesado ya validado salvo que el código haya cambiado.

## Estado

| Campo | Valor |
| --- | --- |
| Rama actual | `feat/experiencia-operativa-tus` (desde `main` local) |
| HEAD | ver `git log -1`; nueva validación focal y Fase 4 parcial en este checkpoint |
| Producción | `44e34fe` (API, Web y remotos). Nada de este plan está desplegado |
| `main` local | `1107b40` = `44e34fe` + merge de `feat/prestador-tipo-persona-empresa` (sin push) |
| Fase actual | Terminado lo implementable: READY FOR PRE-DEPLOY (falta respaldo nuevo + ensayo de 3 migraciones) |
| Último paso terminado | Validación final: Prisma validate/generate, typecheck, lint y builds limpios; suite completa 1375 tests, 1374 pass, 0 fail, 1 skipped; smoke de pagos 323/323 (390, 1280 y 1920) y de alojamientos 96/96; diff contra `44e34fe` auditado |
| Siguiente acción exacta | Esperar al dueño. Para pre-deploy: 1) respaldo nuevo (`TUS_BACKUP_URL` en su terminal) y ensayo de las migraciones `20261121100000`, `20261122100000` y `20261123100000` sobre él en PostgreSQL 17; 2) decidir si el fix de Mercado Pago (`fix/mercado-pago-oauth-autorizacion`) sale antes por separado; 3) mergear `feat/experiencia-operativa-tus` a `main` solo con autorización. Trabajo pendiente sin bloqueo: rama `chore/security-dependencies` (parche de `proxy-addr` primero), pantalla de calificación de alojamientos, rediseño interno de Agenda/Trabajos/Ganancias |
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
3. `20261123100000_tus_prestador_lugar_fijo` — tres columnas nullable en `perfiles_publicos_prestador` (`lugar_nombre`, `lugar_direccion`, `lugar_descripcion`) + CHECK de longitudes. Sin default ni backfill: los perfiles existentes no cambian. Ensayada en PostgreSQL 16 descartable (migrate deploy desde cero, por el runner de tests). **Pendiente de ensayo sobre un respaldo productivo nuevo.**

## Fases

| Fase | Estado | Nota |
| --- | --- | --- |
| 0 Persona física / Empresa | HECHA | Los 3 perfiles históricos quedan Empresa con su nombre (decisión del dueño). Cambio de tipo solo por Admin |
| 1 Respaldo y ensayo | PARCIAL | Ensayo hecho sobre el respaldo existente `2026-10-10T00-03-50`. **Respaldo NUEVO: bloqueado** (ver Bloqueos). Merge local a `main` hecho |
| 2 Agenda: duración vs intervalo | HECHA | Ver abajo |
| 3 Búsqueda geográfica | HECHA | `apps/api/src/tus/directorio/busqueda-geografica.ts`; 2/2. Smoke 1280/390 pasó después de permitir geolocalización solo al mismo origen |
| 4 Cobertura del prestador | HECHA (local) | Copy humano; radio solo domicilio/mixto y rechazo en modo local; consulta por barrio en directorio/asistente usa misma regla de ubicación/modalidad/zonas/radio; localidad/provincia conserva ubicación base más zonas y radio cuando existe punto de referencia |
| 5 Atiendo en un lugar | HECHA (local) | Ver "Fase 5" abajo. **PENDIENTE ENSAYO SOBRE RESPALDO PRODUCTIVO NUEVO** de la migración `20261123100000` |
| 6–9 UX/UI, panel, solicitudes, ayuda | HECHAS (local) | Ver "Fases 6 a 9" abajo |
| 10 Opiniones de turnos | HECHA (local) | Bug real confirmado y corregido: el trabajo de un turno nunca llegaba a `completed`. Ver abajo |
| 11 Rate limit auth/admin | HECHA (local) | `GET /auth/mfa/status` ya no gasta el cupo estricto; el resto igual |
| 12–13 Mercado Pago OAuth / calidad | HECHAS (local) | Fix OAuth integrado y sus tests en verde; preferencia preparada y `docs/MERCADO_PAGO_CALIDAD_100.md`. La medición real necesita un payment ID productivo |
| 14 Nosis | REVISADA, sin cambios | Rama `feat/identidad-documento-nosis-publico` en `71d3c84`, basada en `b53125f` (anterior a este plan), fuera de `main`, apagada por configuración. No se rebasó ni se hicieron consultas reales. Su migración `20261119100000` tiene fecha anterior a cuatro ya creadas: revisar el orden antes de mergearla |
| 15 Rotación de credencial DB | DOCUMENTADA | `docs/runbooks/rotacion-credencial-postgresql.md`. No ejecutada: la hace el dueño |
| 16 Dependencias | AUDITADA, sin cambios | `docs/security/AUDITORIA_DEPENDENCIAS_2026-10-10.md` (5 críticas, 47 altas; la relevante en producción es `proxy-addr`). Rama `chore/security-dependencies` NO creada |
| 17 Alojamientos | PARCIAL | Aviso por email al propietario (reserva y cancelación). Falta la pantalla de calificación. Decisiones financieras abiertas, sin tocar |
| 18–19 Prueba real / refunds | DOCUMENTADAS | `docs/PRUEBA_PAGO_REAL_TUS.md` y `docs/AUDITORIA_REEMBOLSOS_Y_CANCELACIONES_2026-10-10.md`. Nada ejecutado con dinero real |
| 20 Documentación | HECHA | `docs/EXPERIENCIA_OPERATIVA_TUS.md`, manual del prestador (`docs/conocimiento`), decisiones |

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
- Fase 4: `tus-busqueda-geografica.test.mjs` 2/2, `tus-admin-providers.test.mjs` 3/3, `tus-catalogo.test.mjs` 3/3, typecheck API. La búsqueda por barrio excluye prestadores de solo local en otro barrio y los radios insuficientes. Sin N+1 ni geocodificador nuevo.
- typecheck API y Web limpios tras Fase 2.

## Tests pendientes

- Tests existentes de turnos/agenda tras el cambio de firma interna (correr los afectados).
- Tras Fase 2: 25 archivos de turnos afectados, 94 pass / 0 fail después de corregir el orden de props en `provider-turnos.tsx`.
- Tras Fase 3 no se corrieron lint, build ni los tests existentes del directorio: hacerlo antes de seguir.
- **Actualización:** 8 archivos focales de directorio/geo/agenda = **40 pass, 0 fail, 0 skipped**, PostgreSQL 16.15 descartable, migraciones fresh aplicadas; typecheck API/Web y lint de áreas Fases 2–3 pass. Build Web pass con warnings preexistentes en archivos ajenos. Smoke focal `pagos-servicios-smoke.mjs --agenda-geografia` **46/46** en 1280/390, URL de API local y proveedor de pago ficticio. Root `.env` y `factory_local` nunca se usaron. Suite completa aún no corrida.
- Lint, build y **una** suite completa al final. Smokes de navegador al final de las fases de UI.

## Decisiones tomadas (sin consultar, reversibles)

- Persona física nueva: nace así solo si el titular tiene nombre y apellido; si no, Empresa.
- Alta de prestador por Admin con un nombre distinto al del titular: queda Empresa.
- La migración de tipo no reescribe nombres (evita depender del locale de la base para capitalizar).
- Intervalo de comienzo: por servicio, nullable, valores 15/30/45/60. El descanso (`buffer_minutos`) sigue aplicando a la ocupación.
- `Permissions-Policy: geolocation=(self)` habilita SOLO el pedido explícito "Cerca de mí" en la propia Web; `camera`, `microphone`, `payment` y demás permisos permanecen bloqueados. El navegador no persiste la ubicación.
- Perfil local no puede declarar radio de desplazamiento: el frontend lo oculta y envía null; API rechaza uno falsificado y la proyección pública no publica radios heredados en modalidad local.

## Bloqueos reales

- **Respaldo nuevo de producción**: `scripts/db/respaldo-produccion.mjs` necesita `TUS_BACKUP_URL`, que solo el dueño carga en su terminal. El agente no tiene (ni debe usar) credenciales de la base. Antes de desplegar: correr el respaldo y repetir el ensayo de las migraciones pendientes sobre él.

## Hallazgos abiertos

- Opiniones de turnos: en el cableado de tests el trabajo de un turno queda `accepted` aun pagado y confirmado (Fase 10).
- Limitador de `/auth`: 40 pedidos / 15 min por IP incluye `/auth/mfa/status` en cada carga del Admin (Fase 11).

## Fase 5 — lugar fijo de atención (LUGAR-FIJO-01)

- **Datos:** `lugar_nombre` (opcional, 2–80, sin datos de contacto), `lugar_direccion` (obligatoria al guardar el propio perfil con modalidad `local` o `mixto`, 5–160), `lugar_descripcion` (opcional, hasta 240). A domicilio no se pide nada; si el prestador vuelve a domicilio el lugar guardado se conserva y deja de entregarse.
- **Privacidad (decidida en la API):** el directorio, la búsqueda, las cards y el perfil público solo llevan `place.name`. La dirección y la indicación salen por tres lecturas únicamente: el propio prestador (`ownPlace` en `GET/PUT /tus/v1/prestador/perfil-publico`), Admin (`placeAddress` en el detalle del prestador) y el cliente dueño de un turno en estado `confirmed` (`lugarAtencion` en `GET /tus/v1/cliente/turnos`, buscado por la cuenta de la sesión). Pendiente, impago (`awaiting_payment`), rechazado, cancelado o completado: sin dirección.
- **Estado canónico:** `confirmed` (el turno se confirma al acreditarse la seña o el total).
- **Compatibilidad:** un perfil histórico `local` sin dirección sigue publicándose y recibiendo turnos; Admin puede editarlo sin dirección; su próximo guardado propio la pide.
- **No hecho:** la dirección no se incluye en los avisos de WhatsApp/email de turno confirmado (el cliente la ve en Mis turnos). No hay geocodificación de la dirección: el punto del mapa sigue siendo el de Prestador → Ubicación.
- **Aserciones viejas actualizadas (con comentario):** `tus-provider-location.test.mjs` (el modelo del perfil ahora admite las columnas `lugar*`; la dirección de la identidad sigue fuera) y los perfiles `local`/`mixto` de dos tests, que ahora envían dirección.

## Fases 6 a 9 — pantallas

- **Anchos (UX-ANCHO-01):** `apps/web/src/features/layout/layout.module.css` define `contained` (800), `wide` (1180) y `dashboard` (1680), `cardGrid`, `split`, `tabs` y `empty`. Lo usan el panel de prestador, Mis solicitudes, Trabajos (dashboard), Mi perfil público y Mis turnos (wide). Esas pantallas no muestran el footer público (`SitePage footer={false}`).
- **Panel de prestador:** una sola navegación en pestañas (Solicitudes, Agenda, Trabajos, Servicios y perfil, Ganancias, Ubicación; el manual al costado). Dentro del panel el encabezado no repite esos enlaces. Las rutas no cambiaron.
- **Solicitudes:** tarjetas con el solicitante primero, grilla que usa el ancho, estados vacíos breves, urgencias en un panel al costado. Las fotos del cliente (hasta 2) ya existían y estaban validadas: no se tocó el almacenamiento.
- **Ayuda:** en escritorio, índice fijo al costado y portadas en dos columnas; el texto conserva su ancho de lectura.
- **Medido en el smoke** a 390, 1280 y 1920 (el panel mide 1280 px a 1280 y 1680 px a 1920; sin desborde en ninguna).
- **No hecho:** Admin y Alojamientos no se rediseñaron (ya usaban el ancho). El contenido interno de Agenda, Trabajos y Ganancias no se reorganizó más allá del ancho y la navegación. Es un primer pase de estructura, no el rediseño visual completo que pide la Fase 6/7.
- **Aserciones viejas actualizadas:** `tus-prestador-pagos.test.mjs` (la pestaña se llama "Ganancias").

## Fase 10 — opiniones de turnos

- **Bug confirmado en el código de producción:** `work/cierre.ts` excluía a propósito a los turnos de `completarSiPagado` y `completarPorPagoFinal` exigía `in_progress`; el trabajo de un turno no tiene paso de "iniciar", así que quedaba `accepted` para siempre y `calificaciones` (y el trigger de la base) exigen `completed`. La reserva sí pasaba a `completed`.
- **Corrección:** el cierre confirmado (cliente o ventana de 72 h) con el total pago, o el saldo aprobado después del cierre, completan el trabajo del turno (transición `accepted → completed`, motivo `work.completed_after_final_payment`).
- **Tests:** `tus-opiniones-turnos-postgres.test.mjs` 2/2 y 23 archivos de cierre/trabajo/calificaciones 89/0. La liberación de dinero no cambió.
- **No verificado:** que la Web ofrezca al cliente el botón para opinar sobre un turno (la API lo admite).

## Fase 11 — límite de autenticación

Causa: `authRateLimitMiddleware` (40/15 min por IP) montado sobre el prefijo `/auth/mfa` incluía `GET /auth/mfa/status`, que cada carga del Admin consulta. `/auth/session` no estaba bajo ese límite. Ahora esa lectura se saltea (sigue bajo el límite general de 1500/15 min). Test: `tus-auth-limite.test.mjs`.

## Fase 13 — Mercado Pago, calidad

Agregado a la preferencia: `items[].description` y `payer` (email, nombre, apellido) cuando el tenant del cliente tiene una sola cuenta activa. Opcionales y apagados hasta configurarlos: `MERCADO_PAGO_ITEM_CATEGORY_ID`, `MERCADO_PAGO_STATEMENT_DESCRIPTOR`. La documentación oficial no publica la lista de criterios campo por campo: la medición real (con un payment ID productivo) dirá qué descuenta.

## Fase 17 — alojamientos

`apps/api/src/tus/alojamientos/alojamientos-avisos.ts`: email al propietario al confirmarse una reserva y al cancelarla el huésped. Sin transporte de email configurado no hay notificador. Test: `tus-alojamientos-avisos.test.mjs`. No hay aviso por "modificación de reserva" porque esa operación no existe.
