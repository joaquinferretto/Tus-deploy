# Memoria conversacional de TUS

Estado: **Fase 0 terminada (auditoria y diseno)**. Este documento describe lo que el codigo hace HOY y
la arquitectura acordada para las fases siguientes. Nada de lo marcado como "previsto" existe todavia.

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
| Idempotencia de entrada | `wamid` unico | un mensaje por peticion (sin clave de idempotencia del cliente) |

### 1.2 Historial (A)

- `contactos_whatsapp`: un contacto por identidad externa (`uq_contactos_whatsapp_wa_id`), con `canal`.
- `conversaciones_whatsapp`: **una conversacion activa por contacto** (indice unico parcial), con `canal`,
  `estado` (`active` / `closed`), `version` (concurrencia optimista) y el estado estructurado.
- `mensajes_conversacion_whatsapp`: mensajes reales de ambos canales (`direccion`, `tipo`, `texto`,
  `actor`, `metadata`, `fecha_externa`, `fecha_creacion`). Indice `(conversacion_id, fecha_creacion)`.
- Repositorio (`puertos.ts`): `mensajes.ultimos(conversacion, limite)`, `contar`, `pendientes`. No hay
  paginacion hacia atras ni un numero de secuencia: el orden es por `fecha_creacion`.
- Los mensajes y las conversaciones **no tienen columna de cuenta**: la cuenta se obtiene del contacto.
- El documento de identidad se borra del texto guardado (`ocultarDocumento`); un audio no se guarda,
  solo su transcripcion.

### 1.3 Memoria inmediata (B)

`historial()` del orquestador: los ultimos **12 mensajes** (`WHATSAPP_AI_HISTORY_MESSAGES`), cada uno
recortado a 1000 caracteres y pasado por `redactarPii`. Es una cantidad fija de mensajes, **no un
presupuesto de tokens**.

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

En `conversar()` del orquestador, en linea: reglas del sistema → contexto del actor → documentos
recuperados (RAG) → resumen → `historial()` → mensaje actual. No hay un constructor unico ni medicion
de tokens; el unico limite de salida es `WHATSAPP_AI_MAX_COMPLETION_TOKENS` (600).

### 1.9 Borrado y retencion

- Las claves foraneas entre contacto, conversacion y mensaje son `ON DELETE RESTRICT`.
- No hay borrado de conversaciones ni de cuentas, ni tarea de retencion. "Reiniciar" en la Web solo
  cierra la conversacion.
- `"RagEmbedding"` tiene `retentionUntil`, sin uso para conversaciones.

### 1.10 Tests relacionados

30 suites en `tests/foundation` cubren asistente, WhatsApp y RAG (por ejemplo `whatsapp-asistente`,
`tus-asistente-web`, `tus-asistente-contexto*`, `whatsapp-rag`, `tus-rag-evaluacion`). Ninguna prueba
aislamiento de memoria entre cuentas, porque hoy no hay memoria por cuenta.

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
| 1 | `mensajes_conversacion_whatsapp.secuencia` (entero creciente, indice `(conversacion_id, secuencia)`) | orden estable y paginacion; "hasta el mensaje X" |
| 1 | clave de idempotencia opcional para mensajes de la Web (indice unico parcial) | un reintento no duplica el mensaje |
| 3 | `resumenes_conversacion` (conversacion, version, `hasta_secuencia`, texto, modelo, fecha; unico por conversacion + version) | resumen incremental, versionado y regenerable |
| 4 | `fragmentos_memoria` (cuenta, conversacion, canal, `desde_secuencia`, `hasta_secuencia`, texto redactado, checksum, vencimiento) + vectores en `"RagEmbedding"` bajo un tenant propio de memoria y `workspaceId = cuenta` | recuerdos semanticos por cuenta |
| 4 | indice `(tenantId, workspaceId)` en `"RagEmbedding"` | filtrar por cuenta antes de la similitud |
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
- Base ya existente: `redactarPii` (CUIL, documento, tokens, email, tarjeta, telefono) y el
  ocultamiento del documento en el mensaje guardado. Falta agregar codigos de verificacion y enlaces
  con token al filtro, y aplicarlo antes de resumir, fragmentar y generar embeddings (Fases 3 a 5).
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

- No hay tokenizador en el repositorio. La Fase 2 usa una estimacion conservadora por caracteres
  (alrededor de 3,5 caracteres por token en espanol), centralizada en un solo lugar.
- Presupuesto inicial propuesto para la ENTRADA (a medir y ajustar en la Fase 2; hoy no esta medido):

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
| 1 | Conversaciones y mensajes canonicos (secuencia, paginacion, idempotencia, aislamiento) | pendiente |
| 2 | Constructor unico de contexto con presupuesto de tokens | pendiente |
| 3 | Resumen incremental y versionado | pendiente |
| 4 | Memoria semantica con pgvector | pendiente |
| 5 | Hechos con procedencia | pendiente |
| 6 | Resolutores contra el estado real de TUS | pendiente |
| 7 | Continuidad Web + WhatsApp | pendiente |
| 8 | Retencion, borrado y privacidad | pendiente |
| 9 | Observabilidad y costos | pendiente |
| 10 | Validacion integral | pendiente |

## 10. Riesgos y decisiones abiertas

- **Embeddings apagados por defecto** (`RAG_EMBEDDING_PROVIDER=none`): la Fase 4 necesita un proveedor
  configurado en produccion; sin el, la memoria semantica queda inactiva (el resto funciona).
- **Indice HNSW con filtro por cuenta**: con pocos recuerdos por cuenta conviene filtrar por cuenta y
  ordenar exacto, en vez de depender del indice aproximado global. Se decide con datos en la Fase 4.
- **WhatsApp sin modelo**: el canal responde hoy con textos escritos por el backend; la memoria
  generada solo se usa donde hay modelo.
- **Mensajes anteriores a la vinculacion**: lo que un contacto escribio antes de vincular la cuenta
  pasa a ser memoria de esa cuenta solo desde la vinculacion; se define en la Fase 7.
