/**
 * Shared audio contracts extracted from the DocPhone frontend.
 * This module contains no React or UI code and can be used by an API adapter.
 */

export const SUPPORTED_AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'ogg',
  'webm',
  'aac',
  'flac',
  'opus',
  'amr',
] as const;

export type SupportedAudioExtension = (typeof SUPPORTED_AUDIO_EXTENSIONS)[number];

export const RECORDING_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm',
] as const;

export const AUDIO_CONTRACT = {
  defaultRecordingMimeType: 'audio/webm',
  recordedBlobMimeType: 'audio/ogg',
  transcriptionField: 'file',
  transcriptionFilename: 'dictado.ogg',
  reportAudioField: 'audio',
  reportAudioFilename: 'audio.webm',
} as const;

export function getAudioExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot >= 0 ? fileName.slice(lastDot + 1).toLowerCase() : '';
}

export function isSupportedAudioFileName(fileName: string): boolean {
  return SUPPORTED_AUDIO_EXTENSIONS.includes(
    getAudioExtension(fileName) as SupportedAudioExtension,
  );
}

export function normalizeAudioMimeType(mimeType: string): string {
  const aliases: Record<string, string> = {
    'audio/mp3': 'audio/mpeg',
  };

  return aliases[mimeType.toLowerCase()] ?? mimeType;
}

interface NamedBlob extends Blob {
  readonly name: string;
}

function hasAudioFileName(audio: Blob): audio is NamedBlob {
  return 'name' in audio && typeof (audio as { name?: unknown }).name === 'string';
}

export interface AudioUploadPart {
  body: Blob;
  filename: string;
}

export function createTranscriptionUploadPart(audio: Blob): AudioUploadPart {
  if (hasAudioFileName(audio)) {
    return { body: audio, filename: audio.name };
  }

  return {
    body: new Blob([audio], { type: AUDIO_CONTRACT.recordedBlobMimeType }),
    filename: AUDIO_CONTRACT.transcriptionFilename,
  };
}

export function createReportAudioUploadPart(audio: Blob): AudioUploadPart {
  if (hasAudioFileName(audio)) {
    return { body: audio, filename: audio.name };
  }

  return {
    body: new Blob([audio], {
      type: audio.type || AUDIO_CONTRACT.defaultRecordingMimeType,
    }),
    filename: AUDIO_CONTRACT.reportAudioFilename,
  };
}

export function selectRecordingMimeType(
  isTypeSupported: (mimeType: string) => boolean,
  candidates: readonly string[] = RECORDING_MIME_CANDIDATES,
): string {
  return candidates.find((mimeType) => isTypeSupported(mimeType))
    ?? AUDIO_CONTRACT.defaultRecordingMimeType;
}
