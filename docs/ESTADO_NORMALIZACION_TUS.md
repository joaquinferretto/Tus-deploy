# TUS — Estado de normalización

Última actualización: 2026-09-14

Rama: `normalizacion-espanol-tus`

## COMPLETADO

### Semántica interna

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

### Contracts/API ✅ COMPLETADA

- 11A Catálogo/Mercado ✅
- 11B Compromisos/Carrito ✅
- 11C POS/Entrega ✅
- 11D Soporte/WhatsApp ✅
- 11R Habilitación ✅
- 11E Finanzas/Facturación ✅
- 11F Rutas HTTP ✅
- 11G estrategia JSON ✅ mantener/diferir
- 11H estrategia eventos ✅ mantener
- 11G1 freeze compatibilidad ✅

## DECISIONES CONTRACTS/API

- JSON keys actuales se mantienen estables hasta la fase Prisma/PostgreSQL o hasta decisión explícita.
- Event types permanecen como identificadores técnicos estables. No doble emisión, no renombre, no backfill.
- `contractVersion` permanece en `1.0.0`; no se crea v2.
- `$id` inconsistentes de schemas quedan como cleanup opcional/no urgente (11G2 diferido).
- Lectura tolerante de eventos (11H1) queda diferida/opcional.

## FASE ACTUAL

**Prisma** es la siguiente fase de normalización.

## SIGUIENTES FASES

```text
Semántica interna ✅
        ↓
Contracts/API ✅
        ↓
Prisma ← ACTUAL / SIGUIENTE
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

**Auth/Tenancy** permanece sensible y diferido por identidad, seguridad, sesiones, SQL raw, `Membership` y `Tenant`.

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
- 11A–11F y 11R: normalización Contracts/API (`0ede5b4`, `19e0847`, `6dbf165`, `39f2eb1`, `6440008`, `380c19a`, `8ff4038`).

## REGLA DE ACTUALIZACIÓN

Después de cerrar una fase o Build importante, actualizar este archivo antes de iniciar una nueva fase.
