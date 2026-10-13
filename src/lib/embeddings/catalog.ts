/**
 * Embedding model allowlist (worlds-api#1, design D3/D4/D7).
 *
 * The Vectorize index width is immutable and fixed at 1536 dimensions, so only
 * models that can emit exactly 1536 are admissible, and the dimension
 * parameter is pinned in code, never customer-supplied. Provider base URLs are
 * code constants (no customer-supplied host: no SSRF surface, D10).
 */

/** Width of the shared Vectorize index and the D1 vector column. */
export const EMBEDDING_DIMENSIONS = 1536;

export type EmbeddingProviderId = "openai";

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
];

/** Every accepted `provider/model` id, in a tuple usable by z.enum. */
export const EMBEDDING_MODEL_IDS = [
  "openai/text-embedding-3-small",
  "openai/text-embedding-3-large",
  "openai/text-embedding-ada-002",
] as const;

export const EMBEDDING_PROVIDER_IDS = ["openai"] as const;

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
