import type { Env } from "../../../env";
import { getDb, query } from "../../db";
import { getEmbeddingModel } from "../catalog";
import { describeError } from "../errors";
import type { CredentialStatus } from "./credential-types";
import { credentialSlot } from "./key-cache";
import {
  byokEnabled,
  computeEmbeddingStatus,
  type EmbeddingStatus,
  type WorldEmbeddingStateValue,
} from "./world-state";

const IN_CHUNK = 50;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

/**
 * Derives embeddingStatus for a batch of worlds with at most a few queries.
 * Never throws: a lookup failure degrades to "unconfigured" (keyword-only).
 */
export async function loadEmbeddingStatuses(
  env: Env,
  worlds: Array<{
    world_id: string;
    namespace: string;
    embedding_model: string;
  }>,
): Promise<Map<string, EmbeddingStatus>> {
  const out = new Map<string, EmbeddingStatus>();
  if (worlds.length === 0) return out;
  const db = getDb(env);
  try {
    const enabled = await byokEnabled(env);
    const credentials = new Map<string, CredentialStatus>();
    const states = new Map<
      string,
      { state: WorldEmbeddingStateValue; model: string }
    >();
    if (enabled) {
      const namespaces = [...new Set(worlds.map((w) => w.namespace))];
      for (const batch of chunks(namespaces, IN_CHUNK)) {
        const rows =
          (await query<{
            namespace: string;
            provider: string;
            status: CredentialStatus;
          }>(
            db,
            `SELECT namespace, provider, status FROM embedding_credentials WHERE namespace IN (${placeholders(batch.length)})`,
            batch,
          )) ?? [];
        for (const row of rows) {
          credentials.set(
            credentialSlot(row.namespace, row.provider),
            row.status,
          );
        }
      }
      for (const batch of chunks(
        worlds.map((w) => w.world_id),
        IN_CHUNK,
      )) {
        const rows =
          (await query<{
            world_id: string;
            state: WorldEmbeddingStateValue;
            model: string;
          }>(
            db,
            `SELECT world_id, state, model FROM world_embedding_state WHERE world_id IN (${placeholders(batch.length)})`,
            batch,
          )) ?? [];
        for (const row of rows) {
          states.set(row.world_id, { state: row.state, model: row.model });
        }
      }
    }
    for (const world of worlds) {
      const modelProvider = getEmbeddingModel(world.embedding_model)?.provider;
      out.set(
        world.world_id,
        computeEmbeddingStatus({
          enabled,
          model: world.embedding_model,
          credentialStatus: modelProvider
            ? credentials.get(credentialSlot(world.namespace, modelProvider))
            : undefined,
          state: states.get(world.world_id),
        }),
      );
    }
  } catch (error) {
    console.warn("embedding status lookup failed", {
      reason: describeError(error),
    });
    for (const world of worlds) out.set(world.world_id, "unconfigured");
  }
  return out;
}
