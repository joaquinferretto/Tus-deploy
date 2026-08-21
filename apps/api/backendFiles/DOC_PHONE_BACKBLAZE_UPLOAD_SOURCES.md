# DocPhone: fuentes de Backblaze B2 y subida de archivos

Este inventario describe los archivos copiados literalmente desde `C:\Users\mmmau\docphone-v2`. La copia se hizo dentro de una carpeta nueva para no sobrescribir archivos existentes del destino. No se copiaron archivos `.env`, secretos, credenciales, claves, valores sensibles, lockfiles ni configuracion de entorno.

## Archivos copiados

| Destino relativo | Origen exacto | Motivo |
| --- | --- | --- |
| `src/docphone-backblaze-upload/apps/api/src/services/StorageService.ts` | `C:\Users\mmmau\docphone-v2\apps\api\src\services\StorageService.ts` | Servicio completo de storage local y S3-compatible/B2; incluye tipos, adaptadores y helpers. |
| `src/docphone-backblaze-upload/apps/api/src/middlewares/uploadMiddleware.ts` | `C:\Users\mmmau\docphone-v2\apps\api\src\middlewares\uploadMiddleware.ts` | Multer en memoria, filtros de MIME, limites y compresion de imagen. |
| `src/docphone-backblaze-upload/apps/api/src/controllers/report.controller.ts` | `C:\Users\mmmau\docphone-v2\apps\api\src\controllers\report.controller.ts` | Flujo backend de guardado que llama `StorageService.saveFile` para audio e imagen. |
| `src/docphone-backblaze-upload/apps/api/src/routes/report.routes.ts` | `C:\Users\mmmau\docphone-v2\apps\api\src\routes\report.routes.ts` | Montaje de `uploadFiles` y `compressImage` en las rutas de subida, incluyendo `/` y `/guardar`. |
| `src/docphone-backblaze-upload/apps/web/src/lib/api.ts` | `C:\Users\mmmau\docphone-v2\apps\web\src\lib\api.ts` | Cliente frontend que construye `FormData` y dispara las peticiones multipart. |

Los cinco archivos se copiaron completos y sin adaptar. Por eso algunos modulos contienen funciones adicionales del modulo original; no se copiaron por separado workers de vision ni componentes visuales.

## Contenido de storage

`StorageService.ts` contiene literalmente:

- `StoredObjectRef`, el tipo de referencia persistida (`provider`, `bucket`, `key`).
- `ObjectStorageAdapter`, contrato interno del adaptador.
- `LocalDiskAdapter`, fallback de disco local.
- `S3CompatibleAdapter`, cliente AWS SDK para Backblaze B2 mediante API S3-compatible.
- `detectContentType`, helper de MIME por extension.
- `resolveAdapter`, seleccion del adaptador mediante `env.OBJECT_STORAGE_PROVIDER` y `env.OBJECT_STORAGE_BUCKET`.
- `StorageService.saveObject`, `saveFile`, `getSignedUrl`, `getWorkerFetchUrl` y helpers de disco.

El adaptador S3 usa `PutObjectCommand`, `GetObjectCommand`, URLs firmadas y `forcePathStyle: true`.

## Dependencias que debe adaptar el consumidor

### Dependencias de paquetes

- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`
- `express`
- `multer`
- `sharp`
- `axios`
- `@tanstack/react-query`
- `react-hot-toast`

### Imports locales o de workspace

- `StorageService.ts` importa `../config/env.js`; el consumidor debe proporcionar un modulo `env` compatible con `OBJECT_STORAGE_PROVIDER`, `OBJECT_STORAGE_BUCKET` y `PORT`.
- `uploadMiddleware.ts` importa `./errorHandler.js` y necesita un `AppError` compatible.
- `report.controller.ts` depende de `@docphone/db`, `@docphone/shared`, `@docphone/shared/types` y de sus servicios locales (`AiService`, `AuditService`, `AuthorizationService`, `ImageAnalysisJobService`, `PdfService`, `RealtimeService`, `RedisService`, `ReportLifecycleService`, `StorageService`, `UserResolverService` y `WordExportService`).
- `report.routes.ts` depende de `authMiddleware`, `uploadMiddleware`, `AiService`, `AppError`, `report.controller` y `ReportLifecycleService`.
- `api.ts` depende de `@docphone/shared`, `axios`, `@tanstack/react-query` y `react-hot-toast`; tambien asume navegador por `File`, `FormData`, `localStorage`, `window`, `EventSource`, `URL` y `document`.
- Los imports relativos conservan las rutas `.js` del origen y deben resolverse en la estructura del proyecto consumidor.

## Variables requeridas, sin valores

Nombres referenciados por las fuentes copiadas:

- `OBJECT_STORAGE_PROVIDER`
- `OBJECT_STORAGE_BUCKET`
- `B2_REGION`
- `B2_ENDPOINT`
- `B2_ACCESS_KEY_ID`
- `B2_SECRET_ACCESS_KEY`
- `BACKEND_BASE_URL`
- `PORT`
- `VERCEL`
- `RENDER`
- `VITE_API_URL`

`auth_token` no es una variable de entorno: es el nombre de la entrada usada por `localStorage` en el frontend.

No se incluyen valores para ninguno de esos nombres. El consumidor debe configurar sus propios valores y adaptar el modulo `env` importado por `StorageService.ts`.

## Conexion del flujo

1. `api.ts` agrega audio bajo `audio`, imagenes bajo `images` y campos de reporte al `FormData`.
2. `report.routes.ts` aplica `uploadFiles` y `compressImage` antes de `createReport` o `saveReport`.
3. `report.controller.ts` obtiene los buffers de `req.files` y llama `StorageService.saveFile(buffer, originalname, prefix)` con los prefijos `audio` o `image`.
4. `StorageService.saveFile` delega en `saveObject`; si el proveedor es S3, `S3CompatibleAdapter` envia el objeto a B2 mediante `PutObjectCommand`.

El proyecto consumidor debe adaptar las dependencias, el montaje de rutas, el modulo `env`, el acceso a autenticacion y los contratos compartidos sin modificar esta copia fuente si necesita conservarla como referencia literal.
