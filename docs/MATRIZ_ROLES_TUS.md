# Matriz de roles, vistas y endpoints de TUS

Inventario real al 2026-09-28 (commit `fc75d74`). Estado: **✅ existe y funciona**, **🟡 parcial**, **❌ falta**.
Toda autorización se valida en la API: la Web solo muestra lo que la API permite.

## Cliente

| Función | Vista | Endpoint | Estado |
| --- | --- | --- | --- |
| Mapa + buscador en lenguaje natural | `/` | `GET /tus/v1/public/prestadores`, `POST /tus/v1/asistente/interpretar` | ✅ |
| Asistente flotante (ayuda, navegación, búsqueda) | todas las páginas públicas | igual que arriba + `POST /tus/v1/asistente/ayuda` | ✅ |
| Directorio y perfil público | `/trabajadores`, `/trabajadores/[id]` | `GET /tus/v1/public/prestadores[/:id]` | ✅ |
| Publicar solicitud (con fotos) | `/publicar` | `POST /tus/v1/solicitudes`, `POST …/:id/imagenes` | ✅ |
| Mis solicitudes | `/mis-solicitudes` | `GET /tus/v1/solicitudes/mias` | ✅ |
| Postulantes / elegir / rechazar | `/mis-solicitudes` | `GET/POST /tus/v1/solicitudes/:id/postulaciones/…` | ✅ |
| Cerrar solicitud | `/mis-solicitudes` | `POST /tus/v1/solicitudes/:id/cerrar` | ✅ |
| **Editar solicitud** | — | — | ❌ (el modelo no tiene edición) |
| Seguimiento del trabajo / pago | `/tus/compromisos` (workspace viejo) | `/tus/v1/…work…`, pagos WEB-09 | 🟡 (flujo fuera de la experiencia nueva) |
| Mi perfil (datos personales) | `/mi-perfil` | `GET /auth/account`, `PATCH /auth/accounts/:id` | ✅ |

## Prestador

| Función | Vista | Endpoint | Estado |
| --- | --- | --- | --- |
| Perfil profesional (oficio, zonas, modalidad, descripción, visible) | `/prestador/perfil-publico` | `GET/PUT /tus/v1/prestador/perfil-publico` | ✅ (un solo oficio por perfil) |
| Solicitudes recibidas / aceptar / rechazar | `/prestador/solicitudes` | `/tus/v1/prestador/solicitudes/:id/aceptar\|rechazar` | ✅ |
| Postularse / mis postulaciones / retirar | `/prestador/solicitudes` | `/tus/v1/prestador/solicitudes/:id/postular`, `/tus/v1/prestador/postulaciones` | ✅ |
| Identidad (DNI + Nosis) | `/tus/prestador` | identidad WEB (`tus-identidad`) | ✅ (dentro del workspace) |
| **Dashboard propio** | — | — | ❌ (hoy "Ir a mi panel" → `/prestador/solicitudes`) |
| Fotos de trabajos / foto de perfil | — | — | ❌ |
| Múltiples oficios | — | — | ❌ (modelo: un oficio + zonas) |
| Disponibilidad | derivada de horarios de servicios (marketplace) | `/tus/v1/…listings…` | 🟡 |

## Administrador (todo detrás de allowlist + email verificado + login por contraseña + MFA)

| Función | Vista | Endpoint | Estado |
| --- | --- | --- | --- |
| Dashboard con datos reales | `/tus/admin` | `GET /tus/v1/admin/resumen` | ✅ |
| Usuarios (buscar, filtrar, detalle) | `/tus/admin/usuarios` | `GET /tus/v1/admin/usuarios` | ✅ lectura · ❌ suspender/editar |
| Prestadores (motivo real de "fuera del mapa", publicar/ocultar, alta manual) | `/tus/admin/prestadores` | `GET /tus/v1/admin/prestadores`, `POST …/:id/visibilidad`, `POST /tus/v1/admin/prestadores` | ✅ · ❌ aprobar/suspender prestador (el marketplace no lo soporta) |
| Solicitudes | `/tus/admin/solicitudes` | `GET /tus/v1/admin/solicitudes` | ✅ lectura · ❌ cancelar con registro |
| Servicios / oficios | `/tus/admin/servicios` | `GET /tus/v1/admin/catalogo` | ✅ lectura · ❌ ABM (catálogo en código) |
| Categorías | — | — | ❌ (el modelo no tiene categorías) |
| Zonas | `/tus/admin/zonas` | `GET /tus/v1/admin/catalogo` | ✅ lectura · ❌ ABM (zonas en código; falta Ponce) |
| Identidad | `/tus/admin/identidad` | `/tus/v1/admin/identity-verifications/…` | ✅ |
| WhatsApp (bandeja) | `/tus/admin/whatsapp` | `/tus/v1/admin/whatsapp/conversations/…` | ✅ |
| Seguridad (MFA, sesión, eventos) | `/tus/admin/seguridad` | `/auth/mfa/*`, `GET /tus/v1/admin/actividad` | ✅ |
| Auditoría completa | — | `AuditEvent` (auth/MFA) + auditoría del marketplace | 🟡 (solo eventos de seguridad en Inicio/Seguridad) |
| Pagos (comisiones, reembolsos) | — | `/tus/v1/admin/payments/*` | 🟡 (API sin vista) |

## Faltantes que requieren cambios de modelo (migraciones aditivas)

1. **Catálogo en base de datos**: tablas `categorias`, `oficios` (slug, categoría, ícono, sinónimos, activo, orden) y `zonas`
   (nombre, localidad, lat/lng, activa). Hoy `OFICIOS` (`tus/directorio/oficios.ts`) y `ZONAS_CORRIENTES`
   (`tus/solicitudes/modelo.ts`) están en código y los usan el intérprete, el directorio, las solicitudes y WhatsApp.
   Migración: sembrar las tablas con los valores actuales (mismos ids) y leerlas con caché; los perfiles y solicitudes
   ya guardan el id del oficio y el nombre de la zona, así que no se reescriben.
2. **Estado administrativo de cuentas** (activa/suspendida ya existe en `Account.status`): endpoints de suspender y
   reactivar con auditoría y sin dejar el sistema sin administrador.
3. **Estado del prestador** (`merchant.status`): acciones aprobar/suspender en el marketplace con auditoría.
4. **Edición de solicitudes** mientras estén abiertas y sin postulación aceptada.
5. **Dashboard del prestador** que reúna perfil, identidad, solicitudes, postulaciones y trabajos.

## Orden de trabajo propuesto

1. Catálogo en base (oficios, categorías, zonas) + ABM admin + intérprete leyendo la base.
2. Acciones administrativas con auditoría: suspender/reactivar cuentas, aprobar/suspender prestadores, cancelar solicitudes.
3. Cliente: edición de solicitudes con el mismo formulario.
4. Prestador: dashboard propio.
5. Validación de punta a punta (cliente → prestador → admin → mapa) en navegador real.
