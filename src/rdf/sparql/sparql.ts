import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { Store } from "n3";
import type {
  SparqlAskResults,
  SparqlSelectResults,
  SparqlValue,
} from "#/rpc/openapi/generated/types.gen.ts";
import {
  SparqlSyntaxError,
  SparqlUnsupportedOperationError,
} from "#/core/errors.ts";

/** Default timeout for SPARQL queries (30 seconds). */
const DEFAULT_SPARQL_TIMEOUT_MS = 30_000;

/**
 * queryEngine is a singleton instance of the Comunica QueryEngine.
 */
export const queryEngine: QueryEngine = new QueryEngine();

/**
 * Execute SPARQL on a single in-memory `Store` (one world's quads or an
 * aggregate built by the caller).
 *
 * **Supported**
 * - `SELECT` → bindings stream
 * - `ASK` → boolean
 * - `UPDATE` with `void` result → `null` (caller persists quad diffs; see {@link ../../core/worlds.ts})
 *
 * **Not supported here**
 * - `CONSTRUCT` / `DESCRIBE` → throws {@link SparqlUnsupportedOperationError}
 * - Multi-store UPDATE: enforced at {@link ../../core/worlds.ts} (`sparql`): multiple
 *   sources allowed for read-only queries; UPDATE requires a single source.
 *
 * Malformed queries surface as whatever `QueryEngine` rejects; timeouts use
 * {@link SparqlSyntaxError} (default **30000** ms, override `timeoutMs`).
 *
 * @param options.timeoutMs - Query timeout in ms (default 30000).
 */
export async function executeSparql(
  store: Store,
  query: string,
  options?: { baseIRI?: string; timeoutMs?: number },
): Promise<SparqlSelectResults | SparqlAskResults | null> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_SPARQL_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let timer: number | undefined = undefined;

    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    // Set timeout
    timer = setTimeout(() => {
      clearTimer();
      reject(new SparqlSyntaxError("SPARQL query timed out"));
    }, timeoutMs);

    queryEngine.query(query, {
      sources: [store],
      baseIRI: options?.baseIRI,
    }).then((queryType) => {
      clearTimer();

      try {
        if (queryType.resultType === "void") {
          return queryType.execute().then(() => resolve(null));
        }

        if (queryType.resultType === "bindings") {
          return handleBindings(
            queryType as unknown as {
              execute(): Promise<unknown>;
              metadata(): Promise<{ variables: { value: string }[] }>;
            },
          ).then(resolve).catch(reject);
        }

        if (queryType.resultType === "boolean") {
          return handleBoolean(
            queryType as unknown as { execute(): Promise<boolean> },
          ).then(resolve).catch(reject);
        }

        reject(
          new SparqlUnsupportedOperationError(
            "CONSTRUCT and DESCRIBE queries are not supported",
          ),
        );
      } catch (err) {
        reject(err);
      }
    }).catch((err) => {
      clearTimer();
      reject(err);
    });
  });
}

async function handleBindings(queryType: {
  execute(): Promise<unknown>;
  metadata(): Promise<{ variables: { value: string }[] }>;
}): Promise<SparqlSelectResults> {
  const bindingsStream = await queryType.execute();
  const vars = (await queryType.metadata()).variables.map(
    (v: { value: string }) => v.value,
  );

  const bindings = await new Promise<SparqlBinding[]>((resolve, reject) => {
    const b: SparqlBinding[] = [];
    let finished = false;

    const onData = (binding: unknown) => {
      if (finished) return;
      const bindingObj: SparqlBinding = {};
      for (const v of vars) {
        // @ts-ignore - Comunica bindings are map-like with .get(varName)
        const term = (binding as Record<string, unknown>).get(v);
        if (term) {
          bindingObj[v] = toSparqlValue(
            term as {
              termType: string;
              value: string;
              language?: string;
              datatype?: { value: string };
            },
          );
        }
      }
      b.push(bindingObj);
    };

    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(b);
    };

    const onError = (err: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      // @ts-ignore - event emitter
      bindingsStream.off("data", onData);
      // @ts-ignore - event emitter
      bindingsStream.off("end", onEnd);
      // @ts-ignore - event emitter
      bindingsStream.off("error", onError);
    };

    // @ts-ignore - event emitter
    bindingsStream.on("data", onData);
    // @ts-ignore - event emitter
    bindingsStream.on("end", onEnd);
    // @ts-ignore - event emitter
    bindingsStream.on("error", onError);
  });

  return {
    head: { vars, link: undefined },
    results: { bindings },
  };
}

async function handleBoolean(queryType: {
  execute(): Promise<boolean>;
}): Promise<SparqlAskResults> {
  const boolean = await queryType.execute();
  return {
    head: { link: undefined },
    boolean,
  };
}

type SparqlBinding = Record<string, SparqlValue>;

function toSparqlValue(term: {
  termType: string;
  value: string;
  language?: string;
  datatype?: { value: string };
}): SparqlValue {
  if (term.termType === "NamedNode") {
    return { type: "uri", value: term.value };
  }
  if (term.termType === "BlankNode") {
    return { type: "bnode", value: term.value };
  }

  const val: SparqlValue = {
    type: "literal",
    value: term.value,
  };

  if (term.language) {
    val["xml:lang"] = term.language;
  }

  if (
    term.datatype &&
    term.datatype.value !== "http://www.w3.org/2001/XMLSchema#string"
  ) {
    val.datatype = term.datatype.value;
  }

  return val;
}
