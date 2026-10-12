import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldsSdkInterface } from "@worlds/sdk";
import app from "../src/app";
import { getWorldSdk, resolveWorldDatabase } from "../src/lib/world-db";
import { DataFactory } from "@wazoo/sparql-engine/data-model";

const { namedNode, literal, quad, defaultGraph } = DataFactory;

vi.mock("../src/lib/world-db", () => ({
  clearSdkCacheForWorld: vi.fn(),
  getWorldSdk: vi.fn(),
  resolveWorldDatabase: vi.fn(),
}));

const worldId = "w_01jd8x5mqv7k3n9r2t4w6y8z0b";
const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

// Five quads; the last two are text chunks (schema:text) for text/plain.
const QUADS = [
  quad(namedNode("urn:s1"), namedNode("urn:p"), literal("a"), defaultGraph()),
  quad(namedNode("urn:s2"), namedNode("urn:p"), literal("b"), defaultGraph()),
  quad(namedNode("urn:s3"), namedNode("urn:p"), literal("c"), defaultGraph()),
  quad(
    namedNode("urn:c1"),
    namedNode("http://schema.org/text"),
    literal("chunk one"),
    defaultGraph(),
  ),
  quad(
    namedNode("urn:c2"),
    namedNode("http://schema.org/text"),
    literal("chunk two"),
    defaultGraph(),
  ),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveWorldDatabase).mockResolvedValue({
    worldId,
    namespace: "ns",
    embeddingModel: "use",
    chunkSize: 1000,
    topK: 5,
    minScore: 0.5,
  } as never);
  vi.mocked(getWorldSdk).mockResolvedValue({
    export: vi.fn().mockResolvedValue({ kind: "quads", quads: QUADS }),
  } as unknown as WorldsSdkInterface);
});

function exportWorld(query: string) {
  return app.request(
    `/worlds/${worldId}/export?${query}`,
    { headers: { Authorization: "Bearer admin-token" } },
    { WORLDS_API_ADMIN_KEY: "admin-token" },
    executionCtx,
  );
}

describe("export paging applies to every format (#103)", () => {
  const serialized = [
    "application/n-quads",
    "application/n-triples",
    "text/turtle",
    "application/trig",
    "application/ld+json",
  ];

  for (const format of serialized) {
    it(`pages ${format} and signals the next offset`, async () => {
      const first = await exportWorld(
        `format=${encodeURIComponent(format)}&limit=2`,
      );
      expect(first.status).toBe(200);
      expect(first.headers.get("X-Next-Offset")).toBe("2");
      const firstBody = await first.text();
      expect(firstBody).toContain("urn:s1");
      expect(firstBody).toContain("urn:s2");
      expect(firstBody).not.toContain("urn:s3");

      const last = await exportWorld(
        `format=${encodeURIComponent(format)}&limit=2&offset=4`,
      );
      expect(last.headers.get("X-Next-Offset")).toBeNull();
      const lastBody = await last.text();
      expect(lastBody).toContain("urn:c2");
      expect(lastBody).not.toContain("urn:s1");
    });
  }

  it("keeps returning the whole world for serialized formats when limit is omitted", async () => {
    const res = await exportWorld("format=application%2Fn-quads");
    expect(res.headers.get("X-Next-Offset")).toBeNull();
    const body = await res.text();
    for (const subject of ["urn:s1", "urn:s3", "urn:c2"]) {
      expect(body).toContain(subject);
    }
  });

  it("pages application/json with nextOffset in the body and the header", async () => {
    const res = await exportWorld("format=application%2Fjson&limit=3");
    expect(res.headers.get("X-Next-Offset")).toBe("3");
    const body = (await res.json()) as {
      quads: Array<{ subject: string }>;
      nextOffset?: number;
    };
    expect(body.quads.map((q) => q.subject)).toEqual([
      "urn:s1",
      "urn:s2",
      "urn:s3",
    ]);
    expect(body.nextOffset).toBe(3);
  });

  it("signals the next offset for text/plain chunks", async () => {
    const first = await exportWorld("format=text%2Fplain&limit=1");
    expect(await first.text()).toBe("urn:c1\tchunk one");
    expect(first.headers.get("X-Next-Offset")).toBe("1");
    const second = await exportWorld("format=text%2Fplain&limit=1&offset=1");
    expect(await second.text()).toBe("urn:c2\tchunk two");
    expect(second.headers.get("X-Next-Offset")).toBeNull();
  });

  for (const [query, message] of [
    ["limit=0", "limit"],
    ["limit=abc", "limit"],
    ["offset=-1", "offset"],
    ["offset=1.5", "offset"],
  ]) {
    it(`rejects ${query} with 400`, async () => {
      const res = await exportWorld(query);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toContain(message);
    });
  }

  it("rejects an unknown format with 400", async () => {
    const res = await exportWorld("format=text%2Fcsv");
    expect(res.status).toBe(400);
  });
});
