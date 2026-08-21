# Portable backend modules

This directory contains dependency-free TypeScript building blocks for AI calls, medical report generation, storage, Redis-like integrations, validation, and privacy. Existing application routes can inject their own HTTP, Redis, storage, or chat implementations.

## Modules

- `src/ai/retry.ts`: exponential backoff with optional jitter, abort cleanup, max attempts/delay, and permanent-error classification.
- `src/ai/http.ts`: timeout plus external `AbortSignal`, `Retry-After` parsing, and retryable fetch.
- `src/ai/groq.provider.ts`: existing transcription and chat methods using the HTTP helpers.
- `src/ai/medicalReport.ts`: injectable chat client and evidence-bound structured report generation with text and safe JSON output.
- `src/integrations/redis.ts`: injected `get`, `set`, `del`, `publish`, `subscribe`, `enqueue`, and `dequeue` contracts.
- `src/integrations/storage.ts`: storage contract, injected remote adapter, and Node local filesystem adapter with traversal protection.
- `src/validation/medicalJson.ts`: fence removal, JSON parsing, object/array/required-field validation, and structured errors.
- `src/privacy/anonymization.ts`: configurable PII replacement with optional in-memory restoration.

## Example

```ts
import { generateMedicalReport } from './src/ai/medicalReport';
import { anonymizeText } from './src/privacy/anonymization';

const safeInput = anonymizeText(transcript, { reversible: false }).text;
const report = await generateMedicalReport(chatClient, { transcript: safeInput });
console.log(report.text, report.json);
```

The report prompt explicitly forbids invented diagnoses. A malformed model response is returned as text and represented in JSON with `impression: null` plus a limitation instead of being treated as a valid clinical report.

## Integration notes

No Redis, cloud storage, HTTP client, schema library, Express, application error class, or global application environment is required. `LocalFilesystemStorageAdapter` uses Node built-ins and returns a `file:` URL rather than a cryptographically signed remote URL; production deployments should inject a backend that implements real signed URLs.

This folder has no `package.json`, `tsconfig.json`, or test runner. Existing Vitest files are retained, but a full build/test command cannot be run from this folder without the parent workspace toolchain. Validation should be performed by the consuming project with its TypeScript configuration.
