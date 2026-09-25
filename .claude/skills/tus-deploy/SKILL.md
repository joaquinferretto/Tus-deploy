---
name: tus-deploy
description: Arquitectura de despliegue del MVP de TUS y configuración de entornos (Vercel, Hostinger, PostgreSQL administrado, workers, variables de entorno). Usar al preparar staging o producción, editar render.yaml/Dockerfiles/next.config, variables .env/.env.example o runbooks de despliegue.
---

# TUS: despliegue MVP

Referencias canónicas: `docs/PRODUCCION_TUS.md`, `docs/runbooks/tus-deployment.md`, `docs/deployment/render.md`.

## Topología
- Web Next.js → Vercel (raíz del monorepo como Root Directory).
- API Node/Express → Hostinger (Node 22, pnpm vía Corepack, `PORT` lo da la plataforma).
- PostgreSQL 16 administrado con TLS; URL con pooler para runtime y URL directa para migraciones.
- Procesos persistentes o con Chromium (por ejemplo el worker de identidad) van en un host separado; nunca dentro de la API web.

## Salud y arranque
- `/health` (liveness) y `/ready` (readiness) deben responder 200 antes de recibir tráfico.
- La Web en Linux/Render usa salida `standalone`; en Windows local puede desactivarse. Validar siempre la ruta Linux aunque Windows falle con `EPERM`.

## Variables
- Separar backend (secretos, solo en el panel de la plataforma) y frontend (`NEXT_PUBLIC_*`, siempre públicas: nunca secretos).
- `.env.example` refleja todas las variables que consume el código, sin valores reales; al agregar una variable nueva, actualizarlo.
- Configuración ausente o inválida debe dejar la función apagada (fail closed).

## Activación
- Activar integraciones reales de a una (base de datos → rutas TUS → pagos sandbox → WhatsApp → identidad), verificando cada una antes de la siguiente.
- Dinero real, WhatsApp real y consultas Nosis reales requieren autorización explícita.
- No ejecutar deploys ni migraciones productivas desde el agente (ver `tus-database-migrations`).
