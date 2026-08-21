import axios, { AxiosError } from 'axios';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Modality, PaginatedResponse, ReportResponse, WorkflowState } from '@docphone/shared';
import type { ImageSecondOpinionInput, ImageSecondOpinionResultManifest } from '@docphone/shared';
import toast from 'react-hot-toast';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1',
  timeout: 120000,
});

export interface ApiErrorShape {
  message: string;
  statusCode: number;
  code?: string;
}

const normalizeError = (error: unknown): ApiErrorShape => {
  if (axios.isAxiosError(error)) {
    const statusCode = error.response?.status ?? 500;
    const apiMessage = (error.response?.data as { message?: string; error?: string } | undefined)?.message
      ?? (error.response?.data as { message?: string; error?: string } | undefined)?.error;

    return {
      message: apiMessage || error.message || 'Request failed',
      statusCode,
      code: (error.response?.data as { code?: string } | undefined)?.code,
    };
  }

  return {
    message: 'Unexpected error',
    statusCode: 500,
  };
};

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as (typeof error.config & { _retry?: boolean }) | undefined;

    if (error.response?.status === 503 && config && !config._retry) {
      config._retry = true;
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return apiClient(config);
    }

    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export interface LoginRequest {
  email?: string;
  username?: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  expiresAt?: string | Date;
}

export const authApi = {
  signup: async (data: { username: string; email?: string; password: string }) => {
    const response = await apiClient.post<{ token: string }>('/auth/signup', data);
    return response.data;
  },
  login: async (data: LoginRequest): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>('/auth/login', data);
    return response.data;
  },
  me: async () => {
    const response = await apiClient.get('/auth/me');
    return response.data;
  },
  logout: async () => {
    const response = await apiClient.post('/auth/logout');
    return response.data;
  },
};

export const reportApi = {
  getReports: async (params: { page?: number; limit?: number } = {}): Promise<PaginatedResponse<ReportResponse>> => {
    const response = await apiClient.get<PaginatedResponse<ReportResponse>>('/reports', {
      params: { page: params.page ?? 1, limit: params.limit ?? 10 },
    });
    return response.data;
  },

  getReportById: async (id: string): Promise<ReportResponse> => {
    const response = await apiClient.get<ReportResponse>(`/reports/${id}`);
    return response.data;
  },

  getReportPdf: async (id: string): Promise<Blob> => {
    const response = await apiClient.get(`/reports/${id}/pdf`, { responseType: 'blob' });
    return response.data;
  },

  shareReport: async (reportId: string, email: string, reason?: string) => {
    const response = await apiClient.post(`/reports/${reportId}/share`, { email, reason });
    return response.data;
  },

  downloadWord: async (data: { contenido: string; patientName?: string; patientId?: string; modality?: Modality }): Promise<Blob> => {
    const response = await apiClient.post('/reports/generar-word', data, { responseType: 'blob' });
    return response.data;
  },

  revokeReportShare: async (reportId: string, targetUserId: string) => {
    const response = await apiClient.delete(`/reports/${reportId}/share/${targetUserId}`);
    return response.data;
  },

  deleteReport: async (id: string) => {
    const response = await apiClient.delete(`/reports/${id}`);
    return response.data;
  },

  resetReportDerivedState: async (id: string): Promise<ReportResponse> => {
    const response = await apiClient.post<ReportResponse>(`/reports/${id}/reset`);
    return response.data;
  },

  saveReport: async (data: {
    audio?: File | Blob;
    image?: File;
    images?: File[];
    transcriptionText: string;
    formalReport: string;
    secondOpinion?: string;
    patientName?: string;
    patientId?: string;
    status?: 'DRAFT' | 'COMPLETED';
    workflowState?: WorkflowState;
  }): Promise<ReportResponse> => {
    const formData = new FormData();
    if (data.audio) {
      formData.append('audio', data.audio instanceof File ? data.audio : new File([data.audio], 'audio.webm', { type: data.audio.type || 'audio/webm' }));
    }
    const images = data.images?.length ? data.images : data.image ? [data.image] : [];
    for (const image of images) formData.append('images', image);
    formData.append('transcription', data.transcriptionText);
    formData.append('formalReport', data.formalReport);
    if (data.secondOpinion) formData.append('secondOpinion', data.secondOpinion);
    if (data.patientName) formData.append('patientName', data.patientName);
    if (data.patientId) formData.append('patientId', data.patientId);
    if (data.status) formData.append('status', data.status);
    if (data.workflowState) formData.append('workflowState', JSON.stringify(data.workflowState));

    const response = await apiClient.post<ReportResponse>('/reports/guardar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  saveDraft: async (data: {
    audio?: File | Blob;
    image?: File;
    images?: File[];
    transcriptionText: string;
    formalReport: string;
    secondOpinion?: string;
    patientName?: string;
    patientId?: string;
    workflowState?: WorkflowState;
  }): Promise<ReportResponse> => reportApi.saveReport({ ...data, status: 'DRAFT' }),

  downloadPdf: async (data: { contenido: string; patientName?: string; patientId?: string; modality?: Modality }): Promise<Blob> => {
    const response = await apiClient.post('/reports/generar-pdf', data, { responseType: 'blob' });
    return response.data;
  },
};

export const transcriptionApi = {
  transcribeAudio: async (audio: File | Blob): Promise<string> => {
    const formData = new FormData();
    formData.append('file', audio instanceof File ? audio : new File([audio], 'dictado.ogg', { type: 'audio/ogg' }));
    const response = await apiClient.post<{ resultado: string }>('/reports/transcribir', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.resultado;
  },
};

export const formalizationApi = {
  formalizeText: async (data: { texto: string; modality?: Modality }): Promise<{ textoFormal: string }> => {
    const response = await apiClient.post<{ textoFormal: string }>('/reports/formalizar', data);
    return response.data;
  },
};

export const imageAnalysisApi = {
  analyzeImage: async (image: File, modality?: Modality): Promise<ImageSecondOpinionResultManifest> => {
    const formData = new FormData();
    formData.append('file', image);
    if (modality) formData.append('modality', modality);
    const response = await apiClient.post<{ hallazgos?: Record<string, number>; cam_url?: string; job_id?: string; estado?: string; texto?: string; findings?: Array<{ label: string; probability: number; threshold?: number; notes?: string }>; inputs?: ImageSecondOpinionInput[] }>('/reports/analizar-imagen', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    if (response.status === 202 || response.data?.job_id) {
      const jobId = response.data?.job_id;
      if (!jobId) throw new Error('Respuesta async inválida: falta job_id');

      return await new Promise<ImageSecondOpinionResultManifest>((resolve, reject) => {
        const base = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1').replace(/\/$/, '');
        const token = localStorage.getItem('auth_token');
        const sseUrl = `${base}/reports/analizar-imagen/${jobId}/eventos${token ? `?token=${encodeURIComponent(token)}` : ''}`;
        const eventSource = new EventSource(sseUrl);

        const timer = setTimeout(() => {
          eventSource.close();
          reject(new Error('Timeout esperando resultado de análisis de imagen'));
        }, 120000);

        const closeAll = () => {
          clearTimeout(timer);
          eventSource.close();
        };

        eventSource.addEventListener('image-analysis-result', (event: MessageEvent) => {
          try {
            const parsed = JSON.parse(event.data) as ImageSecondOpinionResultManifest;
            closeAll();
            resolve(parsed);
          } catch {
            closeAll();
            reject(new Error('Evento SSE inválido para análisis de imagen'));
          }
        });

        eventSource.onerror = () => {
          closeAll();
          reject(new Error('Error de conexión SSE en análisis de imagen'));
        };
      });
    }

    return {
      status: 'success',
      hallazgos: response.data?.hallazgos ?? {},
      texto: response.data?.texto,
      findings: response.data?.findings,
      inputs: Array.isArray(response.data?.inputs) ? response.data.inputs : undefined,
    };
  },
};

export const useLogin = () => useMutation({
  mutationFn: authApi.login,
  onSuccess: (data) => localStorage.setItem('auth_token', data.token),
});

export const useReports = (params: { page?: number; limit?: number } = {}) => useQuery({
  queryKey: ['reports', params.page ?? 1, params.limit ?? 10],
  queryFn: () => reportApi.getReports(params),
});

export const useReportById = (id: string) => useQuery({
  queryKey: ['report', id],
  queryFn: () => reportApi.getReportById(id),
  enabled: Boolean(id),
});

export const useDownloadPdf = () => useMutation({
  mutationFn: reportApi.getReportPdf,
  onSuccess: (blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'informe.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('PDF descargado correctamente');
  },
  onError: (error) => {
    const normalized = normalizeError(error);
    toast.error(normalized.message || 'Error al descargar PDF');
  },
});

export { apiClient, normalizeError };
