import type { EmbeddingModelSpec } from "./catalog";

/**
 * Embedding client for the vetted providers (see EMBEDDING_PROVIDERS),
 * implementing the engine's embeddingService seam (`embed(texts) => vectors`).
 * Every vetted provider speaks the OpenAI embeddings wire format.
 *
 * SSRF: the URL is a per-provider constant; there is no customer-supplied
 * host, path, or redirect following. Responses are size-capped. Provider
 * response bodies and headers are never copied into errors (see errors.ts).
 */
export const MAX_BATCH = 64;
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * Per-request deadlines and retry policy by operation.
 *
 * A search must degrade to keyword quickly when the provider is slow or
 * hanging, so a query embed gets a short deadline and NO retries (429/5xx
 * fail straight to keyword search). Import and reindex move batches of up to
 * 64 texts and may take longer and retry transient failures with backoff.
 */
export const QUERY_TIMEOUT_MS = 4_000;
export const INDEX_TIMEOUT_MS = 20_000;
export const INDEX_MAX_RETRIES = 2;

export type EmbeddingClientOptions = {
  model: EmbeddingModelSpec;
  /** Resolves the decrypted key per call (cached upstream, TTL <= 60 s). */
  getApiKey: () => Promise<string | null>;
  /**
   * Budget gate, called with the batch size BEFORE the provider is contacted.
   * Must throw EmbeddingError("budget_exceeded") when spend is not allowed.
   */
  reserve: (units: number) => Promise<void>;
  /** Called on provider 401/403 and on a success after prior failures. */
  onAuthFailure?: () => Promise<void> | void;
  onSuccess?: () => Promise<void> | void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Deadline for one provider request, including reading the body. */
  timeoutMs?: number;
  /** Retries on 429/5xx; each retry is a fresh budget reservation. */
  maxRetries?: number;
};

export type EmbeddingsResponse = {
  data?: Array<{ index?: number; embedding?: unknown }>;
};
