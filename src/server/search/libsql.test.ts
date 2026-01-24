import { assertEquals } from "@std/assert/equals";
import { assert } from "@std/assert/assert";
// @deno-types="npm:@types/n3"
import { DataFactory as df } from "n3";
import { createClient } from "@libsql/client";
import { LibsqlPatchHandler, LibsqlSearchStoreManager } from "./libsql.ts";
import { solarSystem } from "./solar-system.ts";

Deno.test("LibsqlSearchStoreManager e2e", async (t) => {
  const client = createClient({ url: ":memory:" });
  const accountId1 = "account-1";
  const accountId2 = "account-2";
  const worldId1 = "world-1";
  const worldId2 = "world-2";

  const searchStore = new LibsqlSearchStoreManager({
    client,
    embeddings: { embed: (_text) => Promise.resolve([0]), dimensions: 1 },
  });

  await t.step("Create tables", async () => {
    await searchStore.createTablesIfNotExists();
  });

  await t.step("Insert documents for account-1/world-1", async () => {
    await searchStore.patch(accountId1, worldId1, [
      {
        insertions: solarSystem.slice(0, 4).map((content, index) =>
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

  await t.step("Insert documents for account-1/world-2", async () => {
    await searchStore.patch(accountId1, worldId2, [
      {
        insertions: solarSystem.slice(4).map((content, index) =>
          df.quad(
            df.namedNode(`https://wazoo.worlds.tech/planets/${index + 4}`),
            df.namedNode("https://schema.org/description"),
            df.literal(content),
          )
        ),
        deletions: [],
      },
    ]);
  });

  await t.step("Insert documents for account-2 (isolation check)", async () => {
    await searchStore.patch(accountId2, worldId1, [
      {
        insertions: [
          df.quad(
            df.namedNode("https://wazoo.worlds.tech/other"),
            df.namedNode("https://schema.org/description"),
            df.literal("Secret data for account 2"),
          ),
        ],
        deletions: [],
      },
    ]);
  });

  await t.step("Search single world of account-1", async () => {
    const results = await searchStore.search("Earth", {
      accountId: accountId1,
      worldIds: [worldId1],
    });
    assert(results.length > 0, "Should have results");
    for (const result of results) {
      assertEquals(result.value.accountId, accountId1);
      assertEquals(result.value.worldId, worldId1);
    }
  });

  await t.step("Search all worlds of account-1", async () => {
    const results = await searchStore.search("planet", {
      accountId: accountId1,
    });
    assert(results.length > 0, "Should have results");
    for (const result of results) {
      assertEquals(result.value.accountId, accountId1);
      // Results can be from any world of accountId1
    }
    // isolation check: should NOT contain account-2 data
    const hasAccount2 = results.some((r) => r.value.accountId === accountId2);
    assertEquals(hasAccount2, false);
  });

  await t.step("Delete world from account-1", async () => {
    await searchStore.deleteWorld(accountId1, worldId1);
    const results = await searchStore.search("Earth", {
      accountId: accountId1,
      worldIds: [worldId1],
    });
    assertEquals(results.length, 0);
  });

  await t.step("Account-2 data still exists", async () => {
    const results = await searchStore.search("Secret", {
      accountId: accountId2,
    });
    assertEquals(results.length, 1);
    assertEquals(results[0].value.accountId, accountId2);
  });

  await t.step("forWorld adapter works", async () => {
    const worldHandler = new LibsqlPatchHandler({
      manager: searchStore,
      accountId: accountId1,
      worldId: "world-3",
    });
    await worldHandler.patch([
      {
        insertions: [
          df.quad(
            df.namedNode("https://example.org/test"),
            df.namedNode("https://schema.org/name"),
            df.literal("Test entity"),
          ),
        ],
        deletions: [],
      },
    ]);

    const results = await searchStore.search("Test", {
      accountId: accountId1,
      worldIds: ["world-3"],
    });
    assertEquals(results.length, 1);
    assertEquals(results[0].value.worldId, "world-3");
    assertEquals(results[0].value.accountId, accountId1);
  });
});
