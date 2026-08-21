import { ProviderOrchestrator } from '../ai/orchestrator';
import { toSafeClientError } from '../utils/errors';
import type { BackendEnv } from '../config/env';
import type { CompanionMessage } from '../ai/types';

interface UploadedFile { buffer: Buffer; mimetype?: string; originalname?: string; }
interface RequestLike { file?: UploadedFile; body?: { sessionId?: string; messages?: CompanionMessage[]; transcript?: string }; }
interface ResponseLike { status: (code: number) => ResponseLike; json: (body: unknown) => void; }

export function createVoiceHandlers(env: BackendEnv) {
  const orchestrator = new ProviderOrchestrator(env.groq);
  return {
    transcribe: async (req: RequestLike, res: ResponseLike) => {
      try {
        if (!req.file?.buffer) return res.status(400).json({ code: 'AUDIO_REQUIRED', message: 'Multipart field file is required', retryable: false });
        const result = await orchestrator.transcribe({ audio: req.file.buffer, mimeType: req.file.mimetype, fileName: req.file.originalname });
        return res.status(200).json(result);
      } catch (error) { return res.status(503).json(toSafeClientError(error)); }
    },
    turn: async (req: RequestLike, res: ResponseLike) => {
      try {
        const { sessionId, messages, transcript } = req.body ?? {};
        if (!sessionId || !Array.isArray(messages)) return res.status(400).json({ code: 'TURN_PAYLOAD_INVALID', message: 'sessionId and messages are required', retryable: false });
        const result = await orchestrator.chat({ sessionId, messages, transcript });
        return res.status(200).json(result);
      } catch (error) { return res.status(503).json(toSafeClientError(error)); }
    },
  };
}
