---
name: tus-repo
description: Reglas base para cualquier cambio en el monorepo TUS (API Express/Prisma, Web Next.js, mobile, worker). Usar al empezar cualquier tarea de implementación, refactor, documentación o investigación dentro de este repositorio.
---

# TUS: reglas base del repositorio

Estas reglas aplican siempre; las demás skills `tus-*` las dan por sabidas.

## Antes de tocar código
- Leer `AGENTS.md` (procesos largos, smoke local, timeouts) y `ARCHITECTURE.md`.
- Consultar la doc canónica del área en `docs/` (por ejemplo `PRODUCCION_TUS.md`, `SEGURIDAD_TUS.md`, `database/DER_TUS.dbml`, `database/DICCIONARIO_DATOS_TUS.md`).
- Inspeccionar el código existente antes de crear algo: buscar servicios, puertos, adaptadores, stores y tests equivalentes y reutilizarlos. No crear infraestructura paralela (otro backend, otra cola, otra base vectorial, otro cliente HTTP) si ya existe una.
- Respetar las convenciones vigentes: arquitectura hexagonal (dominio puro, puertos, adaptadores en memoria y Prisma con la misma semántica), nombres en español en dominio y tablas, contratos en `packages/contracts`, comentarios en el estilo del archivo.

## Límites
- No tocar la base `factory_local` ni infraestructura compartida.
- No modificar `opencode.json` salvo necesidad demostrada y explicada.
- Nunca secretos en Git, logs, docs ni variables `NEXT_PUBLIC_*`; `.env` es local e ignorado, `.env.example` solo lleva placeholders.
- No instalar herramientas del sistema sin explicar antes por qué son imprescindibles.
- No desplegar ni activar integraciones reales (pagos, WhatsApp, Nosis) sin autorización explícita.

## Al terminar
- Informar qué cambió, qué quedó pendiente, procesos dejados en ejecución (con PID) y estado de Git (ver `tus-git-safe`).
- Validar según `tus-testing`.
