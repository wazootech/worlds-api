import { EMBEDDING_DIMENSIONS, type EmbeddingModelSpec } from "./catalog";
import { EmbeddingError } from "./errors";

/**
 * OpenAI embedding provider implementing the engine's embeddingService seam
 * (`embed(texts) => vectors`).
 *
 * SSRF: the URL is a constant; there is no customer-supplied host, path, or
 * redirect following. Responses are size-capped. Provider response bodies and
 * headers are never copied into errors (see errors.ts).
 */
export const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

const MAX_BATCH = 64;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

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

export type OpenAiEmbeddingOptions = {
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

type OpenAiResponse = {
  data?: Array<{ index?: number; embedding?: unknown }>;
};

export function createOpenAiEmbeddingService(options: OpenAiEmbeddingOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? INDEX_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? INDEX_MAX_RETRIES;
  // After a 401/403 the rest of this instance's work stops immediately rather
  // than burning the whole batch on a dead key (design 4.2).
  let authFailed = false;

  async function embedBatch(texts: string[]): Promise<number[][]> {
    if (authFailed) throw new EmbeddingError("auth");
    await options.reserve(texts.length);

    const apiKey = await options.getApiKey();
    if (!apiKey) throw new EmbeddingError("no_credential");

    const body = JSON.stringify({
      model: options.model.providerModel,
      input: texts,
      encoding_format: "float",
      ...(options.model.sendDimensions && { dimensions: EMBEDDING_DIMENSIONS }),
    });

    for (let attempt = 0; ; attempt++) {
      // A retry is another provider call and costs the customer again, so it
      // is another reservation (it can fail closed with budget_exceeded).
      if (attempt > 0) await options.reserve(texts.length);
      const signal = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(OPENAI_EMBEDDINGS_URL, {
          method: "POST",
          redirect: "manual",
          signal,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body,
        });
      } catch {
        // Network errors can embed request details; collapse to a class.
        throw new EmbeddingError(signal.aborted ? "timeout" : "provider_error");
      }

      if (response.status === 401 || response.status === 403) {
        authFailed = true;
        await options.onAuthFailure?.();
        throw new EmbeddingError("auth");
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(250 * 2 ** attempt);
          continue;
        }
        throw new EmbeddingError(
          response.status === 429 ? "rate_limited" : "provider_error",
        );
      }
      if (response.status >= 300 && response.status < 400) {
        // Redirects are never followed.
        throw new EmbeddingError("provider_error");
      }
      if (response.status >= 400) throw new EmbeddingError("bad_request");

      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_RESPONSE_BYTES) {
        throw new EmbeddingError("bad_response");
      }
      let parsed: OpenAiResponse;
      try {
        const text = await response.text();
        if (text.length > MAX_RESPONSE_BYTES) {
          throw new EmbeddingError("bad_response");
        }
        parsed = JSON.parse(text) as OpenAiResponse;
      } catch (error) {
        if (error instanceof EmbeddingError) throw error;
        throw new EmbeddingError(signal.aborted ? "timeout" : "bad_response");
      }

      const rows = parsed.data;
      if (!Array.isArray(rows) || rows.length !== texts.length) {
        throw new EmbeddingError("bad_response");
      }
      const ordered = [...rows].sort(
        (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0),
      );
      const vectors: number[][] = [];
      for (const row of ordered) {
        const vector = row.embedding;
        if (
          !Array.isArray(vector) ||
          vector.length !== EMBEDDING_DIMENSIONS ||
          !vector.every((n) => typeof n === "number" && Number.isFinite(n))
        ) {
          throw new EmbeddingError("bad_response");
        }
        vectors.push(vector as number[]);
      }
      await options.onSuccess?.();
      return vectors;
    }
  }

  return {
    async embed(texts: string[]): Promise<number[][]> {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += MAX_BATCH) {
        out.push(...(await embedBatch(texts.slice(i, i + MAX_BATCH))));
      }
      return out;
    },
  };
}
