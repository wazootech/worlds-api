/** Well-known predicate / class IRIs shared across RDF and search indexing. */

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
export const RDFS_COMMENT = "http://www.w3.org/2000/01/rdf-schema#comment";

/** Predicates excluded from the search vector index (metadata). */
export const META_PREDICATES: readonly string[] = [RDFS_LABEL, RDFS_COMMENT];
