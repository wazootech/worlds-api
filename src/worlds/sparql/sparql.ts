import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { Store } from "n3";
import type {
  SparqlBinding,
  SparqlQuad,
  SparqlResponse,
  SparqlValue,
} from "#/openapi/generated/types.gen.ts";

/**
 * queryEngine is a singleton instance of the Comunica QueryEngine.
 *
 * It's generally OK (and common) to share one `QueryEngine` instance across calls.
 * Reusing it can be slightly more efficient than constructing a new engine per query.
 */
export const queryEngine: QueryEngine = new QueryEngine();

/**
 * executeSparql executes a SPARQL query or update on a given store.
 */
export async function executeSparql(
  store: Store,
  query: string,
  options?: { baseIRI?: string },
): Promise<SparqlResponse> {
  const queryType = await queryEngine.query(query, {
    sources: [store],
    baseIRI: options?.baseIRI,
  });

  if (queryType.resultType === "void") {
    await queryType.execute();
    return null;
  }

  if (queryType.resultType === "bindings") {
    return await handleBindings(
      queryType as unknown as {
        execute(): Promise<unknown>;
        metadata(): Promise<{ variables: { value: string }[] }>;
      },
    );
  }

  if (queryType.resultType === "boolean") {
    return await handleBoolean(
      queryType as unknown as { execute(): Promise<boolean> },
    );
  }

  if (queryType.resultType === "quads") {
    return await handleQuads(
      queryType as unknown as { execute(): Promise<unknown> },
    );
  }

  throw new Error("Unsupported query type");
}

async function handleBindings(queryType: {
  execute(): Promise<unknown>;
  metadata(): Promise<{ variables: { value: string }[] }>;
}): Promise<SparqlResponse> {
  const bindingsStream = await queryType.execute();
  const vars = (await queryType.metadata()).variables.map((
    v: { value: string },
  ) => v.value);

  const bindings = await new Promise<SparqlBinding[]>((resolve, reject) => {
    const b: SparqlBinding[] = [];
    let finished = false;

    const onData = (binding: unknown) => {
      if (finished) return;
      const bindingObj: SparqlBinding = {};
      for (const v of vars) {
        // @ts-ignore - Comunica bindings are map-like with .get(varName)
        const term = binding.get(v);
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
}): Promise<SparqlResponse> {
  const booleanResult = await queryType.execute();
  return {
    head: { link: undefined },
    boolean: booleanResult,
  };
}

async function handleQuads(queryType: {
  execute(): Promise<unknown>;
}): Promise<SparqlResponse> {
  const quadsStream = await queryType.execute();
  const quads = await new Promise<SparqlQuad[]>((resolve, reject) => {
    const q: SparqlQuad[] = [];
    let finished = false;

    const onData = (quad: unknown) => {
      if (finished) return;
      // @ts-ignore: Comunica quad structure
      const subject = quad.subject;
      // @ts-ignore: Comunica quad structure
      const predicate = quad.predicate;
      // @ts-ignore: Comunica quad structure
      const object = quad.object;
      // @ts-ignore: Comunica quad structure
      const graph = quad.graph;

      q.push({
        subject: {
          type: subject.termType === "NamedNode" ? "uri" : "bnode",
          value: subject.value,
        },
        predicate: {
          type: "uri",
          value: predicate.value,
        },
        object: toSparqlValue(object),
        graph: {
          type: graph.termType === "DefaultGraph" ? "default" : "uri",
          value: graph.value,
        },
      });
    };

    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(q);
    };

    const onError = (err: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      // @ts-ignore - event emitter
      quadsStream.off("data", onData);
      // @ts-ignore - event emitter
      quadsStream.off("end", onEnd);
      // @ts-ignore - event emitter
      quadsStream.off("error", onError);
    };

    // @ts-ignore - event emitter
    quadsStream.on("data", onData);
    // @ts-ignore - event emitter
    quadsStream.on("end", onEnd);
    // @ts-ignore - event emitter
    quadsStream.on("error", onError);
  });

  return {
    head: { link: undefined },
    results: { quads },
  };
}

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
