---
name: prisma-postgresql
description: Patrones de persistencia con PostgreSQL 16 y Prisma ORM en TUS. Usar al definir modelos, escribir consultas, crear migraciones o diseñar transacciones y constraints de concurrencia.
---

# PostgreSQL 16 y Prisma en TUS

## Principios de Persistencia
- **Migraciones Formales**:
  - Toda modificación de schema se realiza vía migraciones versionadas en `packages/database/prisma/migrations/`.
  - El único runner oficial de despliegue es `scripts/db/migrate-deploy.mjs`.
  - NUNCA ejecutar `prisma db push` contra entornos persistentes o productivos.
- **Concurrencia e Integridad Física**:
  - Para slots de turnos y reservas de alojamientos que no admiten solapamiento, utilizar transacciones con aislamiento adecuado y exclusion constraints de PostgreSQL 16 (`btree_gist`) sobre rangos temporales `tstzrange`.
  - Validar concurrencia con tests reales sobre PostgreSQL descartable.
- **Consultas Seguras y Rendimiento**:
  - Usar consultas parametrizadas en `$queryRaw` o pg-pool. Prohibida la interpolación de strings directa en sentencias SQL.
  - Prevenir problemas de N+1 mediante `include`/`select` por lote o agregaciones en base de datos.
- **Testing Descartable**:
  - Para pruebas locales usar instancias descartables temporales de PostgreSQL 16 sin afectar bases productivas ni datos personales.
