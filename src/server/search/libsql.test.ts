import { assertEquals } from "@std/assert/equals";
// @deno-types="npm:@types/n3"
import { DataFactory as df } from "n3";
import { createClient } from "@libsql/client";
import { LibsqlSearchStore } from "./libsql.ts";
import { solarSystem } from "./solar-system.ts";

Deno.test("LibsqlSearchStore e2e", async (t) => {
  const client = createClient({ url: ":memory:" });
  const searchStore = new LibsqlSearchStore({
    client,
    embeddings: { embed: (_text) => Promise.resolve([0]), dimensions: 1 },
  });

  await t.step("Create tables", async () => {
    await searchStore.createTables();
  });

  await t.step("Insert documents", async () => {
    await searchStore.patch([
      {
        insertions: solarSystem.map((content, index) =>
          df.quad(
            df.namedNode(`https://wazoo.worlds.tech/planets/${index}`),
            df.namedNode("https://schema.org/description"),
            df.literal(content),
          )
        ),
        deletions: [],
      },
    ]);
  });

  await t.step("Search", async () => {
    const results = await searchStore.search("Earth", 1);
    assertEquals(results.length, 1);
  });
});
