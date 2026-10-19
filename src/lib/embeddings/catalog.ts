/**
 * Embedding model allowlist (worlds-api#1, design D3/D4/D7).
 *
 * The Vectorize index width is immutable and fixed at 1536 dimensions, so only
 * models that can emit exactly 1536 are admissible, and the dimension
 * parameter is pinned in code, never customer-supplied. Provider endpoints are
 * code constants (no customer-supplied host: no SSRF surface, D10). A provider
 * is vetted by listing it in EMBEDDING_PROVIDERS and allowlisting its models.
 */

/** Width of the shared Vectorize index and the D1 vector column. */
export const EMBEDDING_DIMENSIONS = 1536;

export type EmbeddingProviderId = "openai" | "openrouter";

/**
 * Vetted providers. Both speak the OpenAI embeddings wire format
 * (`POST {model, input, encoding_format, dimensions}` returning `data[]`).
 */
export const EMBEDDING_PROVIDERS: Record<
  EmbeddingProviderId,
  { embeddingsUrl: string }
> = {
  openai: { embeddingsUrl: "https://api.openai.com/v1/embeddings" },
  openrouter: { embeddingsUrl: "https://openrouter.ai/api/v1/embeddings" },
};

export type EmbeddingModelSpec = {
  id: string;
  provider: EmbeddingProviderId;
  /** Provider-side model name sent on the wire. */
  providerModel: string;
  /** Whether to send `dimensions: 1536` (models with native width != 1536). */
  sendDimensions: boolean;
  /** Accepted but not advertised in docs/console. */
  legacy: boolean;
};

const MODELS: readonly EmbeddingModelSpec[] = [
  {
    id: "openai/text-embedding-3-small",
    provider: "openai",
    providerModel: "text-embedding-3-small",
    sendDimensions: true,
    legacy: false,
  },
  {
    id: "openai/text-embedding-3-large",
    provider: "openai",
    providerModel: "text-embedding-3-large",
    sendDimensions: true,
    legacy: false,
  },
  {
    id: "openai/text-embedding-ada-002",
    provider: "openai",
    providerModel: "text-embedding-ada-002",
    sendDimensions: false,
    legacy: true,
  },
  // OpenRouter routes to OpenAI's models and forwards `dimensions`; its ids
  // are `<vendor>/<model>`, so the allowlist id is `openrouter/<vendor>/<model>`.
  {
    id: "openrouter/openai/text-embedding-3-small",
    provider: "openrouter",
    providerModel: "openai/text-embedding-3-small",
    sendDimensions: true,
    legacy: false,
  },
  {
    id: "openrouter/openai/text-embedding-3-large",
    provider: "openrouter",
    providerModel: "openai/text-embedding-3-large",
    sendDimensions: true,
    legacy: false,
  },
];

/** Every accepted `provider/model` id, in a tuple usable by z.enum. */
export const EMBEDDING_MODEL_IDS = [
  "openai/text-embedding-3-small",
  "openai/text-embedding-3-large",
  "openai/text-embedding-ada-002",
  "openrouter/openai/text-embedding-3-small",
  "openrouter/openai/text-embedding-3-large",
] as const;

export const EMBEDDING_PROVIDER_IDS = ["openai", "openrouter"] as const;

/** Returns the allowlist entry for a model id, or undefined if not allowlisted. */
export function getEmbeddingModel(id: string): EmbeddingModelSpec | undefined {
  return MODELS.find((model) => model.id === id);
}

export function isAllowlistedEmbeddingModel(id: string): boolean {
  return getEmbeddingModel(id) !== undefined;
}

/** embeddingStatus vocabulary reported on WorldResource. */
export const EMBEDDING_STATUSES = [
  "unconfigured",
  "no_credential",
  "invalid",
  "stale",
  "partial",
  "ready",
] as const;
