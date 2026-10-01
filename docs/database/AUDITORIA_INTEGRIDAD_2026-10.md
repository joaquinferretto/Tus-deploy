# Auditoría de integridad de la base TUS (INTEGRIDAD-01, 2026-10)

Respuesta de ingeniería a la auditoría independiente de Astra sobre el estado actual de la base.
Cada hallazgo se reprodujo contra el código, `schema.prisma` y la cadena de migraciones en un
PostgreSQL 16 **descartable** (nunca `factory_local`, staging ni producción). No se rehízo el
modelo: la arquitectura general es válida y solo se corrige lo demostrado.

## 1. Inventario verificado

Medido sobre una base descartable con la cadena completa de migraciones:

| Objeto | Astra | Verificado |
|---|---|---|
| Modelos Prisma | 171 | 171 |
| Tablas físicas | 173 | 173 (`_prisma_migrations` y `RefreshTokenFamily` no tienen modelo) |
| FK | 139 | 139 |
| CHECK | 206 | 206 |
| EXCLUDE | 2 | 2 (`ex_reservas_sin_solapamiento`, `ex_reservas_alojamiento_sin_solapamiento`) |
| Índices | 579 | 579 |
| Constraints NOT VALID | 19 | 19 (14 FK de tenant, 5 CHECK) |

## 2. Clasificación de hallazgos

Estados: **confirmado** · **falso positivo** · **legacy intencional** · **ya corregido** ·
**requiere decisión de dominio**. "Evidencia" es lo observado al reproducirlo antes de corregir.

### 2.1 Alojamientos

| # | Hallazgo | Clasificación | Evidencia | Acción |
|---|---|---|---|---|
| A1 | Faltan CHECK de coordenadas, capacidad, precios, estados y modalidades | Confirmado | La base aceptó latitud 999, estado inventado, capacidad 0, precio −1, modalidad `quincena`, día de semana 9, estado de reserva `paid` | CHECK en `20261024100000` (§4) |
| A2 | La reserva puede apuntar a una unidad de otro alojamiento | Confirmado | `UPDATE reservas_alojamiento SET alojamiento_id = <otro>` aceptado | FK compuesta `(unidad_id, alojamiento_id)` |
| A3 | Reservas y bloqueos manuales coexisten | Confirmado | `crearBloqueoUnidad` bloqueó un rango con una reserva confirmada; no validaba fechas ni reservas | Bloqueo de fila por unidad en ambas operaciones; el bloqueo sobre una reserva viva responde 409 |
| A12 | (nuevo) Pago que llega para una reserva vencida | Confirmado | Se rechazaba con `INVALID_STATE` y el pago no quedaba registrado; un hold vencido que nadie había reutilizado se confirmaba | Nunca se confirma ni se asignan fechas: queda en revisión (`pago_en_revision_desde`), responde 409 `PAYMENT_REQUIRES_REVIEW` |
| A4 | Holds vencidos: disponibilidad y exclusión no coinciden | Confirmado | La búsqueda ofrecía la unidad y reservar respondía 409 hasta que alguien corriera `liberarHoldsExpirados` (nadie lo llama) | El hold vencido se expira dentro de la misma transacción que crea la reserva o el bloqueo |
| A5 | El checkout no es una integración real con Mercado Pago | Confirmado · NO IMPLEMENTADO (decidido) | `checkout-service` arma una preferencia inventada con monto 0; con token real devolvía una URL de Mercado Pago con un id que no existe | Falla cerrado sin integración real (503 `CHECKOUT_NOT_AVAILABLE`). Mercado Pago de alojamientos queda explícitamente como NO IMPLEMENTADO; nunca se simula una preferencia real |
| A6 | `slug` sin UNIQUE | Confirmado | Dos alojamientos con el mismo slug; el detalle público busca por slug | Índice único (con desduplicación determinista) |
| A7 | Integridad de propietario/cliente | Confirmado (propietario) | `propietario_id` era texto sin FK: se podía guardar una cuenta inexistente | `fk_alojamientos_propietario` → `"Account".id` (RESTRICT; NULL = administrado por la plataforma). `cliente_id` sigue sin FK: puede ser un invitado |
| A8 | Tarifas: moneda, días de semana, temporada | Confirmado | La reserva de una tarifa en USD quedó en ARS; `dias_semana` no se usaba al cotizar | Moneda de la tarifa + CHECK. El precio respeta `dias_semana` noche por noche (`cotizacion.ts`). `temporada`: ver §5 |
| A9 | Agregados de rating bajo concurrencia | Confirmado | 6 calificaciones simultáneas: `rating_cantidad = 3`, promedio 3,67 (real: 4) | Bloqueo de la fila del alojamiento dentro de la transacción |
| A10 | (nuevo) Capacidad no validada | Confirmado | Reserva de 9 personas en una unidad de 4 | Validación en el servicio |
| A11 | (nuevo) Una reserva terminada vuelve a ocupar fechas | Confirmado | Una reserva cancelada pasó a `checked_in` | Una reserva `completed`, `cancelled` o `expired` ya no cambia de estado. El resto de las transiciones (por ejemplo exigir pago antes del check-in) es decisión de dominio |

### 2.2 Tarifas de prestadores

| # | Hallazgo | Clasificación | Evidencia | Acción |
|---|---|---|---|---|
| T1 | Una tarifa puede no corresponder a un servicio ofrecido | Confirmado | Se guardó una tarifa de un servicio que el perfil no ofrece | FK compuesta a `perfil_servicios` + validación en el servicio |
| T2 | `deleteMany` + `createMany` no es atómico | Confirmado | Un guardado que falló a mitad de camino dejó al prestador sin sus tarifas | Una transacción |
| T3 | Ventana de inconsistencia bajo concurrencia | Confirmado | 6 guardados simultáneos dejaron 21 filas mezclando los 6 juegos | Bloqueo de la fila de `perfil_servicios` |

### 2.3 Turnos

| # | Hallazgo | Clasificación | Evidencia | Acción |
|---|---|---|---|---|
| U1 | La exclusión GiST protege el intervalo reservado | Confirmado (correcto) | Carrera de 6 reservas del mismo horario: 1 guardada, 5 con 409 | Sin cambios |
| U2 | Disponibilidad/buffer no protegidos | Confirmado | El descanso solo se respetaba después de una reserva, no antes; 8 de 8 pares simultáneos rompieron el descanso | Buffer simétrico en el generador único + bloqueo de la fila del calendario en todo escritor |
| U3 | Carrera al crear la agenda | Ya corregido | Dos primeros pedidos simultáneos fallaban con `uq_calendarios_tenant_prestador` | Corregido en TURNOS-AGENDA-01 |

La agenda semanal (intervalo general y por día) usa el mismo generador (`agendaDelDia`), por lo
que la corrección cubre la vista de un día, la agenda semanal y la validación de la reserva.

### 2.4 Prisma vs PostgreSQL

`prisma migrate diff` se usó **solo en modo lectura** (imprime un script; nunca se aplica).

| Diferencia | Cantidad | Clasificación |
|---|---|---|
| Tabla `RefreshTokenFamily` sin modelo | 1 | Legacy intencional: la usa el adaptador SQL de rotación de refresh tokens (`auth-security/adapters/postgres/sql`). No se borra |
| FK físicas sin relación en Prisma (14 de tenant, WhatsApp/asistente, perfiles, solicitudes) | 23 | Legacy intencional: la base las aplica; Prisma solo no las conoce. Borrarlas sería una regresión |
| Índices físicos que Prisma no declara (HNSW de `RagEmbedding`, parciales, de recuperación de outbox) | 13 | Intencional: Prisma no los expresa |
| Índices declarados en Prisma que no existen (tablas de plataforma `Tus*`, `Invitation`, `TenantRole`) | 9 | Confirmado, prioridad baja: ver P3 |
| `DEFAULT` físicos que Prisma no declara | 12 | Intencional (migraciones en SQL) |
| Nombre de índice truncado a 63 caracteres | 1 | Cosmético |
| CHECK, EXCLUDE, triggers, NOT VALID | — | Intencional: se documentan en comentarios del modelo |

Regla: `schema.prisma` describe lo que el código tipa; la cadena de migraciones es la fuente de
verdad física. Nunca se genera una migración desde `migrate diff`.

### 2.5 Geografía

| # | Hallazgo | Clasificación | Acción |
|---|---|---|---|
| G1 | `localidades.provincia` (texto) puede contradecir `provincia_id` | Confirmado | Trigger: el texto se deriva de `provincia_id` |
| G2 | Un barrio puede apuntar a una zona de otra localidad | Confirmado | FK compuesta `(zona_id, localidad_id)` |
| G3 | Alojamiento/perfil con `barrio_id` y `zona_id` independientes | Requiere decisión | Ver §5 |
| G4 | `zonas_cobertura` guarda nombres | Requiere decisión | Ver §5 |

### 2.6 Constraints NOT VALID (19)

NOT VALID no significa datos corruptos: la regla ya se aplica a toda fila nueva o modificada; solo
no se revisaron las filas históricas. Las 19 validan sin error en la base descartable.

| Grupo | Constraints | Para validar en producción |
|---|---|---|
| FK de tenant (14) | `Account`, `Session`, `TenantRole`, `TusJob`, `TusProduct`, `TusService`, `compromisos`, `facturas`, `intenciones_pago`, `movimientos_contables`, `operaciones_pos`, `prestadores`, `publicaciones`, `reservas` | Primero la consulta de huérfanos de §6 (solo lectura). Con 0 filas, migración `VALIDATE CONSTRAINT` |
| CHECK financieros (4) | `ck_instantaneas_comision_montos`, `ck_intenciones_pago_monto_no_negativo`, `ck_movimientos_contables_monto_no_negativo`, `ck_movimientos_contables_espacio_sujeto` | Igual. Los ledgers son append-only: una fila incompatible no se corrige, se documenta |
| `ck_reservas_forzado_auditado` (1) | Turnos forzados | Igual |

Las 27 constraints nuevas de esta auditoría también nacen NOT VALID por el mismo motivo: no se
puede leer producción desde este trabajo. Total tras las migraciones: 46 NOT VALID. En la base
descartable (también en la copia con datos "sucios" del estado actual) todas validan sin error;
la verificación se hizo dentro de una transacción revertida, sin dejar nada validado.

## 3. Plan priorizado

| Prioridad | Alcance | Estado |
|---|---|---|
| P1 | Turnos: buffer simétrico y serialización por calendario (U2) | Implementado |
| P1 | Tarifas de prestadores: atomicidad, concurrencia, pertenencia al servicio (T1–T3) | Implementado |
| P1 | Alojamientos: holds vencidos, reserva/bloqueo, rating, capacidad, moneda, estados, slug, CHECK, FK compuestas (A1–A4, A6, A8–A11) | Implementado |
| P1 | Checkout de alojamientos: fallar cerrado sin integración real (A5) | Implementado (la integración sigue pendiente) |
| P2 | Geografía: provincia derivada y barrio/zona (G1, G2) | Implementado |
| P1 | Decisiones de dominio resueltas: FK de propietario, precio por día de semana, pago en revisión | Implementado |
| P2 | Validar las NOT VALID | Pendiente por decisión: NO validar todavía. El diagnóstico de solo lectura está listo (§6) |
| P3 | Índices declarados en Prisma y ausentes en la base (9) | Pendiente: migración aditiva; `TusDeadLetter_tenantId_id_key` es único y exige revisar duplicados |
| P3 | Declarar en Prisma las 23 FK físicas | Pendiente: solo documentación del modelo |
| — | Decisiones de dominio (§5) | Pendiente de decisión |

## 4. Diseño de las correcciones

**Reglas en la base** (migraciones forward-only `20261024100000_tus_alojamientos_integridad` y
`20261025100000_tus_tarifas_geografia_integridad`):

- CHECK solo para invariantes que valen para cualquier escritor: rangos de coordenadas, cantidades
  positivas, precios no negativos, listas cerradas de estados y modalidades, `fin > inicio`,
  moneda ISO, días de semana 0–6, hold con vencimiento. Las reglas de negocio (estadía mínima
  contra una reserva, transiciones de estado, capacidad contra la unidad) quedan en el servicio.
- FK compuestas para proteger columnas desnormalizadas que ya existían (no se duplican datos
  nuevos): `reservas_alojamiento(unidad_id, alojamiento_id)`,
  `calificaciones_alojamiento(reserva_id, alojamiento_id)`,
  `tarifas_servicio_prestador(perfil_id, oficio_id) → perfil_servicios`,
  `barrios(zona_id, localidad_id) → zonas_ubicacion`.
- `uq_alojamientos_slug`: los duplicados existentes se resuelven de forma determinista (el más
  antiguo conserva el slug; los demás reciben un sufijo con su id).
- `localidades.provincia` pasa a ser un dato derivado: un trigger lo copia de `provincias.nombre`
  cuando hay `provincia_id`. No se elimina la columna (la usa el catálogo de servicios).

**Concurrencia en el servicio** (la base sigue siendo la última línea):

- Turnos: toda escritura de una agenda (`reservarTurno`, turno manual, turno forzado, bloqueo,
  cambio de disponibilidad) toma `SELECT … FOR UPDATE` sobre la fila de `calendarios` dentro de
  una transacción y revalida la disponibilidad adentro. `ex_reservas_sin_solapamiento` no cambia.
- Alojamientos: reserva y bloqueo toman `FOR UPDATE` sobre la fila de `unidades_alojamiento`;
  adentro se expiran los holds vencidos del rango y se verifica reserva contra bloqueo. La
  calificación toma `FOR UPDATE` sobre el alojamiento antes de recalcular el agregado.
- Tarifas: reemplazo en una transacción con `FOR UPDATE` sobre la fila de `perfil_servicios`.

No se agregaron FK a `cliente_id` (invitados), `tarifa_id` de reservas (snapshot histórico),
`propietario_id` (ver §5) ni a referencias de proveedores externos (`payment_id`, `preference_id`).

## 5. Decisiones de dominio

### 5.1 Resueltas

| Tema | Decisión | Estado |
|---|---|---|
| Propietario de un alojamiento | Relacionado con la cuenta real mediante FK | Implementado: `fk_alojamientos_propietario` (NOT VALID); el servicio responde 400 `OWNER_NOT_FOUND` |
| Zona de alojamiento/perfil | NO derivarla del barrio hasta revisar la jerarquía geográfica | Sin cambios. `barrio_id` y `zona_id` siguen independientes |
| `dias_semana` y `temporada` | No se eliminan; si existen, el precio debe respetarlos | `dias_semana` es un dato real (lo cargan la API y la Web): el precio se calcula noche por noche con la tarifa de cada día. `temporada`: ver 5.2 |
| Pago para un hold vencido | No confirmar ni asignar; queda en revisión; nunca doble reserva | Implementado: `pago_en_revision_desde`, 409 `PAYMENT_REQUIRES_REVIEW`, listado `GET /api/alojamientos/reservas/pagos-en-revision` (solo administración) |
| NOT VALID | No validar en producción todavía; primero diagnóstico | Diagnóstico listo (§6); nada validado |
| Mercado Pago de alojamientos | Permanece NO IMPLEMENTADO | 503 `CHECKOUT_NOT_AVAILABLE` con credenciales reales |
| Horario especial que amplía un día (Turnos) | Evolución posterior | No implementado |

### 5.2 `temporada` de las tarifas de alojamiento

La columna existe en el modelo y en el contrato, pero ningún código la escribe (`crearTarifa` no
la recibe) y no hay fechas de inicio/fin de una temporada en ninguna tabla. No se puede "respetar"
sin saber cuándo rige. Regla aplicada: una tarifa con `temporada` no se aplica automáticamente
(ni siquiera si el cliente la pide por id); las tarifas sin temporada son las vigentes. Para
usarla de verdad hace falta modelar las temporadas con fechas (`temporadas_alojamiento`:
alojamiento, nombre, desde, hasta) y elegir por noche la tarifa de la temporada vigente. Es
trabajo de producto pendiente; la columna no se elimina.

### 5.3 Evaluación: normalizar `zonas_cobertura`

Hoy `perfiles_publicos_prestador.zonas_cobertura` es `text[]` con nombres, validados contra el
catálogo de zonas de Corrientes en código. Lo leen el directorio (búsqueda por zona con `has`),
los conteos de administración (SQL con `unnest`), el mapa y los adaptadores de marketplace.

Riesgos de la forma actual: renombrar una zona o un barrio deja nombres huérfanos; no hay
integridad referencial; dos lugares con el mismo nombre en distintas localidades no se distinguen.

Camino propuesto, sin romper compatibilidad ni migrar a ciegas:

1. **Diagnóstico (solo lectura)**: listar los nombres de `zonas_cobertura` y `zona` que no
   coinciden con exactamente un `barrios.nombre` o `zonas_ubicacion.nombre` de la localidad del
   perfil. Sin ese resultado no se migra nada.
2. **Tabla nueva** `perfil_zonas_cobertura(perfil_id, barrio_id NULL, zona_id NULL)` con FK a
   `perfiles_publicos_prestador`, `barrios` y `zonas_ubicacion`, CHECK de "exactamente uno" y
   UNIQUE por par. Aditiva.
3. **Escritura doble**: el directorio sigue escribiendo el arreglo de nombres y además las filas
   por ID para los nombres que resuelven de forma única. Las lecturas no cambian.
4. **Backfill** solo de los nombres que el diagnóstico resolvió sin ambigüedad; el resto queda en
   el arreglo y se informa.
5. **Cambio de lecturas** (búsqueda, conteos, mapa) a la tabla por ID, con el arreglo como
   respaldo, y recién después dejar de escribir el arreglo. La columna no se elimina en esa etapa.

No se implementó: toca el directorio, la administración y dos adaptadores que hoy tienen cambios
locales del equipo sin commitear, y depende del resultado del diagnóstico del paso 1.

### 5.4 Pendientes de decisión

1. **Cliente de una reserva de alojamiento**: `cliente_id` sin FK porque puede ser un invitado.
   Se puede agregar FK a `"Account"` (NULL = invitado) con el mismo criterio que el propietario.
2. **Barrio y zona**: revisión de la jerarquía geográfica (localidad → zona → barrio) antes de
   decidir si la zona se deriva o se exige que coincida con la del barrio.
3. **Temporadas con fechas** (5.2).
4. **Bloqueo y reserva en la base**: la garantía actual es el bloqueo de fila en el servicio. Una
   garantía física (una tabla única de ocupaciones con una sola exclusión) es un rediseño.

## 6. Diagnóstico de las NOT VALID (solo lectura)

**Herramienta**: `scripts/db/diagnostico-not-valid.mjs`. Para cada CHECK o FOREIGN KEY sin
validar dice cuántas filas existentes harían fallar `VALIDATE CONSTRAINT` y muestra la clave
primaria de las primeras (nunca otras columnas). Corre dentro de una transacción `READ ONLY` que
se revierte; no valida ni modifica nada. Lee el catálogo, así que cubre también las constraints
que se agreguen después.

```
DIAGNOSTICO_DATABASE_URL=postgresql://... node scripts/db/diagnostico-not-valid.mjs [--muestra 10] [--json]
```

La variable no es `DATABASE_URL` a propósito: apuntarla a una base es una decisión explícita.
Probada en PostgreSQL 16 descartable: con filas previas a las reglas informa exactamente cuáles
(por ejemplo `alojamientos.fk_alojamientos_propietario: 2 fila(s)` con sus ids) y en una base
limpia informa las 46 como validables. **No se ejecutó contra producción.**

Las consultas equivalentes, escritas a mano, para revisar una por una. Todas deben devolver 0.

```sql
-- FK de tenant sin validar: filas huérfanas
SELECT 'Account' AS tabla, count(*) FROM "Account" a WHERE NOT EXISTS (SELECT 1 FROM "TusTenant" t WHERE t.id = a."tenantId")
UNION ALL SELECT 'Session', count(*) FROM "Session" a WHERE NOT EXISTS (SELECT 1 FROM "TusTenant" t WHERE t.id = a."tenantId")
UNION ALL SELECT 'TenantRole', count(*) FROM "TenantRole" a WHERE NOT EXISTS (SELECT 1 FROM "TusTenant" t WHERE t.id = a."tenantId")
UNION ALL SELECT 'prestadores', count(*) FROM prestadores a WHERE NOT EXISTS (SELECT 1 FROM "TusTenant" t WHERE t.id = a.tenant_id)
UNION ALL SELECT 'publicaciones', count(*) FROM publicaciones a WHERE NOT EXISTS (SELECT 1 FROM "TusTenant" t WHERE t.id = a.tenant_id)
UNION ALL SELECT 'reservas', count(*) FROM reservas a WHERE NOT EXISTS (SELECT 1 FROM "TusTenant" t WHERE t.id = a.tenant_id)
UNION ALL SELECT 'compromisos', count(*) FROM compromisos a WHERE NOT EXISTS (SELECT 1 FROM "TusTenant" t WHERE t.id = a.tenant_id)
UNION ALL SELECT 'facturas', count(*) FROM facturas a WHERE NOT EXISTS (SELECT 1 FROM "TusTenant" t WHERE t.id = a.tenant_id)
UNION ALL SELECT 'intenciones_pago', count(*) FROM intenciones_pago a WHERE NOT EXISTS (SELECT 1 FROM "TusTenant" t WHERE t.id = a.tenant_id)
UNION ALL SELECT 'movimientos_contables', count(*) FROM movimientos_contables a WHERE NOT EXISTS (SELECT 1 FROM "TusTenant" t WHERE t.id = a.tenant_id)
UNION ALL SELECT 'operaciones_pos', count(*) FROM operaciones_pos a WHERE NOT EXISTS (SELECT 1 FROM "TusTenant" t WHERE t.id = a.tenant_id);

-- CHECK sin validar
SELECT count(*) FROM instantaneas_comision WHERE NOT (monto_bruto >= 0 AND monto_comision >= 0 AND monto_neto >= 0 AND tasa_puntos_base BETWEEN 0 AND 10000);
SELECT count(*) FROM intenciones_pago WHERE monto < 0;
SELECT count(*) FROM movimientos_contables WHERE monto < 0 OR (obligacion_id IS NOT NULL) <> (entrada_id LIKE 'svc-%');
SELECT count(*) FROM reservas WHERE forzado_fuera_horario AND NOT (motivo_forzado IS NOT NULL AND length(btrim(motivo_forzado)) >= 5 AND (creado_por_admin_id IS NOT NULL OR modificado_por_admin_id IS NOT NULL));

-- Constraints nuevas de esta auditoría
SELECT count(*) FROM reservas_alojamiento r JOIN unidades_alojamiento u ON u.id = r.unidad_id WHERE u.alojamiento_id <> r.alojamiento_id;
SELECT count(*) FROM tarifas_servicio_prestador t WHERE NOT EXISTS (SELECT 1 FROM perfil_servicios s WHERE s.perfil_id = t.perfil_id AND s.oficio_id = t.oficio_id);
SELECT count(*) FROM barrios b JOIN zonas_ubicacion z ON z.id = b.zona_id WHERE z.localidad_id <> b.localidad_id;
SELECT count(*) FROM reservas_alojamiento r JOIN bloqueos_unidad_alojamiento b ON b.unidad_id = r.unidad_id AND b.fecha_inicio < r.fecha_fin AND b.fecha_fin > r.fecha_inicio WHERE r.estado IN ('confirmed', 'checked_in');
```

## 7. Pruebas

- `tests/foundation/tus-integridad-astra-postgres.test.mjs`: cada hallazgo confirmado, con
  concurrencia real, sobre PostgreSQL 16 descartable (`TUS_PERFIL_TURNOS_PG_URL`).
- Migraciones: base desde cero contra dos bases en el estado actual con datos representativos
  (incluidos slugs duplicados, tarifas mezcladas por guardados simultáneos y un rating
  desactualizado). Esquema idéntico (`pg_dump --schema-only`), segunda corrida sin cambios.
- El gate de migraciones (`reviewMigrationChain`) acepta ambas. Seis sentencias que el
  clasificador no puede decidir solo (una desduplicación, dos funciones, dos triggers y un
  backfill) quedaron registradas una por una, con su hash y su motivo, en
  `REVIEWED_MIGRATION_STATEMENTS`; no se agregó ninguna excepción genérica.

## 8. Estado de producción al momento de la auditoría (2026-10-01)

Verificado con peticiones de solo lectura y navegación real (Brave), sin escribir datos.

- API (`api.tusservicios.shop`) y Web (`tusservicios.shop`) corren el commit `27966db`, igual que
  `hostinger/main` y `deploy/main`. Nada de INTEGRIDAD-01, TURNOS-AGENDA-01, perfil/geografía ni
  el asistente Web unificado está desplegado.
- **Turnos no funciona en producción**: la Web pide la disponibilidad a su propio origen (404) y
  la API, consultada directamente, responde 500 al crear la agenda del prestador
  (`calendarios.servicio_id` es NOT NULL en producción) exponiendo el mensaje interno de Prisma.
  Lo corrigen la migración `20261022100000_tus_turnos_admin`, el cliente de turnos de la Web y el
  manejador de errores del router de turnos, todos pendientes de publicar.
- Un cuerpo JSON mal formado responde 500 en producción; en local responde 400.

