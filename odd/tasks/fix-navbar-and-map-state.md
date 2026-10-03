# Fix Navbar Layout and Map Selection State

## Objetivo
Resolver de forma estructural los tres defectos identificados en producción sobre `apps/web`:
1. Navbar roto/superpuesto y colapsado a móvil en resoluciones desktop (1280, 1366, 1440, 1536, 1920, 2560 y 125% zoom).
2. Reapertura automática y recentrado del último prestador en el mapa al hacer zoom o arrastrar tras cerrar el popup.
3. Popup de Leaflet tapado por la barra flotante de búsqueda (`.searchDock`).

## Por qué
Garantizar una experiencia de usuario limpia, predecible y responsiva en cualquier resolución de pantalla, sin comportamientos intrusivos en el mapa ni colisiones visuales en el header.

## Alcance
- Exclusivamente frontend en `apps/web`:
  - `apps/web/src/features/home/home.module.css`
  - `apps/web/src/features/home/public-header.tsx`
  - `apps/web/src/features/home/provider-map.tsx`
  - `apps/web/src/features/home/home-page.tsx`
- Scripts de validación con Playwright en `scratch/`

## Restricciones
- NO tocar backend, base de datos ni APIs.
- NO tocar `opencode.json`.
- NO push a `hostinger`.
- Mantener diseño visual, colores e identidad de TUS.
- No parches superficiales: arquitectura desacoplada de estados y flexbox limpio.

## Delivery Strategy
- Strategy: single-pr
- Route: Delegated direct (Writer trigger: 4 non-trivial files)

## Tareas

- [x] **TASK-01**: Rediseño estructural del Header y Navbar
  - Reemplazar CSS grid simétrico (`minmax(0, 1fr) auto minmax(0, 1fr)`) por Flexbox fluido.
  - Logo a la izquierda (`flex-shrink: 0`), navegación central (`flex: 1`), acciones a la derecha (`flex-shrink: 0`).
  - Mover breakpoint de colapso móvil de 1400px a 1024px.
  - Centrar con `max-width: 1600px` para monitores ultrawide (1920px y 2560px).
  - Verificar ausencia de colisiones entre logo y enlaces ("Para profesionales", "Ayuda").
  - Ruta: Delegated writer.
  - Evidencia: Verificado en 1280x720, 1366x768, 1440x900, 1536x864, 1920x1080, 2560x1440 y 1440x900@125%. Cero colisiones, menú desktop visible con 6 enlaces, botón menú móvil oculto.

- [x] **TASK-02**: Desacoplamiento de estado del Mapa y prevención de reapertura
  - En `provider-map.tsx` y `home-page.tsx`, soportar `onSelect: (id: string | null) => void`.
  - Capturar evento `popupclose` de Leaflet vía `useMapEvents` para resetear `selectedProviderId = null`.
  - Abrir popup únicamente cuando `selectedId` cambia a un nuevo ID explícito (`selectedId !== prevOpenedIdRef.current`), nunca por recalculación de clusters en zoom.
  - En `MapController`, ejecutar `fitProviders` SOLO una vez al montar o tras click explícito en "Recentrar" / nueva búsqueda (`searchSignal`), nunca por re-renders de `workers`.
  - Ejecutar `map.flyTo` únicamente una vez al seleccionar un nuevo prestador.
  - Ajustar `autoPanPaddingTopLeft` a `[24, 290]` en desktop para que Leaflet nunca posicione el popup debajo del `searchDock`.
  - Ruta: Delegated writer.
  - Evidencia: Verificado ciclo completo en Playwright: abrir prestador A -> cerrar popup con X -> zoom in (no reabre) -> zoom out (no reabre) -> drag map (no reabre) -> abrir prestador B -> recentrar (no reabre).

- [x] **TASK-03**: Validación exhaustiva de Calidad y Playwright
  - `corepack pnpm --filter @factory/web typecheck` (0 errores).
  - `corepack pnpm --filter @factory/web build` (54/54 páginas compiladas exitosamente).
  - Suite de Playwright en todas las resoluciones desktop (1280x720, 1366x768, 1440x900, 1536x864, 1920x1080, 2560x1440 y 125% zoom).
  - Comprobación del ciclo completo: abrir prestador A → cerrar con X → zoom in → zoom out → drag → confirmar que NO se reabre → abrir prestador B.
  - Ruta: Delegated writer / parent check.
  - Evidencia: Suite automatizada pasó con 100% de éxito (`ALL VERIFICATION TESTS PASSED WITH 100% SUCCESS`). Capturas guardadas en `audit-screens/verified_*`.
