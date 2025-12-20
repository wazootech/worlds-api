import type { Quad, Term } from "@rdfjs/types";
import {
  blankNode,
  defaultGraph,
  literal,
  namedNode,
  quad,
  Quad_Object,
} from "oxigraph";
import type { StatementRow } from "#/core/database/statements.ts";
import { toTerm } from "./to-term.ts";

// TODO: Complete `./src/core/conversions` module.

/**
 * toQuad converts a StatementRow to a Quad.
 */
export function toQuad(
  statement: StatementRow,
  skolemizedStatements: StatementRow[],
): Quad {
  return quad(
    namedNode(statement.subject),
    namedNode(statement.predicate),
    toTerm(statement, skolemizedStatements) as Quad_Object,
    namedNode(statement.graph),
  );
}
