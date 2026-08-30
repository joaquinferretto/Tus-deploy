export declare const STREAM_CONTRACT_VERSION: "1.0.0";
export declare const STREAM_KIND: {
    readonly TOKEN: "token";
    readonly AUDIO: "audio";
    readonly EVENT: "event";
    readonly PROGRESS: "progress";
};
export type StreamKind = (typeof STREAM_KIND)[keyof typeof STREAM_KIND];
export declare const STREAM_FRAME_STATUS: {
    readonly PARTIAL: "partial";
    readonly PROGRESS: "progress";
    readonly COMPLETED: "completed";
    readonly FAILED: "failed";
    readonly CANCELLED: "cancelled";
};
export type StreamFrameStatus = (typeof STREAM_FRAME_STATUS)[keyof typeof STREAM_FRAME_STATUS];
export declare const STREAM_PARTIAL_RESULT_POLICY: {
    readonly EMIT_PARTIAL: "emit-partial";
    readonly HOLD_UNTIL_COMPLETE: "hold-until-complete";
    readonly DISCARD_ON_CANCEL: "discard-on-cancel";
};
export type StreamPartialResultPolicy = (typeof STREAM_PARTIAL_RESULT_POLICY)[keyof typeof STREAM_PARTIAL_RESULT_POLICY];
export interface StreamContext {
    streamId: string;
    tenantId: string;
    actorId: string;
    correlationId: string;
}
export interface StreamCreateInput extends StreamContext {
    runId: string;
    partialResultPolicy: StreamPartialResultPolicy;
    maxBuffer?: number;
}
export interface StreamFrameInput {
    kind: StreamKind;
    status: StreamFrameStatus;
    payload: Readonly<Record<string, unknown>>;
}
export interface StreamFrame extends StreamFrameInput {
    contractVersion: typeof STREAM_CONTRACT_VERSION;
    streamId: string;
    runId: string;
    tenantId: string;
    actorId: string;
    correlationId: string;
    sequence: number;
    cursor: string;
    emittedAt: string;
}
export interface StreamConnectRequest extends StreamContext {
    cursor?: string;
    maxInFlight: number;
}
export interface StreamConnection {
    connectionId: string;
    streamId: string;
    cursor: string | null;
}
export interface StreamPollRequest extends StreamContext {
    connectionId: string;
}
export interface StreamPollResult {
    status: 'open' | 'empty' | 'completed' | 'failed' | 'cancelled';
    frames: readonly StreamFrame[];
}
export interface StreamAckRequest extends StreamContext {
    connectionId: string;
    cursor: string;
}
export interface StreamCancelRequest extends StreamContext {
    connectionId: string;
    reason: string;
}
export declare class StreamContractValidationError extends Error {
    readonly field: string;
    constructor(field: string, reason: string);
}
export declare function createStreamCursor(streamId: string, sequence: number): string;
export declare function parseStreamCursor(cursor: string): {
    streamId: string;
    sequence: number;
};
export declare function validateStreamFrame(value: unknown): StreamFrame;
export declare function isCanonicalIsoTimestamp(value: unknown): value is string;
//# sourceMappingURL=streams.d.ts.map