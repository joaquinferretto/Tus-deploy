/**
 * API-intermediate client extracted from the frontend's formalization and
 * image-analysis hooks. It does not contain React state or provider secrets.
 */

export const MEDICAL_MODALITY = {
  GENERAL: 'GENERAL',
  ULTRASOUND: 'ULTRASOUND',
  XRAY: 'XRAY',
  TOMOGRAPHY: 'TOMOGRAPHY',
  MAMMOGRAPHY: 'MAMMOGRAPHY',
} as const;

export type MedicalModality = (typeof MEDICAL_MODALITY)[keyof typeof MEDICAL_MODALITY];

export interface FrontendAiApiOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface FormalizationInput {
  texto: string;
  modality?: MedicalModality;
}

export interface FormalizationResponse {
  textoFormal: string;
}

export interface ImageFinding {
  label: string;
  probability: number;
  threshold?: number;
  notes?: string;
}

export interface ImageAnalysisSuccess {
  status: 'success';
  hallazgos: Record<string, number>;
  texto?: string;
  findings?: ImageFinding[];
  inputs?: unknown[];
}

export interface ImageAnalysisPending {
  status: 'pending';
  jobId: string;
}

export type ImageAnalysisResponse = ImageAnalysisSuccess | ImageAnalysisPending;

export class FrontendAiApiError extends Error {
  public constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly code?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FrontendAiApiError';
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function resolveFetch(fetcher?: FrontendAiApiOptions['fetcher']) {
  if (fetcher) return fetcher;
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  throw new FrontendAiApiError('Fetch is not available in this runtime');
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'message' in body
      ? String((body as { message?: unknown }).message)
      : `AI request failed (${response.status})`;
    throw new FrontendAiApiError(message, response.status, undefined, body);
  }
  return body;
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function createFrontendAiApi(options: FrontendAiApiOptions) {
  const fetcher = resolveFetch(options.fetcher);
  const timeoutMs = options.timeoutMs ?? 120_000;

  async function request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await readJson(await fetcher(joinUrl(options.baseUrl, path), {
        ...init,
        headers: { ...authHeaders(options.token), ...(init.headers ?? {}) },
        signal: controller.signal,
      }));
    } catch (error) {
      if (error instanceof FrontendAiApiError) throw error;
      throw new FrontendAiApiError('AI request failed', undefined, 'AI_REQUEST_FAILED', error);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async formalizeText(input: FormalizationInput): Promise<FormalizationResponse> {
      const body = await request('/reports/formalizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const textoFormal = typeof body === 'object' && body !== null
        ? (body as { textoFormal?: unknown }).textoFormal
        : undefined;
      if (typeof textoFormal !== 'string' || !textoFormal.trim()) {
        throw new FrontendAiApiError('La formalización devolvió contenido vacío');
      }
      return { textoFormal };
    },

    async analyzeImage(image: Blob, modality: MedicalModality = MEDICAL_MODALITY.GENERAL): Promise<ImageAnalysisResponse> {
      const formData = new FormData();
      const fileName = 'name' in image && typeof (image as { name?: unknown }).name === 'string'
        ? (image as { name: string }).name
        : 'study.jpg';
      formData.append('file', image, fileName);
      formData.append('modality', modality);

      const body = await request('/reports/analizar-imagen', {
        method: 'POST',
        body: formData,
      });
      if (typeof body !== 'object' || body === null) {
        throw new FrontendAiApiError('Respuesta de análisis inválida');
      }

      const payload = body as {
        job_id?: unknown;
        hallazgos?: unknown;
        texto?: unknown;
        findings?: unknown;
        inputs?: unknown;
      };
      if (typeof payload.job_id === 'string' && payload.job_id) {
        return { status: 'pending', jobId: payload.job_id };
      }

      if (typeof payload.hallazgos !== 'object' || payload.hallazgos === null) {
        throw new FrontendAiApiError('Respuesta de análisis inválida: faltan hallazgos');
      }

      return {
        status: 'success',
        hallazgos: payload.hallazgos as Record<string, number>,
        texto: typeof payload.texto === 'string' ? payload.texto : undefined,
        findings: Array.isArray(payload.findings) ? payload.findings as ImageFinding[] : undefined,
        inputs: Array.isArray(payload.inputs) ? payload.inputs : undefined,
      };
    },
  };
}
