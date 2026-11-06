import type { Env } from "../../env";
import { getDb, query } from "../../lib/db";
import {
  cleanupOk,
  cleanupWorldVectors,
  emptyCleanupReport,
  mergeCleanupReports,
} from "../../lib/embeddings/vectors";

/** Cleans the vectors of every world in a namespace. Never throws. */
export async function cleanupNamespaceVectors(env: Env, namespace: string) {
  if (!env.VECTORIZE_INDEX) return undefined;
  let report = emptyCleanupReport(true);
  let worlds = 0;
  try {
    const rows = await query<{ world_id: string }>(
      getDb(env),
      "SELECT world_id FROM worlds WHERE namespace = ?",
      [namespace],
    );
    for (const row of rows ?? []) {
      const one = await cleanupWorldVectors(env, row.world_id, "all");
      report = mergeCleanupReports(report, one);
      if (one.attempted > 0) worlds++;
    }
  } catch (error) {
    report.failed += 1;
    report.errors.push(
      `enumerate: ${error instanceof Error ? error.name : "unknown"}`,
    );
  }
  if (!cleanupOk(report)) {
    console.warn("namespace vector cleanup incomplete", {
      namespace,
      failed: report.failed,
      incomplete: report.incomplete,
    });
  }
  return {
    worlds,
    attempted: report.attempted,
    deleted: report.deleted,
    failed: report.failed,
    incomplete: report.incomplete || report.failed > 0,
    errors: report.errors,
  };
}
