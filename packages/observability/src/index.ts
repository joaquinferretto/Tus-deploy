import { SpanStatusCode, context, trace, type Attributes, type Span, type Tracer } from "@opentelemetry/api";

export const TELEMETRY_CHANNEL = "golden.telemetry.v1" as const;

export type TelemetryLevel = "debug" | "info" | "warn" | "error";

export interface TelemetryEvent {
  name: string;
  level: TelemetryLevel;
  timestamp: string;
  correlationId?: string;
  attributes?: Record<string, unknown>;
}

export interface Logger {
  emit(event: TelemetryEvent): void;
}

export interface RuntimeTelemetry {
  tracer: Tracer;
  logger: Logger;
}

export interface TelemetryEnvelope {
  channel: typeof TELEMETRY_CHANNEL;
  event: TelemetryEvent;
}

export class ConsoleJsonLogger implements Logger {
  emit(event: TelemetryEvent): void {
    const line = JSON.stringify({ channel: TELEMETRY_CHANNEL, ...event });

    switch (event.level) {
      case "error":
        console.error(line);
        break;
      case "warn":
        console.warn(line);
        break;
      default:
        console.log(line);
        break;
    }
  }
}

export function createRuntimeTelemetry(serviceName: string, logger: Logger = new ConsoleJsonLogger()): RuntimeTelemetry {
  return {
    tracer: trace.getTracer(serviceName),
    logger,
  };
}

export async function withSpan<T>(
  telemetry: RuntimeTelemetry,
  name: string,
  attributes: Attributes,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  const span = telemetry.tracer.startSpan(name, { attributes });

  return await context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await run(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      telemetry.logger.emit({
        name,
        level: "error",
        timestamp: new Date().toISOString(),
        attributes: { ...attributes, message },
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function logEvent(
  telemetry: RuntimeTelemetry,
  name: string,
  level: TelemetryLevel,
  attributes: Record<string, unknown> = {},
): void {
  const span = trace.getSpan(context.active());
  const correlationId = span?.spanContext().traceId;

  telemetry.logger.emit({
    name,
    level,
    timestamp: new Date().toISOString(),
    correlationId,
    attributes,
  });
}

export function toTelemetryEnvelope(event: TelemetryEvent): TelemetryEnvelope {
  return {
    channel: TELEMETRY_CHANNEL,
    event,
  };
}
