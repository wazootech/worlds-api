import type { Env } from "../../env";
import { getEmbeddingModel } from "./catalog";
import { EmbeddingError, describeError } from "./errors";
import {
  createOpenAiEmbeddingService,
  INDEX_MAX_RETRIES,
  INDEX_TIMEOUT_MS,
  QUERY_TIMEOUT_MS,
} from "./openai";
import {
  byokEnabled,
  getCredential,
  getWorldState,
  markWorldPartial,
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
  /** Overrides the per-call unit guard (reindex only). */
  maxUnits?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

let warnedProvider: string | undefined;

type WorldRef = { worldId: string; namespace: string; embeddingModel: string };

/**
 * Preconditions every embedding path shares, minus the per-world state check:
 * BYOK on, Vectorize bound, a usable KEK, an allowlisted model, and an active
 * credential. Never throws.
 */
async function embeddingPrerequisites(env: Env, ref: WorldRef) {
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
  return { model, credential };
}

/**
 * True when a reindex of this world would actually embed (every precondition
 * holds). Used to decide whether a large reindex must run in windows. Never
 * throws.
 */
export async function canEmbedForReindex(
  env: Env,
  ref: WorldRef,
): Promise<boolean> {
  try {
    return (await embeddingPrerequisites(env, ref)) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Builds the embeddingService for a world, or returns undefined (keyword-only).
 *
 * Fails CLOSED and never throws: no BYOK switch, no Vectorize binding, no KEK,
 * non-allowlisted model, no/revoked/invalid credential, or a stale world all
 * yield undefined so search stays keyword-only on read paths.
 */
export async function resolveEmbeddingService(
  env: Env,
  ref: WorldRef,
  options: ResolveEmbeddingOptions,
): Promise<EmbeddingServiceLike | undefined> {
  try {
    const prerequisites = await embeddingPrerequisites(env, ref);
    if (!prerequisites) return undefined;
    const { model, credential } = prerequisites;

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

    // Runtime guard for one reindex call. The window planner keeps a window
    // at or under EMBEDDING_REINDEX_MAX_CHUNKS by literal count; this is 2x
    // headroom for literals that split into several chunks and for paid
    // retries, so a miscount cannot run away within a single request.
    const maxUnits = options.forReindex
      ? (options.maxUnits ?? reindexMaxChunks(env) * 2)
      : Infinity;
    let spent = 0;
    const credentialId = credential.credential_id;

    const inner = createOpenAiEmbeddingService({
      model,
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
      // Search must degrade to keyword quickly: short deadline, no retries.
      timeoutMs:
        options.operation === "query" ? QUERY_TIMEOUT_MS : INDEX_TIMEOUT_MS,
      maxRetries: options.operation === "query" ? 0 : INDEX_MAX_RETRIES,
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

    // Import-time embedding failures (budget exhausted, provider down) leave
    // chunks without vectors while the world may still claim `ready`. The
    // engine swallows the failure into a report the import route cannot see,
    // so reconcile here. Reindex reconciles from its own vectorSync report and
    // search never changes state.
    if (options.operation === "index" && !options.forReindex) {
      return {
        async embed(texts: string[]) {
          try {
            return await inner.embed(texts);
          } catch (error) {
            try {
              await markWorldPartial(env, ref.worldId);
            } catch {
              console.warn("embedding state not recorded after import", {
                worldId: ref.worldId,
              });
            }
            throw error;
          }
        },
      };
    }
    return inner;
  } catch (error) {
    console.warn("embedding service unavailable; keyword-only", {
      reason: describeError(error),
    });
    return undefined;
  }
}
