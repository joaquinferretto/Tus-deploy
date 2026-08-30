export const STREAM_CONTRACT_VERSION = '1.0.0';
export const STREAM_KIND = {
    TOKEN: 'token',
    AUDIO: 'audio',
    EVENT: 'event',
    PROGRESS: 'progress',
};
export const STREAM_FRAME_STATUS = {
    PARTIAL: 'partial',
    PROGRESS: 'progress',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
};
export const STREAM_PARTIAL_RESULT_POLICY = {
    EMIT_PARTIAL: 'emit-partial',
    HOLD_UNTIL_COMPLETE: 'hold-until-complete',
    DISCARD_ON_CANCEL: 'discard-on-cancel',
};
export class StreamContractValidationError extends Error {
    field;
    constructor(field, reason) {
        super(`Invalid stream frame ${field}: ${reason}`);
        this.name = 'StreamContractValidationError';
        this.field = field;
    }
}
export function createStreamCursor(streamId, sequence) {
    if (!isNonEmptyString(streamId) || !Number.isInteger(sequence) || sequence < 1) {
        throw new StreamContractValidationError('cursor', 'streamId and positive sequence are required');
    }
    return `${streamId}:${sequence}`;
}
export function parseStreamCursor(cursor) {
    const separator = cursor.lastIndexOf(':');
    const streamId = separator > 0 ? cursor.slice(0, separator) : '';
    const sequence = separator > 0 ? Number(cursor.slice(separator + 1)) : Number.NaN;
    if (!isNonEmptyString(streamId) || !Number.isInteger(sequence) || sequence < 1) {
        throw new StreamContractValidationError('cursor', 'must be streamId:sequence');
    }
    return { streamId, sequence };
}
export function validateStreamFrame(value) {
    if (!isRecord(value))
        throw new StreamContractValidationError('frame', 'must be an object');
    if (value.contractVersion !== STREAM_CONTRACT_VERSION) {
        throw new StreamContractValidationError('contractVersion', 'unsupported contract version');
    }
    for (const field of [
        'streamId',
        'runId',
        'tenantId',
        'actorId',
        'correlationId',
        'cursor',
        'emittedAt',
    ]) {
        if (!isNonEmptyString(value[field])) {
            throw new StreamContractValidationError(field, 'must be a non-empty string');
        }
    }
    if (!isStreamKind(value.kind))
        throw new StreamContractValidationError('kind', 'is unsupported');
    if (!isStreamFrameStatus(value.status)) {
        throw new StreamContractValidationError('status', 'is unsupported');
    }
    if (!Number.isInteger(value.sequence) || Number(value.sequence) < 1) {
        throw new StreamContractValidationError('sequence', 'must be a positive integer');
    }
    const parsedCursor = parseStreamCursor(value.cursor);
    if (parsedCursor.streamId !== value.streamId || parsedCursor.sequence !== value.sequence) {
        throw new StreamContractValidationError('cursor', 'must match streamId and sequence');
    }
    if (!isRecord(value.payload))
        throw new StreamContractValidationError('payload', 'must be an object');
    if (!isCanonicalIsoTimestamp(value.emittedAt)) {
        throw new StreamContractValidationError('emittedAt', 'must be a canonical ISO-8601 UTC timestamp');
    }
    return value;
}
export function isCanonicalIsoTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
        return false;
    return new Date(value).toISOString() === value;
}
function isStreamKind(value) {
    return Object.values(STREAM_KIND).includes(value);
}
function isStreamFrameStatus(value) {
    return Object.values(STREAM_FRAME_STATUS).includes(value);
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=streams.js.map