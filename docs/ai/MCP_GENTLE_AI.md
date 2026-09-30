# MCP y Gentle-AI para TUS

Validación: 2026-09-30, Windows, Antigravity CLI `agy 1.2.14`.
Se amplió la configuración de `035304d`; no se reinstalaron los MCP existentes.

## Configuración efectiva

- Workspace: `.agents/mcp_config.json`, con diez servidores únicos. No contiene credenciales.
- Global Antigravity: `C:\Users\juaqu\.gemini\config\mcp_config.json`, conservado sin cambios.
- Una sesión nueva de `agy --print` detectó los diez MCP del workspace. En esta versión, `agy mcp list` muestra el registro global y puede decir que no hay servidores aunque el workspace sí los cargue.
- No se copiaron configuraciones de Claude ni se duplicaron servidores globales. `serverUrl` es el campo remoto requerido por Antigravity.
- Rutas locales específicas de esta máquina: adaptarlas al mover el workspace a otro equipo.

## Servidores y evidencia

Todos completaron `initialize`, `tools/list` y las operaciones siguientes mediante el SDK MCP.

| Servidor | Transporte / implementación conservada | Prueba | Estado |
| --- | --- | --- | --- |
| context7 | HTTP, `https://mcp.context7.com/mcp` | Resolver React y consultar documentación de useState | PASS |
| engram | `C:\Users\juaqu\bin\engram.exe mcp --tools=agent`, binario 1.20.0 | Consultar proyecto actual | PASS |
| fetch | `C:\WINDOWS\py.exe -m mcp_server_fetch`, paquete 2026.8.18 | Leer https://example.com | PASS |
| filesystem | `@modelcontextprotocol/server-filesystem@2026.8.31` | Listar TUS y leer encabezado de ARCHITECTURE.md | PASS |
| gh_grep | HTTP, `https://mcp.grep.app` | Buscar `useState(` en facebook/react | PASS |
| git | `py -m mcp_server_git`, paquete 2026.8.18 | git_status de TUS | PASS |
| memory | `@modelcontextprotocol/server-memory@2026.8.31` | Crear, leer, eliminar entidad temporal y comprobar ausencia | PASS |
| playwright | `@playwright/mcp@0.0.83` | example.com, consola, viewport 390x844 y cerrar navegador | PASS |
| sequential_thinking | `@modelcontextprotocol/server-sequential-thinking@2026.8.31` | Operación única inocua | PASS |
| time | `py -m mcp_server_time`, paquete 2026.8.18 | Hora en Córdoba y conversión desde UTC | PASS |

Los paquetes Node se ejecutan con `cmd /c npx -y`; se fijaron las versiones ya instaladas y validadas. Python usado por `py.exe`: 3.14; SDK MCP: 1.30.0. No usar el Python 3.12 del PATH para estas pruebas: no tiene esos paquetes. Playwright reutilizó el navegador disponible, en modo headless y perfil aislado.

Context7 y gh_grep funcionaron sin API key. No hay credenciales pendientes para estas definiciones. Context7 admite consultas públicas de Prisma, Next.js, Express, React, PostgreSQL y TypeScript; no enviar código privado ni datos de usuarios.

## Límites y memoria

- Filesystem recibe únicamente `C:\Users\juaqu\Desktop\Tus` como raíz.
- Git recibe ese repositorio y Antigravity oculta `git_add`, `git_commit`, `git_reset`, `git_create_branch` y `git_checkout` mediante `disabledTools`. El servidor comprobado no ofrece push, force push ni clean. Esto es filtrado del cliente, no un sandbox del ejecutable Python.
- Una segunda sesión nueva de Antigravity confirmó que expone solamente `git_status`, `git_diff_unstaged`, `git_diff_staged`, `git_diff`, `git_log`, `git_show` y `git_branch`; tampoco expone las dos herramientas de captura de Engram deshabilitadas.
- Todos los procesos stdio tienen `cwd` explícito en TUS.
- `MEMORY_FILE_PATH` apunta a `C:\Users\juaqu\AppData\Local\tus-ai-tooling\tus-memory.jsonl`, fuera de Git.
- Engram conserva su almacén existente. Se ocultan `mem_capture_passive` y `mem_save_prompt`; al guardar decisiones usar `capture_prompt: false`.
- Sequential Thinking usa `DISABLE_THOUGHT_LOGGING=true`.
- Playwright usa un perfil aislado y salida en `C:\Users\juaqu\AppData\Local\tus-ai-tooling\playwright-output`.
- Time tiene `--local-timezone America/Argentina/Cordoba`.
- Nunca guardar secretos, contraseñas, tokens, claves, connection strings, prompts completos ni payloads privados en memorias. Las reglas explícitas están en `.agents/rules/gentle-ai-tus.md`; no hay garantía DLP automática. No se añadió autorización global automática de herramientas.

## Gentle-AI

- Ejecutable: `C:\Users\juaqu\bin\gentle-ai.exe`, versión estable **3.7.0**.
- Compilado desde el módulo oficial versionado con Go y su verificación de módulos. Go 1.27.1 se descargó del sitio oficial, verificando SHA-256, y quedó aislado en `C:\Users\juaqu\AppData\Local\tus-ai-tooling\go`; no se cambió el PATH global.
- Estado: `C:\Users\juaqu\.gentle-ai\state.json`. Backups gestionados: subdirectorio `backups`.
- Instalación seleccionada: agente `antigravity`, componente `skills`, skill `skill-registry`, preset/persona `custom`. No se activaron presets masivos, GGA, SDD ni cambios de permisos.
- Skill instalada: `C:\Users\juaqu\.gemini\antigravity-cli\skills\skill-registry\SKILL.md`.
- El instalador añadió su guía global en `C:\Users\juaqu\.gemini\GEMINI.md`; para TUS prevalecen las instrucciones del usuario y las fuentes canónicas del proyecto.
- Telemetría desactivada persistentemente en `C:\Users\juaqu\.gentle-ai\telemetry.json`.
- Registro regenerado: `.atl/skill-registry.md` y su caché. Ahora referencia 16 skills existentes de TUS; sustituye el índice obsoleto que apuntaba a otro usuario/proyecto. No se duplicaron las skills.
- `.gitignore` recibió la exclusión de estado local `.atl/` por el comando oficial. Los dos archivos ya versionados siguen siendo rastreados por Git.
- API, Web, seguridad, migraciones PostgreSQL, recovery, pagos, WhatsApp y QA visual reutilizan las skills existentes y los runbooks; no generan documentación canónica alternativa.

Limitación de `gentle-ai doctor`: da `unhealthy` por GGA ausente (componente no solicitado) y advierte que no encuentra Engram en configuración global de los agentes. No inspecciona correctamente esta configuración MCP de workspace. Engram sí pasó el smoke directo y fue detectado por Antigravity. No instalar GGA ni duplicar MCP para esconder esas advertencias.

## Integraciones de Claude

- **Claude Docs: NO APLICABLE EN ANTIGRAVITY como conector anterior.** La evidencia local es la entrada `claudeAiMcpEverConnected` de `.claude.json`; no hay command/URL/config portable para ese conector. No puede determinarse su implementación exacta con ese historial. Consulta de documentación cubierta por Context7 y Fetch.
- **claude-in-chrome: NO APLICABLE EN ANTIGRAVITY.** Integración específica de Claude y su extensión. Sustituida por Playwright con navegador aislado; no se copió la extensión ni su sesión.

## Revalidación

Desde la raíz de TUS:

```powershell
# Ejecutar por grupos: cada servidor tiene límite de 65 segundos.
py scripts/ai/validate-mcp.py context7 engram fetch
py scripts/ai/validate-mcp.py filesystem gh_grep git
py scripts/ai/validate-mcp.py memory sequential_thinking time
py scripts/ai/validate-mcp.py playwright
C:\Users\juaqu\bin\gentle-ai.exe version
C:\Users\juaqu\bin\gentle-ai.exe skill-registry refresh
```

El validador no imprime contenidos de herramientas ni secretos; inicia procesos como hijos administrados por el SDK y los cierra al salir. Memory elimina su dato temporal en `finally` y Playwright cierra su navegador. No arranca API, Web, DB ni workers.

Abrir una sesión nueva de Antigravity desde TUS, o usar `/mcp` para recargar una sesión ya abierta. La detección se validó en una sesión nueva; no se reiniciaron aplicaciones del usuario. Antes de `gentle-ai sync`, revisar `--dry-run`: su alcance es más amplio que este conjunto elegido.

## Fuentes

- [Antigravity MCP: formato y ámbitos](https://antigravity.google/docs/mcp)
- [Gentle-AI 3.7.0](https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v3.7.0)
- [Gentle-AI: componentes](https://github.com/Gentleman-Programming/gentle-ai/blob/v3.7.0/docs/components.md)
- [Claude in Chrome](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)
