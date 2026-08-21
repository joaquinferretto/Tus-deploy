# Módulos extraídos de DocPhone para Groq e IA

Estos archivos son nuevas extracciones portables de la lógica usada por `docphone-v2/apps/web`. No contienen JSX, pantallas, Zustand, React, claves API ni archivos `.env`.

## Fuentes encontradas

- `apps/web/src/components/audio/AudioRecorder.tsx`: `navigator.mediaDevices.getUserMedia`, `MediaRecorder`, selección de MIME, acumulación de chunks, creación de `Blob`, liberación de tracks y errores de permisos.
- `apps/web/src/features/wizard/components/AudioRecorder.tsx`: segunda implementación equivalente de grabación, con la misma lista de formatos y salida `audio/ogg`.
- `apps/web/src/hooks/useAudioUpload.ts`: extensiones `mp3`, `wav`, `m4a`, `ogg`, `webm`, `aac`, `flac`, `opus`, `amr`; validación por extensión y almacenamiento de `File`/`Blob`.
- `apps/web/src/lib/api.ts`: `POST /reports/transcribir` con multipart `file` y nombre `dictado.ogg`; `POST /reports/formalizar`; `POST /reports/analizar-imagen` con multipart `file`, modalidad y SSE opcional.
- `apps/web/src/hooks/useTranscription.ts`: tres intentos, espera de 5 segundos antes del tercer intento, rechazo de respuesta vacía y estados de error.
- `apps/web/src/hooks/useFormalization.ts` y `apps/web/src/hooks/useImageAnalysis.ts`: validación de respuesta y estados de IA extraídos sin React.
- `apps/web/src/stores/useReportStore.ts` y `apps/web/src/hooks/useReportGeneration.ts`: estados derivados (`transcriptionText`, `cleanedTranscription`, `generatedReport`, `aiAnalysis`) y persistencia del audio como `Blob`/`File`; no se copió el store/UI.

## Archivos nuevos

- `src/frontend-groq/audio-contracts.ts`: extensiones, candidatos MIME, nombres/campos multipart, preparación de audio y selección MIME.
- `src/frontend-groq/browser-audio-recorder.ts`: adaptador browser-only de `getUserMedia`/`MediaRecorder`, estado, duración, errores tipados y liberación de recursos.
- `src/frontend-groq/transcription-client.ts`: cliente `fetch` para la API intermedia, timeout, auth opcional y multipart sin fijar manualmente el boundary.
- `src/frontend-groq/transcription-workflow.ts`: flujo de reintentos y errores sin React ni store.
- `src/frontend-groq/ai-api-client.ts`: cliente para formalización y análisis de imagen de la API intermedia.
- `src/frontend-groq/browser-image-analysis.ts`: espera browser-only del evento SSE `image-analysis-result`.
- `src/frontend-groq/index.ts`: barrel de los módulos nuevos.

## Contratos y compatibilidad

- El frontend transcribe mediante `/reports/transcribir`, campo `file`, y espera `{ resultado: string }`.
- El módulo `src/routes/voice.ts` existente en `backendFiles` expone handlers que esperan `req.file` y devuelven `{ text, provider, model, attempts }`. `transcription-client.ts` acepta ambas claves (`resultado` y `text`); el montaje de la ruta y Multer siguen siendo responsabilidad del backend consumidor.
- `src/ai/groq.provider.ts` existente conserva las llamadas server-side a Groq y nunca se importa desde estos módulos browser-only. No se duplican claves ni se expone `GROQ_API_KEY`.
- El guardado de reportes del frontend usa el campo `audio`, mientras que la transcripción usa `file`; la configuración existente de Multer admite ambos nombres.
- La implementación original etiqueta los chunks grabados como `audio/ogg` aunque el navegador puede haber producido WebM/Opus. Se conserva ese contrato en `AUDIO_CONTRACT.recordedBlobMimeType` para compatibilidad, pero el consumidor debe validar que su proveedor acepte el códec real o transcodificar en backend.
- No se encontró en `apps/web/src` una llamada directa a `chat/completions`, Groq o un chat propio. La generación clínica visible es formalización mediante `/reports/formalizar`; el chat server-side existente en `backendFiles/src/ai/groq.provider.ts` no se presenta como una extracción del frontend.

## Uso mínimo

```ts
import {
  BrowserAudioRecorder,
  createFrontendTranscriptionClient,
  transcribeWithFrontendRetry,
} from './src/frontend-groq';

const recorder = new BrowserAudioRecorder();
await recorder.start();
const recording = await recorder.stop();

const client = createFrontendTranscriptionClient({
  baseUrl: 'https://api.example.invalid/api/v1',
  token: 'token-proporcionado-por-el-runtime',
});

const result = await transcribeWithFrontendRetry({
  audio: recording.blob,
  transcribe: client.transcribeAudio,
});
```

El ejemplo no contiene secretos reales. En una aplicación productiva, el token debe llegar desde el mecanismo de autenticación del runtime y la URL debe configurarse fuera de estos archivos.

## Validación y limitaciones

- Se verificó que `backendFiles` no tenía previamente `src/frontend-groq` ni `FRONTEND_GROQ_MODULES.md` antes de crear estos archivos.
- La carpeta destino no tiene `package.json`, `tsconfig.json` ni runner de pruebas; por ello no existe un comando local autónomo de compilación/test para estos módulos.
- La validación recomendada por el README existente es ejecutar el TypeScript/test runner del proyecto consumidor. Este cambio no crea locks, caches, resultados de test ni configuraciones fuera de `backendFiles`.
