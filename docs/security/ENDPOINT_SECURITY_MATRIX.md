# Matriz de Seguridad y Autorización de Endpoints — TUS

Esta matriz documenta de forma exhaustiva los endpoints HTTP expuestos por la API de TUS, su esquema de autenticación, rol requerido, elevación MFA, aislamiento multi-tenant/ownership, validación de entrada y control de tasa (rate limiting).

Fecha de corte baseline: 2026-09-30 (Auditoría previa a Fases Turnos / UX-UI / WhatsApp / Alojamientos).

---

## Convenciones de Columnas
- **Method**: Verbo HTTP (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
- **Route**: Ruta canónica y aliases.
- **Auth**: Tipo de autenticación (`Public`, `Session / Bearer`, `MFA Elevated`, `Webhook Signature`, `Internal`).
- **Role**: Rol requerido en la plataforma (`Cualquiera`, `Cliente`, `Prestador`, `Admin`).
- **MFA**: Si requiere sesión administrativa con elevación de segundo factor TOTP activa.
- **Tenant / Owner**: Regla de pertenencia (derivada estrictamente del token de sesión o del registro autenticado, mitigando IDOR).
- **Input Validation**: Mecanismo de validación server-side (`Zod`, `Allowlist`, `Schema`).
- **Rate Limit**: Política de rate limit aplicada (`Global`, `Auth / Sensitive`, `Webhook`, `None`).
- **Notes**: Descripción de control y observaciones de seguridad.

---

## 1. Endpoints Públicos y de Infraestructura

| Method | Route | Auth | Role | MFA | Tenant / Owner | Input Validation | Rate Limit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | Public | Cualquiera | No | N/A | None | Global | Liveness probe básica. |
| `GET` | `/ready` | Public | Cualquiera | No | N/A | None | Global | Readiness probe acotada con timeout de conexión. |
| `GET` | `/version` | Public | Cualquiera | No | N/A | None | Global | Versión y commit de despliegue. |
| `GET` | `/tus/seo/robots.txt` | Public | Cualquiera | No | N/A | None | Global | Robots para indexación de motores de búsqueda. |
| `GET` | `/tus/seo/sitemap` | Public | Cualquiera | No | N/A | None | Global | Sitemap SEO público. |
| `POST` | `/tus/seo/discovery-model` | Public | Cualquiera | No | N/A | Zod | Global | Metadatos de descubrimiento SEO. |

---

## 2. Autenticación y Cuentas Públicas

| Method | Route | Auth | Role | MFA | Tenant / Owner | Input Validation | Rate Limit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/auth/register` | Public | Cualquiera | No | Crea nuevo Tenant | Zod | Auth / Sensitive | Registro público crea cuenta, tenant y rol `owner` atómico. Ignora `tenantId` provisto por el cliente. |
| `POST` | `/auth/sign-in` | Public | Cualquiera | No | Deriva de cuenta | Zod | Auth / Sensitive | Inicio de sesión con contraseña. Retorna token y setea cookie HttpOnly. |
| `POST` | `/auth/verify-email` | Public | Cualquiera | No | Token acotado | Zod | Auth / Sensitive | Verificación de correo por token con hash en DB. |
| `POST` | `/auth/verify-email/resend` | Public | Cualquiera | No | Rate-limited | Zod | Auth / Sensitive | Reenvío de confirmación con ventana de enfriamiento. |
| `POST` | `/auth/recovery/request` | Public | Cualquiera | No | N/A | Zod | Auth / Sensitive | Solicitud de reset de password. Respuesta ciega contra enumeración. |
| `POST` | `/auth/recovery/complete` | Public | Cualquiera | No | Token acotado | Zod | Auth / Sensitive | Consumo de token de recuperación de un solo uso. |
| `POST` | `/auth/register` (con `phone`) | Public | Cualquiera | No | Crea nuevo Tenant | Normalizador único | Teléfono + IP (antes de saber si el email existe) | Devuelve el desafío de WhatsApp; un email ya registrado recibe uno de forma idéntica que no verifica nada (sin enumeración). Teléfono inválido: 422 sin crear cuenta. |
| `GET` | `/auth/phone/config` | Public | Cualquiera | No | N/A | None | Cache 5 min | Solo el número oficial PÚBLICO de WhatsApp (`TUS_WHATSAPP_PUBLIC_NUMBER`), nunca tokens. |
| `GET` | `/auth/phone` | Bearer / Cookie | Cualquiera | No | Cuenta de la sesión | None | Global | Teléfono de identidad propio, enmascarado. |
| `POST` | `/auth/phone/challenges` | Bearer / Cookie | Cualquiera | No | Cuenta de la sesión (nunca del body) | Normalizador único | Cuenta 5/15 min, teléfono 5/h, IP 30/15 min | Verificar o cambiar el número; la identidad actual sigue hasta probar el nuevo desde SU WhatsApp. |
| `GET` | `/auth/phone/challenges/:id` | Bearer / Cookie | Cualquiera | No | Solo desafíos propios (404 ajenos) | None | Global | Estado del desafío. |
| `POST` | `/auth/phone/challenges/:id/status` | Public | Cualquiera | No | Secreto de consulta (hash) | None | Global | Solo `pending`/`verified` y sin datos: un desafío falso o desconocido es indistinguible. |
| `POST` | `/auth/phone/challenges/:id/renew` | Public | Cualquiera | No | Secreto de consulta | None | Teléfono + IP | Código nuevo del mismo flujo; desconocido -> falso. |
| `POST` | `/auth/phone/pending` | Public | Cualquiera | No | Prueba de contraseña (mismo limitador y fallo genérico que el ingreso) | Normalizador único | Ingreso + teléfono + IP | Retoma la verificación de una cuenta que nunca verificó. |
| `POST` | `/auth/recovery/whatsapp` | Public | Cualquiera | No | N/A | Normalizador único | Teléfono 3/15 min + IP | Recuperación por WhatsApp; misma respuesta para teléfonos desconocidos; el token de recuperación normal se entrega una sola vez por el estado. |
| `GET` | `/auth/oauth/providers` | Public | Cualquiera | No | N/A | None | Global | Lista proveedores OAuth activos (Google). |
| `GET` | `/auth/oauth/google/start` | Public | Cualquiera | No | N/A | State / Nonce | Auth / Sensitive | Inicio de flujo OAuth con CSRF state mitigado. |
| `GET` | `/auth/oauth/google/callback` | Public | Cualquiera | No | N/A | State verificado | Auth / Sensitive | Redirección con código de un solo uso. |
| `POST` | `/auth/oauth/exchange` | Public | Cualquiera | No | PKCE / Code | Zod | Auth / Sensitive | Intercambio de código por sesión. |
| `POST` | `/auth/oauth/signup/preview` | Public | Cualquiera | No | Token de preview | Zod | Auth / Sensitive | Vista previa de datos federados. |
| `POST` | `/auth/oauth/signup` | Public | Cualquiera | No | Crea nuevo Tenant | Zod | Auth / Sensitive | Alta atómica de cuenta Google federada. |

---

## 3. Sesión y Credenciales Autenticadas

| Method | Route | Auth | Role | MFA | Tenant / Owner | Input Validation | Rate Limit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/auth/session` | Bearer / Cookie | Usuario | No | Sesión actual | None | Global | Retorna tenant, accountId y permisos del usuario activo. |
| `GET` | `/auth/account` | Bearer / Cookie | Usuario | No | Sesión actual | None | Global | Perfil de cuenta del usuario logueado. |
| `POST` | `/auth/sign-out` | Bearer / Cookie | Usuario | No | Sesión actual | None | Global | Revocación de sesión e invalidación de cookie. |
| `PATCH` | `/auth/accounts/:accountId` | Bearer / Cookie | Usuario / Admin | No | IDOR checked | Zod | Global | Modificación de perfil propio o por Admin. |
| `POST` | `/auth/credentials/password` | Bearer / Cookie | Usuario | No | Sesión actual | Zod | Auth / Sensitive | Cambio de contraseña con validación de password actual. |
| `POST` | `/auth/credentials/:credentialId/disable` | Bearer / Cookie | Usuario | No | IDOR checked | Zod | Auth / Sensitive | Desactivación de credencial propia. |
| `POST` | `/auth/oauth/link/preview` | Bearer / Cookie | Usuario | No | Sesión actual | Zod | Auth / Sensitive | Vista previa de vinculación de cuenta federada. |
| `POST` | `/auth/oauth/link` | Bearer / Cookie | Usuario | No | Sesión actual | Zod | Auth / Sensitive | Vinculación federada a cuenta existente. |

---

## 4. Directorio Público y Búsqueda

| Method | Route | Auth | Role | MFA | Tenant / Owner | Input Validation | Rate Limit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/tus/v1/public/oficios` | Public | Cualquiera | No | N/A | None | Global | Catálogo público de oficios y categorías activas. |
| `GET` | `/tus/v1/public/prestadores` | Public | Cualquiera | No | N/A | Query params | Global | Listado de prestadores visibles para el mapa y directorio. Ubicación exacta filtrada si `mostrarUbicacionExacta = false`. |
| `GET` | `/tus/v1/public/prestadores/:id` | Public | Cualquiera | No | N/A | Param ID | Global | Perfil público de un prestador visible. |
| `GET` | `/tus/v1/public/solicitudes` | Public | Cualquiera | No | N/A | Query params | Global | Solicitudes públicas abiertas. Oculta datos privados de contacto. |
| `GET` | `/tus/v1/public/solicitudes/:id/imagenes/:orden` | Public | Cualquiera | No | N/A | Param ID + orden | Global | Entrega segura de imágenes de solicitudes públicas (MIME validado). |
| `POST` | `/tus/v1/asistente/ayuda` | Public | Cualquiera | No | N/A | Zod | Global | Ayuda extractiva para usuarios sin sesión. |
| `POST` | `/tus/v1/asistente/interpretar` | Public | Cualquiera | No | N/A | Zod | Global | Clasificación de oficios por intención de texto. |
| `POST` | `/tus/v1/asistente/candidatos` | Public | Cualquiera | No | N/A | Zod | Global | Recomendación de prestadores candidatos. |

---

## 5. Solicitudes y Trabajos (Cliente y Prestador)

| Method | Route | Auth | Role | MFA | Tenant / Owner | Input Validation | Rate Limit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/tus/v1/solicitudes/mias` | Bearer / Cookie | Cliente | No | `tenantId` de sesión | None | Global | Solicitudes creadas por el cliente autenticado. |
| `POST` | `/tus/v1/solicitudes` | Bearer / Cookie | Cliente | No | `tenantId` de sesión | Zod | Global | Creación de solicitud pública o directa a un prestador. |
| `POST` | `/tus/v1/solicitudes/:id/imagenes` | Bearer / Cookie | Cliente | No | Dueño de solicitud | Tamaño y Magic Bytes | Global | Subida de hasta 2 imágenes para la solicitud. |
| `GET` | `/tus/v1/solicitudes/:id/imagenes/:orden` | Bearer / Cookie | Cliente / Prestador | No | Autorizado | Param ID | Global | Lectura de imágenes por participantes autorizados. |
| `GET` | `/tus/v1/solicitudes/:id/postulaciones` | Bearer / Cookie | Cliente | No | Dueño de solicitud | Param ID | Global | Postulaciones recibidas para elegir candidato. |
| `GET` | `/tus/v1/prestador/solicitudes` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | Query params | Global | Solicitudes disponibles según oficio y zona de cobertura. |
| `POST` | `/tus/v1/prestador/solicitudes/:id/postular` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | Zod | Global | Postulación a solicitud abierta. Idempotente por prestador. |
| `GET` | `/tus/v1/prestador/postulaciones` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | None | Global | Mis postulaciones emitidas. |
| `POST` | `/tus/v1/prestador/postulaciones/:id/retirar` | Bearer / Cookie | Prestador | No | Dueño de postulación | Param ID | Global | Retiro de postulación previa. |
| `GET` | `/tus/v1/mis-trabajos` | Bearer / Cookie | Cliente / Prestador | No | `tenantId` de sesión | None | Global | Trabajos vinculados donde el tenant es cliente o prestador. |
| `GET` | `/tus/v1/trabajos/:id/resumen` | Bearer / Cookie | Cliente / Prestador | No | Participante de trabajo | Param ID | Global | Resumen financiero, estado y calificaciones del trabajo. |
| `GET` | `/tus/v1/trabajos/:id/mensajes` | Bearer / Cookie | Cliente / Prestador | No | Participante de trabajo | Query cursor | Global | Chat privado del trabajo. No accesible para terceros. |
| `POST` | `/tus/v1/trabajos/:id/mensajes` | Bearer / Cookie | Cliente / Prestador | No | Participante de trabajo | Zod (`text`, `clientMessageId`) | Global | Envío de mensaje en chat privado con idempotencia. |
| `POST` | `/tus/v1/trabajos/:id/calificacion` | Bearer / Cookie | Cliente | No | Cliente del trabajo | Zod (`score: 1..5`) | Global | Calificación de prestador por trabajo completado (una sola vez). |
| `POST` | `/tus/v1/work/:workId/checkout` | Bearer / Cookie | Cliente | No | Cliente del trabajo | Zod | Global | Checkout de seña o saldo de trabajo hacia Mercado Pago. |

---

## 6. Prestador: Perfil, Ubicación y Cobros

| Method | Route | Auth | Role | MFA | Tenant / Owner | Input Validation | Rate Limit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/tus/v1/prestador/perfil-publico` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | None | Global | Obtiene el perfil comercial propio. |
| `PUT` | `/tus/v1/prestador/perfil-publico` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | Zod | Global | Edita perfil, zonas de cobertura, modalidad y servicios N:M. |
| `GET` | `/tus/v1/prestador/ubicacion` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | None | Global | Consulta ubicación y pin propio en el mapa. |
| `PUT` | `/tus/v1/prestador/ubicacion` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | Zod | Global | Actualiza coordenadas y toggle de ubicación exacta. |
| `DELETE` | `/tus/v1/prestador/ubicacion` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | None | Global | Elimina pin de mapa propio. |
| `GET` | `/tus/v1/provider/payment-account` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | None | Global | Estado de cuenta de cobro Mercado Pago. |
| `POST` | `/tus/v1/provider/payment-account/mercado-pago/connect` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | Zod | Global | Inicia vinculación OAuth de Mercado Pago para cobros. |
| `POST` | `/tus/v1/provider/payment-account/disconnect` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | None | Global | Desvincula cuenta de cobro Mercado Pago. |

---

## 7. Turnos y Disponibilidad (Existente)

| Method | Route | Auth | Role | MFA | Tenant / Owner | Input Validation | Rate Limit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/tus/v1/calendar/:calendarId/slots` | Public | Cualquiera | No | N/A | Query date/now | Global | Consulta slots libres de una agenda. Solo expone franjas, nunca quién reservó. |
| `POST` | `/tus/v1/calendar` | Bearer / Cookie | Prestador / Admin | No | `tenantId` de sesión | Zod | Global | Creación o actualización de calendario y reglas semanales. |
| `POST` | `/tus/v1/calendar/bookings` | Bearer / Cookie | Cliente | No | `tenantId` de sesión; `customerId` debe ser el de la sesión (403 si no) | Zod | Global | SOLICITUD de reserva de una publicación (TURNOS-SOLICITUD-01): nace `pending` con vigencia de 24 h (nunca más allá del horario), con idempotencia y control de capacidad. Ningún dato del cliente fija estado, vigencia, precio, prestador ni reloj (`now` del body no se lee). Solo el prestador la confirma: al aceptar el trabajo (`/tus/v1/work/commitments/:id/accept` con `reservationId`) o desde Solicitudes de reserva. 409 `TOO_MANY_PENDING_REQUESTS`, `SLOT_OCCUPIED`, `CONCURRENT_MODIFICATION`. |
| `POST` | `/tus/v1/calendar/bookings/:bookingId/cancel` | Bearer / Cookie | Cliente / Prestador | No | Dueño de reserva | Zod | Global | Cancelación de turno con motivo auditado. Sobre una solicitud `pending`: el cliente la retira (`cancelled`), el prestador la rechaza (`rejected`). Reloj del servidor. |
| `POST` | `/tus/v1/calendar/bookings/:bookingId/no-show` | Bearer / Cookie | Prestador | No | Dueño de agenda | Zod | Global | Registro de inasistencia del cliente. |

---

## 8. Webhooks e Integraciones Externas

| Method | Route | Auth | Role | MFA | Tenant / Owner | Input Validation | Rate Limit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/tus/v1/integrations/mercado-pago/webhooks` | Webhook Signature | MP Externo | No | N/A | HMAC SHA-256 | Webhook (Prefix) | Validación de firma y timestamp de Mercado Pago. Deduplicación e idempotencia estricta. |
| `GET` | `/tus/v1/integrations/whatsapp/webhook` | Meta Challenge | Meta Externo | No | N/A | `hub.verify_token` | Webhook (Prefix) | Handshake de suscripción de Meta Cloud API. |
| `POST` | `/tus/v1/integrations/whatsapp/webhook` | Meta Signature | Meta Externo | No | N/A | `X-Hub-Signature-256` | Webhook (Prefix) | Validación criptográfica de payload crudo antes de parsear JSON. |
| `GET` | `/tus/v1/integrations/mercado-pago/oauth/callback` | OAuth Callback | Prestador OAuth | No | State token | Query params | Global | Recepción de código OAuth con state validado. |

---

## 9. Administración de Plataforma (Admin + MFA Obligatorio)

*Nota: Todas las rutas `/tus/v1/admin/*` y de gestión MFA son resueltas a través de `MfaAdminSessionResolver` contra la allowlist de correos autorizados y exigen elevación de segundo factor activa.*

| Method | Route | Auth | Role | MFA | Tenant / Owner | Input Validation | Rate Limit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/auth/mfa/status` | Bearer / Cookie | Admin | No | Sesión actual | None | Auth / Sensitive | Estado de enrolamiento de segundo factor TOTP. |
| `POST` | `/tus/v1/admin/usuarios/:id/telefono` | Bearer / Cookie | Admin (`tus:identity:admin`) | Sí | Cualquier cuenta | Normalizador único | Global | `pendiente`: carga un número a verificar (nunca lo marca verificado); `quitar`: libera el teléfono verificado. Auditado (`phone.admin_*`, enmascarado). |
| `POST` | `/auth/mfa/enroll` | Bearer / Cookie | Admin | No | Sesión actual | None | Auth / Sensitive | Generación de secreto TOTP cifrado con AES-256-GCM. |
| `POST` | `/auth/mfa/enroll/confirm` | Bearer / Cookie | Admin | No | Sesión actual | Zod (TOTP 6 dígitos) | Auth / Sensitive | Confirmación inicial de enrolamiento. |
| `POST` | `/auth/mfa/verify` | Bearer / Cookie | Admin | No | Sesión actual | Zod (TOTP 6 dígitos) | Auth / Sensitive | Verificación para elevar sesión administrativa. |
| `POST` | `/auth/mfa/recover` | Bearer / Cookie | Admin | No | Sesión actual | Zod (Recovery Code) | Auth / Sensitive | Elevación mediante código de recuperación de un solo uso. |
| `POST` | `/auth/mfa/recovery-codes` | Bearer / Cookie | Admin | Sí | Sesión actual | None | Auth / Sensitive | Regeneración de códigos de recuperación tras elevación. |
| `POST` | `/auth/mfa/disable` | Bearer / Cookie | Admin | Sí | Sesión actual | Password actual | Auth / Sensitive | Desactivación de segundo factor con reautenticación. |
| `POST` | `/auth/admin/bootstrap-verify` | Bearer / Cookie | Admin Candidate | No | Allowlist | Password actual | Auth / Sensitive | Bootstrap de verificación para correos de allowlist en dev. |
| `GET` | `/tus/v1/admin/resumen` | MFA Elevated | Admin | Sí | Plataforma | None | Global | Métricas y resumen operativo del sistema. |
| `GET` | `/tus/v1/admin/usuarios` | MFA Elevated | Admin | Sí | Plataforma | Paginación server-side | Global | Listado paginado de usuarios (tope 50). |
| `POST` | `/tus/v1/admin/usuarios` | MFA Elevated | Admin | Sí | Plataforma | Zod | Global | Alta administrativa de usuario auditada. |
| `GET` | `/tus/v1/admin/usuarios/:id` | MFA Elevated | Admin | Sí | Plataforma | Param ID | Global | Detalle de usuario y memberships. |
| `PATCH` | `/tus/v1/admin/usuarios/:id` | MFA Elevated | Admin | Sí | Plataforma | Zod | Global | Edición de datos básicos de usuario. Protege password/hashes. |
| `POST` | `/tus/v1/admin/usuarios/:id/acciones` | MFA Elevated | Admin | Sí | Plataforma | Zod (`suspender`, `reactivar`) | Global | Acciones administrativas auditadas. |
| `GET` | `/tus/v1/admin/prestadores` | MFA Elevated | Admin | Sí | Plataforma | Paginación server-side | Global | Listado de prestadores comerciales registrados. |
| `POST` | `/tus/v1/admin/prestadores` | MFA Elevated | Admin | Sí | Plataforma | Zod | Global | Alta de prestador por administración sin onboarding ficticio. |
| `GET` | `/tus/v1/admin/prestadores/:id` | MFA Elevated | Admin | Sí | Plataforma | Param ID | Global | Detalle completo de prestador, servicios y estado comercial. |
| `PUT` | `/tus/v1/admin/prestadores/:id` | MFA Elevated | Admin | Sí | Plataforma | Zod | Global | Edición de prestador, oficio y atributos comerciales. |
| `POST` | `/tus/v1/admin/prestadores/:id/visibilidad` | MFA Elevated | Admin | Sí | Plataforma | Zod (`visible: boolean`) | Global | Publicación o retiro del directorio público. |
| `GET` | `/tus/v1/admin/prestadores/:id/ubicacion` | MFA Elevated | Admin | Sí | Plataforma | Param ID | Global | Consulta de pin administrativo de prestador. |
| `PUT` | `/tus/v1/admin/prestadores/:id/ubicacion` | MFA Elevated | Admin | Sí | Plataforma | Zod | Global | Ajuste administrativo de ubicación geográfica. |
| `DELETE` | `/tus/v1/admin/prestadores/:id/ubicacion` | MFA Elevated | Admin | Sí | Plataforma | Param ID | Global | Eliminación administrativa de pin de mapa. |
| `GET` | `/tus/v1/admin/solicitudes` | MFA Elevated | Admin | Sí | Plataforma | Paginación server-side | Global | Supervisión de solicitudes públicas y directas. |
| `GET` | `/tus/v1/admin/catalogo` | MFA Elevated | Admin | Sí | Plataforma | None | Global | Catálogo completo (oficios, categorías, zonas, barrios). |
| `GET` | `/tus/v1/admin/catalogo/:entidad` | MFA Elevated | Admin | Sí | Plataforma | Paginación server-side | Global | Listado paginado de elementos de catálogo. |
| `POST` | `/tus/v1/admin/catalogo/:entidad` | MFA Elevated | Admin | Sí | Plataforma | Zod | Global | Creación de oficio, categoría, zona o barrio. |
| `PUT` | `/tus/v1/admin/catalogo/:entidad/:id` | MFA Elevated | Admin | Sí | Plataforma | Zod | Global | Actualización de elemento de catálogo y polígonos. |
| `GET` | `/tus/v1/admin/actividad` | MFA Elevated | Admin | Sí | Plataforma | Paginación server-side | Global | Registro de auditoría de plataforma (acciones de admin). |
| `GET` | `/tus/v1/admin/trabajos` | MFA Elevated | Admin | Sí | Plataforma | Paginación server-side | Global | Supervisión global de trabajos contratados. |
| `GET` | `/tus/v1/admin/trabajos/:id` | MFA Elevated | Admin | Sí | Plataforma | Param ID | Global | Detalle de trabajo y flujo de fondos. |
| `POST` | `/tus/v1/admin/trabajos/:id/cancelar` | MFA Elevated | Admin | Sí | Plataforma | Zod (motivo obligatorio) | Global | Cancelación de trabajo por soporte con auditoría. |
| `GET` | `/tus/v1/admin/pagos` | MFA Elevated | Admin | Sí | Plataforma | Paginación server-side | Global | Listado de obligaciones de pago y estados. |
| `POST` | `/tus/v1/admin/payments/refunds` | MFA Elevated | Admin | Sí | Plataforma | Zod | Global | Emisión auditada de reembolsos administrativos. |
| `GET` | `/tus/v1/admin/payments/status` | MFA Elevated | Admin | Sí | Plataforma | None | Global | Estado de integración y credenciales MP. |
| `GET` | `/tus/v1/admin/payments/configuration` | MFA Elevated | Admin | Sí | Plataforma | None | Global | Configuración de comisiones y modos de cobro. |
| `POST` | `/tus/v1/admin/payments/configuration` | MFA Elevated | Admin | Sí | Plataforma | Zod | Global | Actualización auditada de configuración de pagos. |
| `GET` | `/tus/v1/admin/payments/commission-policies` | MFA Elevated | Admin | Sí | Plataforma | None | Global | Políticas de comisión vigentes. |
| `POST` | `/tus/v1/admin/payments/commission-policies` | MFA Elevated | Admin | Sí | Plataforma | Zod | Global | Nueva política de comisión con versionado inmutable. |
| `GET` | `/tus/v1/admin/payments/readiness/evidence` | MFA Elevated | Admin | Sí | Plataforma | None | Global | Evidencias de habilitación del tenant de plataforma (`service-payments`, `settlement`); `no-store`. |
| `POST` | `/tus/v1/admin/payments/readiness/evidence` | MFA Elevated | Admin | Sí | Plataforma | Allowlist estricta | Global | Alta auditada de una referencia de evidencia; tenant, alcance, origen y estado los fija el servidor; rechaza valores con forma de secreto o dato personal. |
| `POST` | `/tus/v1/admin/payments/readiness/evidence/:evidenceId/revoke` | MFA Elevated | Admin | Sí | Plataforma | Allowlist estricta | Global | Revocación auditada con motivo; nunca borra. |
| `GET` | `/tus/v1/admin/whatsapp/conversations` | MFA Elevated | Admin | Sí | Plataforma | None | Global | Monitoreo de conversaciones de WhatsApp. |
| `GET` | `/tus/v1/admin/whatsapp/conversations/:conversationId` | MFA Elevated | Admin | Sí | Plataforma | Param ID | Global | Conversación y mensajes de soporte WhatsApp. |
| `POST` | `/tus/v1/admin/whatsapp/conversations/:conversationId/:action` | MFA Elevated | Admin | Sí | Plataforma | Zod (`mode: bot/human`) | Global | Intervención humana o retorno a bot en WhatsApp. |
| `GET` | `/tus/v1/admin/identity-verifications` | MFA Elevated | Admin | Sí | Plataforma | None | Global | Colas de verificación de identidad de prestadores. |
| `GET` | `/tus/v1/admin/identity-verifications/:verificationId` | MFA Elevated | Admin | Sí | Plataforma | Param ID | Global | Detalle de verificación y OCR de DNI. |
| `GET` | `/tus/v1/admin/identity-verifications/:verificationId/documents/:side` | MFA Elevated | Admin | Sí | Plataforma | Param ID + side | Global | Visualización segura de fotos de documento. |
| `POST` | `/tus/v1/admin/identity-verifications/:verificationId/decision` | MFA Elevated | Admin | Sí | Plataforma | Zod (`aprobado`, `rechazado`) | Global | Dictamen administrativo sobre verificación de identidad. |
| `GET` | `/tus/v1/admin/identity-worker` | MFA Elevated | Admin | Sí | Plataforma | None | Global | Estado del worker de Nosis e identidad. |
| `POST` | `/tus/v1/admin/identity-worker/:action` | MFA Elevated | Admin | Sí | Plataforma | Zod | Global | Control operativo de reintentos del worker. |

---

## 10. Turnos Avanzados y Concurrencia (Fase 1)

| Method | Route | Auth | Role | MFA | Tenant / Owner | Input Validation | Rate Limit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/turnos/disponibilidad` | Public | Cualquiera | No | N/A | Query (prestadorId, oficioId, fecha) | Global | Slots disponibles y tarifas activas calculadas en Argentina time. |
| `POST` | `/api/turnos/reservar` | Public / Cliente | Invitado / Cliente | No | N/A | Zod / Schema | Global | Reserva física protegida por exclusion constraint `btree_gist` en PostgreSQL 16. Captura 23P01/40P01. |
| `GET` | `/api/turnos/prestador/mis-turnos` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | Query filtros | Global | Listado de turnos de la agenda del prestador autenticado. |
| `POST` | `/api/turnos/prestador/manual` | Bearer / Cookie | Prestador | No | `tenantId` de sesión | Schema entrada manual | Global | Alta de turno presencial/telefónico ingresado por el prestador. |
| `POST` | `/api/turnos/admin/forzar` | MFA Elevated | Admin | Sí | Plataforma | Motivo obligatorio | Global | Forzado administrativo de turno fuera de horario con auditoría. |
| `PATCH` | `/api/turnos/admin/:id/precio` | MFA Elevated | Admin | Sí | Plataforma | Motivo obligatorio | Global | Modificación administrativa de snapshot de precio final con auditoría. |
| `PUT` | `/api/turnos/prestador/horarios` | Bearer / Cookie | Prestador / Admin | No | Dueño de agenda | Reglas semanales | Global | Configuración de rangos horarios semanales por día. |
| `POST` | `/api/turnos/prestador/excepciones` | Bearer / Cookie | Prestador / Admin | No | Dueño de agenda | Rango fecha + motivo | Global | Bloqueos por vacaciones, feriados o indisponibilidad. |

---

## 11. Alojamientos y Reservas (Fase 4)

| Method | Route | Auth | Role | MFA | Tenant / Owner | Input Validation | Rate Limit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/alojamientos/tipos` | Public | Cualquiera | No | N/A | None | Global | Catálogo administrable de tipos (Hotel, Cabaña, Departamento, Motel, etc.). |
| `GET` | `/api/alojamientos` | Public | Cualquiera | No | N/A | Query filtros | Global | Búsqueda pública por zona, fechas, personas, precio. Calcula precio real o "Desde $X". |
| `GET` | `/api/alojamientos/:idOrSlug` | Public | Cualquiera | No | N/A | Param ID/Slug | Global | Detalle de alojamiento y unidades. Aplica jerarquía de fotos con fallback a fotos generales. |
| `POST` | `/api/alojamientos/reservas/hold` | Public / Cliente | Invitado / Cliente | No | `clienteId` = cuenta de la sesión (el del body se ignora) | Schema validado | Global | Creación de hold temporal (15m). Exclusión física PostgreSQL 16 `btree_gist` contra solapamiento. |
| `POST` | `/api/alojamientos/reservas/:id/checkout-preference` | Public / Cliente | Titular / Invitado | No | Reserva con cuenta: solo su titular (o admin). Reserva de invitado: por id de reserva | Param ID | Global | Preferencia de checkout Mercado Pago (soporte sandbox / local). |
| `POST` | `/api/alojamientos/reservas/:id/simular-pago` | Deshabilitado en producción | Titular / Invitado (solo dev/test) | No | Igual que checkout-preference | Param ID | Global | Confirma una reserva sin pago real. Solo existe con `NODE_ENV=development` o `test`; en cualquier otro entorno responde 403 `PAYMENT_SIMULATION_DISABLED`. |
| `POST` | `/api/alojamientos/calificar` | Bearer / Cookie | Cliente | No | Titular de reserva (cuenta de la sesión; el `clienteId` del body no se lee) | Puntuación 1-5 | Global | Calificación de alojamiento exclusiva para reservas `completed`. 1:1 único por reserva. Una reserva de invitado no se califica por API. |
| `POST` | `/api/alojamientos` | Bearer / Cookie | Admin | Sí | Admin asigna `propietarioId` | Schema comercial | Global | Creación de alojamiento (soporta fixtures ficticios de test sin propietario). No hay alta por autoservicio: el propietario es la cuenta que asigna el admin. |
| `POST` | `/api/alojamientos/:id/unidades` | Bearer / Cookie | Admin / Propietario | No | Dueño de alojamiento | Schema unidad | Global | Alta de unidad (habitación, cabaña, depto) con capacidad y amenities. |
| `POST` | `/api/alojamientos/unidades/:unidadId/tarifas` | Bearer / Cookie | Admin / Propietario | No | Dueño de unidad | Modalidad y precio | Global | Tarifas por hora, bloque de horas, noche, día o semana con estadía mínima. |
| `POST` | `/api/alojamientos/:id/imagenes` | Bearer / Cookie | Admin / Propietario | No | Dueño de alojamiento | URL y categoría | Global | Carga de fotos generales (fachada, recepción, piscina, etc.). |
| `POST` | `/api/alojamientos/unidades/:unidadId/imagenes` | Bearer / Cookie | Admin / Propietario | No | Dueño de unidad | URL y orden | Global | Carga de fotos propias de una unidad específica. |
| `POST` | `/api/alojamientos/unidades/:unidadId/bloquear` | Bearer / Cookie | Admin / Propietario | No | Dueño de unidad | Rango y motivo | Global | Bloqueo manual por mantenimiento o uso propio. |
| `GET` | `/api/alojamientos/:id/reservas` | Bearer / Cookie | Admin / Propietario | No | Dueño de alojamiento | Param ID | Global | Listado de reservas, huéspedes y estados comerciales. |
| `PATCH` | `/api/alojamientos/reservas/:id/estado` | Bearer / Cookie | Admin / Propietario | No | Dueño de alojamiento | Estado objetivo | Global | Transiciones operativas (`checked_in`, `completed`, `cancelled`). |

Reglas de las rutas "Admin / Propietario" (`apps/api/src/tus/alojamientos/alojamientos-routes.ts`, tests en
`tests/foundation/tus-alojamientos-http.test.mjs`): la sesión es la misma del resto de TUS (Bearer o cookie +
`X-Correlation-Id`). Admin = permiso `tus:providers:admin` (sesión con MFA elevado). Propietario = la cuenta de la sesión
coincide con `alojamientos.propietario_id` del alojamiento (o del alojamiento de la unidad / de la reserva), leído de la
base. Sin sesión: 401. Con sesión sin permiso sobre el recurso: 403, también si el id no existe (no revela ids).

---

## 12. Asistente Web, Perfil Personal, Geografía y Turnos de Administración

| Method | Route | Auth | Role | MFA | Tenant / Owner | Input Validation | Rate Limit | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `POST` | `/tus/v1/asistente/mensajes` | Public / Session opcional | Cualquiera | No | Cuenta = sesión; sin sesión, `visitorId` aleatorio (solo continuidad) | Allowlist de campos (422), texto 1..1000, `replyId` con patrón | 30/min por IP + 12/min por conversación | Mismo orquestador que WhatsApp. Visitante: solo herramientas públicas. Escrituras: confirmación ligada a conversación y cuenta. `private, no-store`. |
| `GET` | `/tus/v1/asistente/historial` | Public / Session opcional | Cualquiera | No | Conversación de la cuenta o del `visitorId` | Patrón de `visitorId` | Global | Solo la conversación propia. |
| `POST` | `/tus/v1/asistente/reiniciar` | Public / Session opcional | Cualquiera | No | Idem | Patrón de `visitorId` | 30/min por IP | Cierra la conversación activa. |
| `GET` | `/tus/v1/geografia/paises`, `/provincias`, `/localidades` | Public | Cualquiera | No | N/A | Patrón de ids | Global | Datos de referencia. `private, max-age=300` (nunca `public`). |
| `GET` | `/tus/v1/perfil` | Session / Bearer | Cualquiera | No | Cuenta de la sesión (no hay ruta por id) | N/A | Global | Datos personales privados del titular. `no-store`. |
| `PUT` | `/tus/v1/perfil` | Session / Bearer | Cualquiera | No | Cuenta de la sesión | Contrato compartido `validarPerfilPersonal`; campos desconocidos 422 | Global | Documento único por persona (409). Localidad del catálogo. |
| `GET` | `/tus/v1/admin/usuarios` | MFA Elevated | Admin (`tus:identity:admin`) | Sí | Plataforma | Allowlist de filtros | Global | Búsqueda por nombre, email, documento o teléfono y filtros resueltos en SQL; paginado. |
| `GET` | `/tus/v1/admin/usuarios/:id` | MFA Elevated | Admin (`tus:identity:admin`) | Sí | Plataforma | Id | Global | Incluye documento y residencia (datos privados). |
| `GET` | `/tus/v1/admin/turnos/prestadores`, `/prestadores/:id/servicios`, `/clientes`, `/disponibilidad` | MFA Elevated | Admin (`tus:providers:admin`) | Sí | Plataforma | Query | Global | Búsquedas por nombre para el formulario de turnos; teléfono de clientes enmascarado. |
| `POST` | `/tus/v1/admin/turnos` | MFA Elevated | Admin (`tus:providers:admin`) | Sí | Plataforma; el administrador es la sesión | Allowlist de campos (422) | Global | `general`: solo una franja de la disponibilidad real. `forzado`: motivo obligatorio, auditado. Solapamiento: 409 `SLOT_OCCUPIED`. |
| `GET`/`PUT` | `/tus/v1/prestador/turnos/horarios` | Session / Bearer | Prestador | No | `tenantId` de sesión | `validarHorariosSemanales` + `esIntervaloTurno`; campos desconocidos 422 | Global | Disponibilidad semanal de la propia agenda: intervalo general y, por día, horarios e intervalo propio. |
| `GET` | `/tus/v1/public/prestadores/:id/turnos/agenda` | Pública | — | No | Solo perfiles visibles (404 si no) | `oficioId`, `desde` (YYYY-MM-DD, entre hoy−7 y hoy+180), `tarifaId` del servicio | Global | Agenda semanal: inicios posibles y su estado (disponible, ocupado, bloqueado, pasado). Sin datos del cliente ni motivo del bloqueo. `private, no-store`. |
| `GET` | `/tus/v1/prestador/turnos/agenda` | Session / Bearer | Prestador | No | Perfil del `tenantId` de sesión | Query | Global | La misma agenda, también con el perfil oculto. |
| `GET` | `/api/alojamientos/reservas/pagos-en-revision` | Session / Bearer | Admin de plataforma | Sí | Plataforma | — | Global | Pagos recibidos para reservas que ya no tenían sus fechas; se concilian a mano, nunca se confirman solos. |
| `POST` | `/api/alojamientos/reservas/:id/checkout-preference` | Session / Bearer | Titular de la reserva | No | Cuenta titular | Id | Global | Mercado Pago de alojamientos NO IMPLEMENTADO: con credenciales reales responde 503 `CHECKOUT_NOT_AVAILABLE`. |
| `GET`/`DELETE` | `/tus/v1/prestador/turnos/bloqueos`, `/bloqueos/:id` | Session / Bearer | Prestador | No | `tenantId` de sesión (un bloqueo ajeno responde 404) | Id | Global | Bloqueos vigentes de la propia agenda; quitar uno no toca la configuración semanal. |
| `GET` | `/tus/v1/prestador/turnos/servicios`, `/disponibilidad` | Session / Bearer | Prestador | No | `tenantId` de sesión | Query | Global | Servicios y disponibilidad propios. |
| `POST` | `/tus/v1/prestadores/:id/turnos/solicitudes` (alias: `/tus/v1/public/prestadores/:id/turnos/reservar`) | Session / Bearer | Cliente con cuenta | No | El cliente es la cuenta de la sesión; campos de identidad, tenant, prestador, precio, seña o estado se rechazan | `oficioId`, `inicio`, `tarifaId`, `notas` (allowlist estricta) | Global | SOLICITUD de turno: nace `pending` y retiene el horario hasta 24 h (nunca más allá del turno). Sin sesión: 401 `LOGIN_REQUIRED`. Disponibilidad decidida con la agenda bloqueada; 409 `SLOT_OCCUPIED` / `SLOT_NOT_AVAILABLE`; 409 `TOO_MANY_PENDING_REQUESTS` (3 por agenda). |
| `GET` | `/tus/v1/cliente/turnos`, `/tus/v1/cliente/turnos/solicitante` | Session / Bearer | Cualquiera | No | Solo los turnos y los datos de la cuenta de la sesión | — | Global | Estado real de cada turno propio. `solicitante`: nombre y email de la cuenta, teléfono enmascarado. |
| `POST` | `/tus/v1/cliente/turnos/:id/cancelar` | Session / Bearer | Cliente titular | No | Solo un turno propio (ajeno: 404) | Id | Global | Retira una solicitud o cancela un turno confirmado antes de su inicio. |
| `GET` | `/tus/v1/prestador/turnos/solicitudes` | Session / Bearer | Prestador | No | `tenantId` de sesión | — | Global | Solicitudes pendientes de la propia agenda. Muestra el nombre del cliente; teléfono y email solo después de confirmar. |
| `POST` | `/tus/v1/prestador/turnos/:id/aceptar`, `/rechazar` | Session / Bearer | Prestador | No | Solo solicitudes de la propia agenda (ajena: 404) | Id | Global | Aceptar mueve `pending → awaiting_payment` y abre una ventana de pago de 24 h, acotada por el inicio; no confirma. Con pagos online activos y prestador sin cuenta de cobro: 409 `PROVIDER_PAYMENT_ACCOUNT_REQUIRED` (sigue `pending`). Solo un turno sin seña (sin precio, o pagos online apagados en toda la plataforma) pasa directo a `confirmed`. Horario ya no libre: 409 `REQUEST_SLOT_UNAVAILABLE` y queda `rejected`. Repetir la misma respuesta es idempotente. |
| `POST` | `/tus/v1/cliente/turnos/:id/sena/checkout` | Session / Bearer | Cliente titular | No | Solo turno propio en `awaiting_payment`; el body debe estar vacío | Id | Global | Crea o recupera idempotentemente el Checkout Pro por el 50% del precio persistido. Solo el webhook firmado, consultado contra Mercado Pago y validado por reserva/cliente/prestador/importe/moneda confirma el turno. |
| `PATCH` | `/tus/v1/prestador/turnos/:id/estado`, `/tus/v1/admin/turnos/:id/estado` | Session / Bearer; MFA Elevated | Prestador; Admin | No; Sí | `tenantId` de sesión; plataforma | Estado de `ESTADOS_TURNO` | Global | Solo transiciones operativas permitidas. Rechaza escrituras genéricas a `awaiting_payment` o `confirmed`; esos estados pertenecen respectivamente a aceptar y al webhook de pago. |
| `PUT` | `/tus/v1/prestador/servicios/:oficioId/turnos-config`, `/tarifas` | Session / Bearer | Prestador | No | Perfil del `tenantId` de sesión (el `perfilId` del body se ignora) | Body | Global | Corregido IDOR: antes el perfil se tomaba del body. |

Las rutas de administración de turnos exigen `tus:providers:admin` (ya no aceptan `tus:calendar:write`).
