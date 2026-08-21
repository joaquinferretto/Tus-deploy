/** Browser-only MediaRecorder adapter. It contains no React or UI code. */

import {
  AUDIO_CONTRACT,
  RECORDING_MIME_CANDIDATES,
  audioExtensionForMimeType,
  selectRecordingMimeType,
} from './audio-contracts';

export const AUDIO_RECORDER_STATE = {
  IDLE: 'idle',
  STARTING: 'starting',
  RECORDING: 'recording',
  STOPPING: 'stopping',
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
  DISPOSED: 'DISPOSED',
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
  filename: string;
  durationSeconds: number;
  chunkCount: number;
}

export interface BrowserAudioRecorderOptions {
  audio?: MediaTrackConstraints;
  mimeCandidates?: readonly string[];
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createMediaRecorder?: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  isTypeSupported?: (mimeType: string) => boolean;
  now?: () => number;
}

interface CompletionHandlers {
  resolve: (result: AudioRecordingResult) => void;
  reject: (error: AudioRecorderError) => void;
}

function hasName(error: unknown, name: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === name;
}

function toRecorderError(error: unknown): AudioRecorderError {
  if (error instanceof AudioRecorderError) return error;
  if (hasName(error, 'NotAllowedError')) {
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
  private completionPromise: Promise<AudioRecordingResult> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private durationSeconds = 0;
  private state: AudioRecorderState = AUDIO_RECORDER_STATE.IDLE;
  private mimeType: string | null = null;
  private stopRequested = false;
  private disposed = false;

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
    if (this.state !== AUDIO_RECORDER_STATE.IDLE) {
      throw new AudioRecorderError(
        AUDIO_RECORDER_ERROR.ALREADY_RECORDING,
        'An audio recording is already starting or active',
      );
    }

    this.disposed = false;
    this.stopRequested = false;
    this.state = AUDIO_RECORDER_STATE.STARTING;
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
      (stream: MediaStream, recorderOptions: MediaRecorderOptions) => {
        if (typeof globalThis.MediaRecorder === 'undefined') {
          throw new AudioRecorderError(
            AUDIO_RECORDER_ERROR.BROWSER_UNSUPPORTED,
            'This browser does not expose MediaRecorder',
          );
        }
        return new MediaRecorder(stream, recorderOptions);
      }
    );
    const isTypeSupported = this.options.isTypeSupported ?? ((mimeType: string) => (
      typeof globalThis.MediaRecorder !== 'undefined'
      && globalThis.MediaRecorder.isTypeSupported(mimeType)
    ));

    try {
      this.stream = await getUserMedia({ audio: this.options.audio ?? true });
      if (this.disposed) {
        this.releaseResources();
        throw new AudioRecorderError(AUDIO_RECORDER_ERROR.DISPOSED, 'The recorder was disposed');
      }

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

      if (this.stopRequested) this.requestStop();
    } catch (error) {
      const recorderError = toRecorderError(error);
      this.rejectCompletion(recorderError);
      throw recorderError;
    }
  }

  public stop(): Promise<AudioRecordingResult> {
    if (this.state === AUDIO_RECORDER_STATE.STARTING) {
      this.stopRequested = true;
      return this.createCompletionPromise();
    }
    if (this.state === AUDIO_RECORDER_STATE.STOPPING && this.completion) {
      return this.completionPromise ?? Promise.reject(new AudioRecorderError(
        AUDIO_RECORDER_ERROR.NO_ACTIVE_RECORDING,
        'The stop operation is not available',
      ));
    }
    if (this.state !== AUDIO_RECORDER_STATE.RECORDING || !this.recorder) {
      return Promise.reject(new AudioRecorderError(
        AUDIO_RECORDER_ERROR.NO_ACTIVE_RECORDING,
        'There is no active audio recording',
      ));
    }

    const result = this.createCompletionPromise();
    this.requestStop();
    return result;
  }

  public dispose(): void {
    this.disposed = true;
    this.stopRequested = true;
    const error = new AudioRecorderError(AUDIO_RECORDER_ERROR.DISPOSED, 'The recorder was disposed');
    this.completion?.reject(error);
    this.completion = null;
    this.completionPromise = null;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.releaseResources();
    this.state = AUDIO_RECORDER_STATE.IDLE;
    this.durationSeconds = 0;
  }

  private createCompletionPromise(): Promise<AudioRecordingResult> {
    if (this.completionPromise) return this.completionPromise;
    this.completionPromise = new Promise<AudioRecordingResult>((resolve, reject) => {
      this.completion = { resolve, reject };
    });
    return this.completionPromise;
  }

  private requestStop(): void {
    if (!this.recorder || this.recorder.state === 'inactive') {
      this.finishRecording();
      return;
    }
    this.state = AUDIO_RECORDER_STATE.STOPPING;
    this.recorder.stop();
  }

  private finishRecording(): void {
    const actualMimeType = this.recorder?.mimeType
      || this.chunks[0]?.type
      || this.mimeType
      || AUDIO_CONTRACT.defaultRecordingMimeType;
    const blob = new Blob(this.chunks, { type: actualMimeType });
    const extension = audioExtensionForMimeType(actualMimeType) || 'webm';
    const completion = this.completion;
    this.completion = null;
    this.completionPromise = null;

    if (blob.size === 0) {
      completion?.reject(new AudioRecorderError(
        AUDIO_RECORDER_ERROR.EMPTY_RECORDING,
        'The recording is empty',
      ));
    } else {
      completion?.resolve({
        blob,
        mimeType: actualMimeType,
        filename: `dictado.${extension}`,
        durationSeconds: this.durationSeconds,
        chunkCount: this.chunks.length,
      });
    }

    this.releaseResources();
    this.state = AUDIO_RECORDER_STATE.IDLE;
    this.durationSeconds = 0;
    this.stopRequested = false;
  }

  private rejectCompletion(error: AudioRecorderError): void {
    this.completion?.reject(error);
    this.completion = null;
    this.completionPromise = null;
    this.releaseResources();
    this.state = AUDIO_RECORDER_STATE.IDLE;
    this.durationSeconds = 0;
    this.stopRequested = false;
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
