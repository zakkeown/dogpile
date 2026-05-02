import { context, SpanStatusCode, trace, type Span as OtelSpan } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { run } from "../runtime/engine.js";
import {
  DOGPILE_SPAN_NAMES,
  type DogpileSpan,
  type DogpileSpanOptions,
  type DogpileTracer
} from "../runtime/tracing.js";
import {
  createDelegatingDeterministicProvider,
  createDeterministicModelProvider
} from "../testing/deterministic-provider.js";
import type { ConfiguredModelProvider, ModelResponse } from "../types.js";

function makeTracerWithExporter(): {
  readonly tracer: DogpileTracer;
  readonly exporter: InMemorySpanExporter;
  readonly provider: BasicTracerProvider;
} {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)]
  });
  const otelTracer = provider.getTracer("dogpile-test");
  const otelSpanFor = new WeakMap<DogpileSpan, OtelSpan>();
  const tracer: DogpileTracer = {
    startSpan(name: string, options?: DogpileSpanOptions): DogpileSpan {
      const parentOtelSpan = options?.parent ? otelSpanFor.get(options.parent) : undefined;
      const parentContext = parentOtelSpan
        ? trace.setSpan(context.active(), parentOtelSpan)
        : context.active();
      const span = otelTracer.startSpan(
        name,
        options?.attributes ? { attributes: options.attributes } : {},
        parentContext
      );
      const wrapper: DogpileSpan = {
        end(): void {
          span.end();
        },
        setAttribute(key: string, value: string | number | boolean): void {
          span.setAttribute(key, value);
        },
        setStatus(code: "ok" | "error", message?: string): void {
          span.setStatus({
            code: code === "ok" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
            ...(message ? { message } : {})
          });
        }
      };
      otelSpanFor.set(wrapper, span);
      return wrapper;
    }
  };

  return { tracer, exporter, provider };
}

function parentSpanId(span: ReadableSpan): string | undefined {
  return span.parentSpanContext?.spanId;
}

describe("OTEL tracing bridge contract", () => {
  it("records dogpile.run, dogpile.agent-turn, and dogpile.model-call spans", async () => {
    const { tracer, exporter, provider } = makeTracerWithExporter();

    await run({
      intent: "trace test",
      model: createDeterministicModelProvider("trace-test-model"),
      protocol: { kind: "sequential", maxTurns: 1 },
      tracer
    });
    await provider.forceFlush();

    const names = exporter.getFinishedSpans().map((span) => span.name);
    expect(names).toContain(DOGPILE_SPAN_NAMES.RUN);
    expect(names).toContain(DOGPILE_SPAN_NAMES.AGENT_TURN);
    expect(names).toContain(DOGPILE_SPAN_NAMES.MODEL_CALL);
  });

  it("sets locked dogpile.run attributes", async () => {
    const { tracer, exporter, provider } = makeTracerWithExporter();

    await run({
      intent: "intent text for attribute check",
      model: createDeterministicModelProvider("attr-test"),
      protocol: { kind: "sequential", maxTurns: 1 },
      tracer
    });
    await provider.forceFlush();

    const runSpan = exporter.getFinishedSpans().find((span) => span.name === DOGPILE_SPAN_NAMES.RUN);
    expect(runSpan).toBeDefined();
    expect(runSpan?.attributes["dogpile.run.protocol"]).toBe("sequential");
    expect(runSpan?.attributes["dogpile.run.intent"]).toBe("intent text for attribute check");
    expect(runSpan?.attributes["dogpile.run.outcome"]).toBe("completed");
    expect(runSpan?.attributes["dogpile.run.turn_count"]).toBeTypeOf("number");
    expect(runSpan?.attributes["dogpile.run.cost_usd"]).toBeTypeOf("number");
  });

  it("records per-turn agent-turn cost instead of cumulative run cost", async () => {
    const { tracer, exporter, provider } = makeTracerWithExporter();

    await run({
      intent: "two turn accounting",
      model: createDeterministicModelProvider("per-turn-cost-test"),
      protocol: { kind: "sequential", maxTurns: 2 },
      tracer
    });
    await provider.forceFlush();

    const turnSpans = exporter
      .getFinishedSpans()
      .filter((span) => span.name === DOGPILE_SPAN_NAMES.AGENT_TURN)
      .sort(
        (left, right) =>
          Number(left.attributes["dogpile.turn.number"]) -
          Number(right.attributes["dogpile.turn.number"])
      );

    expect(turnSpans).toHaveLength(2);
    expect(turnSpans.map((span) => span.attributes["dogpile.turn.cost_usd"])).toEqual([
      0.0001,
      0.0001
    ]);
  });

  it("truncates long dogpile.run intent attributes", async () => {
    const { tracer, exporter, provider } = makeTracerWithExporter();

    await run({
      intent: "x".repeat(500),
      model: createDeterministicModelProvider("trunc-test"),
      protocol: { kind: "sequential", maxTurns: 1 },
      tracer
    });
    await provider.forceFlush();

    const runSpan = exporter.getFinishedSpans().find((span) => span.name === DOGPILE_SPAN_NAMES.RUN);
    expect(String(runSpan?.attributes["dogpile.run.intent"])).toHaveLength(200);
  });

  it("keeps best-effort run attributes on failed run spans", async () => {
    const { tracer, exporter, provider } = makeTracerWithExporter();
    const failingProvider: ConfiguredModelProvider = {
      id: "failing-trace-provider",
      async generate(): Promise<ModelResponse> {
        throw new Error("trace provider failure");
      }
    };

    await expect(
      run({
        intent: "failed trace attributes",
        model: failingProvider,
        protocol: { kind: "sequential", maxTurns: 1 },
        tracer
      })
    ).rejects.toThrow("trace provider failure");
    await provider.forceFlush();

    const runSpan = exporter.getFinishedSpans().find((span) => span.name === DOGPILE_SPAN_NAMES.RUN);
    expect(runSpan).toBeDefined();
    expect(runSpan?.attributes["dogpile.run.id"]).toBeTypeOf("string");
    expect(runSpan?.attributes["dogpile.run.outcome"]).toBe("aborted");
    expect(runSpan?.attributes["dogpile.run.turn_count"]).toBe(0);
    expect(runSpan?.attributes["dogpile.run.cost_usd"]).toBe(0);
    expect(runSpan?.attributes["dogpile.run.input_tokens"]).toBe(0);
    expect(runSpan?.attributes["dogpile.run.output_tokens"]).toBe(0);
    expect(runSpan?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("nests live coordinator sub-run and child run spans under the parent run", async () => {
    const { tracer, exporter, provider } = makeTracerWithExporter();

    await run({
      intent: "sub-run nesting test",
      model: createDelegatingDeterministicProvider({ id: "otel-02-parent" }),
      protocol: { kind: "coordinator", maxTurns: 2 },
      tracer
    });
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const runSpan = spans.find(
      (span) => span.name === DOGPILE_SPAN_NAMES.RUN && parentSpanId(span) === undefined
    );
    const subRunSpan = spans.find((span) => span.name === DOGPILE_SPAN_NAMES.SUB_RUN);
    const childRunSpan = spans.find(
      (span) => span.name === DOGPILE_SPAN_NAMES.RUN && parentSpanId(span) !== undefined
    );

    expect(runSpan, "top-level dogpile.run span must exist").toBeDefined();
    expect(subRunSpan, "dogpile.sub-run span must be emitted by live coordinator dispatch").toBeDefined();
    expect(childRunSpan, "child dogpile.run span must exist").toBeDefined();
    expect(parentSpanId(subRunSpan!)).toBe(runSpan!.spanContext().spanId);
    expect(parentSpanId(childRunSpan!)).toBe(subRunSpan!.spanContext().spanId);
  });

  it("emits no spans when tracer is absent", async () => {
    const { exporter, provider } = makeTracerWithExporter();

    const result = await run({
      intent: "no-tracer baseline",
      model: createDeterministicModelProvider("no-tracer"),
      protocol: { kind: "sequential", maxTurns: 1 }
    });
    await provider.forceFlush();

    expect(exporter.getFinishedSpans()).toHaveLength(0);
    expect(result.trace.runId).toBeTypeOf("string");
    expect(result.health).toBeDefined();
    expect(result.cost).toBeDefined();
  });

  it("keeps the RunResult shape unchanged when tracer is present", async () => {
    const { tracer } = makeTracerWithExporter();
    const withoutTracer = await run({
      intent: "shape",
      model: createDeterministicModelProvider("shape-without-tracer"),
      protocol: { kind: "sequential", maxTurns: 1 }
    });
    const withTracer = await run({
      intent: "shape",
      model: createDeterministicModelProvider("shape-with-tracer"),
      protocol: { kind: "sequential", maxTurns: 1 },
      tracer
    });

    expect(Object.keys(withTracer).sort()).toEqual(Object.keys(withoutTracer).sort());
  });
});
