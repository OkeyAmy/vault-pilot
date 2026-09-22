import { DecisionSchema, DECISION_TOOL_JSON_SCHEMA, type Decision } from "./policy-graph.js";
import type { ModelConfig } from "./model-configs.js";

export interface ReasoningCallResult {
  decision: Decision;
  promptTokens: number;
  completionTokens: number;
  responseId: string;
}

export class ReasoningError extends Error {}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatCompletionResponse {
  id: string;
  choices: {
    finish_reason: string;
    message: { role: string; content: string | null; tool_calls?: ToolCall[] };
  }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const SUBMIT_DECISION_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_decision",
    description: "Submit the structured rebalance decision for this epoch.",
    parameters: DECISION_TOOL_JSON_SCHEMA,
  },
};

const DEFAULT_BASE_URL = "https://inference-api.openserv.ai/v1";

/**
 * Calls the OpenAI-compatible chat completions endpoint, forcing a
 * `submit_decision` tool call so every model returns the same structured
 * shape. Tools whose name begins with `serv_` are interpreted by SERV and
 * stripped before the request reaches the model; `serv_shadow_agent` runs a
 * validation loop over the model's own output.
 */
export async function requestDecision(params: {
  model: ModelConfig;
  systemPrompt: string;
  userPrompt: string;
}): Promise<ReasoningCallResult> {
  const apiKey = process.env.SERV_API_KEY;
  if (!apiKey) {
    throw new ReasoningError("SERV_API_KEY is not set.");
  }
  const baseUrl = process.env.SERV_BASE_URL ?? DEFAULT_BASE_URL;

  const tools: unknown[] = [SUBMIT_DECISION_TOOL];
  // Vault labels and pool metadata come from a third-party feed and are
  // interpolated into the prompt, so the system prompt is hardened against
  // injection on every call.
  if (process.env.DISABLE_PROMPT_GUARD !== "true") {
    tools.push({ type: "function", function: { name: "serv_prompt_guard", parameters: {} } });
  }
  if (params.model.useShadowAgent) {
    tools.push({ type: "function", function: { name: "serv_shadow_agent", parameters: {} } });
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model.model,
      messages: [
        { role: "system", content: params.systemPrompt },
        { role: "user", content: params.userPrompt },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "submit_decision" } },
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ReasoningError(
      `Decision call failed for model ${params.model.model}: ${response.status} ${body}`,
    );
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const message = payload.choices[0]?.message;
  const toolCall = message?.tool_calls?.find((tc) => tc.function.name === "submit_decision");
  if (!toolCall) {
    throw new ReasoningError(
      `Model ${params.model.model} did not call submit_decision ` +
        `(finish_reason=${payload.choices[0]?.finish_reason}).`,
    );
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(toolCall.function.arguments);
  } catch (err) {
    throw new ReasoningError(
      `submit_decision arguments were not valid JSON: ${(err as Error).message}`,
    );
  }

  const parsed = DecisionSchema.safeParse(parsedArgs);
  if (!parsed.success) {
    throw new ReasoningError(
      `submit_decision arguments failed schema validation: ${parsed.error.message}`,
    );
  }

  return {
    decision: parsed.data,
    promptTokens: payload.usage?.prompt_tokens ?? 0,
    completionTokens: payload.usage?.completion_tokens ?? 0,
    responseId: payload.id,
  };
}
