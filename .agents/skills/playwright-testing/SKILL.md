---
name: playwright-testing
description: Directrices para pruebas de extremo a extremo y auditorías visuales con Playwright en TUS. Usar al validar flujos de usuario, verificar componentes responsive o tomar capturas.
---

# Pruebas y Auditoría Visual con Playwright en TUS

## Metodología de Testing
- **Cobertura Desktop y Mobile**:
  - Validar siempre dos viewports representativos: Desktop (1280x720 o superior) y Mobile (375x667 o 390x844).
  - Comprobar que no exista scroll horizontal no intencionado, que los botones de acción principal permanezcan visibles y que los modales queden acotados al viewport.
- **Selectores Robustos y Accesibles**:
  - Priorizar selectores basados en accesibilidad y semántica: `getByRole`, `getByLabel`, `getByText` antes que selectores frágiles por clase CSS.
- **Ambiente de Test Aislado**:
  - Levantar servicios locales utilizando los runners acotados del proyecto (`scripts/dev/smoke-local.mjs web`).
  - No dejar servidores o navegadores huérfanos al finalizar la ejecución de las pruebas.
- **Verificación de Errores Visuales**:
  - Inspeccionar estados de loading, estados vacíos (empty states), mensajes de validación inline y diálogos de confirmación.
