---
name: tus-git-safe
description: Operaciones Git seguras en TUS (commits, merges, resolución de conflictos, rebase, push). Usar antes de commitear, mergear, resolver conflictos o ejecutar cualquier comando Git que reescriba o publique historia.
---

# TUS: Git seguro

## Nunca sin autorización explícita
- `push` (y jamás `push --force` / `--force-with-lease` sobre ramas compartidas).
- `rebase`, `squash`, `reset --hard`, `commit --amend` sobre historia ya compartida.
- Saltar hooks (`--no-verify`) o firmas.

## Operaciones riesgosas
- Antes de un merge grande, reset o limpieza: crear una rama o tag de respaldo y anotarlo en el reporte.
- Revisar `git status` y el objetivo antes de borrar o sobrescribir.

## Merges y conflictos
- Merge semántico: entender la intención de ambos lados y combinarla.
- Nunca resolución global `-X ours`/`-X theirs` ni `checkout --ours/--theirs` masivo; resolver archivo por archivo.
- Si los tests de cada lado exigen formas incompatibles, reconciliar el contrato y ajustar solo la aserción obsoleta, explicando por qué (ver `tus-testing`).
- Cero marcadores de conflicto: `git diff --name-only --diff-filter=U` vacío, `git diff --check` y `git diff --cached --check` limpios.
- Validar (según `tus-testing`) antes de crear el merge commit.

## Commits
- Commits lógicos y pequeños por tema; mensaje en el estilo del repo (`tipo(ámbito): descripción`).
- Stagear rutas explícitas; nunca incluir `.env`, credenciales ni artefactos generados.

## Reporte final
- HEAD inicial y final, commits nuevos, commits adelante del remoto, estado del working tree y confirmación de que no hubo push.
