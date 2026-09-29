# Fase 5: trabajo y chat privado en Web

Base revisada: `c3baf66` (Fase 4). Al retomar no había código parcial de esta fase:
el único archivo modificado era `opencode.json`, que se preserva y no forma parte del commit.
Las fases anteriores ya devolvían `workId` desde solicitudes, aceptación y postulaciones.

## Lecturas nuevas

- `GET /tus/v1/mis-trabajos`: trabajos del tenant autenticado como Cliente o Prestador.
- `GET /tus/v1/trabajos/:id/resumen`: mismo criterio de participación; tercero recibe 404.
- Ambas rutas usan la sesión real y `Cache-Control: no-store`. No toman autoridad del body,
  query o rol enviado por la Web. No se agregó acceso global de administrador porque el
  acceso existente de trabajo está limitado a las partes.
- Contrato compartido `WorkSummary`: estado, versión, origen, solicitud, fechas, contraparte,
  presupuesto vigente y capacidades. No incluye tenants, cuentas, emails ni auditoría interna.

## Consultas y N+1

Conteos de lecturas de dominio, sin incluir la resolución común de sesión:

| Operación | Lecturas |
| --- | --- |
| Mis trabajos, N > 0 | 1 trabajos + 1 solicitudes + 1 imágenes (relación batch Prisma) + 1 perfiles + 1 presupuestos = hasta 5 SQL |
| Mis trabajos vacío | 1 trabajos; sin consultas de enriquecimiento |
| Resumen | 1 trabajo accesible + las mismas 4 lecturas = hasta 5 SQL |
| Resumen de un tercero | 1 trabajo accesible; sin enriquecimiento |
| Leer mensajes | 1 trabajo accesible + 1 página de mensajes = 2 SQL |
| Enviar mensaje nuevo | 1 trabajo accesible + 1 insert = 2 SQL |
| Reintentar mensaje existente | las anteriores + 1 lectura por ID después del conflicto único = 3 sentencias |

La prueba compara 1 y 40 trabajos: en ambos casos cuenta 1 llamada al almacén de trabajos y
3 llamadas `findMany` de enriquecimiento. La relación de imágenes agrega una lectura batch
en Prisma. El conteo SQL es derivado del adaptador, no una medición de latencia contra producción.
Solicitudes usa `id IN (...)`; perfiles y presupuestos usan lotes con las claves de los trabajos
previamente autorizados. Los mapas evitan búsquedas repetidas al proyectar los resultados.
No se calculan conteos de mensajes en el listado: el chat se consulta al abrir el trabajo.

Además se corrigieron dos N+1 previos en las pantallas de entrada:

- Mis solicitudes: perfiles, antes hasta una lectura por Prestador distinto; ahora una lectura
  `tenantId IN (...)`. El `workId` ya venía de una relación batch.
- Mis postulaciones: antes una lectura de solicitud por postulación; ahora una sola lectura
  de solicitudes por IDs (con sus relaciones batch). Se mantiene la protección del `workId`
  para mostrarlo solamente al Prestador elegido.

## Experiencia y autoridad

`/trabajos` muestra cards, estados humanos, contraparte, rol y fecha; tiene carga, error,
reintento y vacíos para Cliente/Prestador. `/trabajos/[id]` muestra encabezado, estado,
solicitud original e imágenes privadas, presupuesto, acciones y mensajes.

Las acciones derivan del servidor y siguen las mutaciones existentes:

- Prestador: crear presupuesto en solicitado/diagnóstico/presupuesto pendiente; iniciar con
  presupuesto aceptado cuando es obligatorio; completar en curso; cancelar antes del estado terminal.
- Cliente: aceptar o rechazar el último presupuesto emitido y vigente. Rechazar requiere motivo.
- Presupuesto aceptado muestra "Pago pendiente de configuración" (solo texto de UI; sin checkout
  ni estado de pago nuevo en backend).
- La cancelación del trabajo existente es exclusiva del Prestador asignado. No se amplió esa
  autorización. La Web del Cliente no muestra Cancelar trabajo.
- La solicitud abierta solo permite cancelar antes del match. Luego ofrece el trabajo; un
  conflicto `WORK_ACTIVE` recarga solicitudes y muestra una explicación.
- Se preservan `expectedVersion`, versión de presupuesto, `requestHash` e `Idempotency-Key`.
  Un 409 refresca y pide revisar el estado, sin repetir la operación automáticamente.

Chat: rutas de Fase 4, últimos 100 mensajes y acceso a páginas anteriores, actualización
manual y después de enviar, sin polling ni WebSocket. Texto vacío no permitido, límite
compartido de 2000 caracteres, fechas, roles y errores visibles. Un reintento mantiene
`clientMessageId`; no duplica mensajes. Se permiten teléfono, dirección, WhatsApp y email.
React renderiza el contenido como texto, sin HTML ejecutable.

Navegación: Mis trabajos en header y menú móvil, Mis solicitudes y panel del Prestador;
Ver trabajo y mensajes desde la solicitud y Ver trabajo desde recibidas/postulaciones aceptadas.

No se implementaron pagos, Mercado Pago, rating ni infraestructura adicional. No hay cambios
en mobile: los campos de enlace agregados al contrato existente son opcionales.

## Validación

Nuevos tests: `tus-work-summary.test.mjs` (HTTP, acceso, capacidades, presupuesto y batch) y
`tus-work-web-phase5.test.mjs` (cliente HTTP, navegación y navegador real con API simulada).
El test de navegador usa las dependencias existentes `playwright-core` y `esbuild`, no levanta
servidores y cierra Chrome en `finally`. Valida envío, reintento, XSS, conflictos, presupuestos
y ausencia de desborde horizontal; genera capturas temporales de móvil/escritorio.

Se ejecutan también los tests de trabajo, mensajes Fase 4, solicitudes, postulaciones,
directorio y Web relacionados, typechecks y builds de API/Web.

El lint de los archivos nuevos/modificados de la fase pasa. La invocación estricta que incluye
todo `server.ts` detecta un `prefer-const` preexistente en `listen` (también presente en
`c3baf66`); ese archivo pasa al desactivar exclusivamente esa regla. No se cambió el arranque
para corregir una observación ajena a esta fase. El build Web conserva dos advertencias
preexistentes en `trabajo-cliente.tsx` y `tus-web-contract.ts`.

No se inicia ningún servicio persistente para implementar esta fase. No se realiza push.
