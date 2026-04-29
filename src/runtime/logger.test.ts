import { describe, expect, it, vi } from "vitest";
import {
  consoleLogger,
  loggerFromEvents,
  noopLogger,
  type Logger,
  type LogLevel
} from "./logger.js";
import type { StreamEvent } from "../types.js";

function captureLogger(): { logger: Logger; calls: Array<{ level: LogLevel; message: string; fields?: unknown }> } {
  const calls: Array<{ level: LogLevel; message: string; fields?: unknown }> = [];
  const make = (level: LogLevel) =>
    (message: string, fields?: unknown): void => {
      calls.push({ level, message, fields });
    };
  return {
    logger: {
      debug: make("debug"),
      info: make("info"),
      warn: make("warn"),
      error: make("error")
    },
    calls
  };
}

describe("noopLogger", () => {
  it("ignores every call without throwing", () => {
    expect(() => noopLogger.info("nothing")).not.toThrow();
    expect(() => noopLogger.error("still nothing", { k: "v" })).not.toThrow();
  });
});

describe("consoleLogger", () => {
  it("respects the minimum level", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const logger = consoleLogger({ level: "warn" });
      logger.debug("dropped");
      logger.info("dropped");
      logger.warn("kept");
      logger.error("kept");
      expect(log).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledOnce();
      expect(err).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      err.mockRestore();
    }
  });

  it("emits one-line JSON with level/message/fields", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      consoleLogger({ level: "debug" }).info("hello", { runId: "r1" });
      expect(log).toHaveBeenCalledOnce();
      const payload = JSON.parse(log.mock.calls[0]?.[0] as string);
      expect(payload).toEqual({ level: "info", message: "hello", fields: { runId: "r1" } });
    } finally {
      log.mockRestore();
    }
  });
});

describe("loggerFromEvents", () => {
  it("routes a model-output-chunk event at debug level", () => {
    const { logger, calls } = captureLogger();
    const subscriber = loggerFromEvents(logger);
    subscriber({
      type: "model-output-chunk",
      at: "2026-04-29T00:00:00.000Z",
      runId: "run-1",
      agentId: "agent-1",
      role: "planner",
      providerCallId: "p1",
      chunk: { delta: "ab" }
    } as unknown as StreamEvent);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.level).toBe("debug");
    expect(calls[0]?.message).toBe("dogpile:model-output-chunk");
    expect(calls[0]?.fields).toMatchObject({
      eventType: "model-output-chunk",
      runId: "run-1",
      agentId: "agent-1",
      role: "planner"
    });
  });

  it("routes budget-stop at warn and error events at error", () => {
    const { logger, calls } = captureLogger();
    const subscriber = loggerFromEvents(logger);
    subscriber({ type: "budget-stop", at: "2026-04-29T00:00:00.000Z" } as unknown as StreamEvent);
    subscriber({ type: "error", at: "2026-04-29T00:00:00.000Z" } as unknown as StreamEvent);
    expect(calls.map((c) => c.level)).toEqual(["warn", "error"]);
  });

  it("filters by include set", () => {
    const { logger, calls } = captureLogger();
    const subscriber = loggerFromEvents(logger, { include: ["error"] });
    subscriber({ type: "model-output-chunk", at: "x" } as unknown as StreamEvent);
    subscriber({ type: "error", at: "x" } as unknown as StreamEvent);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.level).toBe("error");
  });

  it("respects levelFor override", () => {
    const { logger, calls } = captureLogger();
    const subscriber = loggerFromEvents(logger, {
      levelFor: (event) => (event.type === "agent-turn" ? "warn" : undefined)
    });
    subscriber({ type: "agent-turn", at: "x" } as unknown as StreamEvent);
    expect(calls[0]?.level).toBe("warn");
  });

  it("catches throwing logger and routes via error channel", () => {
    const errors: Array<{ message: string; fields?: unknown }> = [];
    const logger: Logger = {
      debug() { throw new Error("boom"); },
      info() { throw new Error("boom"); },
      warn() { throw new Error("boom"); },
      error(message, fields) { errors.push({ message, fields }); }
    };
    const subscriber = loggerFromEvents(logger);
    expect(() =>
      subscriber({ type: "model-request", at: "x" } as unknown as StreamEvent)
    ).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("dogpile logger threw while handling event");
  });

  it("does not crash when error() itself throws", () => {
    const logger: Logger = {
      debug() { throw new Error("a"); },
      info() { throw new Error("b"); },
      warn() { throw new Error("c"); },
      error() { throw new Error("d"); }
    };
    const subscriber = loggerFromEvents(logger);
    expect(() =>
      subscriber({ type: "model-request", at: "x" } as unknown as StreamEvent)
    ).not.toThrow();
  });

  it("tool-result with error type routes at warn", () => {
    const { logger, calls } = captureLogger();
    const subscriber = loggerFromEvents(logger);
    subscriber({
      type: "tool-result",
      at: "x",
      result: { type: "error" }
    } as unknown as StreamEvent);
    expect(calls[0]?.level).toBe("warn");
  });
});
