import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from "@opentelemetry/sdk-trace-base";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

let provider: NodeTracerProvider | null = null;

function isOtelDisabled(): boolean {
  return (
    process.env.OTEL_SDK_DISABLED === "true" ||
    process.env.OTEL_TRACES_EXPORTER === "none" ||
    process.env.KRWN_OTEL_ENABLED === "0"
  );
}

function hasOtlpEndpointConfigured(): boolean {
  const traces = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return Boolean(traces || base);
}

function pickTraceExporter(): SpanExporter | null {
  if (hasOtlpEndpointConfigured()) {
    return new OTLPTraceExporter();
  }
  if (process.env.NODE_ENV === "development") {
    return new ConsoleSpanExporter();
  }
  return null;
}

/**
 * Starts Node tracing for the Next.js server process (see `src/instrumentation.ts`).
 * Dev: console spans unless an OTLP endpoint is set.
 * Prod: OTLP only when `OTEL_EXPORTER_OTLP_*` is configured (no hardcoded secrets).
 *
 * Uses `NodeTracerProvider` + HTTP trace exporter only (no `@opentelemetry/sdk-node`,
 * which pulls gRPC metrics/logs stacks that break Next.js webpack).
 */
export function startNodeOtel(): void {
  if (provider) {
    return;
  }
  if (isOtelDisabled()) {
    return;
  }

  const traceExporter = pickTraceExporter();
  if (!traceExporter) {
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "krwnos";

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": serviceName,
    }),
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
  });
  provider.register();

  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const u = req.url ?? "";
          return (
            u.startsWith("/_next/static") ||
            u.startsWith("/_next/webpack-hmr") ||
            u === "/api/health" ||
            u === "/api/ready"
          );
        },
      }),
    ],
  });

  const shutdown = () => {
    const current = provider;
    provider = null;
    void current?.shutdown().catch(() => undefined);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
