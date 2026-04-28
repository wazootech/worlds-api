export interface StoredQuad {
  subject: string;
  predicate: string;
  object: string;
  graph: string;
  objectTermType?: "NamedNode" | "BlankNode" | "Literal";
  objectDatatype?: string;
  objectLanguage?: string;
}