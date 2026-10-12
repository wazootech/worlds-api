import type { Env } from "../../env";
import { getEmbeddingModel } from "./catalog";
import { EmbeddingError, describeError } from "./errors";
import { createOpenAiEmbeddingService } from "./openai";
import {
  byokEnabled,
  getCredential,
  getWorldState,
  recordAuthFailure,
  recordAuthSuccess,
  reindexMaxChunks,
  reserveBudget,
  resolveApiKey,
  type EmbeddingOperation,
} from "./store";

export type EmbeddingServiceLike = {
  embed(texts: string[]): Promise<number[][]>;
};

export type ResolveEmbeddingOptions = {
  /** "query" for search, "index" for import/reindex. */
  operation: EmbeddingOperation;
  /**
   * Reindex may embed while the world is stale (that is how it becomes ready);
   * every other path requires ready/partial state for the current model.
   */
  forReindex?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

let warnedProvider: string | undefined;

/**
 * Builds the embeddingService for a world, or returns undefined (keyword-only).
 *
 * Fails CLOSED and never throws: no BYOK switch, no Vectorize binding, no KEK,
 * non-allowlisted model, no/revoked/invalid credential, or a stale world all
 * yield undefined so search stays keyword-only on read paths.
 */
export async function resolveEmbeddingService(
  env: Env,
  ref: { worldId: string; namespace: string; embeddingModel: string },
  options: ResolveEmbeddingOptions,
): Promise<EmbeddingServiceLike | undefined> {
  try {
    const provider = env.EMBEDDING_PROVIDER;
    if (!provider) return undefined;
    if (provider !== "byok") {
      if (warnedProvider !== provider) {
        warnedProvider = provider;
        console.warn(
          "EMBEDDING_PROVIDER is set to an unsupported value; staying keyword-only (supported: byok)",
        );
      }
      return undefined;
    }
    if (!env.VECTORIZE_INDEX) return undefined;
    if (!(await byokEnabled(env))) return undefined;

    const model = getEmbeddingModel(ref.embeddingModel);
    if (!model) return undefined;

    const credential = await getCredential(env, ref.namespace, model.provider);
    if (!credential || credential.status !== "active") return undefined;

    if (!options.forReindex) {
      const state = await getWorldState(env, ref.worldId);
      if (
        !state ||
        state.model !== ref.embeddingModel ||
        (state.state !== "ready" && state.state !== "partial")
      ) {
        return undefined;
      }
    }

    const maxUnits = options.forReindex ? reindexMaxChunks(env) : Infinity;
    let spent = 0;
    const credentialId = credential.credential_id;

    return createOpenAiEmbeddingService({
      model,
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
      getApiKey: async () =>
        (await resolveApiKey(env, ref.namespace, model.provider))?.key ?? null,
      reserve: async (units) => {
        spent += units;
        if (spent > maxUnits) throw new EmbeddingError("budget_exceeded");
        const ok = await reserveBudget(
          env,
          ref.namespace,
          units,
          options.operation,
        );
        if (!ok) throw new EmbeddingError("budget_exceeded");
      },
      onAuthFailure: async () => {
        try {
          await recordAuthFailure(env, credentialId);
        } catch (error) {
          console.warn("embedding auth failure not recorded", {
            reason: describeError(error),
          });
        }
      },
      onSuccess: async () => {
        if (credential.consecutive_auth_failures > 0) {
          try {
            await recordAuthSuccess(env, credentialId);
          } catch {
            // Counter reset is best effort.
          }
        }
      },
    });
  } catch (error) {
    console.warn("embedding service unavailable; keyword-only", {
      reason: describeError(error),
    });
    return undefined;
  }
}
