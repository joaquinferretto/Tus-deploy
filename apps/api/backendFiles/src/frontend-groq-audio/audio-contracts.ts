/** Audio-only contracts extracted from the DocPhone frontend. */

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
  transcriptionField: 'file',
  transcriptionFilenamePrefix: 'dictado',
} as const;

export class AudioContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AudioContractError';
  }
}

export function getAudioExtension(fileName: string): string {
  const cleanName = fileName.split(/[?#]/, 1)[0] ?? fileName;
  const lastDot = cleanName.lastIndexOf('.');
  return lastDot >= 0 ? cleanName.slice(lastDot + 1).toLowerCase() : '';
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

export function audioExtensionForMimeType(mimeType: string): SupportedAudioExtension | '' {
  const baseMimeType = normalizeAudioMimeType(mimeType).split(';', 1)[0]?.toLowerCase() ?? '';
  const extensions: Record<string, SupportedAudioExtension> = {
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/opus': 'opus',
    'audio/amr': 'amr',
  };

  return extensions[baseMimeType] ?? '';
}

interface NamedBlob extends Blob {
  readonly name: string;
}

function hasAudioFileName(audio: Blob): audio is NamedBlob {
  return 'name' in audio && typeof (audio as { name?: unknown }).name === 'string'
    && (audio as { name: string }).name.length > 0;
}

export interface AudioUploadPart {
  body: Blob;
  filename: string;
}

export function assertNonEmptyAudio(audio: Blob): void {
  if (audio.size === 0) {
    throw new AudioContractError('The audio Blob is empty');
  }
}

export function createTranscriptionUploadPart(audio: Blob): AudioUploadPart {
  assertNonEmptyAudio(audio);

  if (hasAudioFileName(audio)) {
    return { body: audio, filename: audio.name };
  }

  const extension = audioExtensionForMimeType(audio.type) || 'webm';
  return {
    body: audio,
    filename: `${AUDIO_CONTRACT.transcriptionFilenamePrefix}.${extension}`,
  };
}

export function selectRecordingMimeType(
  isTypeSupported: (mimeType: string) => boolean,
  candidates: readonly string[] = RECORDING_MIME_CANDIDATES,
): string {
  return candidates.find((mimeType) => isTypeSupported(mimeType))
    ?? AUDIO_CONTRACT.defaultRecordingMimeType;
}
