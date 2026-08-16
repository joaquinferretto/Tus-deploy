export const ASSET_PIPELINE_CONTRACT_VERSION = "1.0.0" as const;

export type PipelineStage = "ingest" | "transform" | "generate" | "publish";
export type PipelineJobStatus = "pending" | "running" | "succeeded" | "failed";

export interface AssetReference {
  assetId: string;
  uri: string;
  mimeType?: string;
  checksum?: string;
}

export interface PipelineTraceContext {
  traceId: string;
  correlationId: string;
  causationId?: string;
}

export interface AssetPipelineJob<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  workflowId: string;
  runId: string;
  stage: PipelineStage;
  status: PipelineJobStatus;
  contractVersion: typeof ASSET_PIPELINE_CONTRACT_VERSION;
  createdAt: string;
  payload: TPayload;
  trace: PipelineTraceContext;
}

export interface AssetLineageEvent {
  assetId: string;
  stage: PipelineStage;
  parents: AssetReference[];
  produced: AssetReference;
  performedBy: string;
  recordedAt: string;
  metadata?: Record<string, unknown>;
}

export interface AssetPipelineAdapter {
  readonly stage: PipelineStage;
  execute(job: AssetPipelineJob): Promise<PipelineExecutionResult>;
}

export interface PipelineExecutionResult {
  status: Extract<PipelineJobStatus, "succeeded" | "failed">;
  outputs: AssetReference[];
  lineage: AssetLineageEvent[];
  metrics?: Record<string, number>;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface PipelineRegistry {
  register(adapter: AssetPipelineAdapter): void;
  get(stage: PipelineStage): AssetPipelineAdapter;
  list(): PipelineStage[];
}

export class InMemoryPipelineRegistry implements PipelineRegistry {
  readonly #adapters = new Map<PipelineStage, AssetPipelineAdapter>();

  register(adapter: AssetPipelineAdapter): void {
    if (this.#adapters.has(adapter.stage)) {
      throw new Error(`Pipeline adapter already registered for stage: ${adapter.stage}`);
    }

    this.#adapters.set(adapter.stage, adapter);
  }

  get(stage: PipelineStage): AssetPipelineAdapter {
    const adapter = this.#adapters.get(stage);

    if (!adapter) {
      throw new Error(`No pipeline adapter registered for stage: ${stage}`);
    }

    return adapter;
  }

  list(): PipelineStage[] {
    return Array.from(this.#adapters.keys());
  }
}

export function createPipelineJob<TPayload extends Record<string, unknown>>(
  job: Omit<AssetPipelineJob<TPayload>, "contractVersion" | "createdAt" | "status"> &
    Partial<Pick<AssetPipelineJob<TPayload>, "createdAt" | "status">>,
): AssetPipelineJob<TPayload> {
  return {
    contractVersion: ASSET_PIPELINE_CONTRACT_VERSION,
    createdAt: job.createdAt ?? new Date().toISOString(),
    status: job.status ?? "pending",
    ...job,
  };
}

export function createLineageEvent(input: {
  assetId: string;
  stage: PipelineStage;
  parents: AssetReference[];
  produced: AssetReference;
  performedBy: string;
  metadata?: Record<string, unknown>;
  recordedAt?: string;
}): AssetLineageEvent {
  return {
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    ...input,
  };
}

export const DEFAULT_PIPELINE_STAGES: PipelineStage[] = ["ingest", "transform", "generate", "publish"];
