---
name: express-backend
description: Patrones de backend Express y arquitectura hexagonal en apps/api. Usar al crear endpoints, middleware, use cases, servicios o adaptadores.
---

# Express Backend y Arquitectura Hexagonal en TUS

## Capas y Responsabilidades
- **Presentación (HTTP Handlers & Middleware)**:
  - Controladores delgados: validar entrada con Zod, extraer sesión/tenant, invocar el caso de uso y retornar el DTO de respuesta con el código HTTP apropiado.
  - No colocar lógica de negocio directamente en rutas o middlewares.
- **Casos de Uso (Application Layer)**:
  - Orquestan la lógica del negocio.
  - Dependen exclusivamente de interfaces de puertos (repositorios, gateways de pago, servicios de mensajería).
- **Dominio (Domain Layer)**:
  - Entidades, value objects y reglas invariantes puras.
  - Cero dependencias externas (sin Express, sin Prisma, sin librerías de infraestructura).
- **Infraestructura (Adapters & Database)**:
  - Implementaciones concretas de repositorios (Prisma y memoria) asegurando paridad semántica en ambos adapters.
- **Manejo de Errores**:
  - Centralizado en middleware de errores.
  - Nunca retornar stack traces ni detalles crudos de PostgreSQL/Prisma al cliente.
  - Utilizar códigos de error semánticos definidos en contratos.
