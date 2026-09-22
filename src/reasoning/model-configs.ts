export interface ModelConfig {
  /** Stable id used in receipt paths and the leaderboard. */
  id: string;
  name: string;
  /** Value sent as the `model` field in the inference request. */
  model: string;
  /** Enables the serv_shadow_agent validation loop for this arm. */
  useShadowAgent: boolean;
  pricePerMillionInputUsd: number;
  pricePerMillionOutputUsd: number;
}

/**
 * Tournament arms are declared in TOURNAMENT_MODELS as a comma-separated list:
 *
 *   TOURNAMENT_MODELS="id:model:shadow:inPrice:outPrice, ..."
 *
 * `shadow` is 0 or 1; prices are USD per million tokens and are used only to
 * report cost-per-decision on the leaderboard.
 */
const DEFAULT_TOURNAMENT_MODELS = [
  "base-a:gpt-5.4-mini:0:1.00:6.00",
  "shadow-a:gpt-5.4-mini:1:1.00:6.00",
  "base-b:claude-haiku-4.5:0:1.25:6.50",
  "base-c:gemini-3.5-flash:0:1.95:12.00",
].join(",");

function parseArm(spec: string, index: number): ModelConfig {
  const parts = spec.trim().split(":");
  if (parts.length < 5) {
    throw new Error(
      `TOURNAMENT_MODELS entry #${index + 1} ("${spec.trim()}") must have 5 colon-separated ` +
        `fields: id:model:shadow:inPrice:outPrice`,
    );
  }
  // Model identifiers may themselves contain colons (a vendor suffix, a tag),
  // so the fixed fields are read from the ends and everything left over in the
  // middle is rejoined as the model id.
  const id = parts[0]!;
  const outPrice = parts[parts.length - 1]!;
  const inPrice = parts[parts.length - 2]!;
  const shadow = parts[parts.length - 3]!;
  const model = parts.slice(1, parts.length - 3).join(":");
  const inputPrice = Number(inPrice);
  const outputPrice = Number(outPrice);
  if (!id || !model) {
    throw new Error(`TOURNAMENT_MODELS entry #${index + 1} has an empty id or model.`);
  }
  if (shadow !== "0" && shadow !== "1") {
    throw new Error(
      `TOURNAMENT_MODELS entry #${index + 1} shadow flag must be 0 or 1, got "${shadow}".`,
    );
  }
  if (!Number.isFinite(inputPrice) || !Number.isFinite(outputPrice)) {
    throw new Error(`TOURNAMENT_MODELS entry #${index + 1} has non-numeric pricing.`);
  }
  return {
    id,
    name: shadow === "1" ? `${model} + shadow agent` : model,
    model,
    useShadowAgent: shadow === "1",
    pricePerMillionInputUsd: inputPrice,
    pricePerMillionOutputUsd: outputPrice,
  };
}

export function loadModelConfigs(): ModelConfig[] {
  const raw = process.env.TOURNAMENT_MODELS?.trim() || DEFAULT_TOURNAMENT_MODELS;
  const configs = raw.split(",").filter((s) => s.trim().length > 0).map(parseArm);
  if (configs.length === 0) {
    throw new Error("TOURNAMENT_MODELS resolved to zero models.");
  }
  const ids = configs.map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`TOURNAMENT_MODELS has duplicate ids: ${ids.join(", ")}`);
  }
  return configs;
}

export function estimateReasoningCostUsd(
  config: ModelConfig,
  promptTokens: number,
  completionTokens: number,
): number {
  return (
    (promptTokens / 1_000_000) * config.pricePerMillionInputUsd +
    (completionTokens / 1_000_000) * config.pricePerMillionOutputUsd
  );
}
