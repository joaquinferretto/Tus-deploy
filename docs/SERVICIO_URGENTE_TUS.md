# Servicio urgente (SERVICIO-URGENTE-01)

Excepción deliberada al flujo normal de TUS.

- **Flujo normal:** el cliente busca, compara y **elige** un prestador; ese prestador acepta o
  rechaza. TUS no elige por el cliente.
- **Flujo urgente:** el cliente pide atención inmediata y **autoriza a TUS a ofrecer la solicitud,
  al mismo tiempo, a todos los prestadores compatibles**. El primero que acepta queda asignado.

La difusión ocurre únicamente cuando la solicitud está marcada explícitamente como urgente
(`difusion_urgente`). Turnos y solicitudes comunes no cambian.

## Qué se reutiliza

No hay una arquitectura paralela.

| Necesidad | Qué se usa |
| --- | --- |
| La solicitud | Una fila de `solicitudes_servicio` (`urgencia = 'urgente'`, `difusion_urgente`) |
| El asignado | El prestador de esa misma fila (`prestador_id`, `estado_asignacion`) |
| El trabajo | El único trabajo de la solicitud (`uq_trabajos_solicitud`), creado por `ServicioTrabajo` en la misma transacción |
| Candidatos | `ServicioDirectorio.aptosParaUrgencia`: visibles, aprobados, de ese servicio |
| Quién es el prestador | La cuenta vinculada (`prestadores.cuenta_id`) y sus WhatsApp vinculados |
| Avisos | El notificador de WhatsApp de los turnos: botones dentro de 24 h, plantilla aprobada fuera |
| Evidencia de entrega | Los mensajes con el estado que informa Meta |
| Auditoría | `AuditEvent` (`urgentes.*`) y las transiciones del trabajo |

Lo nuevo (migración `20261112100000_tus_servicio_urgente`):

- `solicitudes_servicio`: `direccion`, `difusion_urgente`, `cierre_urgente`, `reaperturas_urgente`.
- `perfiles_publicos_prestador.acepta_urgencias` (por defecto **no**).
- `ofertas_urgentes`: una fila por candidato; también es el historial de quién aceptó y quién renunció.
- La FK `fk_trabajos_solicitud_asignada` pasa a ser diferible (sigue chequeándose al instante salvo
  en la transacción de reasignación).

## Dirección

En este flujo el prestador ve **dirección y barrio desde el primer aviso**: los necesita para
decidir. Es la única excepción a la regla de que una solicitud no lleva dirección. La dirección
nunca es pública: no sale en el mapa, ni en la lista de solicitudes abiertas, ni en ninguna vista
pública. La ven los candidatos a quienes se ofrece y la administración.

## Candidatos

Se ofrece a **todos** los que cumplen, no a una lista corta:

1. del servicio pedido, con perfil visible y prestador aprobado;
2. que activaron **Aceptar servicios urgentes**;
3. que cubren el barrio: lo declaran (propio o de cobertura), o está dentro de su radio, o solo
   tienen cargado su propio barrio (nunca dijeron a dónde no van). Quien declaró otras zonas y no
   esa queda afuera;
4. que no son el propio cliente.

Un candidato al que no se le puede escribir (sin cuenta vinculada, sin WhatsApp, fuera de 24 h sin
plantilla, conversación tomada por un operador, fallo de envío) queda registrado con el motivo y
puede tomar la solicitud desde su panel. Si no se pudo avisar a nadie, la solicitud se cierra en el
momento (`sin_candidatos`) y el cliente lo sabe.

## El primero que acepta gana

`AlmacenUrgentesPrisma.tomar`, en una transacción:

```sql
UPDATE solicitudes_servicio
   SET visibilidad = 'dirigida', prestador_tenant_id = $t, prestador_id = $p,
       estado_asignacion = 'aceptada', respondida_en = now()
 WHERE id = $id AND difusion_urgente AND estado = 'abierta' AND expira_en > now()
   AND (estado_asignacion IS NULL OR estado_asignacion = 'cancelada')
```

Solo una transacción puede modificar esa fila: la segunda espera el lock, vuelve a evaluar el
`WHERE`, no encuentra nada y revierte. En la misma transacción: la oferta pasa a `acepto`, las demás
a `cerrada_por_otro`, nace (o se reasigna) el trabajo y se escribe la auditoría. Dos índices únicos
cubren cualquier carrera que el `WHERE` no vea: un `acepto` por solicitud y un trabajo por solicitud.

- Quien pierde recibe: "Esta solicitud ya fue tomada por otro prestador."
- El mismo botón dos veces (o un webhook repetido) devuelve el mismo resultado sin crear nada.
- Un prestador al que no se le ofreció no puede tomarla.
- Pasado el vencimiento no se puede tomar, aunque el barrido todavía no haya corrido.

## Renuncia del prestador asignado

Si el asignado avisa que finalmente no puede ir ("no puedo asistir", "al final no puedo ir", "no
llego", "me equivoqué", "cancelar", o **No puedo asistir** en la Web), no es un rechazo de una
oferta: es una renuncia a la asignación.

Solo se reabre sola si el trabajo no avanzó: estado `requested`, sin diagnóstico, presupuesto,
evidencia, mensajes, pagos ni calificaciones. En ese caso, en una transacción:

1. el trabajo se libera (pasa a `cancelled` con rol `prestador` y el motivo; nunca se borra);
2. la solicitud vuelve a estar disponible con una nueva ventana (15 minutos) y suma una reapertura;
3. la oferta de ese prestador queda `renuncio`, con hora, canal y motivo; conserva su `aceptada_en`.

Después: el cliente recibe "X finalmente no puede asistir. Estamos buscando otro prestador
disponible.", y la **misma** solicitud se ofrece de nuevo a quienes siguen siendo válidos (se vuelve
a verificar todo). Nunca a quien renunció ni a quien ya dijo "No puedo". Pueden sumarse prestadores
que se volvieron válidos. Cuando otro acepta, el **mismo** trabajo pasa a ese prestador y vuelve a
`requested`.

El historial queda en un solo expediente:

- ofertas: `A: renuncio (aceptada_en, renuncia_en)`, `B: acepto`;
- transiciones del trabajo: `work.created_from_request` → `work.released_by_provider` →
  `work.reassigned_from_request`;
- auditoría: `urgentes.solicitud_tomada`, `urgentes.asignacion_renunciada`, `urgentes.solicitud_tomada`.

Tope: 3 reaperturas por solicitud; después se cierra y se avisa al cliente.

**Con avances no hay reasignación automática.** El prestador recibe que debe cancelar el trabajo
desde Mis trabajos. Rige la cancelación normal del trabajo (motivo obligatorio; con seña pagada la
resuelve soporte). Falta definir como política de producto si en ese caso TUS debe ofrecerle al
cliente una nueva solicitud urgente.

## Cierres

| Cierre | Cuándo | Aviso al cliente |
| --- | --- | --- |
| `sin_candidatos` | No hay a quién avisar | En la respuesta al crearla |
| `todos_rechazaron` | Todos los avisados dijeron "No puedo", o se agotaron las reaperturas | Sí |
| `vencida` | Nadie la tomó en `TUS_URGENTE_VIGENCIA_MINUTOS` (15) | Sí |

El vencimiento se persiste en `expira_en`. Un barrido cada 30 segundos cierra las vencidas; no hay
temporizadores en memoria: un reinicio no pierde nada.

## WhatsApp

Plantilla `servicio_urgente_disponible` (Utilidad, `es_AR`), parámetros en este orden:
1 cliente, 2 servicio, 3 dirección, 4 barrio/zona, 5 motivo. Botones de respuesta rápida:
`Puedo asistir`, `No puedo`.

```
Hola, {{1}} necesita un servicio urgente de {{2}}.
Dirección: {{3}}
Barrio/Zona: {{4}}
Motivo: {{5}}
¿Podés asistir ahora?
```

- Dentro de las 24 h: mensaje interactivo con el mismo texto y los mismos dos botones.
- Fuera de las 24 h: solo la plantilla, y solo si figura en `WHATSAPP_APPROVED_TEMPLATES`. Nunca
  texto libre.
- Cada botón lleva `urgente:asistir:<id>` o `urgente:nopuedo:<id>`. Quién responde es la cuenta
  vinculada a ese número.

El cliente puede pedirlo por WhatsApp en un mensaje ("Necesito un electricista urgente, estoy en
Av. 3 de Abril 1850, Barrio Sur. Se me cortó toda la luz"): el backend lee servicio, dirección,
barrio y motivo y solo pregunta lo que falte. Empieza cuando el mensaje pide un servicio con
urgencia **y** da una dirección, o nombra el "servicio urgente" como tal. "Plomero urgente ahora",
sin dirección, sigue mostrando los primeros turnos libres como siempre.

## Pagos

No hay lógica de pagos propia. El trabajo nace como cualquier trabajo de solicitud (`requested`,
requiere presupuesto) y sigue el flujo existente: presupuesto del prestador → aceptación del
cliente → seña del 50 % antes de iniciar → saldo al finalizar.

## API

| Ruta | Quién | Qué |
| --- | --- | --- |
| `POST /tus/v1/urgentes` | Cliente | Crea y difunde |
| `GET /tus/v1/urgentes/mias` | Cliente | Sus urgencias con estado real |
| `GET /tus/v1/prestador/urgentes` | Prestador | Sus ofertas (con dirección) |
| `GET/PUT /tus/v1/prestador/urgentes/preferencia` | Prestador | Aceptar servicios urgentes |
| `POST /tus/v1/prestador/urgentes/:id/asistir` | Prestador | Puedo asistir |
| `POST /tus/v1/prestador/urgentes/:id/no-puedo` | Prestador | No puedo / renuncia (`reason` opcional) |
| `GET /tus/v1/admin/urgentes` | Admin | Solicitud, candidatos, respuestas, entregas |

Ningún campo del cuerpo puede nombrar una cuenta, un prestador o un estado.

Web: `/urgente` (cliente), bloque "Servicios urgentes" en `/prestador/solicitudes` (preferencia y
ofertas), sección "Servicios urgentes" en Admin → Solicitudes.

## Producción

| Variable | Para qué |
| --- | --- |
| `TUS_URGENTE_VIGENCIA_MINUTOS` | Minutos de espera (opcional; 15) |
| `WHATSAPP_APPROVED_TEMPLATES` | Agregar `servicio_urgente_disponible` cuando Meta la apruebe |

Además: cada prestador tiene que activar **Aceptar servicios urgentes** y tener su WhatsApp
vinculado a la cuenta.

## Verificación

- `tests/foundation/tus-urgentes-postgres.test.mjs` (PostgreSQL real): caso normal, carrera
  simultánea, idempotencia, prestador inválido, vencida, todos rechazan, sin candidatos, renuncia,
  carrera tras la renuncia, trabajo con avances, rutas HTTP.
- `tests/foundation/tus-urgentes-whatsapp-postgres.test.mjs` (PostgreSQL real + asistente): la
  conversación de aceptación completa y los parámetros de la plantilla.
- `tests/foundation/tus-directorio.test.mjs`: la regla de candidatos.

Meta es un sustituto en todos: prueban el código, no una entrega real.
