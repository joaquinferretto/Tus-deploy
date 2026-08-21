/**
 * Browser-only MediaRecorder adapter extracted from DocPhone's React component.
 * It deliberately exposes events/state instead of rendering controls or toasts.
 */

import {
  AUDIO_CONTRACT,
  RECORDING_MIME_CANDIDATES,
  selectRecordingMimeType,
} from './audio-contracts';

export const AUDIO_RECORDER_STATE = {
  IDLE: 'idle',
  RECORDING: 'recording',
} as const;

export type AudioRecorderState = (typeof AUDIO_RECORDER_STATE)[keyof typeof AUDIO_RECORDER_STATE];

export const AUDIO_RECORDER_ERROR = {
  BROWSER_UNSUPPORTED: 'BROWSER_UNSUPPORTED',
  MICROPHONE_PERMISSION_DENIED: 'MICROPHONE_PERMISSION_DENIED',
  MICROPHONE_UNAVAILABLE: 'MICROPHONE_UNAVAILABLE',
  ALREADY_RECORDING: 'ALREADY_RECORDING',
  NO_ACTIVE_RECORDING: 'NO_ACTIVE_RECORDING',
  EMPTY_RECORDING: 'EMPTY_RECORDING',
  RECORDER_FAILED: 'RECORDER_FAILED',
} as const;

export type AudioRecorderErrorCode = (typeof AUDIO_RECORDER_ERROR)[keyof typeof AUDIO_RECORDER_ERROR];

export class AudioRecorderError extends Error {
  public constructor(
    public readonly code: AudioRecorderErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AudioRecorderError';
  }
}

export interface AudioRecorderSnapshot {
  state: AudioRecorderState;
  durationSeconds: number;
  mimeType: string | null;
}

export interface AudioRecordingResult {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
  chunkCount: number;
}

export interface BrowserAudioRecorderOptions {
  audio?: MediaTrackConstraints;
  mimeCandidates?: readonly string[];
  outputMimeType?: string;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createMediaRecorder?: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  isTypeSupported?: (mimeType: string) => boolean;
  now?: () => number;
}

interface CompletionHandlers {
  resolve: (result: AudioRecordingResult) => void;
  reject: (error: AudioRecorderError) => void;
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'NotAllowedError';
}

function toRecorderError(error: unknown): AudioRecorderError {
  if (error instanceof AudioRecorderError) return error;
  if (isPermissionDenied(error)) {
    return new AudioRecorderError(
      AUDIO_RECORDER_ERROR.MICROPHONE_PERMISSION_DENIED,
      'Microphone permission was denied',
      error,
    );
  }

  return new AudioRecorderError(
    AUDIO_RECORDER_ERROR.MICROPHONE_UNAVAILABLE,
    'The microphone could not be accessed',
    error,
  );
}

export class BrowserAudioRecorder {
  private readonly options: BrowserAudioRecorderOptions;
  private readonly chunks: Blob[] = [];
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private completion: CompletionHandlers | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private durationSeconds = 0;
  private state: AudioRecorderState = AUDIO_RECORDER_STATE.IDLE;
  private mimeType: string | null = null;

  public constructor(options: BrowserAudioRecorderOptions = {}) {
    this.options = options;
  }

  public getSnapshot(): AudioRecorderSnapshot {
    return {
      state: this.state,
      durationSeconds: this.durationSeconds,
      mimeType: this.mimeType,
    };
  }

  public async start(): Promise<void> {
    if (this.state === AUDIO_RECORDER_STATE.RECORDING) {
      throw new AudioRecorderError(
        AUDIO_RECORDER_ERROR.ALREADY_RECORDING,
        'An audio recording is already active',
      );
    }

    const getUserMedia = this.options.getUserMedia ?? ((constraints: MediaStreamConstraints) => {
      if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
        throw new AudioRecorderError(
          AUDIO_RECORDER_ERROR.BROWSER_UNSUPPORTED,
          'This browser does not expose navigator.mediaDevices.getUserMedia',
        );
      }
      return globalThis.navigator.mediaDevices.getUserMedia(constraints);
    });

    const createMediaRecorder = this.options.createMediaRecorder ?? (
      (stream: MediaStream, options: MediaRecorderOptions) => new MediaRecorder(stream, options)
    );
    const isTypeSupported = this.options.isTypeSupported ?? ((mimeType: string) => (
      typeof globalThis.MediaRecorder !== 'undefined'
      && globalThis.MediaRecorder.isTypeSupported(mimeType)
    ));

    try {
      this.stream = await getUserMedia({ audio: this.options.audio ?? true });
      this.mimeType = selectRecordingMimeType(
        isTypeSupported,
        this.options.mimeCandidates ?? RECORDING_MIME_CANDIDATES,
      );
      this.chunks.length = 0;
      this.durationSeconds = 0;
      this.startedAt = (this.options.now ?? Date.now)();
      this.recorder = createMediaRecorder(this.stream, { mimeType: this.mimeType });
      this.recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      this.recorder.onerror = () => {
        this.rejectCompletion(new AudioRecorderError(
          AUDIO_RECORDER_ERROR.RECORDER_FAILED,
          'The browser recorder failed',
        ));
      };
      this.recorder.onstop = () => this.finishRecording();
      this.recorder.start();
      this.state = AUDIO_RECORDER_STATE.RECORDING;
      this.interval = setInterval(() => {
        const now = (this.options.now ?? Date.now)();
        this.durationSeconds = Math.floor((now - this.startedAt) / 1000);
      }, 1000);
    } catch (error) {
      this.releaseResources();
      this.state = AUDIO_RECORDER_STATE.IDLE;
      throw toRecorderError(error);
    }
  }

  public stop(): Promise<AudioRecordingResult> {
    if (!this.recorder || this.state !== AUDIO_RECORDER_STATE.RECORDING) {
      return Promise.reject(new AudioRecorderError(
        AUDIO_RECORDER_ERROR.NO_ACTIVE_RECORDING,
        'There is no active audio recording',
      ));
    }

    return new Promise<AudioRecordingResult>((resolve, reject) => {
      this.completion = { resolve, reject };
      this.recorder?.stop();
    });
  }

  public dispose(): void {
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    this.releaseResources();
    this.state = AUDIO_RECORDER_STATE.IDLE;
  }

  private finishRecording(): void {
    const blob = new Blob(this.chunks, {
      type: this.options.outputMimeType ?? AUDIO_CONTRACT.recordedBlobMimeType,
    });
    const result = {
      blob,
      mimeType: blob.type,
      durationSeconds: this.durationSeconds,
      chunkCount: this.chunks.length,
    };

    if (blob.size === 0) {
      this.rejectCompletion(new AudioRecorderError(
        AUDIO_RECORDER_ERROR.EMPTY_RECORDING,
        'The recording is empty',
      ));
    } else {
      this.completion?.resolve(result);
      this.completion = null;
    }

    this.releaseResources();
    this.state = AUDIO_RECORDER_STATE.IDLE;
    this.durationSeconds = 0;
  }

  private rejectCompletion(error: AudioRecorderError): void {
    this.completion?.reject(error);
    this.completion = null;
    this.releaseResources();
    this.state = AUDIO_RECORDER_STATE.IDLE;
  }

  private releaseResources(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}
