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

### SEC-01-H3: re-inicialización de organización por un miembro autenticado

**Severidad previa:** High. **Estado:** corregido.

`POST /tenancy/organizations` usaba el tenant de la sesión como `organizationId`, pero el servicio podía actualizar una
organización existente y volver a crear workspace, rol `Owner` y membership activa sin un gate de bootstrap. Un miembro podía
intentar cambiar el nombre/slug del tenant y obtener autoridad de Owner. La ruta fue retirada: no existe un caso de producto
para múltiples organizaciones por cuenta y el registro es el único dueño del bootstrap inicial.

Corrección:

- `AuthService.register()` y `registerFederated()` delegan el bootstrap completo al store de identidad dentro de su transacción.
- Prisma e in-memory crean usuario, tenant, organización inicial, workspace `Default`, rol `Owner` y membership activa; una
  falla posterior revierte el grafo completo.
- `POST /tenancy/organizations` ya no se monta como flujo HTTP; `p9-identity-http.test.mjs` verifica que no existe y los tests
  de auth verifican bootstrap por contraseña y Google con la misma forma.

### SEC-01-H4: colisión global de `calendarId` entre tenants

**Severidad previa:** High. **Estado:** corregido.

`Calendario.id` es una clave primaria global y el adapter Prisma usaba `upsert` por ese id. Un tenant podía enviar el id de
otra agenda y sobrescribirla o provocar una relación inconsistente.

Corrección:

- `ServiceCalendarService.createCalendar()` comprueba la existencia del id dentro de la transacción antes de guardar y devuelve
  `CALENDAR_ID_CONFLICT` sin revelar datos del tenant dueño.
- `PrismaServiceCalendarStore` repite el límite antes del `upsert` y rechaza cualquier tenant distinto.
- `tests/integration/tus/catalog-booking.test.mjs` prueba la colisión cross-tenant y confirma que la agenda original permanece.

### SEC-01-H5: autorización y consentimiento WhatsApp fail-open

**Severidad previa:** High. **Estado:** corregido.

Las acciones podían ejecutarse cuando no existía una política de sender y cuando `consent: true` no tenía un consentimiento
persistido activo.

Corrección:

- La ausencia de `authorizeSender`, allowlist o política persistida devuelve `sender_not_authorized`.
- La composición Prisma autoriza solo un `ContactoWhatsapp` vinculado a la cuenta y tenant de la sesión, sin bloqueo activo.
- Las acciones requieren `consent: true` y `ConsentimientoWhatsApp` persistido con estado `active`; ausencia o revocación devuelve
  `messaging_consent_required`.
- La procedencia se normaliza a `web_linking`, `whatsapp_inbound`, `operator_console` u `opt_out`; la ruta HTTP no acepta un
  origen arbitrario del body. `whatsapp_inbound` habilita evidencia de conversación, pero no mensajes plantilla outbound.
- La confirmación Web y la primera conversación inbound registran el origen y propósito en la auditoría del asistente; un inbound
  sin vinculación no recibe un tenant inventado.
- `tests/foundation/p8-tus-operations.test.mjs` y `tests/foundation/p9-support-operations.test.mjs` cubren ausencia de política,
  ausencia de consentimiento, sender no autorizado y el flujo HTTP de consentimiento previo a la acción.

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
| Bootstrap tenant  | El registro es el único dueño; crea el grafo inicial en una transacción y no existe endpoint de re-bootstrap. |
| Calendario        | `calendarId` colisionado entre tenants se rechaza antes del `upsert` global.                         |
| WhatsApp          | Sender vinculado y consentimiento persistido activo; configuración ausente falla cerrada.            |
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
- Solo se extraen DNI, nombre y CUIL; cuando la fuente entrega columnas separadas se puede conservar un área normalizada
  sin números (barrio/localidad/provincia), nunca la dirección textual. Snapshot mínimo; auditoría append-only con
  DNI/CUIL enmascarados; logs sin cookies, HTML, contraseñas ni documentos completos.
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

## Directorio de prestadores y solicitudes públicas

- La home muestra prestadores y sus zonas de atención, no solicitudes de clientes. `GET /tus/v1/public/prestadores`
  reutiliza `ServicioDirectorio` para oficio, zona y texto; el asistente Web y WhatsApp usa el mismo caso de uso.
- El DTO público contiene `publicArea`, `serviceZones`, modalidad de cobertura y `mapLocations` con precisión `zone`.
  Las coordenadas son centros de zonas conocidas, redondeados a 3 decimales; no representan domicilios.
- La ubicación efectiva sigue este orden: zonas configuradas por el prestador; área normalizada de una identidad verificada;
  o `locationSource=none` sin pin. El fallback nunca copia dirección, calle, altura, documento o coordenadas exactas al perfil.
- El perfil permite zona principal, varias zonas, modalidad local/domicilio/mixta y radio opcional. La sesión decide el tenant
  y el actor; el body no puede aportar tenant, actor, coordenadas ni dirección.

`GET /tus/v1/public/solicitudes` permanece público para compatibilidad y alimenta la sección separada de solicitudes recientes;
no es la fuente del mapa principal.

### Solicitudes de servicio (mapa público histórico)

- `GET /tus/v1/public/solicitudes` es público y solo devuelve: categoría, título, descripción, nombre + inicial, barrio,
  punto aproximado (centro del barrio ±~300 m, 3 decimales), presupuesto máximo, urgencia y fecha. Nunca el id de cuenta,
  email, teléfono ni dirección (no existen columnas para eso). `cache-control: private, no-store`: nunca `public`, porque
  una caché compartida delante de la API reprodujo estas respuestas entre orígenes (ver
  `docs/HOSTINGER_WHATSAPP_ADMIN.md`, "Caché de Hostinger delante de la API").
- Publicar (`POST /tus/v1/solicitudes`) exige sesión TUS de una cuenta activa con email verificado. La cuenta, el nombre
  público y las coordenadas los decide la API: si el cliente manda `accountId`, `lat`, `lng`, `status`, `requesterName` o un
  `tenantId`/`actorId` ajeno se responde 403.
- El texto público rechaza teléfonos, emails y links (validación en API y Web) para que el contacto ocurra dentro de TUS.
- Anti-abuso: 5 publicaciones por cuenta cada 24 h, 10 abiertas a la vez, vigencia 30 días, más el rate limit global.
  Solo la dueña puede cerrar su solicitud.
- La Web nunca habla con la base: todo pasa por la API (Prisma). No hay claves de Supabase en el frontend.
- **Data API de Supabase cerrada (SEGURIDAD-DATA-API-01).** TUS usa Supabase solo como PostgreSQL, pero Supabase publica
  el esquema `public` por PostgREST/GraphQL y les da permisos a los roles `anon` y `authenticated`: con la clave pública
  se podía leer y escribir cualquier tabla (alertas `rls_disabled_in_public` y `sensitive_columns_exposed`). La
  migración `20261110100000_tus_data_api_cerrada` les revoca todo permiso sobre tablas, secuencias y funciones de
  `public`, también sobre lo que creen migraciones futuras, y habilita RLS sin ninguna política en todas las tablas
  (deny by default). No se crean políticas: nada tiene que ser público. La API es la propietaria de las tablas y no
  queda sujeta a RLS; nunca se usa `FORCE ROW LEVEL SECURITY`. Una migración posterior que cree una tabla tiene que
  habilitarle RLS (lo exige `tests/foundation/tus-data-api-cerrada-postgres.test.mjs`).
  - El despliegue lo comprueba solo: antes de aplicar una migración que habilita RLS, `scripts/db/migrate-deploy.mjs`
    exige que el rol de `DATABASE_URL` (la API) sea el propietario de las tablas, superusuario o `BYPASSRLS`. Si las dos
    URLs usan el mismo rol (el caso de producción: `postgres`), queda decidido sin abrir ninguna conexión. Si son roles
    distintos, se le pregunta a la base con `pg`, el driver de la API, con un límite de 30 segundos. Si no se cumple,
    no aplica nada y el despliegue falla (`runtime-role-not-owner`): sigue corriendo la API anterior.
  - Nunca se corre un comando de Prisma sobre `DATABASE_URL`: es una conexión por pooler y el motor de esquema de
    Prisma no está hecho para eso (para eso existe `DIRECT_URL`). El despliegue del 2026-10-07 quedó colgado diez
    minutos por hacerlo; no llegó a aplicar ninguna migración. Cada paso del script ahora dice su nombre, cuánto
    esperó y qué alcanzó a imprimir cuando no termina, sin datos de la conexión.
  - A mano, lo mismo: correr el bloque 8 de `scripts/db/auditoria-prestadores.sql` con la URL de
    runtime y comprobar que el rol es el propietario de las tablas (`tablas_de_otro_propietario = 0`).
  - Después: el bloque 7 no debe devolver filas, y el Security Advisor de Supabase no debe listar esas dos alertas.
  - Recomendado además, fuera de SQL: Project Settings → Data API → quitar `public` de "Exposed schemas" (o apagar la
    Data API). Los logs de PostgREST del proyecto son la única fuente para saber si alguien usó ese acceso.

## Buscar trabajador, asistente y solicitudes dirigidas

- DTO públicos explícitos (`@factory/contracts`, `tus-directorio.ts`): nunca salen `tenantId`, `prestadorId`, email,
  teléfono, dirección, coordenadas, DNI ni CUIL; el id público es el del perfil. `rating` es siempre `null`: TUS no tiene
  reseñas todavía y nada se inventa. Verificación, trabajos completados y horarios los calcula TUS, no el prestador.
- El directorio y el perfil son públicos; buscar candidatos con el asistente, crear solicitudes, subir fotos y ver la
  bandeja requieren sesión. El prestador solo edita su perfil (`tus:marketplace:write`, sin campos de autoridad).
- La IA no consulta la base: el asistente Web interpreta el texto con reglas determinísticas y llama a los mismos casos de
  uso (`ServicioDirectorio`, `ServicioSolicitudes`) que "Buscar trabajador" y que las herramientas de WhatsApp
  (`search_providers`, `request_provider` con confirmación explícita). El cliente siempre elige; la solicitud dirigida
  queda `pendiente` hasta que el prestador destino acepta. Solo el tenant destino puede responder.
- La Web solo puede declarar orígenes Web; `whatsapp` lo fija el servidor. Un prestador no puede pedirse a sí mismo.
- Fotos: tipo por magic bytes, sin metadata, máx. 3 MB y 2 por solicitud; respuesta con `nosniff`,
  `default-src 'none'` y `cross-origin-resource-policy: cross-origin` (la Web está en otro dominio). Las de solicitudes
  dirigidas se sirven solo con sesión (dueña o prestador destino) y `no-store`.

## Identidad por teléfono (WhatsApp iniciado por el usuario)

- El único número que verifica es el remitente (`wa_id`) del webhook oficial, después de validar la firma de Meta; la
  Web nunca lo aporta. El desafío se reconoce antes del asistente: nunca llega a Groq, a herramientas ni a búsquedas.
- Código de 8 símbolos con `crypto.randomInt`, solo hash en la base, 10 minutos, un solo uso (UPDATE condicional),
  invalidado tras 5 envíos desde un número equivocado; el texto entrante se guarda redactado. Consumir el desafío y
  fijar el teléfono ocurren en una transacción; el UNIQUE de PostgreSQL decide si el número ya es de otra persona.
- Sin enumeración: registro con email existente, recuperación con teléfono desconocido y estado por secreto de consulta
  responden igual que un caso real; los límites de registro se evalúan antes de saber si la cuenta existe.
- Webhooks repetidos (`wamid`) no producen efectos ni respuestas duplicadas; un fallo de Meta al responder no revierte la
  identidad.
- Auditoría (`phone.*`) con números enmascarados. El admin nunca marca un teléfono como verificado.

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
- [ ] Re-inicializar una organización existente no cambia su metadata ni crea Owner membership.
- [ ] Reutilizar un `calendarId` ajeno no sobrescribe ni devuelve la agenda del tenant dueño.
- [ ] Acciones WhatsApp sin sender vinculado o consentimiento persistido activo terminan en handoff y no mutan.
- [ ] `TUS_MERCADOPAGO_ENABLED=false` y configuración persistida de pagos deshabilitada.

## Regla de decisión

El gate es **FAIL** ante cualquier Critical/High explotable, secreto expuesto, migración no ensayada, target DB ambiguo,
`/ready` distinto de 200, proxy no medido o pagos habilitados. No se compensa un fallo con documentación ni aceptación
manual sin corregir o aislar técnicamente el riesgo.
