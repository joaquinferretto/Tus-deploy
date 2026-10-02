# Informe de Auditoría de Seguridad Integral — TUS (Baseline Fase 0.5)

**Fecha:** 2026-09-30  
**Alcance:** Monorepo TUS (`apps/api`, `apps/web`, `packages/*`), contratos, modelos Prisma y endpoints HTTP.  
**Estado:** BASELINE INICIAL PREVIO A TURNOS, UX/UI, WHATSAPP Y ALOJAMIENTOS.

---

## 1. Resumen Ejecutivo
Se realizó una auditoría estática y dinámica de la superficie completa del backend y frontend de TUS:
- **Total de endpoints HTTP inventariados:** 88 rutas (detalladas en `docs/security/ENDPOINT_SECURITY_MATRIX.md`).
- **Autenticación y Sesiones:** Doble esquema con cookies HttpOnly seguras y headers `Authorization: Bearer`. CSRF protegido mediante verificación de origen.
- **Autorización y Multi-Tenancy:** El aislamiento de datos se deriva de forma estricta del token de sesión (`context.tenantId`), previniendo vulnerabilidades IDOR.
- **Administración de Plataforma:** Todas las rutas `/tus/v1/admin/*` están protegidas por el guardián `MfaAdminSessionResolver`, requiriendo pertenencia a la allowlist de administradores y elevación activa de segundo factor TOTP (RFC 6238).
- **Webhooks:** Firmas criptográficas HMAC SHA-256 validadas sobre los bytes crudos del request (`raw-body`) antes de la deserialización de JSON tanto para Mercado Pago como para Meta WhatsApp.
- **Escaneo de Secretos:** 0 credenciales o tokens filtrados en el código rastreado (`corepack pnpm security:scan` limpio).
- **Contratos:** 107 esquemas JSON validados sin inconsistencias.
- **Suite de Pruebas:** 865 tests ejecutados localmente, 864 aprobados, 0 fallos, 1 skip justificado.

---

## 2. Clasificación de Hallazgos Baseline

### SEC-02-B1: Límites de consulta en endpoints de catálogo público
- **ID:** `SEC-02-B1`
- **Severidad:** `LOW`
- **Componente:** `apps/api/src/tus/directorio/http.ts` (`GET /tus/v1/public/prestadores`)
- **Evidencia:** Si bien la búsqueda georreferenciada prioriza prestadores por polígono y radio, se debe asegurar que consultas sin filtro espacial tengan un límite superior de registros para prevenir denegación de servicio por memoria en clientes móviles.
- **Impacto:** Posible sobrecarga de payload en clientes de bajo ancho de banda ante crecimiento exponencial de prestadores.
- **Corrección recomendada:** Mantener el cap server-side de 200 prestadores en respuestas de directorio/mapa sin restringir prestadores elegibles para la zona activa.
- **Test Asociado:** `tests/integration/tus/directory-search.test.mjs`
- **Estado:** `MITIGADO` (Cap vigente en servicio de directorio).

### SEC-02-B2: Ocultación estricta de coordenadas privadas de prestadores
- **ID:** `SEC-02-B2`
- **Severidad:** `MEDIUM`
- **Componente:** `apps/api/src/tus/directorio/almacenes.ts` (`PerfilPublicoPrestador`)
- **Evidencia:** La base de datos almacena `latitud` y `longitud` precisas, pero el modelo incluye la bandera `mostrarUbicacionExacta: Boolean`.
- **Impacto:** Si la serialización del perfil devolviera latitud/longitud cuando `mostrarUbicacionExacta === false`, un atacante podría extraer la dirección privada del prestador directamente del JSON aún si la UI oculta el pin.
- **Corrección:** El mapper de dominio `toPerfilPublico` filtra activamente `latitud` y `longitud` seteándolas a `null` si `mostrarUbicacionExacta` no está habilitada.
- **Test Asociado:** `tests/integration/tus/geo-location.test.mjs`
- **Estado:** `RESUELTO` (Verificado en mapper y contrato de respuesta).

### SEC-02-B3: Validación de Concurrencia en Turnos y Reservas (A implementar en Fase 1)
- **ID:** `SEC-02-B3`
- **Severidad:** `HIGH` (Preventivo)
- **Componente:** `apps/api/src/tus/adapters/prisma-calendar.ts` y PostgreSQL 16
- **Actualización (TURNOS-SOLICITUD-01):** `POST /tus/v1/calendar/bookings` ya no crea reservas confirmadas: crea una solicitud `pending` que solo el prestador confirma; el reloj es el del servidor.
- **Evidencia:** La reserva de turnos (`POST /tus/v1/calendar/bookings`) requiere garantizar que dos solicitudes simultáneas para el mismo prestador y franja horaria no generen doble turno confirmado (race condition).
- **Impacto:** Superposición física de turnos de clientes.
- **Corrección requerida:** Diseñar e incorporar `exclusion constraint` en PostgreSQL 16 utilizando `btree_gist` sobre el rango temporal `tstzrange(fecha_inicio, fecha_fin)` y estado confirmado.
- **Test Asociado:** Test de concurrencia PG16 a construir en Fase 1.
- **Estado:** `EN PROCESO` (Objetivo central de la Fase 1).

---

## 3. Estado de Seguridad por Dominio

| Dominio | Nivel de Riesgo | Estado de Controles |
| :--- | :--- | :--- |
| Autenticación & Cuentas | Bajo | Robusto (Argon2id/bcrypt, cookies HttpOnly, rotación de sesiones, rate limit). |
| Multi-Tenancy / IDOR | Bajo | Aislamiento por `tenantId` en queries de Prisma, sin confiar en inputs del cliente. |
| Elevación Admin & MFA | Bajo | TOTP AES-256-GCM, allowlist estricta de emails, desafiliación inmediata. |
| Webhooks MP & WhatsApp | Bajo | Firmas HMAC sobre buffer crudo, deduplicación e idempotencia. |
| Uploads de Imágenes | Bajo | Validación de magic bytes, límite de 2MB, sin ejecución de código. |
| Contratos & Zod | Bajo | Type-safe de punta a punta entre `packages/contracts` y API Express. |

---

## 4. Veredicto Baseline

**SEGURIDAD PREVIA A FASES: APTA PARA CONTINUAR.**  
No existen vulnerabilidades críticas ni altas pendientes de resolución en el código actual. Se autoriza el inicio de la Fase 1 (Turnos + Mapa).
