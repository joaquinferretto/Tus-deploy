# Variante frontend audio-only

Esta carpeta contiene únicamente la lógica de audio extraída de `docphone-v2/apps/web`. No contiene JSX, React, pantallas, imágenes, análisis visual, SSE de imágenes, secretos ni archivos `.env`.

## Módulos

- `src/frontend-groq-audio/audio-contracts.ts`: extensiones aceptadas, selección MIME, derivación MIME-extensión, `Blob` no vacío y parte multipart.
- `src/frontend-groq-audio/browser-audio-recorder.ts`: `getUserMedia` y `MediaRecorder` sin UI, con estados serializados, clasificación de navegador no compatible y liberación de tracks.
- `src/frontend-groq-audio/transcription-client.ts`: cliente STT multipart para `/reports/transcribir`, usando el campo `file`, `Authorization` opcional, `AbortSignal` y timeout.
- `src/frontend-groq-audio/transcription-workflow.ts`: workflow no React; solo reintenta errores transitorios y no repite 4xx permanentes ni cancelaciones.
- `src/frontend-groq-audio/index.ts`: exports públicos de audio.

## Correcciones aplicadas

- El `Blob` conserva el MIME real expuesto por `MediaRecorder.mimeType`; WebM/Opus no se etiqueta como OGG.
- El nombre de archivo se deriva del MIME real (`dictado.webm`, `dictado.ogg`, `dictado.m4a`, etc.).
- Los tokens, cuando el consumidor los proporciona, viajan en `Authorization`; nunca se agregan a URLs.
- No existe cliente SSE ni módulo de análisis de imágenes en esta variante.
- `start`, `stop` y `dispose` usan estados `starting`, `recording` y `stopping` para evitar carreras y siempre detienen los tracks obtenidos.
- Un `Blob` vacío se rechaza antes de construir `FormData` y al finalizar una grabación.
- La ausencia de `navigator.mediaDevices.getUserMedia` o `MediaRecorder` se clasifica como `BROWSER_UNSUPPORTED`.
- Los errores 4xx permanentes no se reintentan; 408, 425, 429, 5xx y fallos de red sí pueden reintentarse.

## Ejemplo

```ts
import {
  BrowserAudioRecorder,
  createFrontendTranscriptionClient,
  transcribeWithFrontendRetry,
} from './src/frontend-groq-audio';

const recorder = new BrowserAudioRecorder();
await recorder.start();
const recording = await recorder.stop();

const client = createFrontendTranscriptionClient({
  baseUrl: 'https://api.example.invalid/api/v1',
});

const result = await transcribeWithFrontendRetry({
  audio: recording.blob,
  transcribe: client.transcribeAudio,
});
```

El frontend original consultado usa `/reports/transcribir`, `FormData` con campo `file` y respuesta `{ resultado: string }`. La variante también acepta `{ text: string }` para el handler portable existente de `backendFiles/src/routes/voice.ts`.

## Fuentes consultadas

- `apps/web/src/components/audio/AudioRecorder.tsx`
- `apps/web/src/features/wizard/components/AudioRecorder.tsx`
- `apps/web/src/hooks/useAudioUpload.ts`
- `apps/web/src/hooks/useTranscription.ts`
- `apps/web/src/lib/api.ts` (`transcriptionApi`)
- `apps/web/src/__tests__/hooks/useAudioUpload.test.ts`
- `apps/web/src/__tests__/components/AudioRecorder.test.tsx`

## Limitaciones

`backendFiles` no tiene `package.json`, `tsconfig.json` ni runner de pruebas propio. Las validaciones realizadas se limitan a comprobaciones sintácticas/estructurales que no escriben artefactos; el proyecto consumidor debe compilar estos módulos con sus tipos DOM y su configuración TypeScript.

El módulo previo `src/frontend-groq/ai-api-client.ts` no se eliminó: mezcla formalización textual con análisis de imágenes, por lo que no puede demostrarse que sea exclusivamente visual. `src/frontend-groq/browser-image-analysis.ts` sí era exclusivamente visual y fue eliminado.
