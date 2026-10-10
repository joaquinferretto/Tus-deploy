# Dependencias — auditoría y corrección de seguridad (2026-10-10)

> Rama `chore/security-dependencies`, desde producción (`43b4153`). **No desplegada, no mergeada.**
> Gestor: pnpm 9.15.9 (workspace `apps/*`, `packages/*`), Node 22. Auditoría con `pnpm audit`.
> No se usó `--force` ni se actualizó ningún major.

## Resultado

| Severidad | Antes | Después |
| --- | --- | --- |
| Crítica | 5 | **0** |
| Alta | 47 | 4 |
| Moderada | 23 | 4 |
| Baja | 3 | 1 |

Por dónde corre cada hallazgo:

| Ámbito | Antes | Después |
| --- | --- | --- |
| Runtime productivo de la API y la Web | `proxy-addr` (crítica), `sharp` (alta), `next` (moderada), `source-map-js` (alta, transitiva de `postcss`) | **ninguno** |
| Herramientas de build y lint (API, Web, paquetes) | `brace-expansion`, `js-yaml`, `fast-uri`, `handlebars`; `braces`; `turbo` | `braces` (sin versión corregida) y `turbo` (salto mayor) |
| App móvil (`apps/mobile`, no publicada) | `shell-quote` (crítica), `@xmldom/xmldom`, `axios`, `compression`, `undici`, `image-size`, `node-forge`, `uuid`, `decode-uri-component`, `sprintf-js` | `image-size`, `node-forge`, `uuid`, `decode-uri-component`, `sprintf-js`, `braces` |

## Qué se cambió

Todos son parches (o un minor) dentro del mismo major. Las transitivas se corrigieron con `overrides` de pnpm **acotados a las versiones vulnerables** (`paquete@<rango>`), que es exacto: no fijan nada más y dejan de aplicar solos cuando el paquete padre pida una versión sana. En cada bloque el lockfile cambió solo los paquetes listados (verificado comparando el lockfile antes y después).

### 1. Runtime productivo (`f494b86`)

| Paquete | Antes | Después | Cómo | Nota |
| --- | --- | --- | --- | --- |
| `proxy-addr` | 2.0.7 | 2.0.8 | override acotado | CVE-2026-90711 (crítica). Express 4.22.x lo pide como `~2.0.7`: no hizo falta tocar Express (sigue en 4.22.2; 4.22.3 pide el mismo rango) |
| `next` | 15.5.26 | 15.5.27 | dependencia directa de la Web (`^15.5.27`) | parche |
| `sharp` | 0.35.4 | 0.35.5 | el override que ya existía | parche; arrastra sus binarios por plataforma |
| `source-map-js` | 1.2.1 | 1.2.2 | override acotado | transitiva de `postcss` |

**`proxy-addr` y la IP del cliente.** Express calcula `req.ip` con `proxy-addr`, según `trust proxy` (`resolveTrustProxy`, `apps/api/src/platform/runtime.ts`: apagado por defecto, o `TRUST_PROXY_HOPS`, o `TRUST_PROXY_ADDRESSES`). De esa IP dependen el límite general y el límite estricto de autenticación. El fallo corregido afecta a quien confía en proxies por **dirección**: un salto escrito como IPv6 con IPv4 mapeada no se trataba igual que su IPv4. No se cambió ninguna política. Test nuevo `tests/foundation/tus-proxy-ip-cliente.test.mjs`, con el Express real de la API:

- sin proxy de confianza, `X-Forwarded-For` se ignora;
- con un salto, vale solo la entrada que escribió el proxy: lo que el cliente ponga antes no cambia su IP ni le permite escapar del límite;
- con direcciones de confianza, un proxy confiable lo es en las dos notaciones y un salto no confiable corta la cadena en las dos;
- el límite estricto cuenta 40 por IP y no afecta a otro cliente.

No verificado desde acá: qué valor de `TRUST_PROXY_*` tiene cargado Hostinger. Conviene confirmarlo en el panel al desplegar (solo CONFIGURADO / AUSENTE y cuál de las dos variables).

### 2. Herramientas (`7d98791`)

`brace-expansion` 1.1.18 → 1.1.21, 2.1.4 → 2.1.7 y 5.0.9 → 5.0.12; `js-yaml` 3.15.1 → 3.15.2 y 4.3.1 → 4.3.2; `fast-uri` 3.1.5 → 3.1.8 (vía `ajv` en `packages/contracts`); `handlebars` 4.7.8 → 4.7.10 (vía `eslint-plugin-boundaries`).

### 3. App móvil (`c6c1262`)

`shell-quote` 1.10.0 → 1.11.0, `undici` 6.28.0 → 6.28.1, `compression` 1.8.1 → 1.8.2, `@xmldom/xmldom` 0.8.14 → 0.8.15 y 0.9.11 → 0.9.12 (overrides acotados); `axios` 1.19.0 → 1.20.0 (dependencia directa, `^1.20.0`). Sin tocar Expo ni React Native.

## Qué queda y por qué

| Paquete | Sev. | Dónde | Motivo |
| --- | --- | --- | --- |
| `braces` 3.0.3 | Alta | mobile (React Native / Expo) y lint de la Web (`eslint-config-next` → `fast-glob` → `micromatch`) | **No hay versión corregida publicada.** Es denegación de servicio con patrones maliciosos: en estos caminos los patrones los escribe el propio proyecto |
| `node-forge` 1.4.0 | Alta | mobile (Expo) | **No hay versión corregida publicada** |
| `image-size` 1.2.1 | Alta | mobile (React Native) | La corrección es 2.0.3: **salto mayor** de una transitiva de React Native. Forzarlo puede romper el empaquetador |
| `uuid` 7.0.3 | Moderada | mobile (Expo) | Corrección en 11.1.1: salto de cuatro majors |
| `decode-uri-component` 0.2.2 | Moderada | mobile (Expo) | Corrección en 0.5.0: cambio incompatible |
| `sprintf-js` 1.0.3 | Moderada | mobile | No hay versión corregida publicada |
| `turbo` 1.13.4 | Moderada y baja | raíz (solo orquesta builds) | Corrección en 2.9.14: **salto mayor**. Ver abajo |

Los de mobile se resuelven actualizando Expo / React Native, que es un trabajo propio de esa app. La app móvil no está publicada.

## Turbo 1 → 2 (no migrado)

- Los dos avisos son: fijación de sesión en el callback de `turbo login` (TUS no usa caché remota ni `turbo login`) y ejecución de código local al detectar Yarn Berry (el repositorio usa pnpm). Con el uso actual, la exposición es baja.
- Migrar implica: `turbo.json` usa `pipeline` y Turbo 2 lo reemplaza por `tasks`; revisar `globalDependencies`, las salidas y la tarea `dev` (`persistent`); los scripts de la raíz (`turbo run build|lint|typecheck --concurrency=1`); y los builds que corren fuera de esta máquina: Vercel (Web, salida `standalone` en Linux) y el `postinstall` de Hostinger. No hay forma de probar esos dos desde acá.
- Recomendación: hacerlo en un commit propio, con un build de prueba en Vercel (preview) y en Hostinger antes de mergear.

## Escáner de secretos

`pnpm run lint:security` fallaba en producción por tres archivos; ahora pasa, sin tocar el escáner (`d6dae4b`):

- el smoke de pagos y un test de Mercado Pago usaban valores falsos que no empiezan con el prefijo que el escáner reconoce como ficticio: se renombraron;
- un test comparaba contra un objeto literal que asignaba un código de error a una clave terminada en `_CLIENT_SECRET`, que el escáner lee como credencial en línea: era un falso positivo, y el objeto esperado ahora se arma desde los nombres.

Dato útil: en modo `--tracked` el escáner lee el contenido **del índice de Git**, no el del disco. Un cambio sin `git add` no se ve.

## Verificación

Ver el reporte de la rama: typecheck, lint, builds, tests focales por bloque, suite completa y smokes.
