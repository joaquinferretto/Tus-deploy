# Cambios de proxy, WhatsApp y administración

## Estado y alcance

Implementación local; este documento no acredita un despliegue ni una medición del tráfico de producción.
El usuario confirmó Node.js Web Apps de hPanel, sin Hostinger CDN ni Cloudflare. No hay una sesión de
hPanel conectada a esta ejecución. No se cambiaron variables del panel ni credenciales.

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

## Asistente de WhatsApp

- Prompt: `apps/api/src/tus/asistente/orquestador.ts`, versión `tus-whatsapp-v2`.
- Los mensajes de soporte estaban en ese prompt, `modelo.ts`, errores de vinculación/acciones,
  el escalamiento por baja confianza, el worker y dos documentos públicos del corpus.
- La intención se calculaba solo desde el último mensaje; ahora una continuación conserva `buscar`.
- El historial y resumen existentes permanecen; `state.draft` conserva oficio, problema y zona
  mediante la herramienta `collect_service_request`. La IA redacta la pregunta por lo faltante.
- `search_providers` pasa por `DominioAsistenteTus` y el directorio PostgreSQL compartido. El backend
  exige una necesidad completa y utiliza sus filtros guardados. RAG no es fuente de prestadores.
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

## Admin, Authenticator y alta manual

Configurar en Hostinger (sin copiar secretos al chat):

| Variable | Configuración |
| --- | --- |
| `TUS_PLATFORM_ADMIN_EMAILS` | El email de tu cuenta admin, ya configurado según lo informado |
| `TUS_MFA_ENCRYPTION_KEY` | Una clave aleatoria estable de 32 bytes en base64; no es el código del teléfono |
| `TUS_ROUTES_ENABLED` | `true` |
| `TUS_WEB_BASE_URL` | `https://tusservicios.shop` |
| `CORS_ORIGINS` | `https://tusservicios.shop,https://www.tusservicios.shop` |
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | Credencial privada de Resend |
| `EMAIL_FROM` | Remitente autorizado en el dominio verificado de Resend |

Mantener la clave MFA: reemplazarla hace ilegibles los secretos ya enrolados. Ejecutar las migraciones
pendientes, incluida `auth_rate_limits`, como parte del release; no asumir que el código local ya existe en producción.

1. Registrarse con el email permitido o utilizar la cuenta existente. Confirmar el email.
2. Iniciar sesión con **email y contraseña de TUS**. Google no concede administración. La allowlist
   no crea ni cambia la contraseña. No se comprobó ni reutilizó la contraseña escrita en el chat;
   la política de registro/reset exige 12–256 caracteres y rechaza contraseñas filtradas.
3. Abrir `/tus/admin/seguridad` y pulsar **Configurar autenticador**.
4. En Google Authenticator: agregar cuenta → ingresar clave de configuración → nombre TUS →
   copiar la clave que muestra **esa pantalla privada**, elegir basada en tiempo. También existe
   el enlace `otpauth` para abrir una app compatible en el teléfono.
5. Escribir en TUS el código actual de seis dígitos. Guardar los códigos de recuperación fuera del chat.
   Este paso lo realiza el titular con su teléfono; no se puede dar por completado desde el repositorio.
6. Abrir `/tus/admin/prestadores`. El nuevo permiso `tus:providers:admin` requiere un inicio de sesión
   nuevo después del despliegue; todas las rutas lo verifican detrás de la elevación MFA.

La pantalla permite crear/actualizar el perfil de un prestador con **cuenta activa y email confirmado**:
email, nombre público, oficio, zona, modalidad y descripción. No crea cuentas ni contraseñas por otro,
no cambia identidades verificadas, precios, calificaciones ni trabajos completados. Reutiliza onboarding
y directorio, conserva las restricciones de publicación y registra al admin como actor de auditoría.
No reactiva prestadores previamente suspendidos/no aprobados.

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
