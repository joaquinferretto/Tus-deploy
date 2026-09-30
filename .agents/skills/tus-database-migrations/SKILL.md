---
name: tus-database-migrations
description: Cambios de esquema en TUS (PostgreSQL 16 + Prisma): nuevas tablas, columnas, índices, migraciones, schema.prisma y validación de migraciones. Usar al crear o revisar migraciones, modificar schema.prisma o diagnosticar drift/checksums.
---

# TUS: migraciones de base de datos

Stack: PostgreSQL 16 (con pgvector) + Prisma. Carpeta: `apps/api/prisma/migrations`.

## Diseño
- Preferir migraciones aditivas (tablas, columnas nullable, índices, CHECK, triggers append-only). Evitar `DROP`, `CASCADE`, renombres y cambios de tipo salvo plan explícito.
- Nunca reescribir una migración histórica ya aplicada o compartida; corregir con una migración nueva de reparación/convergencia.
- Invariantes en la base: uniques (parciales si hace falta), CHECK, FK `RESTRICT`, triggers append-only para auditoría y ledgers. Lo que Prisma no puede expresar (índices parciales, `tsvector`, `vector`) va en SQL y se documenta en el modelo.
- Actualizar `docs/database/DER_TUS.dbml` y `docs/database/DICCIONARIO_DATOS_TUS.md`.

## Distinguir dos problemas
- **Convergencia de esquema**: ¿una base existente y una nueva terminan con el mismo esquema? Se prueba con fresh vs upgrade.
- **Checksum/drift del historial**: una migración aplicada cuyo archivo cambió. Se resuelve con el proceso de reparación de `scripts/tus-migration-repair-lib.mjs`, nunca editando la base a mano.

## Validación obligatoria
1. Gate: `reviewMigrationChain` de `scripts/tus-migration-repair-lib.mjs` debe aceptar la migración nueva (fail-closed).
2. `prisma validate` y `prisma generate` (con URLs ficticias si hace falta; sin tocar bases reales).
3. PostgreSQL 16 **descartable** (initdb en un directorio temporal): base fresh y base upgrade desde la migración anterior, `prisma migrate deploy` en ambas, `pg_dump --schema-only` idéntico y `prisma migrate diff` sin drift.
4. Detener y borrar la base descartable al terminar (ver `AGENTS.md`).

## Prohibido sin autorización explícita
- Migrar `factory_local`, staging compartido o producción. En esos entornos solo lectura (`migrate status`).
