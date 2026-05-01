import { describe, expect, it } from "vitest";
import {
  DOGPILE_SPAN_NAMES,
  type DogpileSpan,
  type DogpileSpanOptions,
  type DogpileTracer
} from "./tracing.js";

describe("DOGPILE_SPAN_NAMES", () => {
  it("exposes the four locked span names verbatim", () => {
    expect(DOGPILE_SPAN_NAMES.RUN).toBe("dogpile.run");
    expect(DOGPILE_SPAN_NAMES.SUB_RUN).toBe("dogpile.sub-run");
    expect(DOGPILE_SPAN_NAMES.AGENT_TURN).toBe("dogpile.agent-turn");
    expect(DOGPILE_SPAN_NAMES.MODEL_CALL).toBe("dogpile.model-call");
  });

  it("contains exactly four unique values", () => {
    const values = Object.values(DOGPILE_SPAN_NAMES);
    expect(values).toHaveLength(4);
    expect(new Set(values).size).toBe(4);
  });
});

describe("DogpileSpan / DogpileTracer structural types", () => {
  it("a minimal stub satisfies DogpileSpan (compile-time)", () => {
    const span: DogpileSpan = {
      end(): void {},
      setAttribute(_key: string, _value: string | number | boolean): void {},
      setStatus(_code: "ok" | "error", _message?: string): void {}
    };
    span.setAttribute("k", "v");
    span.setAttribute("k", 1);
    span.setAttribute("k", true);
    span.setStatus("ok");
    span.setStatus("error", "boom");
    span.end();
    expect(typeof span.end).toBe("function");
  });

  it("a minimal stub satisfies DogpileTracer with full DogpileSpanOptions", () => {
    const baseSpan: DogpileSpan = {
      end(): void {},
      setAttribute(_k, _v): void {},
      setStatus(_c, _m?): void {}
    };
    const tracer: DogpileTracer = {
      startSpan(_name: string, _options?: DogpileSpanOptions): DogpileSpan {
        return baseSpan;
      }
    };
    const opts: DogpileSpanOptions = {
      parent: baseSpan,
      attributes: { a: "x", b: 1, c: true }
    };
    const span = tracer.startSpan("dogpile.run", opts);
    expect(typeof span.end).toBe("function");
  });
});
