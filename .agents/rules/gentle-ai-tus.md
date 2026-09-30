---
trigger: always_on
---

# Reglas Compartidas Gentle-AI para TUS

Este documento extiende y complementa las directrices canónicas de `AGENTS.md` y `ARCHITECTURE.md` para todos los agentes de IA (Antigravity CLI, Claude Code, OpenCode, Codex).

## Principios Fundamentales
1. **Prioridad Canónica**:
   - `AGENTS.md` rige la ejecución de procesos, límites de tiempo y runners de smoke.
   - `ARCHITECTURE.md` y `docs/` rigen el diseño del sistema, modelos y flujos funcionales.
   - Gentle-AI actúa como puente colaborativo y capa de memoria sin alterar las reglas del repositorio.

2. **Memoria Persistente (Engram)**:
   - Toda decisión arquitectónica, convención aprobada o hito relevante de sesión debe registrarse en la memoria de proyecto `tus` vía Engram.
   - Queda estrictamente prohibido persistir secretos, tokens de pago (Mercado Pago), claves de Meta, URLs de base de datos con contraseñas o datos de usuarios.

3. **Herramientas y MCP**:
   - Se utiliza la configuración unificada en `.agents/mcp_config.json`.
   - El acceso al sistema de archivos está restringido al workspace `C:\Users\juaqu\Desktop\Tus`.
   - Las operaciones Git están acotadas a este repositorio local.

4. **Ciclo de Trabajo Seguro**:
   - Todo cambio debe compilar, pasar typecheck y tests focales.
   - Mantener `opencode.json` fuera del área de staging y de los commits.
   - Prohibición absoluta de operaciones `git push`, `deploy` o alteraciones a entornos de producción.

## Contexto y memoria segura

- Leer `README.md`, `ARCHITECTURE.md` y las fuentes canónicas de `docs/`; no generar copias competidoras.
- TUS es un monorepo: Web Next.js, API Express, contratos TypeScript y Prisma/PostgreSQL (Supabase). Web se publica en Vercel y API en Hostinger.
- Conservar autorización por Cliente/Prestador/Admin y las invariantes de Turnos, Alojamientos, WhatsApp y Mercado Pago.
- Reutilizar las skills de `.agents/skills/`: `tus-repo`, `express-backend`, `nextjs-react`, `tus-database-migrations`, `prisma-postgresql`, `tus-security`, `tus-git-safe`, `tus-deploy`, `tus-testing`, `tus-ai`, `tus-payments` y `playwright-testing`.
- Guardar únicamente decisiones resumidas y referencias a archivos. En Engram usar `capture_prompt: false` al guardar; no copiar conversaciones completas, payloads de webhooks, logs ni datos personales.
- Nunca persistir valores de `DIRECT_URL`, `DATABASE_URL`, tokens Meta/Mercado Pago/Groq/Vercel/Hostinger, JWT, claves de cifrado o contraseñas. No leer `.env*`, claves privadas o almacenes de credenciales para alimentar memorias.
- No enviar código privado ni secretos a Context7 o gh_grep; usar consultas públicas mínimas.
- Memory conserva su archivo fuera del repositorio; Engram mantiene su almacenamiento previo. Las reglas son instrucciones de uso, no un filtro DLP automático.
- Configuración y validación reproducible: `docs/ai/MCP_GENTLE_AI.md`. No ejecutar instaladores masivos ni `gentle-ai sync` sin revisar antes su dry-run.
