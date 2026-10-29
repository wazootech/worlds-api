export { physicalVectorId } from "./vectors/physical-id";
export {
  cleanupOk,
  emptyCleanupReport,
  mergeCleanupReports,
} from "./vectors/report";
export type { VectorCleanupReport } from "./vectors/report";
export { cleanupWorldVectors } from "./vectors/cleanup";
export { markNamespaceStale, markWorldStale } from "./vectors/stale";
