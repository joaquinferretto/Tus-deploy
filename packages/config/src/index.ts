export const CONFIG_CONTRACT_VERSION = "1.0.0" as const;

export type RuntimeRole = "api-edge" | "workflow-runtime" | "worker";
export type Environment = "development" | "test" | "staging" | "production";
export type RuntimeProfile = "local" | "render" | "aws";

export interface RuntimeConfig {
  role: RuntimeRole;
  environment: Environment;
  profile: RuntimeProfile;
  contractVersion: typeof CONFIG_CONTRACT_VERSION;
  serviceName: string;
  serviceVersion: string;
  telemetry: {
    otlpEndpoint?: string;
    logLevel: "debug" | "info" | "warn" | "error";
    sampleRatio: number;
  };
  storage: {
    assetBucket?: string;
    publicBaseUrl?: string;
  };
  runtime: {
    shutdownTimeoutMs: number;
    maxConcurrency: number;
  };
  providers: {
    llm: string;
    objectStorage: string;
    queue: string;
  };
  databases: {
    postgres: string;
    mongo: string;
    redis: string;
  };
  security: {
    secretStoreRef?: string;
  };
}

export interface RuntimePorts {
  http?: number;
  metrics?: number;
}

export interface EnvReader {
  get(name: string): string | undefined;
}

export class ProcessEnvReader implements EnvReader {
  get(name: string): string | undefined {
    return process.env[name];
  }
}

export function loadRuntimeConfig(reader: EnvReader = new ProcessEnvReader()): RuntimeConfig {
  const environment = readEnum(reader, "NODE_ENV", ["development", "test", "staging", "production"], "development");
  const profile = readEnum(reader, "FACTORY_PROFILE", ["local", "render", "aws"], "local");
  const secretStoreRef = reader.get("SECRET_STORE_REF");

  if (environment === "production" && !secretStoreRef) {
    throw new Error("Missing required secret-store reference: SECRET_STORE_REF");
  }

  return {
    contractVersion: CONFIG_CONTRACT_VERSION,
    role: readEnum(reader, "RUNTIME_ROLE", ["api-edge", "workflow-runtime", "worker"], "api-edge"),
    environment,
    profile,
    serviceName: readRequired(reader, "SERVICE_NAME", "golden-runtime"),
    serviceVersion: readRequired(reader, "SERVICE_VERSION", "0.1.0"),
    telemetry: {
      otlpEndpoint: reader.get("OTEL_EXPORTER_OTLP_ENDPOINT"),
      logLevel: readEnum(reader, "LOG_LEVEL", ["debug", "info", "warn", "error"], environment === "production" ? "info" : "debug"),
      sampleRatio: readNumber(reader, "OTEL_SAMPLE_RATIO", 1, { min: 0, max: 1 }),
    },
    storage: {
      assetBucket: reader.get("ASSET_BUCKET"),
      publicBaseUrl: reader.get("PUBLIC_BASE_URL"),
    },
    runtime: {
      shutdownTimeoutMs: readNumber(reader, "SHUTDOWN_TIMEOUT_MS", 10_000, { min: 1 }),
      maxConcurrency: readNumber(reader, "MAX_CONCURRENCY", 8, { min: 1 }),
    },
    providers: {
      llm: readRequired(reader, "LLM_PROVIDER", "fake"),
      objectStorage: readRequired(reader, "OBJECT_STORAGE_PROVIDER", "fake"),
      queue: readRequired(reader, "QUEUE_PROVIDER", "local"),
    },
    databases: {
      postgres: readRequired(reader, "POSTGRES_PROVIDER", "local"),
      mongo: readRequired(reader, "MONGO_PROVIDER", "local"),
      redis: readRequired(reader, "REDIS_PROVIDER", "local"),
    },
    security: { secretStoreRef },
  };
}

export function loadRuntimePorts(reader: EnvReader = new ProcessEnvReader()): RuntimePorts {
  return {
    http: optionalNumber(reader.get("PORT")),
    metrics: optionalNumber(reader.get("METRICS_PORT")),
  };
}

function readRequired(reader: EnvReader, name: string, fallback?: string): string {
  const value = reader.get(name) ?? fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readEnum<const T extends readonly string[]>(
  reader: EnvReader,
  name: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const value = reader.get(name) ?? fallback;

  if (!allowed.includes(value)) {
    throw new Error(`Invalid value for ${name}. Expected one of: ${allowed.join(", ")}. Received: ${value}`);
  }

  return value;
}

function readNumber(
  reader: EnvReader,
  name: string,
  fallback: number,
  range: { min?: number; max?: number } = {},
): number {
  const raw = reader.get(name);
  const value = raw ? Number(raw) : fallback;

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${name}: ${raw}`);
  }

  if (range.min !== undefined && value < range.min) {
    throw new Error(`${name} must be >= ${range.min}`);
  }

  if (range.max !== undefined && value > range.max) {
    throw new Error(`${name} must be <= ${range.max}`);
  }

  return value;
}

function optionalNumber(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value: ${raw}`);
  }

  return value;
}
