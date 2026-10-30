import { SparqlParser } from "@wazoo/sparql-engine/parser";

/**
 * The engine rejects timeouts with this exact message (WazooSparqlEngine's
 * composed timeout/abort controller), so the
 * route maps it back to the documented QUERY_TIMEOUT error code without its
 * own timer.
 */
export const SPARQL_TIMEOUT_MESSAGE = "SPARQL query timed out";

/**
 * materializeBindings drains SPARQL bindings before the response is
 * serialized. Engines may hand back a live stream; stream-evaluation errors
 * (e.g., an unhandled term comparator while sorting on an unbound OPTIONAL
 * variable) otherwise fire asynchronously during JSON serialization and
 * escape the route's try/catch, crashing the Worker with Error 1101.
 * Draining here turns those errors into a rejection the route can map to a
 * structured response.
 */
export async function materializeBindings(
  bindings: unknown,
  maxRows: number,
): Promise<unknown> {
  if (Array.isArray(bindings)) return bindings.slice(0, maxRows);
  const iterable = bindings as
    | {
        [Symbol.asyncIterator](): AsyncIterator<unknown>;
      }
    | undefined;
  if (iterable && typeof iterable[Symbol.asyncIterator] === "function") {
    const rows: unknown[] = [];
    for await (const row of iterable as AsyncIterable<unknown>) {
      rows.push(row);
      if (rows.length >= maxRows) break; // bound drain cost
    }
    return rows;
  }
  return bindings;
}

/**
 * Parses the query with the same parser configuration the engine uses and
 * reports whether it is a query or an update. Throws on a syntax error.
 */
export function classifySparql(query: string): "query" | "update" {
  return new SparqlParser().parse(query).type;
}
