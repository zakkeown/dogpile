import type { JsonValue, StreamEvent, StreamEventSubscriber } from "../types.js";

/**
 * Severity levels recognized by `consoleLogger` and used as the floor when
 * deciding which events surface through `loggerFromEvents`.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Minimal structured-logging seam that callers can implement against pino,
 * winston, console, or anything else. Logger calls must be synchronous,
 * non-throwing, and have no return value — Dogpile catches throws and routes
 * them to the same logger's `error` channel rather than failing the run.
 */
export interface Logger {
  debug(message: string, fields?: Readonly<Record<string, JsonValue>>): void;
  info(message: string, fields?: Readonly<Record<string, JsonValue>>): void;
  warn(message: string, fields?: Readonly<Record<string, JsonValue>>): void;
  error(message: string, fields?: Readonly<Record<string, JsonValue>>): void;
}

/** Logger that drops every call. The default when no logger is supplied. */
export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

/**
 * Build a console-backed logger respecting a minimum level.
 *
 * The output format is JSON-on-one-line so it can be piped straight into log
 * collectors. Use `loggerFromEvents` to bridge it to a Dogpile stream handle.
 */
export function consoleLogger(options: { readonly level?: LogLevel } = {}): Logger {
  const minLevel = options.level ?? "info";
  const allowed = (level: LogLevel): boolean => LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
  const emit = (level: LogLevel, message: string, fields?: Readonly<Record<string, JsonValue>>): void => {
    if (!allowed(level)) return;
    const payload: Record<string, unknown> = { level, message };
    if (fields !== undefined) payload.fields = fields;
    const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    sink(JSON.stringify(payload));
  };
  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields)
  };
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

/**
 * Options for `loggerFromEvents`.
 */
export interface LoggerFromEventsOptions {
  /**
   * Restrict logging to the listed event types. By default every
   * lifecycle event is forwarded.
   */
  readonly include?: ReadonlyArray<StreamEvent["type"]>;
  /**
   * Override the level chosen for a given event type. Useful for elevating
   * tool-result errors to `warn` or downgrading `model-output-chunk` to
   * `debug`.
   */
  readonly levelFor?: (event: StreamEvent) => LogLevel | undefined;
}

/**
 * Bridge a `Logger` to a Dogpile stream handle by returning a
 * `StreamEventSubscriber`. Pass it to `handle.subscribe(...)`.
 *
 * Logger throws are caught and routed to `logger.error` so a misbehaving
 * logger can never crash an in-flight run.
 *
 * @example
 * ```ts
 * const handle = Dogpile.stream({ intent, model });
 * handle.subscribe(loggerFromEvents(consoleLogger({ level: "info" })));
 * const result = await handle.result;
 * ```
 */
export function loggerFromEvents(
  logger: Logger,
  options: LoggerFromEventsOptions = {}
): StreamEventSubscriber {
  const includeSet = options.include ? new Set(options.include) : undefined;
  return (event: StreamEvent): void => {
    const eventType = event.type;
    if (includeSet && !includeSet.has(eventType)) {
      return;
    }
    const level = options.levelFor?.(event) ?? defaultLevel(event);
    const message = describeEvent(event);
    const fields = summarizeEvent(event);
    try {
      logger[level](message, fields);
    } catch (cause) {
      try {
        logger.error("dogpile logger threw while handling event", {
          eventType,
          error: cause instanceof Error ? cause.message : String(cause)
        });
      } catch {
        // Swallow — a logger that throws from error() cannot be helped.
      }
    }
  };
}

function defaultLevel(event: StreamEvent): LogLevel {
  switch (event.type) {
    case "model-output-chunk":
      return "debug";
    case "budget-stop":
      return "warn";
    case "error":
      return "error";
    case "tool-result": {
      const result = (event as { readonly result?: { readonly type?: string } }).result;
      return result?.type === "error" ? "warn" : "info";
    }
    default:
      return "info";
  }
}

function describeEvent(event: StreamEvent): string {
  return `dogpile:${event.type}`;
}

function summarizeEvent(event: StreamEvent): Readonly<Record<string, JsonValue>> {
  const fields: Record<string, JsonValue> = { eventType: event.type };
  const at = (event as { readonly at?: unknown }).at;
  if (typeof at === "string") fields.at = at;
  const runId = (event as { readonly runId?: unknown }).runId;
  if (typeof runId === "string") fields.runId = runId;
  const agentId = (event as { readonly agentId?: unknown }).agentId;
  if (typeof agentId === "string") fields.agentId = agentId;
  const role = (event as { readonly role?: unknown }).role;
  if (typeof role === "string") fields.role = role;
  return fields;
}
