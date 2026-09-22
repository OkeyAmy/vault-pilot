import { resolvedBaseUrl } from "./serv-client.js";

export interface CatalogueModel {
  id: string;
  name: string;
  contextLength: number | null;
  promptPriceUsdPerMillion: number | null;
  completionPriceUsdPerMillion: number | null;
  supportsTools: boolean;
  free: boolean;
}

interface UpstreamModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { at: number; models: CatalogueModel[] } | null = null;

function perMillion(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const perToken = Number(raw);
  return Number.isFinite(perToken) ? perToken * 1_000_000 : null;
}

/**
 * Models the configured endpoint will actually serve, so an operator can pick
 * tournament arms from what exists rather than guessing identifiers.
 *
 * Only tool-capable models are returned: the decision contract is delivered
 * through a forced `submit_decision` tool call, so a model without tool
 * support cannot take part regardless of how capable it otherwise is.
 */
export async function fetchModelCatalogue(): Promise<CatalogueModel[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models;

  const apiKey = process.env.SERV_API_KEY;
  const response = await fetch(`${resolvedBaseUrl()}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Model catalogue request failed: ${response.status}`);
  }

  const payload = (await response.json()) as { data?: UpstreamModel[] };
  const models: CatalogueModel[] = (payload.data ?? [])
    .map((m) => {
      const prompt = perMillion(m.pricing?.prompt);
      const completion = perMillion(m.pricing?.completion);
      return {
        id: m.id,
        name: m.name ?? m.id,
        contextLength: m.context_length ?? null,
        promptPriceUsdPerMillion: prompt,
        completionPriceUsdPerMillion: completion,
        supportsTools: (m.supported_parameters ?? []).includes("tools"),
        free: prompt === 0 && completion === 0,
      };
    })
    .filter((m) => m.supportsTools)
    .sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id));

  cache = { at: Date.now(), models };
  return models;
}
