import { z } from "@hono/zod-openapi";
import {
  cleanupOk,
  type VectorCleanupReport,
} from "../../lib/embeddings/vectors";

/**
 * VectorSyncSchema mirrors @worlds/cloudflare's VectorSyncReport: what the
 * reindex managed to write to the outside-D1 vector index (worlds-cloudflare#40).
 */
export const VectorSyncSchema = z
  .object({
    enabled: z.boolean(),
    attempted: z.number().int().nonnegative(),
    upserted: z.number().int().nonnegative(),
    failedUpserts: z.number().int().nonnegative(),
    embeddingFailures: z.number().int().nonnegative(),
    staleDeleteFailures: z.number().int().nonnegative(),
    errors: z.array(z.string()),
  })
  .openapi("VectorSyncReport");

export type VectorSync = z.infer<typeof VectorSyncSchema>;

export function readVectorSync(report: unknown): VectorSync | undefined {
  const parsed = VectorSyncSchema.safeParse(
    (report as { vectorSync?: unknown } | null)?.vectorSync,
  );
  return parsed.success ? parsed.data : undefined;
}

/**
 * Folds an orphan-vector cleanup that failed or did not finish into the
 * vectorSync report, so a reindex that could not remove stale vectors says so
 * (completed_with_vector_errors) instead of reporting a clean run.
 */
export function withCleanup(
  vectorSync: VectorSync | undefined,
  cleanup: VectorCleanupReport,
): VectorSync | undefined {
  if (cleanupOk(cleanup)) return vectorSync;
  const failures = cleanup.failed + (cleanup.incomplete ? 1 : 0);
  const errors = cleanup.incomplete
    ? [...cleanup.errors, "cleanup: incomplete"]
    : cleanup.errors;
  const base = vectorSync ?? {
    enabled: false,
    attempted: 0,
    upserted: 0,
    failedUpserts: 0,
    embeddingFailures: 0,
    staleDeleteFailures: 0,
    errors: [],
  };
  return {
    ...base,
    staleDeleteFailures: base.staleDeleteFailures + failures,
    errors: [...base.errors, ...errors],
  };
}

export function vectorSyncFailed(vectorSync: VectorSync | undefined): boolean {
  return Boolean(
    vectorSync &&
    (vectorSync.failedUpserts > 0 ||
      vectorSync.embeddingFailures > 0 ||
      vectorSync.staleDeleteFailures > 0),
  );
}
