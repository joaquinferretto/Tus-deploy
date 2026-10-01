# Cambios de proxy, WhatsApp y administración

## Estado y alcance

Implementación local; este documento no acredita un despliegue ni una medición del tráfico de producción.
El usuario confirmó Node.js Web Apps de hPanel, sin Hostinger CDN ni Cloudflare. No hay una sesión de
hPanel conectada a esta ejecución. No se cambiaron variables del panel ni credenciales.

> **Corrección (medido en producción el 2026-10-01):** `api.tusservicios.shop` sí responde a través de
> Hostinger CDN: las respuestas traen `server: hcdn`, `x-hcdn-cache-status`, `platform: hostinger` y
> `panel: hpanel`. La afirmación "sin Hostinger CDN" de arriba ya no describe la producción actual; ver
> "Caché de Hostinger delante de la API" más abajo. No hay evidencia de Cloudflare.

## Proxy en Hostinger

Para la ruta hPanel → Node, la configuración propuesta es:

```dotenv
TRUST_PROXY_HOPS=1
TRUST_PROXY_DIAGNOSTICS=true
```

Dejar `TRUST_PROXY_ADDRESSES` vacío al usar saltos. `1` confía únicamente en el proxy inmediato y
toma la entrada derecha de X-Forwarded-For; no acepta ciegamente la entrada izquierda del visitante.
Es segura **solo si Node no es accesible directamente y el proxy inmediato agrega o sobrescribe
la IP del cliente**. La confirmación de hPanel sin CDN elimina dos capas posibles, pero no demuestra
cuántas capas internas conserva Hostinger en X-Forwarded-For. Hay que medir antes de cerrar el incidente.
Con el CDN de Hostinger detectado delante de la API (corrección de arriba), esa premisa "sin CDN" no
vale: la cantidad de saltos tiene que medirse con el CDN incluido.

La API mantiene `false` por defecto en entornos no configurados. No se añadió confianza global por
estar en producción. Como alternativa a los saltos, `TRUST_PROXY_ADDRESSES` acepta IPs/CIDRs de proxies
confirmados; rechaza comodines, /0 y su combinación con `TRUST_PROXY_HOPS`.

### Verificación real

1. Después del deploy/reinicio, habilitar temporalmente el diagnóstico anterior.
2. Desde una red conocida ejecutar:
   ```powershell
   curl.exe --max-time 10 -H "X-Correlation-Id: proxy-check-normal" https://api.tusservicios.shop/health
   curl.exe --max-time 10 -H "X-Correlation-Id: proxy-check-forged" -H "X-Forwarded-For: 198.51.100.99" https://api.tusservicios.shop/health
   ```
3. Buscar ambos correlationId en Runtime logs. `details.clientIp` debe ser la IP pública de salida
   real en ambas peticiones; nunca `198.51.100.99`. `socketPeer` muestra el vecino inmediato;
   `forwardedFor` contiene solo IPs válidas, no otros headers ni credenciales.
4. Repetir desde otra red (por ejemplo, datos móviles). `clientIp` debe cambiar. Si aparece una IP
   interna, no aumentar los saltos a ciegas: identificar los peers con Hostinger y configurar sus
   direcciones o el número de saltos demostrado. Comprobar también cualquier URL alternativa del hosting.
5. Confirmar ausencia de `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`. Desactivar el diagnóstico:
   `TRUST_PROXY_DIAGNOSTICS=false`.

El test HTTP local conserva la validación de express-rate-limit y reproduce el problema:
el aviso se captura y se registra, y el primer POST llega a la ruta. **El aviso no bloquea**.
Con `trust proxy=false`, visitantes diferentes comparten el bucket del proxy y pueden recibir
429 cuando se agota. No se puede afirmar que un POST concreto de producción fue bloqueado sin su
status/correlationId. WhatsApp sigue teniendo su límite separado y exige la firma de Meta.

El logger enviaba todos los eventos mediante `console.error`: `info` y `warn` ahora van a stdout,
con su nivel JSON conservado; `error` va a stderr. El clasificador externo de hPanel puede seguir
mostrando una etiqueta de stream, pero los eventos informativos ya no se emiten como errores.

Fuentes: [Express behind proxies](https://expressjs.com/en/guide/behind-proxies/).
La [documentación de Hostinger CDN](https://www.hostinger.com/support/hostinger-cdn-visitor-ip-addresses-in-logs-and-analytics/)
describe otro escenario y no prueba el número de proxies internos de Node.js Web Apps.

## Caché de Hostinger delante de la API

Medido el 2026-10-01 con peticiones GET contra `https://api.tusservicios.shop` (sin acceso a hPanel):

- La API está detrás de Hostinger CDN (`server: hcdn`, `x-hcdn-cache-status: HIT | DYNAMIC`). Node no
  comprime: `Content-Encoding: br/gzip` lo agrega esa capa.
- Esa caché guardó las respuestas que la API marcaba `cache-control: public`. No respetó `Vary: Origin`
  ni `max-age=30` (se observaron objetos servidos 49 minutos después) y guardó la respuesta completa,
  incluidos `X-Correlation-Id` y `RateLimit-Remaining` de la petición original. También se vieron
  respuestas viejas con `x-hcdn-cache-status: DYNAMIC`.
- Efecto: una respuesta generada para una petición sin `Origin` (sin `Access-Control-Allow-Origin`) se
  reprodujo a los navegadores de la Web y la home falló de forma intermitente con "No
  'Access-Control-Allow-Origin' header is present". Las respuestas sin `cache-control: public`
  (`no-store` o sin cabecera) no se cachearon en ninguna de las pruebas.

Reglas que quedan en la aplicación:

- Las respuestas dinámicas de la API no usan caché pública: `cache-control: private, no-store` (o
  `private, max-age=N` solo para binarios que el navegador puede guardar). Lo fija
  `tests/foundation/tus-cache-compartida.test.mjs`, que además falla si algún handler vuelve a declarar
  `public`.
- CORS sigue respondiendo `Access-Control-Allow-Origin` con el origen permitido y `Vary: Origin`; no se
  resuelve este problema tocando CORS.
- Al probar la API de producción, enviar siempre `Origin: https://tusservicios.shop`.

Pendiente fuera del código (hPanel): purgar la caché del CDN para el dominio de la API y decidir si el
CDN debe cachear ese dominio. No se cambió ninguna configuración de Hostinger.

## Asistente de WhatsApp

- Prompt: `apps/api/src/tus/asistente/orquestador.ts`, versión `tus-whatsapp-v2`.
- Los mensajes de soporte estaban en ese prompt, `modelo.ts`, errores de vinculación/acciones,
  el escalamiento por baja confianza, el worker y dos documentos públicos del corpus.
- La intención se calculaba solo desde el último mensaje; ahora una continuación conserva `buscar`.
- El historial y resumen existentes permanecen; `state.draft` conserva oficio, problema y zona
  mediante la herramienta `collect_service_request`. La IA redacta la pregunta por lo faltante.
- `search_providers` pasa por `DominioAsistenteTus` y el directorio PostgreSQL compartido. El backend
  exige una necesidad completa y utiliza sus filtros guardados. RAG no es fuente de prestadores.
- Desde ASISTENTE-CONV-01 la necesidad completa es oficio + día (la zona y la descripción son opcionales) y la
  búsqueda con turnos reales la hace `find_appointments`; ver "Conversación, no formulario" en `WHATSAPP_IA_TUS.md`.
- Los resultados se presentan directamente desde los datos devueltos, sin una reescritura del modelo
  que agregue nombres/precios/calificaciones. Los IDs de candidatos quedan en el contexto para continuar.
- La búsqueda de WhatsApp exige cobertura declarada de zona. La Web conserva su ordenamiento existente.
  El catálogo actual **no incluye Ponce**: no debe confundirse comprensión del texto con cobertura
  cargada. Ampliar el catálogo de barrios y puntos aproximados requiere datos de ubicación comprobados.
- Un error no deriva automáticamente a un humano. Se recuperan los chats antes derivados automáticamente
  y sin operador asignado; una toma manual explícita del panel conserva sus controles.
- El texto neutral es: «Tuve un problema procesando tu solicitud. Probá nuevamente en unos minutos.»

Después de desplegar, reindexar el corpus contra la base correcta:

```powershell
corepack pnpm tus:rag:ingest -- --dry-run
corepack pnpm tus:rag:ingest
```

No se ejecutó ingest contra producción en esta tarea. Los tests conversacionales usan un modelo
guionado: verifican el flujo real de backend y sus restricciones, no evalúan la calidad de Groq en vivo.

## Admin, Authenticator y alta manual (sin consola y sin email)

Todo se hace desde el panel de variables de Hostinger y la Web; no hace falta ejecutar comandos en
Hostinger. La migración y la reindexación del corpus corren solas en el postinstall del deploy.

Variables en hPanel (reiniciar/redeploy después):

| Variable | Valor |
| --- | --- |
| `TUS_PLATFORM_ADMIN_EMAILS` | tu email de admin |
| `TUS_MFA_ENCRYPTION_KEY` | 32 bytes en base64. Se genera en tu propia PC (no en Hostinger) con PowerShell: `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`. No cambiarla después. |
| `TUS_ADMIN_BOOTSTRAP_CODE` | una frase larga que inventás vos (24+ caracteres). Borrarla cuando termines. |
| `TRUST_PROXY_HOPS` | `1` |

Pasos:

1. `/registro`: registrate con tu email de admin y una contraseña de 12+ caracteres (una frase larga).
2. `/activar-admin`: escribí tu email y el código de arranque. Esto confirma tu email sin mandar un mail.
3. `/sign-in`: entrá con email y contraseña (nunca con Google: una sesión de Google no es admin).
4. `/tus/admin/seguridad` → **Configurar autenticador**. En Google Authenticator: `+` → **Ingresar clave de
   configuración** → nombre `TUS` → pegá la clave que muestra la pantalla → **Basada en tiempo**. La app
   muestra un número de 6 dígitos que cambia cada 30 segundos: ese es el código que se escribe en TUS.
   Guardá los 8 códigos de recuperación.
5. Borrá `TUS_ADMIN_BOOTSTRAP_CODE` en Hostinger.
6. `/tus/admin/prestadores`: cargá prestadores. Si el email no tiene cuenta, se crea un **prestador
   administrado**: sin contraseña y sin email a confirmar, nadie puede iniciar sesión con él; sirve para
   cargar prestadores a mano y probar la búsqueda de la IA. Nunca se marca como identidad verificada.
   La zona tiene que ser una del catálogo (hoy no incluye Ponce).

Cada inicio de sesión nuevo pide contraseña + el código de 6 dígitos de la app.

## Archivos de esta fase

- Proxy/logs: `apps/api/src/platform/runtime.ts`, `apps/api/src/presentation/middleware/correlation.ts`,
  `apps/api/src/presentation/middleware/logger.ts`, `apps/api/src/server.ts`, `.env.example`.
- WhatsApp: `apps/api/src/tus/asistente/{modelo,herramientas,orquestador,ingreso,worker,dominio}.ts`;
  `apps/api/src/tus/directorio/servicio.ts`; `docs/conocimiento/{asistente-whatsapp,cancelaciones}.md`.
- Admin: `apps/api/src/tus/directorio/{admin,http}.ts`,
  `apps/api/src/auth-security/application/auth-service.ts`,
  `apps/web/src/app/tus/admin/prestadores/page.tsx`,
  `apps/web/src/components/admin/{prestadores-admin,seguridad-admin}.tsx`.
- Enlaces de email: `apps/web/src/features/auth/email-flows.tsx` (lectura única compatible con StrictMode).
- Tests: `proxy-logging`, `whatsapp-conversation-intake`, `tus-admin-providers`; ajustes a
  `whatsapp-asistente`, `whatsapp-webhook`, `tus-directorio` y el lector de resultados de escenarios
  `tests/foundation/fixtures/web-09-servicio.mjs` para distinguir stdout de logs y resultados.

Estos cambios conviven con los cambios de autenticación anteriores, todavía sin commit al comenzar la tarea.
