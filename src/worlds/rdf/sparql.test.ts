import { assertEquals } from "@std/assert";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { DataFactory, Store } from "n3";

Deno.test("Comunica QueryEngine can query an n3 Store (RDFJS)", async () => {
  const store = new Store();
  store.addQuad(
    DataFactory.namedNode("https://example.com/s"),
    DataFactory.namedNode("https://example.com/p"),
    DataFactory.namedNode("https://example.com/o1"),
  );
  store.addQuad(
    DataFactory.namedNode("https://example.com/s"),
    DataFactory.namedNode("https://example.com/p"),
    DataFactory.namedNode("https://example.com/o2"),
  );

  const engine = new QueryEngine();
  const result = await engine.query(
    "SELECT ?o WHERE { <https://example.com/s> <https://example.com/p> ?o } ORDER BY ?o",
    { sources: [store] },
  );

  assertEquals(result.resultType, "bindings");

  const bindingsStream =
    await (result as unknown as { execute: () => Promise<unknown> })
      .execute();

  const values: string[] = await new Promise((resolve, reject) => {
    const out: string[] = [];
    let finished = false;

    const onData = (binding: unknown) => {
      if (finished) return;
      // @ts-ignore Comunica binding types are complex
      const term = binding.get("o");
      if (term) out.push(term.value);
    };

    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(out);
    };

    const onError = (err: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      // @ts-ignore streams are EventEmitters
      bindingsStream.off("data", onData);
      // @ts-ignore streams are EventEmitters
      bindingsStream.off("end", onEnd);
      // @ts-ignore streams are EventEmitters
      bindingsStream.off("error", onError);
    };

    // @ts-ignore streams are EventEmitters
    bindingsStream.on("data", onData);
    // @ts-ignore streams are EventEmitters
    bindingsStream.on("end", onEnd);
    // @ts-ignore streams are EventEmitters
    bindingsStream.on("error", onError);
  });

  assertEquals(values, ["https://example.com/o1", "https://example.com/o2"]);
});
