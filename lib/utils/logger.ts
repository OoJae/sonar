import { Langfuse } from "langfuse";
import { env } from "./env";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

function emit(level: LogLevel, event: string, fields: LogFields = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const serialized = JSON.stringify(line);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

// Lazy-initialised Langfuse client. Built only when both keys are set; if
// either is missing the cycle tracer becomes a no-op and the rest of the
// agent runs untouched. The keys live in .env.local (Wave 2 B5).
let lf: Langfuse | null = null;
function getLangfuse(): Langfuse | null {
  if (lf) return lf;
  const e = env();
  if (!e.LANGFUSE_PUBLIC_KEY || !e.LANGFUSE_SECRET_KEY) return null;
  lf = new Langfuse({
    publicKey: e.LANGFUSE_PUBLIC_KEY,
    secretKey: e.LANGFUSE_SECRET_KEY,
    baseUrl: e.LANGFUSE_BASE_URL,
  });
  return lf;
}

// Wave 2 Langfuse cycle tracer. Returns a small handle the runner uses to
// attach output and flush, or null when Langfuse is not configured. The
// runner persists the returned trace id into agent_runs.trace_id so /log
// can link out.
export type CycleTrace = {
  id: string;
  update(fields: { output?: unknown; metadata?: Record<string, unknown> }): void;
  flush(): Promise<void>;
};

export function startCycleTrace(opts: {
  runId: string;
  input: Record<string, unknown>;
  model: string;
}): CycleTrace | null {
  const client = getLangfuse();
  if (!client) return null;
  const trace = client.trace({
    id: opts.runId,
    name: "sonar-cycle",
    input: opts.input,
    metadata: { model: opts.model },
  });
  return {
    id: trace.id,
    update(fields) {
      trace.update(fields);
    },
    async flush() {
      await client.flushAsync();
    },
  };
}

// Build a public URL to a trace for the /log Trace column. Cloud trace URLs
// follow the project-keyed path; the public key is enough to identify the
// project on the cloud instance. Self-hosted setups may need a different
// base URL but the same path shape.
export function traceUrl(traceId: string): string | null {
  const e = env();
  if (!e.LANGFUSE_PUBLIC_KEY) return null;
  return `${e.LANGFUSE_BASE_URL.replace(/\/$/, "")}/trace/${traceId}`;
}

export const logger = {
  debug(event: string, fields: LogFields = {}) {
    emit("debug", event, fields);
  },
  info(event: string, fields: LogFields = {}) {
    emit("info", event, fields);
  },
  warn(event: string, fields: LogFields = {}) {
    emit("warn", event, fields);
  },
  error(event: string, fields: LogFields = {}) {
    emit("error", event, fields);
  },
  async trace(event: string, fields: LogFields = {}) {
    emit("info", event, fields);
    // Per-event Langfuse logging is replaced by the cycle-level startCycleTrace
    // pattern in Wave 2. Keep this method for backwards-compat callers.
  },
};
