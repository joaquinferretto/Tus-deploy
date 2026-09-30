---
name: typescript-strict
description: Convenciones y reglas de TypeScript estricto para TUS. Usar al tipar contratos, use cases, componentes React, modelos de base de datos o APIs.
---

# TypeScript Estricto en TUS

## Reglas Principales
- **Cero `any`**: Usar `unknown`, generics o tipos discriminados en su lugar. Si se recibe payload externo, validarlo mediante schemas de Zod.
- **Contratos Compartidos**: Los DTOs, interfaces de respuesta y payloads API deben residir en `packages/contracts` o `packages/zod-schemas`.
- **Inmutabilidad y Tipos Discriminados**: Usar discriminated unions (`type: 'success' | 'error'`) para modelar estados finitos en dominio y frontend.
- **Dominio Puro**: Los tipos del dominio no deben importar tipos de infraestructura (Prisma, Express, React).
- **Typecheck Obligatorio**: Todo cambio debe pasar `pnpm typecheck` o `tsc --noEmit` en el paquete afectado sin errores.
