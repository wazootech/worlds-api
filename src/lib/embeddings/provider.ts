import { EMBEDDING_DIMENSIONS, EMBEDDING_PROVIDERS } from "./catalog";
import { EmbeddingError } from "./errors";
import {
  INDEX_MAX_RETRIES,
  INDEX_TIMEOUT_MS,
  MAX_BATCH,
  MAX_RESPONSE_BYTES,
  type EmbeddingClientOptions,
  type EmbeddingsResponse,
} from "./provider-options";

export {
  INDEX_MAX_RETRIES,
  INDEX_TIMEOUT_MS,
  QUERY_TIMEOUT_MS,
} from "./provider-options";
export type { EmbeddingClientOptions } from "./provider-options";

export function createEmbeddingService(options: EmbeddingClientOptions) {
  const url = EMBEDDING_PROVIDERS[options.model.provider].embeddingsUrl;
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
        response = await fetchImpl(url, {
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
      let parsed: EmbeddingsResponse;
      try {
        const text = await response.text();
        if (text.length > MAX_RESPONSE_BYTES) {
          throw new EmbeddingError("bad_response");
        }
        parsed = JSON.parse(text) as EmbeddingsResponse;
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
