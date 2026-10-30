/**
 * RDF_IMPORT_CONTENT_TYPES are the serialized RDF formats import parses.
 * sparql-engine's parser reads the TriG grammar, a superset of Turtle,
 * N-Triples and N-Quads (the same parser the SDK uses), so one path covers
 * all of them. JSON-LD is not parsed anywhere in
 * the stack and is rejected rather than advertised.
 */
/** EXPORT_FORMATS are the content types export can serialize. */
export const EXPORT_FORMATS = [
  "application/json",
  "text/plain",
  "application/n-quads",
  "application/n-triples",
  "text/turtle",
  "application/trig",
  "application/ld+json",
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const TURTLE_FORMATS = {
  "application/n-quads": "n-quads",
  "application/n-triples": "n-triples",
  "text/turtle": "turtle",
} as const;
export type TurtleExportFormat = keyof typeof TURTLE_FORMATS;

/** DEFAULT_EXPORT_LIMIT is the page size for formats that page by default. */
export const DEFAULT_EXPORT_LIMIT = 1000;

export const RDF_IMPORT_CONTENT_TYPES = [
  "text/turtle",
  "application/trig",
  "application/n-triples",
  "application/n-quads",
  "text/n3",
] as const;
