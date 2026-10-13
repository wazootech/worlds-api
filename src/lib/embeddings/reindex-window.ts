import type { Env } from "../../env";
import { getDb, query, queryOne } from "../db";
import { reindexMaxChunks } from "./store";

/**
 * Windowed reindex planning (design 4.3: "excess returns a resumable cursor").
 *
 * The Worlds engine rebuilds every chunk of a world from the first quad each
 * time and has no cursor, so a world with more text than one call may embed
 * could never finish: every retry re-embedded the same first chunks and burned
 * the day's budget. Instead a large reindex is split into windows of whole
 * subjects. Each call refreshes (and embeds) only the subjects in its window
 * through the engine's `include.subjects` filter, then the cursor (the last
 * finished subject) is stored in `world_embedding_state.reindex_cursor`. The
 * next call resumes after it, so no chunk is embedded twice in a pass, and the
 * world reaches `ready` when the last window finishes with no failures.
 *
 * Windows are sized by text literal quads (an upper bound on chunk count for
 * short literals; long literals that split into several chunks are covered by
 * the 2x runtime guard in the embedder).
 */

export type ReindexWindow =
  | { windowed: false }
  | {
      windowed: true;
      subjects: string[];
      /** Cursor to store when this window completes. */
      lastSubject: string;
      /** True when this window reaches the end of the world. */
      done: boolean;
      /** Literal quads after this window (an estimate of chunks left). */
      remaining: number;
    };

const SUBJECT_PAGE = 1000;

function isMissingTable(error: unknown): boolean {
  return (
    error instanceof Error &&
    /no such table|does not exist/i.test(error.message)
  );
}

export async function planReindexWindow(
  env: Env,
  worldId: string,
  cursor: string | null,
): Promise<ReindexWindow> {
  const cap = reindexMaxChunks(env);
  const db = getDb(env);
  try {
    if (cursor === null) {
      const total = await queryOne<{ n: number }>(
        db,
        "SELECT COUNT(*) AS n FROM quads WHERE world_id = ? AND o_type = 'Literal'",
        [worldId],
      );
      if (Number(total?.n ?? 0) <= cap) return { windowed: false };
    }

    const subjects: string[] = [];
    let sum = 0;
    let after = cursor ?? "";
    let exhausted = false;
    let full = false;
    while (!full && !exhausted) {
      const rows =
        (await query<{ s: string; n: number }>(
          db,
          `SELECT s, COUNT(*) AS n FROM quads
            WHERE world_id = ? AND o_type = 'Literal' AND s > ?
            GROUP BY s ORDER BY s LIMIT ${SUBJECT_PAGE}`,
          [worldId, after],
        )) ?? [];
      for (const row of rows) {
        const n = Number(row.n);
        // Whole subjects only. A single subject larger than the cap is taken
        // alone (the guard has 2x headroom) rather than blocking the pass.
        if (subjects.length > 0 && sum + n > cap) {
          full = true;
          break;
        }
        subjects.push(row.s);
        sum += n;
        after = row.s;
        if (sum >= cap) {
          full = true;
          break;
        }
      }
      if (rows.length < SUBJECT_PAGE) exhausted = true;
    }
    if (subjects.length === 0) {
      // Only reachable with a cursor: the previous window was the last one.
      // The caller finishes the pass without running the engine (an empty
      // include list must not be read as "no filter").
      return {
        windowed: true,
        subjects: [],
        lastSubject: cursor ?? "",
        done: true,
        remaining: 0,
      };
    }
    const last = subjects[subjects.length - 1]!;
    const left = await queryOne<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM quads WHERE world_id = ? AND o_type = 'Literal' AND s > ?",
      [worldId, last],
    );
    const remaining = Number(left?.n ?? 0);
    return {
      windowed: true,
      subjects,
      lastSubject: last,
      done: remaining === 0,
      remaining,
    };
  } catch (error) {
    if (isMissingTable(error)) return { windowed: false };
    throw error;
  }
}
