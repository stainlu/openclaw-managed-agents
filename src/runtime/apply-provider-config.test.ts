import { describe, expect, it } from "vitest";

import { applyPriceOverrides } from "../../docker/apply-provider-config.mjs";

describe("apply-provider-config", () => {
  it("patches known models and injects missing models with full metadata", () => {
    const providerConfig = {
      api: "openai-completions",
      baseUrl: "https://api.moonshot.ai/v1",
      models: [
        {
          id: "kimi-k2.5",
          name: "Kimi K2.5",
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 262144,
          maxTokens: 262144,
        },
      ],
    };
    const overrides = {
      moonshot: {
        "kimi-k2.5": {
          input: 0.6,
          output: 3,
          cacheRead: 0.1,
          cacheWrite: 0,
        },
        "kimi-k2.6": {
          name: "Kimi K2.6",
          reasoning: false,
          modalities: ["text", "image"],
          contextWindow: 262144,
          maxTokens: 262144,
          input: 0.6,
          output: 3,
          cacheRead: 0.1,
          cacheWrite: 0,
        },
        "kimi-future-price-only": {
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
        },
      },
    };

    const lines: string[] = [];
    applyPriceOverrides("moonshot", providerConfig, overrides, (line) => {
      lines.push(line);
    });

    expect(providerConfig.models[0].cost).toEqual({
      input: 0.6,
      output: 3,
      cacheRead: 0.1,
      cacheWrite: 0,
    });
    expect(providerConfig.models.map((m) => m.id)).toEqual([
      "kimi-k2.5",
      "kimi-k2.6",
    ]);
    expect(providerConfig.models[1]).toMatchObject({
      id: "kimi-k2.6",
      name: "Kimi K2.6",
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 262144,
      maxTokens: 262144,
      cost: {
        input: 0.6,
        output: 3,
        cacheRead: 0.1,
        cacheWrite: 0,
      },
    });
    expect(lines.join("")).toContain("applied price overrides to 1 moonshot model(s)");
    expect(lines.join("")).toContain("injected 1 missing moonshot model(s)");
    expect(lines.join("")).toContain("skipped 1 missing moonshot model(s)");
  });
});
