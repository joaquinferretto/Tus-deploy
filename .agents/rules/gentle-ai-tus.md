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
