import { describeError } from "../errors";
import { MAX_ERRORS } from "./constants";

export type VectorCleanupReport = {
  /** False when no Vectorize binding is present: nothing to clean. */
  enabled: boolean;
  /** Vector ids enumerated from D1 chunk rows. */
  attempted: number;
  /** Ids Vectorize accepted for deletion. */
  deleted: number;
  /** Ids whose deletion (or enumeration) failed. */
  failed: number;
  /** True when more vectors remain and a re-run is required. */
  incomplete: boolean;
  /** Orphan chunk rows (no quad left) removed from D1. */
  orphanChunkRows: number;
  /** Failure classes only, never provider bodies. */
  errors: string[];
};

export function emptyCleanupReport(enabled: boolean): VectorCleanupReport {
  return {
    enabled,
    attempted: 0,
    deleted: 0,
    failed: 0,
    incomplete: false,
    orphanChunkRows: 0,
    errors: [],
  };
}

export function cleanupOk(report: VectorCleanupReport): boolean {
  return report.failed === 0 && !report.incomplete;
}

export function mergeCleanupReports(
  a: VectorCleanupReport,
  b: VectorCleanupReport,
): VectorCleanupReport {
  return {
    enabled: a.enabled || b.enabled,
    attempted: a.attempted + b.attempted,
    deleted: a.deleted + b.deleted,
    failed: a.failed + b.failed,
    incomplete: a.incomplete || b.incomplete,
    orphanChunkRows: a.orphanChunkRows + b.orphanChunkRows,
    errors: [...new Set([...a.errors, ...b.errors])].slice(0, MAX_ERRORS),
  };
}

export function recordError(
  report: VectorCleanupReport,
  stage: string,
  error: unknown,
) {
  const entry = `${stage}: ${describeError(error)}`;
  if (report.errors.length < MAX_ERRORS && !report.errors.includes(entry)) {
    report.errors.push(entry);
  }
}

/** A missing chunks/quads table means the world never indexed anything. */
