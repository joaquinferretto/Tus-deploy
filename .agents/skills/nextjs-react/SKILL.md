---
name: nextjs-react
description: Patrones y arquitectura para Next.js 15 y React 19 en apps/web. Usar al crear o modificar rutas, páginas, layouts, Server Components o hooks.
---

# Next.js 15 + React 19 en TUS Web

## Arquitectura de Rutas y Componentes
- **App Router**: Páginas y layouts en `apps/web/src/app`.
- **Server Components por defecto**: Mantener los componentes en el servidor a menos que requieran interactividad del cliente (`useState`, `useEffect`, event listeners).
- **Límites de Cliente (`'use client'`)**: Aislar la directiva `'use client'` a los componentes hoja interactivos (botones, formularios, modales), evitando marcar layouts o páginas completas.
- **Manejo de Estado**:
  - Estado del servidor: React Query o fetching nativo con cacheo controlado.
  - Estado local de UI: Zustand o React local state.
- **Seguridad en el Frontend**:
  - NUNCA importar secretos en el bundle web.
  - Solo usar variables prefijadas con `NEXT_PUBLIC_*` si son completamente seguras para exposición pública.
- **Rendimiento**: Evitar re-renders innecesarios, optimizar imágenes con `next/image`, y verificar que el bundle inicial no incluya bibliotecas pesadas de Node.js.
