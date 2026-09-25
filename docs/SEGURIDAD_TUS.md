# Seguridad TUS: auditoría SEC-01 y release gate

> Corte auditado: 2026-09-24, rama `web-tus`, pagos productivos apagados. Esta revisión es estática y local; no constituye
> un pentest externo ni evidencia de infraestructura Hostinger/Vercel/PostgreSQL.

## Veredicto

**SECURITY RELEASE GATE (código): PASS.** No queda un Critical/High explotable conocido en el código revisado después de
las correcciones SEC-01.

**RELEASE STAGING GLOBAL: NO-GO.** Faltan controles externos y operativos: validar la cadena completa sobre PostgreSQL 16
descartable con pgvector, confirmar topología de proxy Hostinger, ejecutar builds limpios en Linux, configurar Vercel y
probar `/health`/`/ready` sin habilitar Mercado Pago. Un fallo en cualquiera de esos puntos vuelve el gate a FAIL.

## Alcance

- Registro, login, verificación, recuperación, sesiones y cambio de credenciales.
- Tenancy, invitations, memberships, roles, aislamiento e IDOR.
- Middleware HTTP: CORS, Helmet, body limits, errores, logs, rate limit y reverse proxy.
- Rutas TUS, trabajos, finanzas y administración de pagos.
- OAuth Mercado Pago, cifrado de tokens, checkout, webhooks, conciliación y refunds.
- Web Next.js, URLs públicas y exposición de secretos.
- Prisma/PostgreSQL, migraciones, readiness, TLS y conexiones.
- Dependencias, CI y contratos de despliegue Hostinger/Vercel.

Fuera de alcance: llamadas reales a Mercado Pago, credenciales reales, provisioning, migraciones sobre DB real, pruebas
de carga, DAST contra un host público y revisión legal/fiscal.

## Hallazgos Critical/High corregidos

### SEC-01-H1: apropiación de tenant por registro público

**Severidad previa:** High. **Estado:** corregido.

`POST /auth/register` aceptaba `tenantId` del body. Un atacante podía usar un tenant publicado por marketplace, verificar
su propio correo y obtener una sesión `member` con permisos TUS del tenant víctima. Esto habilitaba lectura de trabajos y
datos financieros del prestador, y podía encadenarse con impersonación de un tenant cliente.

Corrección:

- `apps/api/src/auth-security/http/auth-router.ts` ya no transmite `tenantId`.
- `apps/api/src/auth-security/application/auth-service.ts` siempre genera un tenant nuevo y rol `owner` para altas
  públicas.
- La unión a un tenant existente queda reservada a un flujo futuro de invitación de un solo uso; no hay fallback por ID.
- `tests/foundation/p1-auth-lifecycle.test.mjs` y `p9-identity-http.test.mjs` prueban que un `tenantId` malicioso se ignora.

### SEC-01-H2: sesión válida después de revocar membership

**Severidad previa:** High. **Estado:** corregido.

El resolver verificaba sesión y `Account`, pero no el estado actual de `Membership`. Un token ya emitido podía conservar
acceso hasta expirar después de una revocación.

Corrección:

- `IdentityStore.hasActiveMembership()` forma parte del contrato de identidad.
- `PrismaIdentityStore` consulta una membership `active` del usuario y tenant en cada resolución.
- `DurableIdentitySessionResolver` falla cerrado si la membership falta o fue revocada.
- Existe regresión que reutiliza el mismo token antes y después de revocar autoridad.

## Controles verificados

| Área              | Resultado                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Autoridad HTTP    | Tenant/actor se derivan de la sesión; headers/body incompatibles se rechazan.                        |
| CORS              | Allowlist exacta por `CORS_ORIGINS`; no wildcard con credenciales.                                   |
| Proxy             | `TRUST_PROXY_HOPS` acepta solo 1..10; default `false`; nunca `trust proxy=true`.                     |
| Rate limit        | Bucket global 100/15 min y bucket auth independiente 10/15 min; prefijos Redis separados.            |
| Errores/logs      | Envelopes acotados, correlation ID y redacción de URLs/secretos.                                     |
| Body limits       | JSON 1 MB, form 100 KB y upload 10 MB.                                                               |
| Sesiones          | Tokens opacos almacenados como digest; expiración, revocación y membership activa.                   |
| Password recovery | Respuesta no enumerable, token de un uso, TTL y revocación de sesiones.                              |
| OAuth MP          | State aleatorio de un uso, PKCE S256, redirect estático y tokens AES-256-GCM ligados al tenant.      |
| Checkout MP       | Monto/moneda/comisión derivados del servidor; URL HTTPS limitada a dominios Mercado Pago.            |
| Webhook MP        | Firma y timestamp antes de lookup; validación server-to-server; inbox durable e idempotencia.        |
| Refunds           | Admin tenant + permiso específico + idempotencia; resultados ambiguos pasan a revisión.              |
| Frontend          | No hay secretos en `NEXT_PUBLIC_*`; el retorno del navegador nunca confirma un pago.                 |
| PostgreSQL        | TLS obligatorio en producción; runtime pooled separado de migración directa; pool auxiliar máximo 2. |
| Migraciones       | Lock Prisma PostgreSQL y readiness exige tablas WEB-09D/E. No se aplicó ninguna migración real.      |

## Riesgos residuales

### Medium

- Los permisos de una sesión se congelan al emitirla. La revocación de membership corta acceso inmediatamente, pero un
  cambio de roles/permisos requiere revocar sesiones o esperar su TTL de una hora. Antes de administración delegada se
  debe derivar autorización de roles persistidos o revocar sesiones al modificar roles.
- El limiter usa memoria si Redis está apagado. Es válido para una sola instancia de staging, pero un despliegue con varias
  instancias requiere Redis y pruebas de bucket distribuido.
- La verificación de email todavía usa un sender in-memory. En staging, las cuentas del equipo requieren un procedimiento
  operativo auditado; producción necesita proveedor de correo antes de registro público.
- La topología real de Hostinger no fue observada. `TRUST_PROXY_HOPS=1` solo es correcto si existe exactamente un salto de
  proxy y el proceso Node no es accesible directamente.
- Se ejecutó `pnpm audit --prod` contra el advisory feed; no se ejecutó DAST contra un host público. El lockfile y las
  acciones de CI deben revisarse periódicamente; un advisory High/Critical vigente en el target de staging hace fallar el gate.
- La actualización local de esta fase llevó Next a `15.5.26` y fijó `sharp>=0.35.4`, `postcss>=8.5.23` y `qs>=6.16.0`.
  El audit global actual no tiene Critical y conserva 19 High/6 moderate exclusivamente bajo `apps/mobile`/Expo, que no
  forma parte del despliegue Hostinger/Vercel de esta fase. La remediación móvil queda pendiente y bloquea una aprobación
  de seguridad del monorepo completo, aunque no el alcance API/Web una vez repetido el audit scoped.
- `/ready` comprueba el piso de tablas del release, no la versión de pgvector ni filas fallidas de `_prisma_migrations`.
  Esos controles siguen en el release job/runbook.

### Low

- Health no expone commit/schema floor, por lo que la trazabilidad del rollback depende del panel de despliegue.
- Las GitHub Actions usan tags mayores y no SHAs inmutables.
- Vercel Preview necesita dominios estables o allowlist explícita; no se habilitan wildcards CORS.

## IDENTITY-NOSIS: controles de identidad de prestadores

- DNI: magic bytes (el Content-Type no decide), 8 KB–8 MB, parseo estructural, rechazo de SVG/HTML/ejecutables, EXIF/GPS/XMP
  y chunks de texto eliminados antes de guardar; cifrado AES-256-GCM con `TUS_IDENTITY_DOCUMENTS_KEY` y AAD por
  verificación/lado; sin URL pública. Solo el admin de plataforma (`tus:identity:admin` + tenant de plataforma) ve las
  imágenes, con `no-store`, `nosniff` y CSP `default-src 'none'`.
- Tenancy: el prestador opera solo sobre la verificación de su tenant de sesión; campos de autoridad falsificados → 403.
- Enviar solo encola (202): la API nunca abre un navegador ni espera a Nosis.
- Sesión de Mi Nosis cifrada con `TUS_NOSIS_SESSION_KEY`; credenciales solo como secretos del host del worker.
- Desafíos de terceros (reCAPTCHA/hCaptcha/Turnstile) **no se automatizan**: pasan a `session_required` y login humano.
- Solo se extraen DNI, nombre y CUIL; snapshot mínimo; auditoría append-only con DNI/CUIL enmascarados; logs sin
  cookies, HTML, contraseñas ni documentos completos.
- DNI/CUIL verificados únicos por índice parcial; aprobación manual exige motivo y revisa duplicados.
- Riesgo residual (Medium): los selectores de Mi Nosis se validaron solo contra un mock; la primera consulta real debe
  hacerse con `pnpm tus:identity:nosis-check` y un DNI autorizado. Low: `aceptarConsentimiento` permite reiniciar una
  verificación `rejected` por API (la Web no lo ofrece); cada reintento consume un cupo de 7/h.
- Privacidad (Medium, decisión legal): el lector de visión envía frente y dorso del DNI a Groq (procesador externo) por
  HTTPS. Revisar términos de retención de Groq y, si corresponde, mencionar el procesamiento por IA en el consentimiento
  (hoy dice "fuentes externas de validación"). Sin `GROQ_API_KEY_1..6` ni `GROQ_API_KEY` no se envía nada y todo va a revisión manual.

## Ingreso y registro con Google (OIDC)

- Un único flujo Authorization Code + PKCE ejecutado por la API (`/auth/oauth/google/start` → Google →
  `/auth/oauth/google/callback`). La Web solo navega al endpoint de inicio: `GOOGLE_CLIENT_SECRET` vive únicamente en la API
  y no existe ninguna variable `NEXT_PUBLIC_GOOGLE_*`.
- La API valida `state` (sha256 guardado, consumo atómico de un solo uso, expira en minutos), `nonce`, PKCE S256, firma
  RS256 del `id_token` contra el JWKS de Google (`kid`, caché según `max-age`), `iss`, `aud`, `exp` y `email_verified`.
- **Decisión `email_verified`:** si Google no confirma el email se rechaza el ingreso (`google_email_not_verified`). Por eso
  una cuenta creada con Google nace con `emailVerifiedAt` y puede iniciar sesión sin el correo de verificación.
- Identidad permanente = proveedor + emisor + `sub` (`identidades_externas`, única). El email nunca identifica.
- Vinculación segura: si el email ya pertenece a una cuenta TUS no se crea otra ni se vincula en silencio; se pide
  iniciar sesión con contraseña y la vinculación exige una sesión de menos de 10 minutos, el mismo email y que ese `sub` no
  esté vinculado a otra cuenta. Solo quien controla un Google con ese email verificado llega a esa pantalla, así que no
  habilita enumeración de cuentas; el login por contraseña sigue devolviendo el mismo mensaje para email o clave incorrectos.
- El callback entrega a la Web un código de un solo uso en el fragmento (`#code=`), nunca un token de sesión; la Web lo
  canjea por POST y obtiene la misma sesión TUS (Bearer opaco en `sessionStorage`) que el login con contraseña.
  `Referrer-Policy: no-referrer` en el callback; rate limit en canje, alta y vinculación.
- No se guardan access tokens ni refresh tokens de Google. Sin las tres variables `GOOGLE_*` y `TUS_WEB_BASE_URL` el
  proveedor queda deshabilitado (fail closed) y la Web muestra el botón como no disponible.
- El registro con Google exige aceptar términos. La "intención" (contratar u ofrecer servicios) solo elige la pantalla
  siguiente; los roles los decide el backend.

## Solicitudes de servicio (mapa público)

- `GET /tus/v1/public/solicitudes` es público y solo devuelve: categoría, título, descripción, nombre + inicial, barrio,
  punto aproximado (centro del barrio ±~300 m, 3 decimales), presupuesto máximo, urgencia y fecha. Nunca el id de cuenta,
  email, teléfono ni dirección (no existen columnas para eso). `cache-control: public, max-age=30`.
- Publicar (`POST /tus/v1/solicitudes`) exige sesión TUS de una cuenta activa con email verificado. La cuenta, el nombre
  público y las coordenadas los decide la API: si el cliente manda `accountId`, `lat`, `lng`, `status`, `requesterName` o un
  `tenantId`/`actorId` ajeno se responde 403.
- El texto público rechaza teléfonos, emails y links (validación en API y Web) para que el contacto ocurra dentro de TUS.
- Anti-abuso: 5 publicaciones por cuenta cada 24 h, 10 abiertas a la vez, vigencia 30 días, más el rate limit global.
  Solo la dueña puede cerrar su solicitud.
- La Web nunca habla con la base: todo pasa por la API (Prisma). No hay claves de Supabase en el frontend.

## Gate obligatorio antes de staging

- [ ] Working tree esperado y commit/release ID registrados; `opencode.json` fuera del cambio.
- [ ] Secret scan y revisión de variables públicas sin hallazgos.
- [ ] Typecheck API/Web y tests SEC-01 en verde.
- [ ] Builds dependency-aware desde checkout limpio: `@factory/api...` y `@factory/web...`.
- [ ] PostgreSQL 16 exacto, TLS, `vector`, DB fresh y URLs pooled/direct apuntando a la misma base.
- [ ] Migraciones probadas primero en una base descartable; cero filas fallidas en `_prisma_migrations`.
- [ ] Hostinger con Node 22, pnpm 9.15.9, `NATIVE_PROFILE=1`, proxy medido y pagos apagados.
- [ ] Vercel sin secretos y con `NEXT_PUBLIC_API_URL` canónica.
- [ ] CORS contiene solo el origen Web exacto.
- [ ] `/health` 200, `/ready` 200 y shutdown SIGTERM dentro del grace period.
- [ ] Registro malicioso con `tenantId` no obtiene el tenant pedido.
- [ ] Membership revocada invalida inmediatamente el token existente.
- [ ] `TUS_MERCADOPAGO_ENABLED=false` y configuración persistida de pagos deshabilitada.

## Regla de decisión

El gate es **FAIL** ante cualquier Critical/High explotable, secreto expuesto, migración no ensayada, target DB ambiguo,
`/ready` distinto de 200, proxy no medido o pagos habilitados. No se compensa un fallo con documentación ni aceptación
manual sin corregir o aislar técnicamente el riesgo.
