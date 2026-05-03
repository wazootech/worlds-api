import { assertEquals } from "@std/assert";
import type { QuadStorageManager, StoredQuad } from "./quad-storage.ts";

/** Shared contract tests for any QuadStorageManager implementation. */
export function testQuadStorageManager(
  name: string,
  factory: (suffix: string) => QuadStorageManager,
) {
  Deno.test(
    `QuadStorageManager contract [${name}]: getQuadStorage returns same instance for same ref`,
    async () => {
      const mgr = factory("contract1");
      const a = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      const b = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      assertEquals(a, b);
    },
  );

  Deno.test(
    `QuadStorageManager contract [${name}]: different worlds are isolated`,
    async () => {
      const mgr = factory("contract2");
      const s1 = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      const s2 = await mgr.getQuadStorage({ namespace: "ns", id: "w2" });
      const quad: StoredQuad = {
        subject: "s",
        predicate: "p",
        object: "o",
        graph: "g",
      };
      await s1.setQuad(quad);
      const results = await s2.findQuads([]);
      assertEquals(results.length, 0);
    },
  );

  Deno.test(
    `QuadStorageManager contract [${name}]: setQuad stores and findQuads retrieves`,
    async () => {
      const mgr = factory("contract3");
      const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      const quad: StoredQuad = {
        subject: "s",
        predicate: "p",
        object: "o",
        graph: "g",
      };
      await s.setQuad(quad);
      const results = await s.findQuads([]);
      assertEquals(results.length, 1);
      assertEquals(results[0], quad);
    },
  );

  Deno.test(
    `QuadStorageManager contract [${name}]: setQuad is idempotent (dedup by key)`,
    async () => {
      const mgr = factory("contract4");
      const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      const quad: StoredQuad = {
        subject: "s",
        predicate: "p",
        object: "o",
        graph: "g",
      };
      await s.setQuad(quad);
      await s.setQuad(quad);
      const results = await s.findQuads([]);
      assertEquals(results.length, 1);
    },
  );

  Deno.test(
    `QuadStorageManager contract [${name}]: setQuads batch stores multiple`,
    async () => {
      const mgr = factory("contract5");
      const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      const q1: StoredQuad = {
        subject: "s1",
        predicate: "p",
        object: "o1",
        graph: "g",
      };
      const q2: StoredQuad = {
        subject: "s2",
        predicate: "p",
        object: "o2",
        graph: "g",
      };
      await s.setQuads([q1, q2]);
      const results = await s.findQuads([]);
      assertEquals(results.length, 2);
    },
  );

  Deno.test(
    `QuadStorageManager contract [${name}]: deleteQuad removes quad`,
    async () => {
      const mgr = factory("contract6");
      const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      const quad: StoredQuad = {
        subject: "s",
        predicate: "p",
        object: "o",
        graph: "g",
      };
      await s.setQuad(quad);
      await s.deleteQuad(quad);
      const results = await s.findQuads([]);
      assertEquals(results.length, 0);
    },
  );

  Deno.test(
    `QuadStorageManager contract [${name}]: deleteQuad is idempotent (no-op for missing)`,
    async () => {
      const mgr = factory("contract7");
      const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      const quad: StoredQuad = {
        subject: "s",
        predicate: "p",
        object: "o",
        graph: "g",
      };
      await s.deleteQuad(quad);
      const results = await s.findQuads([]);
      assertEquals(results.length, 0);
    },
  );

  Deno.test(
    `QuadStorageManager contract [${name}]: deleteQuads batch removes multiple`,
    async () => {
      const mgr = factory("contract8");
      const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      const q1: StoredQuad = {
        subject: "s1",
        predicate: "p",
        object: "o1",
        graph: "g",
      };
      const q2: StoredQuad = {
        subject: "s2",
        predicate: "p",
        object: "o2",
        graph: "g",
      };
      await s.setQuads([q1, q2]);
      await s.deleteQuads([q1]);
      const results = await s.findQuads([]);
      assertEquals(results.length, 1);
      assertEquals(results[0].subject, "s2");
    },
  );

  Deno.test(
    `QuadStorageManager contract [${name}]: findQuads with matchers filters correctly`,
    async () => {
      const mgr = factory("contract9");
      const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      const q1: StoredQuad = {
        subject: "s1",
        predicate: "p",
        object: "o1",
        graph: "g",
      };
      const q2: StoredQuad = {
        subject: "s2",
        predicate: "p",
        object: "o2",
        graph: "g",
      };
      await s.setQuads([q1, q2]);
      const results = await s.findQuads([{ subject: "s1" } as StoredQuad]);
      assertEquals(results.length, 1);
      assertEquals(results[0].subject, "s1");
    },
  );

  Deno.test(
    `QuadStorageManager contract [${name}]: clear removes all quads for that world only`,
    async () => {
      const mgr = factory("contract10");
      const s1 = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      const s2 = await mgr.getQuadStorage({ namespace: "ns", id: "w2" });
      const quad: StoredQuad = {
        subject: "s",
        predicate: "p",
        object: "o",
        graph: "g",
      };
      await s1.setQuad(quad);
      await s2.setQuad(quad);
      await s1.clear();
      const r1 = await s1.findQuads([]);
      const r2 = await s2.findQuads([]);
      assertEquals(r1.length, 0);
      assertEquals(r2.length, 1);
    },
  );

  Deno.test(
    `QuadStorageManager contract [${name}]: clear is idempotent`,
    async () => {
      const mgr = factory("contract11");
      const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      await s.clear();
      await s.clear();
      const results = await s.findQuads([]);
      assertEquals(results.length, 0);
    },
  );

  Deno.test(
    `QuadStorageManager contract [${name}]: deleteQuadStorage clears storage and is idempotent`,
    async () => {
      const mgr = factory("contract12");
      const s = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      const quad: StoredQuad = {
        subject: "s",
        predicate: "p",
        object: "o",
        graph: "g",
      };
      await s.setQuad(quad);
      await mgr.deleteQuadStorage({ namespace: "ns", id: "w1" });
      const s2 = await mgr.getQuadStorage({ namespace: "ns", id: "w1" });
      const results = await s2.findQuads([]);
      assertEquals(results.length, 0);
      await mgr.deleteQuadStorage({ namespace: "ns", id: "w1" });
    },
  );
}

// ── LibsqlQuadStorageManager contract tests ─────────────────────────────────

// Skip libsql tests on Windows (native module not available in Deno)
if (Deno.build.os !== "windows") {
  // Dynamic import to avoid loading native module on Windows
  const { createLibsqlClient } = await import(
    "#/core/storage/libsql-client.ts"
  );
  const { LibsqlQuadStorageManager } = await import(
    "./libsql-quad-storage-manager.ts"
  );

  testQuadStorageManager("LibsqlQuadStorageManager",
    (suffix: string) => {
      // Each factory call gets its own in-memory DB for isolation
      const client = createLibsqlClient(
        { url: `file:memory:${suffix}?mode=memory&cache=shared` },
      );
      return new LibsqlQuadStorageManager(client);
    });
}
