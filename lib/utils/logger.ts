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

async function langfuse(event: string, fields: LogFields) {
  const e = env();
  if (!e.LANGFUSE_PUBLIC_KEY || !e.LANGFUSE_SECRET_KEY) return;
  // Intentional no-op in Wave 1. The Langfuse client is added in a follow-up
  // commit once the agent runner is streaming real traces. Keeping the shape
  // here means callers do not need to change later.
  void event;
  void fields;
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
    await langfuse(event, fields);
  },
};
