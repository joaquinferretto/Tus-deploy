# TUS — Estado de normalización

Última actualización: 2026-09-13

Rama: `normalizacion-espanol-tus`

## COMPLETADO

- Habilitación ✅
- Auditorías ✅
- Catálogo / Prestadores ✅
- Publicaciones ✅
- Mercado interno ✅
- Compromisos ✅
- Reservas / Calendario ✅
- POS ✅
- Entrega ✅
- Soporte ✅
- WhatsApp funcional ✅
- Finanzas internas ✅
- Facturación interna ✅

Los checks indican que los bloques de normalización interna están aplicados en Git. No significan que todas las integraciones externas o rutas de cada dominio estén activas.

## FASE ACTUAL

**Contracts/API** es la siguiente fase de normalización.

Los contratos actuales siguen siendo la frontera compartida y no se modificaron durante los Builds A–I. La normalización de tipos internos no equivale a cambiar schemas, payloads, estados o rutas.

## SIGUIENTES FASES

```text
Semántica interna ✅
        ↓
Contracts/API ← ACTUAL / SIGUIENTE
        ↓
Prisma
        ↓
PostgreSQL físico
        ↓
Legacy
        ↓
Web
        ↓
Mobile
        ↓
Auditoría residual / docs / tests
        ↓
Nuevas features
```

## DIFERIDO / SENSIBLE

**Auth/Tenancy** requiere revisión y ejecución con especial cuidado por identidad, seguridad, sesiones, SQL raw, `Membership` y `Tenant`.

## DEUDA CONOCIDA

- HTTP `404` baseline de Marketplace y Delivery/POS.
- Finance P8 `404` vs `202` baseline.
- `Membership` / SQL raw.
- `RefreshTokenFamily` / outbox.
- Aliases HTTP.
- Worker Python parcial.
- Legacy `@factory`, `@repo`, `product-factory`, `factory`, `alqui`.

## ÚLTIMOS HITOS

- Habilitación y auditoría de plataforma: `11f82e3`, `993124c` y commits de auditoría posteriores.
- Build A: perfil interno del prestador, `af7a471`.
- Build B: publicaciones y mercado interno, `c131025`.
- Build C: compromisos, `92d69fe`.
- Build D: reservas y calendario, `e80c50f`.
- Build E: POS y entrega, `1676228`.
- Build F: soporte, `847d1f8`.
- Build G: WhatsApp funcional interno, `fd28e67`.
- Build H: finanzas internas, `27401c5`.
- Build I: facturación interna, `b0417da`.

## REGLA DE ACTUALIZACIÓN

Después de cerrar una fase o Build importante, actualizar este archivo antes de iniciar una nueva fase.
