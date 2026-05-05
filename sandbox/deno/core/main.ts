import { Worlds } from "#/core/worlds.ts";
import { InMemoryWorldStorage } from "#/core/storage/in-memory.ts";
import { FakeEmbeddingsService } from "#/indexing/embeddings/fake.ts";
import { InMemoryChunkIndexManager } from "#/indexing/storage/in-memory.ts";
import { IndexedQuadStorageManager } from "#/rdf/storage/indexed/manager.ts";

const worlds = new Worlds(
  {
    worldStorage: new InMemoryWorldStorage(),
    quadStorageManager: new IndexedQuadStorageManager(
      new FakeEmbeddingsService(),
      new InMemoryChunkIndexManager(),
    ),
  },
  "demo-user",
);

function section(title: string): void {
  console.log("\n===", title, "===");
}

section("create world");
const created = await worlds.createWorld({
  namespace: "demo",
  id: "earth",
  displayName: "Earth",
  description: "A tiny demo world",
});
console.log(created);

section("import N-Quads");
const nquads = [
  '<https://example.com/earth> <https://schema.org/name> "Earth" .',
  '<https://example.com/earth> <https://schema.org/description> "Blue marble with oceans" .',
  '<https://example.com/earth> <https://schema.org/diameter> "12742" .',
  "<https://example.com/earth> <https://schema.org/containsPlace> <https://example.com/moon> .",
  '<https://example.com/moon> <https://schema.org/name> "Moon" .',
].join("\n");

await worlds.import({
  source: "demo/earth",
  data: nquads,
  contentType: "application/n-quads",
});
console.log("Imported", nquads.split("\n").length, "quads");

section("sparql SELECT");
const sparql = await worlds.sparql({
  source: "demo/earth",
  query:
    "SELECT ?label WHERE { <https://example.com/earth> <https://schema.org/name> ?label }",
});
console.log(JSON.stringify(sparql, null, 2));

section("search");
const search = await worlds.search({
  sources: ["demo/earth"],
  query: "blue marble",
});
console.log(search.results ?? []);

section("export N-Quads");
const exported = await worlds.export({
  source: "demo/earth",
  contentType: "application/n-quads",
});
const exportedText = new TextDecoder().decode(exported);
console.log(exportedText.trim());

section("list worlds");
const list = await worlds.listWorlds();
console.log(list.worlds);
