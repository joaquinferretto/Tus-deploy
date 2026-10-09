# Verificación de identidad de prestadores (IDENTITY-NOSIS)

Estado: implementado y probado localmente (memoria, Chromium contra un Mi Nosis simulado y PostgreSQL 16 desechable).
**Todavía no se hizo ninguna consulta real a Mi Nosis** (requiere credenciales del operador y la confirmación de los
selectores reales; ver §9).

Solución temporal hasta contratar la API de Nosis: automatiza la cuenta Mi Nosis del operador de TUS con Chromium. El
dominio solo conoce la interfaz `IdentityVerificationProvider`; `NosisApiIdentityProvider` reemplazará al adaptador de
navegador sin tocar cola, límite, matching ni gates.

## 1. Flujo

1. El prestador crea su cuenta y su perfil.
2. Acepta el consentimiento (`identidad-prestador-v1`, propósito `alta_prestador`):
   "Autorizo a TUS a verificar los datos de identidad proporcionados mediante fuentes externas de validación con el fin de
   validar mi alta como prestador." Se guarda `consentAcceptedAt`, versión y propósito, y se audita.
3. Sube frente y dorso del DNI (JPEG/PNG/WEBP). La API valida magic bytes, tamaño (8 KB – 8 MB), estructura (archivo
   truncado o corrupto → 422), rechaza SVG/HTML/ejecutables, **elimina EXIF/GPS/XMP/textos** y guarda solo la copia limpia,
   cifrada con AES-256-GCM (`TUS_IDENTITY_DOCUMENTS_KEY`, AAD atada a verificación y lado). No hay URL pública.
4. "Enviar para verificar" responde **202 `queued`** de inmediato con el mensaje
   "Tu documentación está siendo verificada. Te avisaremos cuando finalice el proceso." La API nunca abre un navegador.
5. Worker separado (concurrencia 1), etapa **lectura**: OCR (tesseract.js, MRZ TD1 con dígitos de control) + visión
   (Groq, `GROQ_API_KEY_1..6` con fallback legacy `GROQ_API_KEY`, esquema estricto validado con zod; no inventa campos). Ambos lectores deben coincidir en el DNI
   con confianza ≥ 0,6; si no → revisión (`DOCUMENT_READER_MISMATCH`, `DOCUMENT_LOW_CONFIDENCE`, `DOCUMENT_UNREADABLE`) **sin
   gastar una consulta a Nosis**. Un DNI ya verificado por otro prestador → `IDENTITY_ALREADY_VERIFIED` sin consulta.
6. Etapa **consulta**: FIFO, límite global 7/h, búsqueda **solo por documento** en el Localizador; se leen únicamente
   DNI, denominación (nombre) y CUIT/CUIL. Si la fuente expone columnas separadas de barrio, localidad y provincia,
   también se normaliza ese área sin números; nunca se guarda una dirección textual.
7. Comparación: DNI exacto, CUIL válido (11 dígitos, prefijo 20/23/24/27, dígito verificador y DNI embebido), nombre
   normalizado (acentos, mayúsculas, espacios) sin fuzzy permisivo.
8. Resultado: `verified` (método `nosis_browser`, snapshot mínimo `{resultCount, nameMatch, cuilValid}` y área opcional),
   `review_required` o `rejected`. Verificado desbloquea al prestador.

| Situación                                         | Resultado                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| 0 resultados                                      | revisión `NOSIS_NOT_FOUND`                                        |
| más de 1 resultado                                | revisión `NOSIS_AMBIGUOUS_RESULT`                                 |
| DNI distinto en la fuente                         | revisión `DOCUMENT_NUMBER_MISMATCH`                               |
| CUIL inválido / no corresponde al DNI             | revisión `CUIL_INVALID` / `CUIL_DOCUMENT_MISMATCH`                |
| segundos nombres distintos (coincidencia parcial) | revisión `NAME_PARTIAL_MATCH`                                     |
| apellido o nombres no coinciden                   | rechazo `NAME_MISMATCH`                                           |
| identidad ya verificada para otro prestador       | revisión `IDENTITY_ALREADY_VERIFIED` (índice único parcial en DB) |
| error de red / layout / indisponible              | reintento a +5, +15 y +60 min; luego revisión `RETRIES_EXHAUSTED` |

Estados: `pending_upload`, `queued`, `processing`, `retry_pending`, `session_required`, `review_required`, `verified`,
`rejected`, `failed`. El prestador ve: Pendiente, En cola, Verificando, En revisión, Verificado, Rechazado.

## 2. Gates (backend)

Hasta `verified` el prestador **no puede**: publicar un servicio (`PROVIDER_IDENTITY_NOT_VERIFIED` en `publishListing`),
aceptar trabajos (`acceptServiceCommitment`), conectar Mercado Pago (`iniciarConexion`) ni recibir dinero
(`disponibilidad` del cobro → `PROVIDER_IDENTITY_NOT_VERIFIED`, antes de mirar la cuenta conectada). En la composición
PostgreSQL los gates están siempre activos; en la composición en memoria se activan inyectando `identity`.

## 3. Cola, límite y worker

- Cola persistente `cola_verificacion_identidad`: `jobId`, `verificationId`, `etapa`, `estado`, `encolado_en`,
  `disponible_en`, `intentos`, `lease_owner`, `lease_hasta`, `ultimo_error`. Un solo trabajo activo por verificación
  (índice único parcial). FIFO por `encolado_en` de la verificación (la etapa de consulta conserva la posición).
- Lease atómico en transacción Serializable + `updateMany` condicional; un lease vencido lo retoma otro worker. Varios
  procesos worker son seguros (probado con 3 workers concurrentes en PostgreSQL 16).
- Límite `NOSIS_BROWSER_MAX_CHECKS_PER_HOUR=7`: global, persistente (`consultas_proveedor_identidad`, append-only),
  compartido entre procesos, ventana deslizante de 60 min, sobrevive reinicios. El cupo se consume **justo antes de
  enviar la búsqueda** y queda consumido aunque el parseo falle después. Con la ventana llena no se toma ningún trabajo de
  consulta (el 8.º espera en la cola; `nextEligibleAt` = salida de la consulta más vieja que bloquea).
- Circuit breaker: 5 errores consecutivos → `circuit_open` (auditoría `nosis.circuit_opened`); se reanuda desde admin.
- Sesión vencida o desafío externo → proveedor `session_required`, la cola se conserva y **nunca se rechaza una
  identidad por eso**. Las lecturas OCR/visión siguen avanzando mientras tanto.

## 4. Mi Nosis por navegador

- `playwright-core` 1.59.1 + Chromium (headless en el worker, headful en el runner de login).
- `MiNosisPage` concentra la interacción: `ensureAuthenticated`, `login`, `openLocalizador`, `searchByDocument`,
  `readResult`, `clearSearch`, `detectSessionProblem`, `detectVerificationWidget`. Todos los selectores están en
  `SELECTORES_MI_NOSIS` (`apps/api/src/tus/identidad/nosis-browser.ts`) y se pueden ajustar sin código con
  `NOSIS_BROWSER_SELECTORS` (JSON parcial).
- Login con Documento/Clave desde variables de entorno. Se marca **solo el checkbox nativo de Mi Nosis**.
- **reCAPTCHA, hCaptcha, Turnstile u otros desafíos de terceros no se clickean ni se resuelven automáticamente.** Se
  detectan (iframes y marcadores) y el worker pasa a `session_required`; un humano completa el ingreso con
  `pnpm tus:identity:nosis-login`. Recomendación: pedir a Nosis que habilite la IP del worker / la cuenta operadora, o
  acelerar el contrato de la API.
- El estado de sesión (cookies/storage de Playwright) se guarda **solo cifrado** (`TUS_NOSIS_SESSION_KEY`) en
  `sesiones_navegador_proveedor`.
- Cambio de layout (tabla o columnas no reconocidas, página que no renderiza) → `NOSIS_LAYOUT_CHANGED`, reintento y
  circuit breaker.

## 5. Comandos

```powershell
pnpm tus:identity:worker                                   # proceso worker (dejarlo corriendo en el host del worker)
pnpm tus:identity:nosis-login                              # Chromium visible: un humano inicia sesión en Mi Nosis
pnpm tus:identity:nosis-check -- --dni <DNI> --confirm     # UNA consulta real autorizada; consume un cupo de 7/h
```

Salidas en JSON de una línea, sin secretos, cookies, HTML ni DNI/CUIL completos (se enmascaran: `***222`,
`20-*****222-0`). `nosis-check` se niega sin `--confirm`, sin DNI válido o con `IDENTITY_PROVIDER` distinto de
`nosis-browser`; solo usarlo con el DNI de una persona que lo autorizó (por ejemplo el propio operador).

## 6. Administración

Página Web `/tus/admin/identidad` (API `/tus/v1/admin/identity-verifications*` y `/tus/v1/admin/identity-worker*`).
Requiere permiso `tus:identity:admin` **y** el tenant `TUS_PLATFORM_ADMIN_TENANT_ID`. Filtros por estado; detalle con
imágenes del DNI (servidas `no-store`, `nosniff`, CSP `default-src 'none'`, mostradas como blob URL que se revoca al
cerrar), lecturas OCR y visión, resultado externo mínimo, matching y motivo. Acciones: reintentar, marcar revisión,
aprobar manualmente (motivo obligatorio; verifica duplicados), rechazar (motivo obligatorio), pausar/reanudar worker,
reautenticar Nosis. Estado del worker: funcionando, pausado, límite horario, sesión requerida, circuit breaker,
"X / 7 consultas" y próxima capacidad.

## 7. Datos y privacidad

Migración aditiva `20260927100000_tus_identity_verification`: `verificaciones_identidad`, `documentos_identidad`,
`cola_verificacion_identidad`, `consultas_proveedor_identidad` (append-only), `estado_proveedor_identidad`,
`sesiones_navegador_proveedor`, `auditoria_identidad` (append-only). Índices únicos parciales sobre DNI y CUIL en filas
`verified`. Validada en PostgreSQL 16 desechable: base nueva y upgrade desde la migración anterior producen el mismo
esquema, sin drift contra `schema.prisma`.

De Nosis solo se guarda el snapshot mínimo; nunca páginas, HTML, teléfonos, actividad, direcciones exactas ni otros datos. Auditoría:
`verification.created/consent_accepted/document_uploaded/queued/processing/verified/review_required/rejected/
retry_scheduled`, `nosis.session_required/session_restored/rate_limited/circuit_opened`, `worker.pause/resume/
reauthenticate`, con DNI/CUIL enmascarados. Logs prohibidos: contraseñas, cookies, sesión, DNI/CUIL completos, HTML.

## 8. Configuración

| Variable                                                   | Dónde        | Secreta | Nota                                                                                                       |
| ---------------------------------------------------------- | ------------ | ------: | ---------------------------------------------------------------------------------------------------------- |
| `IDENTITY_PROVIDER`                                        | API y worker |      no | `nosis-browser` (default) o `demo`; `demo` se rechaza con `NODE_ENV=production`; `nosis-api` reservado     |
| `NOSIS_BROWSER_MAX_CHECKS_PER_HOUR`                        | API y worker |      no | 1..7, default 7                                                                                            |
| `NOSIS_BROWSER_CONCURRENCY`                                | worker       |      no | solo `1`                                                                                                   |
| `NOSIS_BROWSER_HEADLESS`                                   | worker       |      no | `true`                                                                                                     |
| `NOSIS_BROWSER_AUTO_LOGIN`                                 | worker       |      no | `true`: reingresa solo si no hay desafío externo                                                           |
| `NOSIS_BROWSER_LOGIN_URL`, `NOSIS_BROWSER_LOCALIZADOR_URL` | worker       |      no | URLs de Mi Nosis de la cuenta operadora                                                                    |
| `NOSIS_BROWSER_DOCUMENTO`, `NOSIS_BROWSER_CLAVE`           | worker       |  **sí** | nunca en Git ni en la API                                                                                  |
| `NOSIS_BROWSER_SELECTORS`                                  | worker       |      no | JSON parcial para ajustar selectores                                                                       |
| `TUS_NOSIS_SESSION_KEY`                                    | worker       |  **sí** | 32 bytes base64                                                                                            |
| `TUS_IDENTITY_DOCUMENTS_KEY`                               | API y worker |  **sí** | 32 bytes base64; sin ella las subidas responden 503                                                        |
| `GROQ_API_KEY` y `GROQ_API_KEY_1..6`                       | worker       |  **sí** | pool de visión; usa las numeradas primero y la legacy como fallback; sin ninguna todo va a revisión manual |
| `GROQ_VISION_MODEL`                                        | worker       |      no | default `qwen/qwen3.8-27b`                                                                                 |
| `GROQ_VISION_RESPONSE_FORMAT`                              | worker       |      no | `json_object` (default) o `json_schema` si el modelo soporta salida estricta                               |
| `TESSERACT_LANG_PATH`                                      | worker       |      no | opcional: datos de idioma locales para OCR sin descarga                                                    |

## 9. Hosting del worker

La API sigue en la "Node.js app" de Hostinger: no abre navegadores y solo necesita `TUS_IDENTITY_DOCUMENTS_KEY`.

El worker necesita Chromium y sus librerías del sistema, un proceso de larga duración y (para el login humano) una sesión
con pantalla. Según la documentación de Hostinger, las Node.js apps están en los planes Business y Cloud con despliegue
administrado, mientras que VPS/dedicado requieren configuración manual por línea de comandos
([Hostinger](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)). La documentación no aclara
si las apps administradas permiten instalar las dependencias de Chromium o mantener un proceso worker aparte: **no
asumirlo**; confirmarlo con soporte de Hostinger.

Recomendación: correr **solo el worker** en un VPS (por ejemplo Hostinger VPS KVM con Ubuntu) o en un host de
contenedores con la imagen oficial de Playwright:

1. Instalar Node 22, `corepack pnpm install --frozen-lockfile`, luego `npx playwright-core install --with-deps chromium`
   (o usar `NOSIS_BROWSER_EXECUTABLE_PATH` con un Chromium del sistema).
2. Cargar las variables del §8 en el gestor de secretos del host (nunca en archivos del repo).
3. Ejecutar `pnpm tus:identity:worker` bajo systemd/pm2 con reinicio automático y logs rotados.
4. Para `nosis-login` headful: usar escritorio remoto/VNC en el VPS, o ejecutarlo en una PC del operador apuntando a la
   misma base (la sesión cifrada queda en PostgreSQL y el worker la reutiliza). La IP de salida puede cambiar la
   probabilidad de desafíos: conviene que login y worker salgan por la misma IP y pedir a Nosis que la habilite.

## 10. Pruebas

- `tests/foundation/identity-nosis.test.mjs`: dominio (CUIL, normalización, matching), OCR MRZ, adaptador Groq (request,
  esquema, errores), seguridad de subida, pipeline completo, decisiones, 7/h + 8.º en espera + reinicio + dos workers,
  lease vencido, sesión/desafío, reintentos 5/15/60, circuit breaker, caída de lectores, acciones admin.
- `tests/foundation/identity-nosis-browser.test.mjs`: Chromium real contra un Mi Nosis simulado local: login con checkbox
  nativo, reutilización de sesión cifrada, búsqueda solo por DNI, 0/1/2 resultados, desafío externo nunca clickeado,
  sesión vencida sin gastar cupo, cambio de layout, pipeline con el worker.
- `tests/foundation/identity-nosis-gates.test.mjs`: gates de publicación, aceptación, Mercado Pago y cobro; HTTP con
  IDOR/tenancy, spoofing, subida binaria, 202 queued y admin.
- `tests/foundation/identity-nosis-postgres.test.mjs`: se ejecuta solo con `TUS_IDENTITY_PG_URL` apuntando a un
  PostgreSQL **desechable**: lease con 3 workers, 7/h con reservas concurrentes, índice único parcial, append-only.
- `tests/foundation/tus-web-identidad.test.mjs`: cliente Web y superficies.

Ningún test consulta personas reales: las personas de `DEMO_FIXTURES` y del mock son ficticias.

## Verificación documental con el buscador público de Nosis (DOCUMENTO-NOSIS-PUBLICO-01, 2026-10-09)

Proveedor `IDENTITY_PROVIDER=nosis-public`. Reutiliza todo el circuito de arriba (consentimiento, frente y dorso, OCR + visión,
cola, worker, límite de consultas, auditoría, Admin, modelo de verificación); solo cambia de dónde salen los datos externos y
se agrega la provincia como tercer dato.

**Qué prueba y qué no.** Prueba que los datos del documento subido coinciden con los de una fuente externa. NO prueba quién
sostiene el documento: no hay selfie ni prueba de vida. Por eso el texto es "Documento verificado" y nunca "identidad
biométrica verificada". Es una señal opcional de confianza: no es requisito para publicar, aceptar trabajos, cobrar ni retirar.

**Método de consulta.** HTTP directo, sin navegador ni login (`apps/api/src/tus/identidad/nosis-public.ts`,
`NosisPublicLookupAdapter`): un `GET` a `https://informes.nosis.com/` (cookie de sesión del sitio) y un `POST` a
`/Home/Buscar` con el DNI en `Texto`. La respuesta es JSON: `ExigirCaptcha`, `HayError`, `HayMasResultados` y
`EntidadesEncontradas[]`. Forma observada con una única consulta real el 2026-10-09.

**Qué se lee.** De cada resultado, únicamente `Documento` (CUIT/CUIL, del que se deriva el DNI: `20-45247702-6` → `45247702`),
`RazonSocial` (nombre) y `Provincia`. `Actividad`, `UrlInforme`, `UrlClon`, `MensajeHabeasData` y cualquier otra clave se
descartan dentro del adaptador: no se devuelven, no se guardan y no se loguean. Nunca se abre ni se compra un informe: el
adaptador solo conoce las direcciones `/` y `/Home/Buscar`.

**Captcha.** El sitio pide un reCAPTCHA "debido a la cantidad de búsquedas". El adaptador NUNCA lo responde: ante
`ExigirCaptcha` (o HTTP 429) corta con `NOSIS_CHALLENGE_REQUIRED`, la verificación queda en `session_required` y el worker no
consulta nada más hasta que un operador lo reanude. El formulario público envía dos campos de relleno cuando no hay captcha;
el adaptador envía los mismos. **Pendiente del dueño:** confirmar que los términos de uso de Nosis permiten esta consulta
automatizada.

**Quién puede consultar.** Solo el worker, y solo el DNI de una verificación existente (subida por su propio usuario, con
consentimiento). No existe ninguna ruta que reciba un DNI para buscar una persona: TUS no es un buscador de personas. Límite
global existente: a lo sumo 7 consultas por hora, una por verificación; una verificación resuelta no vuelve a consultar.

**Comparación.** Aprobación automática solo con las tres coincidencias:

| Dato      | Regla                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DNI       | exacto después de quitar puntos, espacios y guiones; el de la fuente es el contenido en su CUIT/CUIL (válido: prefijo, dígito verificador, DNI embebido) |
| Nombre    | mismos tokens después de normalizar (mayúsculas, tildes, espacios, puntuación); apellido primero o al final; sin fuzzy                                  |
| Provincia | una de las 24 jurisdicciones después de normalizar (con alias como CABA); un texto que no es una provincia no se aproxima                               |

La provincia del documento es la que lee el lector de visión en el domicilio del dorso (la MRZ no la trae); se guarda dentro
de la lectura (`visionReading.province`), nunca la calle ni el número.

| Resultado                | Cuándo                                                                                                   | Estado guardado                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `VERIFIED`               | DNI + nombre + provincia coinciden                                                                       | `verified`, método `nosis_public`                 |
| `MISMATCH`               | DNI distinto, nombre distinto o provincia distinta                                                       | `review_required` (o `rejected` por nombre)       |
| `NOT_FOUND`              | sin resultados                                                                                           | `review_required` `NOSIS_NOT_FOUND`               |
| `MANUAL_REVIEW_REQUIRED` | falta la provincia en alguna fuente, CUIL inválido, más de un resultado, coincidencia parcial de nombre, respuesta inesperada | `review_required` con su motivo |
| `PROVIDER_UNAVAILABLE`   | error del sitio, timeout (se reintenta) o captcha (se detiene)                                           | `retry_pending` / `session_required`              |

Motivos nuevos: `PROVINCE_MISMATCH`, `PROVINCE_UNAVAILABLE`, `PROVIDER_RESPONSE_UNEXPECTED`. El resultado lo calcula el backend
(`resultadoDocumental`) y viaja en el detalle de Admin como `documentaryResult`.

**Evidencia guardada** (en el `externalSnapshot` existente): fuente `nosis_public`, fecha, CUIT/CUIL mostrado y los tres datos
comparados ya normalizados con su veredicto. No se guarda la respuesta del sitio.

**Admin.** El detalle de la verificación muestra la tabla Dato / DNI / Nosis / Resultado para Documento, Nombre y Provincia, y
el resultado final ("Documento verificado" o "Revisión manual requerida"). La verificación y el rechazo manuales con motivo y
auditoría no cambian.

**Migración.** `20261119100000_tus_identidad_nosis_publico`: solo amplía el CHECK del método para aceptar `nosis_public`.

**Tests.** `tests/foundation/tus-identidad-nosis-publico.test.mjs` con fixtures de `tests/foundation/fixtures/nosis-publico/`
(forma real, personas ficticias). La suite nunca consulta a Nosis. Smoke externo, manual y opcional:
`scripts/identidad/nosis-publico-smoke.mjs` (una consulta, con un DNI autorizado y el argumento `--autorizado`; no corre en CI).

**Relación con los gates.** En esta rama los gates de identidad de `main` no se tocan. Los elimina
`feat/cobro-mercado-pago-vinculado`; esta rama se rebasa sobre ese `main` cuando se mergee.
