---
name: ux-ui-design
description: Principios de diseño visual, jerarquía y experiencia de usuario (UX/UI) para TUS. Usar al construir vistas, rediseñar pantallas, mejorar formularios o ajustar layouts responsive.
---

# Principios de UX/UI en TUS

## Identidad y Estilo Visual
- **Paleta y Tonalidad**:
  - Color de acento de marca: Naranja institucional de TUS.
  - Fondos y superficies: Blanco y tonos neutros limpios (grises suaves, alto contraste de legibilidad).
  - No saturar con gradientes estridentes ni sombras desmedidas. Priorizar claridad y foco en el contenido útil.
- **Jerarquía y Composición**:
  - Encabezados claros, espaciado consistente y tipografía legible.
  - Evitar sobrecargar con tarjetas anidadas e iconografía puramente decorativa.
- **Formularios Profesionales**:
  - Etiquetas visibles asociadas a sus inputs (`label`).
  - Ayuda contextual clara y mensajes de error inline inmediatos.
  - Estados claros: loading con spinner o feedback deshabilitado para prevenir doble submit.
  - Touch targets mínimos de 44x44px para interacciones táctiles en dispositivos móviles.
- **Tablas y Listados Responsive**:
  - En Desktop: vista tabular ordenada con filtros comprensibles y paginación acotada.
  - En Mobile: transformar tablas anchas en cards verticales o columnas prioritarias con detalle expandible, eliminando scrolls horizontales accidentales.
- **Accesibilidad (A11y)**:
  - Navegación por teclado completa (`tabindex`, focus rings visibles).
  - Diálogos y modales accesibles con focus trap y cierre por tecla Escape.
  - Atributos ARIA necesarios y contraste de color conforme a WCAG AA.
