export type { IngestOptions } from "./ingest.ts";
export { parseStoreFromRdfBytes, toSkolemizedQuad } from "./ingest.ts";

export type { SkolemOptions } from "./skolem.ts";
export {
  canonizeQuad,
  resolveSkolemPrefix,
  skolemizeBlankNodeLabel,
  skolemizeQuad,
} from "./skolem.ts";
