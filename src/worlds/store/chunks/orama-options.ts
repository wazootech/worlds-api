import { type Orama, type SearchParams } from "@orama/orama";

export const CHUNK_SCHEMA = {
  id: "string",
  factId: "string",
  subject: "string",
  predicate: "string",
  text: "string",
  namespace: "string",
  worldId: "string",
  vector: "string",
} as const;

export type OramaSearchOptions = Omit<SearchParams<Orama<typeof CHUNK_SCHEMA>>, "term">;

export const DEFAULT_ORAMA_OPTIONS: OramaSearchOptions = {
  mode: "fulltext",
};
