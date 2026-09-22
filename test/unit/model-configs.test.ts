import { afterEach, describe, expect, it } from "vitest";
import {
  loadModelConfigs,
  estimateReasoningCostUsd,
  type ModelConfig,
} from "../../src/reasoning/model-configs.js";

afterEach(() => {
  delete process.env.TOURNAMENT_MODELS;
});

describe("loadModelConfigs", () => {
  it("parses a single arm into its fields", () => {
    process.env.TOURNAMENT_MODELS = "a:gpt-5.4-mini:0:1.00:6.00";
    // blindfold: contract — the documented format is
    // id:model:shadow:inPrice:outPrice.
    expect(loadModelConfigs()).toEqual([
      {
        id: "a",
        name: "gpt-5.4-mini",
        model: "gpt-5.4-mini",
        useShadowAgent: false,
        pricePerMillionInputUsd: 1.0,
        pricePerMillionOutputUsd: 6.0,
      },
    ]);
  });

  it("sets the shadow flag and labels the arm accordingly", () => {
    process.env.TOURNAMENT_MODELS = "a:gpt-5.4-mini:1:1.00:6.00";
    const [arm] = loadModelConfigs();
    expect(arm!.useShadowAgent).toBe(true);
    // blindfold: contract — shadow arms are labelled "<model> + shadow agent".
    expect(arm!.name).toBe("gpt-5.4-mini + shadow agent");
  });

  it("parses several comma-separated arms", () => {
    process.env.TOURNAMENT_MODELS = "a:m1:0:1:6,b:m2:1:2:7";
    // blindfold: contract — arms are comma-separated.
    expect(loadModelConfigs().map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("trims whitespace around entries rather than folding it into ids", () => {
    process.env.TOURNAMENT_MODELS = " a:m1:0:1:6 , b:m2:0:2:7 ";
    // blindfold: contract — ids become receipt directory names, so a stray
    // leading space would create a directory named " a" instead of "a".
    expect(loadModelConfigs().map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("falls back to the default roster when the variable is unset", () => {
    // blindfold: contract — the shipped default in model-configs.ts, so the
    // tournament runs out of the box with no configuration.
    expect(loadModelConfigs().map((c) => c.id)).toEqual([
      "base-a",
      "shadow-a",
      "base-b",
      "base-c",
    ]);
  });

  it("pairs exactly one shadow arm against the same model as base-a", () => {
    const configs = loadModelConfigs();
    const shadow = configs.filter((c) => c.useShadowAgent);
    // blindfold: invariant — the shadow arm only isolates SERV's validation
    // loop if it runs the identical model as its unshadowed counterpart.
    expect(shadow.map((c) => c.id)).toEqual(["shadow-a"]);
    expect(shadow[0]!.model).toBe(configs.find((c) => c.id === "base-a")!.model);
  });

  it("falls back to defaults when the variable is whitespace only", () => {
    process.env.TOURNAMENT_MODELS = "   ";
    // blindfold: contract — same default roster as the unset case.
    expect(loadModelConfigs().map((c) => c.id)).toEqual([
      "base-a",
      "shadow-a",
      "base-b",
      "base-c",
    ]);
  });

  it("rejects an entry with too few fields", () => {
    process.env.TOURNAMENT_MODELS = "a:gpt-5.4-mini:0";
    expect(() => loadModelConfigs()).toThrow(/5 colon-separated/);
  });

  it("rejects a non-binary shadow flag", () => {
    process.env.TOURNAMENT_MODELS = "a:gpt-5.4-mini:yes:1.00:6.00";
    expect(() => loadModelConfigs()).toThrow(/shadow flag must be 0 or 1/);
  });

  it("rejects non-numeric pricing", () => {
    process.env.TOURNAMENT_MODELS = "a:gpt-5.4-mini:0:cheap:6.00";
    expect(() => loadModelConfigs()).toThrow(/non-numeric pricing/);
  });

  it("rejects an empty model id", () => {
    process.env.TOURNAMENT_MODELS = "a::0:1:6";
    expect(() => loadModelConfigs()).toThrow(/empty id or model/);
  });

  it("rejects duplicate arm ids", () => {
    process.env.TOURNAMENT_MODELS = "a:m:0:1:6,a:n:0:1:6";
    // blindfold: invariant — arm ids are receipt directory names, so a
    // duplicate would make two arms overwrite each other's receipts.
    expect(() => loadModelConfigs()).toThrow(/duplicate ids/);
  });
});

describe("estimateReasoningCostUsd", () => {
  const config: ModelConfig = {
    id: "a",
    name: "a",
    model: "m",
    useShadowAgent: false,
    pricePerMillionInputUsd: 1,
    pricePerMillionOutputUsd: 6,
  };

  it("prices input and output separately", () => {
    // blindfold: math — 1M input at $1/M plus 1M output at $6/M = $7.
    expect(estimateReasoningCostUsd(config, 1_000_000, 1_000_000)).toBeCloseTo(7, 9);
  });

  it("scales linearly below a million tokens", () => {
    // blindfold: math — 1000/1e6 * $1 = $0.001; 500/1e6 * $6 = $0.003; total $0.004.
    expect(estimateReasoningCostUsd(config, 1000, 500)).toBeCloseTo(0.004, 12);
  });

  it("is zero when no tokens were used", () => {
    expect(estimateReasoningCostUsd(config, 0, 0)).toBe(0);
  });
});
