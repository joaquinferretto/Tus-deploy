# Dependencias — auditoría de seguridad (2026-10-10)

> `pnpm audit` sobre el lockfile de `feat/experiencia-operativa-tus` (el mismo árbol de dependencias
> que producción, `44e34fe`: este plan no agregó ni actualizó ningún paquete).
> **No se actualizó nada.** La corrección va en una rama aparte, `chore/security-dependencies`, con
> su propia suite, build y smoke; no se mezcla con los cambios de producto.

## Resumen

| Severidad | Avisos |
| --- | --- |
| Crítica | 5 |
| Alta | 47 |
| Moderada | 23 |
| Baja | 3 |

Un mismo paquete suele acumular muchos avisos. Agrupado por paquete, y separando lo que corre en producción de lo que solo existe en desarrollo o en la app móvil:

### Corre en producción (prioridad)

| Paquete | Versión | Dónde | Severidad | Corrección | Nota |
| --- | --- | --- | --- | --- | --- |
| `proxy-addr` | 2.0.7 | API (dependencia de `express` 4.22.2) | **Crítica** | `>= 2.0.8` (parche) | Suplantación de IP con direcciones IPv4 mapeadas a IPv6 cuando se confía en un proxy. La API usa `trust proxy` (`resolveTrustProxy`) y los límites por IP dependen de esa IP: es el aviso más relevante. Se corrige con un `override` de parche |
| `next` | 15.5.26 | Web | Moderada | `>= 15.5.27` (parche) | Subir el parche y volver a correr build y smokes |
| `sharp` | 0.35.4 | Web (procesa imágenes); fijado por `overrides` | Alta | `>= 0.35.5` (parche) | Cambiar el valor del `override` existente |
| `fast-uri` | 3.1.5 | `packages/contracts` (vía `ajv`) | Alta | `>= 3.1.8` (parche) | `override` de parche. `ajv` valida esquemas propios, no URIs que mande un usuario; aun así se corrige |
| `js-yaml` | 3.15.1 / 4.3.1 | API, Web (y herramientas) | Alta | `>= 4.3.2` | Verificar qué lo usa en ejecución; la rama 3.x es de herramientas |
| `brace-expansion` | 1.1.18 / 2.1.4 / 5.0.9 | API, Web (vía ESLint y `minimatch`) | Alta | parches por rama (`1.1.20`, `2.1.6`, `5.0.12`) | Denegación de servicio con patrones maliciosos: en estos caminos son herramientas de desarrollo |

### Solo desarrollo, build o la app móvil

| Paquete | Dónde | Severidad | Nota |
| --- | --- | --- | --- |
| `handlebars` 4.7.8 | `apps/mobile` (vía `eslint-plugin-boundaries`) | Crítica | Herramienta de lint. Corrección: `>= 4.7.10` |
| `shell-quote` 1.10.0 | `apps/mobile` (herramientas de React Native) | Crítica | Corrección: `>= 1.11.0` |
| `@xmldom/xmldom`, `axios` 1.19.0, `compression`, `image-size`, `node-forge`, `undici`, `uuid`, `decode-uri-component`, `sprintf-js` | `apps/mobile` (Expo / React Native / Sentry) | Alta o moderada | La app móvil no está publicada. Se corrigen al actualizar Expo/React Native, no con parches sueltos. `node-forge`, `braces` y `sprintf-js` no tienen versión corregida publicada |
| `braces` 3.0.3, `source-map-js` 1.2.1 | Web y mobile (build) | Alta | Herramientas de build |
| `turbo` 1.13.4 | raíz | **Moderada** (2 avisos) | La corrección es `>= 2.9.14`: **salto mayor** |

El aviso "crítico" de Turbo que figuraba en el backlog ya no aparece como crítico: hoy `pnpm audit` lo clasifica como moderado.

## Turbo 1 → 2 (qué implica, sin hacerlo a ciegas)

- `turbo.json` usa la clave `pipeline`; Turbo 2 la reemplaza por `tasks`. Hay que migrar el archivo (existe un codemod oficial) y revisar `globalDependencies`, las salidas (`outputs`) y la tarea `dev` (`persistent`).
- Los scripts de la raíz llaman `turbo run build|lint|typecheck --concurrency=1`: revisar que las opciones sigan existiendo.
- Vercel y Hostinger ejecutan estos comandos al construir: probar el build de la Web con salida `standalone` en Linux y el `postinstall` de Hostinger antes de mergear.
- Cambia el formato de caché: la primera corrida no reutiliza la caché anterior.
- Turbo no corre en producción (solo orquesta builds), por eso su aviso moderado es de baja prioridad frente a `proxy-addr`.

## Plan propuesto para `chore/security-dependencies`

1. Rama desde `main`, sin cambios de producto.
2. **Paso 1 — parches que corren en producción:** `overrides` para `proxy-addr` (`2.0.8`), `fast-uri` (`3.1.8`), `sharp` (`0.35.5`); subir `next` al parche `15.5.27`. `pnpm install`, revisar que el lockfile solo cambie esos paquetes.
3. Verificar: Prisma validate/generate, typecheck, lint, build de API y Web, **suite completa**, smokes de navegador (pagos y alojamientos). Probar a mano que la IP que ve la API detrás del proxy sigue siendo la correcta (el límite por IP depende de `proxy-addr`).
4. **Paso 2 — herramientas:** `brace-expansion`, `js-yaml`, `handlebars`, `shell-quote` por `overrides` de parche; repetir la verificación.
5. **Paso 3 — Turbo 2**, en su propio commit, con la migración de `turbo.json` y un build de prueba en Vercel (preview) y en Hostinger antes de mergear.
6. La app móvil (`apps/mobile`) se actualiza aparte, cuando se retome ese producto.

## Estado

- Auditoría: hecha.
- Rama `chore/security-dependencies`: **no creada todavía** (no se instaló ni actualizó ningún paquete).
- Bloqueos: ninguno técnico. Requiere una ventana propia de verificación completa y un deploy separado del de las funciones nuevas.
