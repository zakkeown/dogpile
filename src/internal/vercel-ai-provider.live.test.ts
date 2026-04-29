import { createGateway, type GatewayModelId } from "ai";
import { describe, expect, it } from "vitest";
import type { JsonObject, ModelFinishReason } from "../index.js";
import { createVercelAIProvider } from "./vercel-ai.js";

const liveModelId = (process.env.DOGPILE_VERCEL_AI_LIVE_MODEL ?? "openai/gpt-4.1-mini") as GatewayModelId;
const hasLiveVercelAIAuth = Boolean(
  process.env.AI_GATEWAY_API_KEY || process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN
);
const liveIt = hasLiveVercelAIAuth ? it : it.skip;
const dogpileContractToken = "dogpile-live-vercel-ai-ok";
const validFinishReasons = new Set<ModelFinishReason>([
  "stop",
  "length",
  "content-filter",
  "tool-calls",
  "error",
  "other"
]);

describe("createVercelAIProvider live Vercel AI Gateway integration", () => {
  liveIt(
    "performs a real Vercel AI provider call and maps the Dogpile response contract",
    async () => {
      const gateway = createGateway(
        process.env.AI_GATEWAY_API_KEY ? { apiKey: process.env.AI_GATEWAY_API_KEY } : undefined
      );
      const provider = createVercelAIProvider({
        model: gateway(liveModelId),
        maxRetries: 0,
        maxOutputTokens: 32,
        timeout: {
          totalMs: 45_000
        },
        costEstimator({ usage }) {
          return usage ? usage.totalTokens / 1_000_000 : undefined;
        }
      });

      const response = await provider.generate({
        messages: [
          {
            role: "system",
            content: `You are a release integration test. Reply with exactly: ${dogpileContractToken}`
          },
          {
            role: "user",
            content: `Return exactly ${dogpileContractToken}.`
          }
        ],
        temperature: 0,
        metadata: {
          test: "vercel-ai-live-provider",
          modelId: liveModelId
        }
      });

      expect(provider.id).toBe(`vercel-ai:gateway:${liveModelId}`);
      expect(response.text.trim().toLowerCase()).toContain(dogpileContractToken);
      expect(response.finishReason).toBeDefined();
      expect(validFinishReasons.has(response.finishReason as ModelFinishReason)).toBe(true);
      expect(response.toolRequests).toBeUndefined();

      expect(response.usage).toBeDefined();
      if (!response.usage) {
        throw new Error("expected live Vercel AI response to include token usage");
      }
      expect(response.usage.inputTokens).toBeGreaterThan(0);
      expect(response.usage.outputTokens).toBeGreaterThan(0);
      expect(response.usage.totalTokens).toBe(response.usage.inputTokens + response.usage.outputTokens);
      expect(response.costUsd).toBe(response.usage.totalTokens / 1_000_000);

      const vercelAiMetadata = expectJsonObject(response.metadata?.vercelAi, "metadata.vercelAi");
      const responseMetadata = expectJsonObject(vercelAiMetadata.response, "metadata.vercelAi.response");
      const requestMetadata = expectJsonObject(vercelAiMetadata.request, "metadata.vercelAi.request");
      const requestBody = expectJsonObject(requestMetadata.body, "metadata.vercelAi.request.body");
      const responseId = expectString(responseMetadata.id, "metadata.vercelAi.response.id");
      const responseModelId = expectString(responseMetadata.modelId, "metadata.vercelAi.response.modelId");
      const responseTimestamp = expectString(responseMetadata.timestamp, "metadata.vercelAi.response.timestamp");

      expect(responseId.length).toBeGreaterThan(0);
      expect(responseModelId.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(responseTimestamp))).toBe(false);
      expect(requestBody).toEqual(
        expect.objectContaining({
          prompt: expect.any(Array)
        })
      );
    },
    60_000
  );
});

function expectJsonObject(value: unknown, label: string): JsonObject {
  expect(typeof value, `${label} should be an object`).toBe("object");
  expect(value, `${label} should not be null`).not.toBeNull();
  expect(Array.isArray(value), `${label} should not be an array`).toBe(false);

  return value as JsonObject;
}

function expectString(value: unknown, label: string): string {
  expect(typeof value, `${label} should be a string`).toBe("string");

  return value as string;
}
