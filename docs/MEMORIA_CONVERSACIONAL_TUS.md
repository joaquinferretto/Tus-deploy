# Memoria conversacional de TUS

Estado: **Fases 0 a 4 terminadas** (diseno; historial canonico; constructor de contexto; resumen
incremental versionado; memoria semantica). Este documento describe lo que el
codigo hace HOY y la arquitectura acordada para las fases siguientes. Lo marcado como "previsto" no
existe todavia.

Regla que ordena todo lo demas: **la memoria ayuda a entender a que se refiere la persona; el estado
real de TUS (PostgreSQL) decide los datos**. Si la memoria dice que un turno era a las 16:00 y la
reserva dice 17:00, vale la reserva.

## 1. Que existe hoy (codigo real)

### 1.1 Un solo asistente, dos canales

WhatsApp y Web usan el MISMO orquestador (`apps/api/src/tus/asistente/orquestador.ts`), las mismas
herramientas, la misma base de conocimiento y las mismas tablas. Solo cambia la entrega.

| Pieza | WhatsApp | Web |
| --- | --- | --- |
| Entrada | `ingreso.ts` (webhook de Meta, cola + worker) | `web.ts` / `http-web.ts` (respuesta en la misma peticion) |
| Identidad externa del contacto | `wa_id` de Meta | `web:acct:<cuentaId>` (sesion) o `web:anon:<id de navegador>` |
| Cuenta | `contactos_whatsapp.cuenta_vinculada_id` (vinculo verificado) o identificacion por nombre + documento (24 h, `conversaciones_whatsapp.cuenta_identificada_id`) | la sesion autenticada |
| Idempotencia de entrada | `wamid` unico | `clientMessageId` opcional (Fase 1): un reintento devuelve el intercambio ya guardado |

### 1.2 Historial (A)

- `contactos_whatsapp`: un contacto por identidad externa (`uq_contactos_whatsapp_wa_id`), con `canal`.
- `conversaciones_whatsapp`: **una conversacion activa por contacto** (indice unico parcial), con `canal`,
  `estado` (`active` / `closed`), `version` (concurrencia optimista) y el estado estructurado.
- `mensajes_conversacion_whatsapp`: mensajes reales de ambos canales (`direccion`, `tipo`, `texto`,
  `actor`, `metadata`, `fecha_externa`, `fecha_creacion`). Indice `(conversacion_id, fecha_creacion)`.
- Repositorio (`puertos.ts`): `mensajes.ultimos(conversacion, limite)`, `contar`, `pendientes` y, desde
  la Fase 1, `mensajes.pagina(conversacion, { before, limit })` por secuencia y
  `conversaciones.deContacto(contacto)`.
- Los mensajes y las conversaciones **no tienen columna de cuenta**: la cuenta se obtiene del contacto.
- El documento de identidad se borra del texto guardado (`ocultarDocumento`); un audio no se guarda,
  solo su transcripcion.

### 1.3 Memoria inmediata (B)

Desde la Fase 2 la ventana reciente es un **presupuesto de tokens** (ver 1.12): se leen hasta 60
mensajes de la conversacion, con `redactarPii`, y se incluyen desde el mas nuevo hacia atras hasta
agotar el presupuesto. `WHATSAPP_AI_HISTORY_MESSAGES` ya no limita el contexto del modelo (sigue
usandose para el disparador del resumen).

### 1.4 Resumen (C)

`resumirSiCorresponde()`: cuando hay 24 mensajes nuevos (`WHATSAPP_AI_SUMMARY_THRESHOLD`) el modelo
resume los mensajes que salieron de la ventana y el resultado se guarda en
`conversaciones_whatsapp.resumen` + `mensajes_resumidos`.

Limitaciones reales:
- cubre "hasta la cantidad N de mensajes", no "hasta el mensaje X";
- se sobrescribe: no hay versiones ni forma de saber de que mensajes salio;
- es por conversacion: al cerrarse la conversacion (Web "reiniciar", o una nueva conversacion de
  WhatsApp) se pierde;
- es "mejor esfuerzo": si el modelo falla no se reintenta.

### 1.5 Memoria semantica (D)

No existe para conversaciones. Existe la infraestructura:
- extension `vector` y tabla `"RagEmbedding"` (`vector(1024)`, indice HNSW coseno), hoy usada solo por
  la base de conocimiento (`tenantId = 'tus-platform'`), con `fragmentos_conocimiento` para el texto;
- proveedor de embeddings configurable (`RAG_EMBEDDING_PROVIDER`; por defecto `none` → busqueda
  lexica; `local-hash` solo fuera de produccion), dimension 1024;
- `RecuperadorConocimiento` (hibrido lexico + vector, con umbrales).

### 1.6 Memoria de hechos (E)

No existe. Lo mas parecido es el estado de la conversacion (`estado_conversacional`, JSON): la
necesidad en curso (servicio, dia, hora, zona, profesional elegido o excluido), las opciones mostradas
y la solicitud que se esta armando. Vence solo (30 minutos / 2 horas) y no sobrevive a la conversacion.

### 1.7 Estado real del negocio (F)

Ya es la autoridad: las herramientas del asistente (`herramientas.ts`, `dominio.ts`) leen turnos,
solicitudes, trabajos, presupuestos y pagos de los servicios de dominio, y el prompt lo dice ("los
datos oficiales salen de herramientas"). `diagnose_user_issue` devuelve estados, nunca datos personales.

### 1.8 Donde se arma el contexto del modelo

Desde la Fase 2, en `construirContexto()` (`apps/api/src/tus/asistente/contexto.ts`), llamado por
`conversar()`. El limite de salida sigue siendo `WHATSAPP_AI_MAX_COMPLETION_TOKENS` (600).

### 1.9 Borrado y retencion

- Las claves foraneas entre contacto, conversacion y mensaje son `ON DELETE RESTRICT`.
- No hay borrado de conversaciones ni de cuentas, ni tarea de retencion. "Reiniciar" en la Web solo
  cierra la conversacion.
- `"RagEmbedding"` tiene `retentionUntil`, sin uso para conversaciones.

### 1.10 Tests relacionados

30 suites en `tests/foundation` cubren asistente, WhatsApp y RAG (por ejemplo `whatsapp-asistente`,
`tus-asistente-web`, `tus-asistente-contexto*`, `whatsapp-rag`, `tus-rag-evaluacion`). Ninguna prueba
aislamiento de memoria entre cuentas, porque hoy no hay memoria por cuenta.

### 1.11 Historial canonico (Fase 1, implementado)

- **Secuencia**: cada mensaje recibe de la base un numero creciente y unico (`secuencia`). Los mensajes
  existentes se numeraron por fecha de creacion. Un cambio de estado de un mensaje no mueve su lugar.
- **Lectura por cuenta** (`apps/api/src/tus/asistente/historial.ts`, `HistorialConversacional`):
  `conversaciones(cuenta)` y `mensajes({ accountId, conversationId, before, limit })`, paginado hacia
  atras por secuencia (50 por defecto, 200 como maximo). Es la unica via por la que la memoria leera
  mensajes.
- **Que cuenta como "de la cuenta"** (`cuentaDeContacto`): el contacto Web `web:acct:<cuenta>` y los
  WhatsApp con vinculo verificado. Un visitante anonimo, un WhatsApp sin vincular y una conversacion
  identificada por nombre + documento NO pertenecen a ninguna cuenta para la memoria.
- **Aislamiento**: una conversacion ajena o inexistente responde lo mismo (`NOT_FOUND`).
- **Idempotencia Web**: `POST /tus/v1/asistente/mensajes` acepta `clientMessageId` (8 a 64 caracteres
  `[A-Za-z0-9_-]`). Repetirlo devuelve el mismo mensaje y la misma respuesta sin llamar otra vez al
  modelo; si la respuesta todavia se esta generando responde 409 `TURN_IN_PROGRESS`. La clave es por
  contacto: dos personas pueden usar la misma.
- La paginacion existe a nivel de servicio; la Web todavia no la expone por HTTP (sigue mostrando la
  ventana reciente).

### 1.12 Constructor de contexto (Fase 2, implementado)

`construirContexto(partes, presupuesto)` es el unico lugar donde se arma lo que recibe el modelo:

1. partes fijas (prompt del sistema, contexto del actor, documentos de conocimiento, avisos), armadas
   por el orquestador y solo medidas aca;
2. resumen (recortado a su presupuesto);
3. recuerdos de la cuenta y 4. hechos (listas en el orden recibido, mientras entren) — vacias hasta
   las Fases 4 y 5;
5. ventana reciente: desde el mensaje mas nuevo hacia atras hasta agotar `recientes`; un mensaje
   largo se recorta a `porMensaje`, y el mas nuevo nunca se descarta;
6. mensaje actual (recortado a `actual`).

No lee la base ni conoce cuentas: recibe texto que el backend ya acoto a la cuenta y conversacion
correctas. Presupuesto por defecto (`PRESUPUESTO_CONTEXTO_POR_DEFECTO`, tokens estimados a 3,5
caracteres por token): recientes 1500, por mensaje 300, resumen 400, recuerdos 500, hechos 150,
actual 300, candidatos leidos 60. Configurable con `WHATSAPP_AI_CONTEXT_RECENT_TOKENS`,
`WHATSAPP_AI_CONTEXT_SUMMARY_TOKENS` y `WHATSAPP_AI_CONTEXT_MEMORY_TOKENS`.

Metrica por turno `assistant.context` (solo numeros y banderas, nunca contenido): tokens por parte y
total, mensajes incluidos / omitidos / recortados, recuerdos y hechos incluidos / omitidos, y si el
resumen o el mensaje actual se recortaron.

### 1.13 Resumen incremental y versionado (Fase 3, implementado)

- Tabla `resumenes_conversacion` (migracion `20261103100000_tus_memoria_resumenes`): conversacion,
  `version`, `desde_secuencia`, `hasta_secuencia`, cantidad de mensajes, texto, modelo y fecha. Unica
  por conversacion + version. Cada fila dice exactamente "este resumen representa hasta el mensaje X".
- `resumirSiCorresponde()` ya no cuenta mensajes ni sobrescribe: lee con `mensajes.posteriores()` lo
  que vino despues de `hasta_secuencia`, deja afuera la ventana reciente (los ultimos
  `WHATSAPP_AI_HISTORY_MESSAGES`), y cuando hay `WHATSAPP_AI_SUMMARY_THRESHOLD` mensajes esperando
  resume solo esos sobre el texto anterior y guarda una VERSION NUEVA (hasta 80 mensajes por paso).
- Idempotente y tolerante a reintentos: el rango sale de la version guardada; si el modelo falla no
  se guarda nada y el mismo rango se intenta en un turno posterior.
- Concurrencia: dos procesos sobre el mismo paso calculan la misma version y el indice unico deja una.
- Trazable y regenerable: `regenerarResumen(conversacion)` reconstruye desde los mensajes ORIGINALES
  hasta donde llega la version vigente y lo guarda como otra version; las anteriores quedan.
- Los mensajes originales nunca se reemplazan. La columna `conversaciones_whatsapp.resumen` se mantiene
  como copia del texto vigente (lectores anteriores); el contexto lee la version vigente de la tabla.
- Privacidad: antes de resumir, cada mensaje (y el resumen que vuelve) pasa por `limpiarParaMemoria()`
  = `redactarPii` + `sinSecretos` (contrasenas, codigos de verificacion, tokens, cookies, CVV y
  enlaces con credenciales). Los estados de turnos, pagos y solicitudes no van al resumen.
- Metricas `assistant.summary` (version, mensajes, tokens) y `assistant.summary_skipped` (motivo), sin
  contenido.
- El resumen sigue siendo por conversacion. Lo que cruza conversaciones y canales llega con la
  memoria semantica y los hechos (Fases 4, 5 y 7).

### 1.14 Memoria semantica (Fase 4, implementado)

- **Que es un recuerdo**: un FRAGMENTO, no un mensaje. Cuando un paso de resumen cubre mensajes que
  salieron de la ventana reciente, esos mismos mensajes se agrupan en tramos de hasta 900 caracteres
  cortados en limites de mensaje (`fragmentarConversacion`), ya limpios con `limpiarParaMemoria()`.
- **Donde vive**: `fragmentos_memoria` (migracion `20261104100000_tus_memoria_fragmentos`): cuenta,
  conversacion, canal, `desde_secuencia`, `hasta_secuencia`, texto, checksum, version de embeddings,
  fecha y vencimiento. El vector va en la tabla existente `"RagEmbedding"` (pgvector, 1024
  dimensiones) con `tenantId = 'tus-memoria'` y `workspaceId = cuenta`. Fragmento y vector se
  escriben en la misma transaccion; el mismo tramo de una conversacion se guarda una sola vez.
- **De quien**: solo de contactos con cuenta (`cuentaDeContacto`). Un visitante anonimo o un WhatsApp
  sin vincular no generan ni reciben recuerdos.
- **Busqueda** (`ServicioMemoriaSemantica.recuperar`): 1) cuenta resuelta por el backend, 2) la
  consulta SQL filtra `tenantId`, `workspaceId = cuenta` y `cuenta_id = cuenta` ANTES de ordenar por
  similitud, 3) similitud coseno, 4) umbral (`WHATSAPP_AI_MEMORY_MIN_SCORE`, 0,35), 5) pocos
  resultados (`WHATSAPP_AI_MEMORY_TOP_K`, 3). Los vencidos y los de otra version de embeddings no se
  comparan. Como defensa adicional el servicio descarta cualquier fragmento que no sea de la cuenta.
- **En el contexto**: entran como `recuerdos` del constructor, con fecha y canal de origen, dentro de
  su presupuesto de tokens, marcados como datos de contexto y no como autoridad.
- **Si falla** (proveedor caido): el turno sigue con la ventana reciente y las herramientas.
- **Requisito**: un proveedor de embeddings (`RAG_EMBEDDING_PROVIDER`). Con `none` (valor por defecto)
  la memoria semantica queda apagada y el resto funciona igual.
- Metricas sin contenido: `assistant.memory_stored`, `assistant.memory_retrieved` (recuperados,
  descartados por umbral, milisegundos) y `assistant.memory_error`.

## 2. Que se reutiliza

- Las tres tablas de historial (contacto, conversacion, mensaje) para ambos canales.
- El vinculo cuenta ↔ contacto ya existente (sesion Web, vinculo verificado de WhatsApp).
- `redactarPii` y el ocultamiento del documento, como base del filtro de datos prohibidos.
- pgvector, `"RagEmbedding"` y el proveedor de embeddings (misma dimension y version de indice).
- La transaccion y la concurrencia optimista (`version`) del asistente; la cola por conversacion.
- Las herramientas de dominio como unica fuente de datos operativos.

## 3. Arquitectura propuesta

```
mensaje entrante (Web o WhatsApp)
        │
        ▼
identidad: contacto → cuenta (sesion Web / vinculo verificado de WhatsApp)   ← sin cuenta: solo la conversacion actual
        │
        ▼
historial canonico (mensaje guardado, secuencia estable)                      (Fase 1)
        │
        ▼
CONSTRUCTOR DE CONTEXTO (unico, con presupuesto de tokens)                    (Fase 2)
   1. instrucciones del sistema
   2. estado estructurado de la conversacion (necesidad, solicitud en curso)
   3. resumen vigente  "hasta el mensaje X"                                   (Fase 3)
   4. recuerdos relevantes de ESA cuenta (pgvector, top K, umbral)            (Fase 4)
   5. hechos permitidos de ESA cuenta                                         (Fase 5)
   6. mensajes recientes, del mas nuevo hacia atras hasta agotar presupuesto
   7. mensaje actual
        │
        ▼
modelo ──► herramientas ──► estado real de TUS (PostgreSQL)                   (Fase 6: la referencia sale de la memoria, el dato sale de la base)
        │
        ▼
respuesta + trabajo posterior al turno: resumen incremental, fragmentos, hechos
```

El constructor vive en el modulo del asistente (junto al orquestador) y reemplaza el armado en linea
de `conversar()`; el camino sin modelo de WhatsApp (respuestas escritas por el backend) no usa memoria
generada.

### 3.1 Clave de la memoria: la cuenta

- La memoria de largo plazo (resumen entre conversaciones, recuerdos, hechos) se guarda y se lee **por
  `cuenta_id`**, que el backend resuelve del contacto: sesion Web, o WhatsApp con vinculo verificado.
- Un visitante anonimo de la Web o un WhatsApp sin vincular solo tiene la memoria de su conversacion
  actual. La identificacion por nombre + documento (24 h) habilita una accion, **no** da acceso a la
  memoria de la cuenta.
- Toda lectura filtra por cuenta **en la consulta SQL, antes** de ordenar por similitud. Nunca se
  busca en todo y se filtra despues.

### 3.2 Web y WhatsApp

Los dos canales guardan en las mismas tablas. Con la misma cuenta (WhatsApp vinculado), la memoria de
cuenta es comun; cada recuerdo conserva conversacion, canal y mensaje de origen. Las ventanas de
mensajes recientes siguen siendo por conversacion; lo que cruza de un canal a otro es el resumen de
cuenta, los recuerdos y los hechos (Fase 7).

## 4. Modelos

### 4.1 Existentes que se reutilizan

`contactos_whatsapp`, `conversaciones_whatsapp`, `mensajes_conversacion_whatsapp`,
`cola_conversacion_whatsapp`, `auditoria_asistente`, `"RagEmbedding"`.

### 4.2 Nuevos previstos (ninguno creado todavia)

| Fase | Cambio | Para que |
| --- | --- | --- |
| 1 (hecho) | `mensajes_conversacion_whatsapp.secuencia` (entero creciente, unico, indice `(conversacion_id, secuencia)`); migracion `20261102100000_tus_memoria_historial_canonico` | orden estable y paginacion; "hasta el mensaje X" |
| 1 (hecho) | idempotencia de mensajes Web SIN columna nueva: la clave del cliente se guarda en `wamid` como `web:<contacto>:<clave>` (indice unico ya existente) | un reintento no duplica el mensaje |
| 3 (hecho) | `resumenes_conversacion` (conversacion, version, `desde_secuencia`, `hasta_secuencia`, mensajes, texto, modelo, fecha; unico por conversacion + version); migracion `20261103100000_tus_memoria_resumenes` | resumen incremental, versionado y regenerable |
| 4 (hecho) | `fragmentos_memoria` + vectores en `"RagEmbedding"` (`tenantId = 'tus-memoria'`, `workspaceId = cuenta`); migracion `20261104100000_tus_memoria_fragmentos` | recuerdos semanticos por cuenta |
| 4 (hecho) | indice `ix_rag_embedding_tenant_workspace` en `"RagEmbedding"` | filtrar por cuenta antes de la similitud |
| 5 | `hechos_memoria` (cuenta, tipo de una lista cerrada, valor, mensaje y conversacion de origen, canal, confianza, vencimiento, invalidacion) | hechos con procedencia |

Todas las migraciones seran solo hacia adelante y no destructivas (columnas nuevas anulables o con
valor por defecto, tablas nuevas, indices). Las columnas `resumen` y `mensajes_resumidos` se conservan.
No se agrega infraestructura: PostgreSQL + pgvector alcanzan.

## 5. Invariantes

1. El estado real de TUS tiene prioridad sobre cualquier memoria generada.
2. Ninguna consulta de memoria se ejecuta sin `cuenta_id` resuelto por el backend.
3. La cuenta A nunca recibe mensajes, resumenes, recuerdos ni hechos de la cuenta B.
4. Los mensajes originales nunca se reemplazan ni se editan por la memoria: resumen, fragmentos y
   hechos son derivados y regenerables.
5. Cada derivado sabe de donde salio (conversacion, canal, rango de mensajes).
6. El modelo no decide destinatarios, cuentas ni identificadores: los resuelve el backend.
7. Un fallo de memoria (modelo caido, embeddings apagados) no rompe el turno: se responde con la
   ventana reciente y las herramientas.

## 6. Privacidad

- No se guarda como memoria ni se vectoriza: contrasenas, codigos de verificacion (OTP), tokens,
  cookies, secretos, datos de tarjetas, credenciales ni enlaces de autenticacion.
- `limpiarParaMemoria()` (Fase 3) = `redactarPii` (CUIL, documento, tokens, email, tarjeta, telefono)
  + `sinSecretos` (contrasenas, claves, codigos de verificacion, CVV, cookies, tokens y enlaces que
  autentican). Se aplica antes de resumir y se aplicara igual antes de fragmentar y generar
  embeddings (Fases 4 y 5).
- Los registros y metricas nunca llevan contenido de mensajes, solo cantidades y tamanos.

## 7. Borrado y retencion (definicion; se implementa en la Fase 8)

Cadena de dependencia: mensaje → resumen → fragmento → embedding → hecho.

- Borrar un mensaje o una conversacion invalida los derivados que lo cubren (resumen regenerado,
  fragmentos y vectores eliminados, hechos con ese origen invalidados).
- Borrar una cuenta elimina toda su memoria derivada.
- Recuerdos y hechos pueden tener vencimiento.
- Hoy las claves foraneas son `RESTRICT` y no existe ningun borrado: no hay datos huerfanos, pero
  tampoco ciclo de vida.

## 8. Tokens

- No hay tokenizador en el repositorio: se usa una estimacion conservadora por caracteres (3,5
  caracteres por token), centralizada en `estimarTokens()`.
- Presupuesto de ENTRADA implementado (las partes fijas se miden pero no se recortan; los documentos
  de conocimiento los acota el recuperador):

| Parte | Tokens aprox. |
| --- | --- |
| Instrucciones del sistema y reglas | lo que midan hoy (fijo) |
| Estado estructurado | 400 |
| Resumen | 400 |
| Recuerdos semanticos | 500 |
| Hechos | 150 |
| Documentos de conocimiento (RAG) | 1000 |
| Mensajes recientes | 1500 |
| Mensaje actual | 300 |

- La ventana reciente se llena desde el mensaje mas nuevo hacia atras hasta agotar su parte.
- Salida: `WHATSAPP_AI_MAX_COMPLETION_TOKENS` (600), sin cambios.

## 9. Fases

| Fase | Contenido | Estado |
| --- | --- | --- |
| 0 | Auditoria y diseno | terminada |
| 1 | Conversaciones y mensajes canonicos (secuencia, paginacion, idempotencia, aislamiento) | terminada |
| 2 | Constructor unico de contexto con presupuesto de tokens | terminada |
| 3 | Resumen incremental y versionado | terminada |
| 4 | Memoria semantica con pgvector | terminada |
| 5 | Hechos con procedencia | pendiente |
| 6 | Resolutores contra el estado real de TUS | pendiente |
| 7 | Continuidad Web + WhatsApp | pendiente |
| 8 | Retencion, borrado y privacidad | pendiente |
| 9 | Observabilidad y costos | pendiente |
| 10 | Validacion integral | pendiente |

## 10. Riesgos y decisiones abiertas

- **Embeddings apagados por defecto** (`RAG_EMBEDDING_PROVIDER=none`): la Fase 4 necesita un proveedor
  configurado en produccion; sin el, la memoria semantica queda inactiva (el resto funciona).
- **Indice HNSW con filtro por cuenta**: la consulta filtra por cuenta con el indice
  `(tenantId, workspaceId)` y ordena por distancia dentro de ese conjunto. No esta medido con volumen
  real: si el planificador eligiera el indice HNSW global y devolviera menos filas de las esperadas,
  habria que forzar el orden exacto para memoria.
- **WhatsApp sin modelo**: el canal responde hoy con textos escritos por el backend; la memoria
  generada solo se usa donde hay modelo.
- **Mensajes anteriores a la vinculacion**: lo que un contacto escribio antes de vincular la cuenta
  pasa a ser memoria de esa cuenta solo desde la vinculacion; se define en la Fase 7.
