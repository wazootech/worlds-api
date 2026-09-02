import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { getWorldSdk, resolveWorldDatabase } from "../src/lib/world-db";

vi.mock("../src/lib/world-db", () => ({
  resolveWorldDatabase: vi.fn(),
  getWorldSdk: vi.fn(),
}));

const getWorldSdkMock = vi.mocked(getWorldSdk);
const resolveWorldDatabaseMock = vi.mocked(resolveWorldDatabase);

const env = {
  DB: {} as any,
  WORLDS_ADMIN_KEY: "test-admin-key",
  RATE_LIMIT_RPM: "0",
} as unknown as Env;

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const worldRef = {
  worldUid: "test-world",
  namespace: "ns",
  embeddingModel: "use",
  chunkSize: 1000,
  topK: 5,
  minScore: 0.5,
};

const ALLOWED_ORIGIN = "https://console.wazoo.dev";

function request(
  body: unknown,
  overrides?: { db?: unknown; authHeader?: string },
) {
  return app.request(
    "/worlds/test-world/search",
    {
      method: "POST",
      headers: {
        authorization: overrides?.authHeader ?? "Bearer test-admin-key",
        "content-type": "application/json",
        origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify(body),
    },
    { ...env, DB: overrides?.db ?? env.DB },
    executionCtx,
  );
}

function mockSearchClient() {
  const search = vi.fn();
  getWorldSdkMock.mockResolvedValue({ search } as never);
  return search;
}

function mockFallbackDb(
  rows: Array<{ s: string; p: string; o: string; g: string }>,
) {
  const all = vi.fn();
  // Emulate the SQL LIMIT: the last bound argument is the limit value.
  const bind = vi.fn((...args: unknown[]) => {
    all.mockResolvedValue({
      results: rows.slice(0, Number(args[args.length - 1])),
    });
    return { all };
  });
  return { prepare: vi.fn().mockReturnValue({ bind }), bind, all };
}

describe("POST /worlds/:id/search endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveWorldDatabaseMock.mockResolvedValue(worldRef as never);
  });

  it("rejects request without authorization token", async () => {
    const res = await app.request(
      "/worlds/test-world/search",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "find me" }),
      },
      env,
      executionCtx,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when query is missing", async () => {
    const res = await request({});
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
  });

  it("returns 404 when the world database cannot be resolved", async () => {
    resolveWorldDatabaseMock.mockResolvedValue(null as never);
    const res = await request({ query: "find me" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects limit outside the 1–100 contract range", async () => {
    const tooBig = await request({ query: "find me", limit: 101 });
    expect(tooBig.status).toBe(400);
    const tooSmall = await request({ query: "find me", limit: 0 });
    expect(tooSmall.status).toBe(400);
    // topK is no longer part of the public contract — it is silently stripped.
    mockSearchClient().mockResolvedValue({ results: [] });
    const res = await request({ query: "find me", topK: 999 });
    expect(res.status).toBe(200);
    expect(getWorldSdkMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      999,
    );
  });

  it("passes candidateCount = max(limit, world.topK) to the SDK factory", async () => {
    mockSearchClient().mockResolvedValue({ results: [] });
    await request({ query: "find me", limit: 3 });

    expect(getWorldSdkMock).toHaveBeenCalledWith(
      expect.anything(),
      worldRef,
      Math.max(3, worldRef.topK),
    );
    // max(limit=3, topK=5) = 5.
    expect(getWorldSdkMock.mock.calls[0][2]).toBe(5);
  });

  it("defaults the candidate pool from the world's topK when limit is omitted", async () => {
    mockSearchClient().mockResolvedValue({ results: [] });
    await request({ query: "find me" });

    // Default limit is 20; max(20, topK=5) = 20.
    expect(getWorldSdkMock.mock.calls[0][2]).toBe(20);
  });

  it("searches with query, world-default minScore, and forwarded filter", async () => {
    const search = mockSearchClient();
    search.mockResolvedValue({ results: [] });

    await request({
      query: "find me",
      filter: {
        include: { predicates: ["http://schema.org/name"] },
        exclude: { graphs: ["urn:private"] },
      },
    });

    expect(search).toHaveBeenCalledWith({
      query: "find me",
      minScore: worldRef.minScore,
      include: { predicates: ["http://schema.org/name"] },
      exclude: { graphs: ["urn:private"] },
    });
  });

  it("lets the request override minScore", async () => {
    const search = mockSearchClient();
    search.mockResolvedValue({ results: [] });

    await request({ query: "find me", minScore: 0.9 });
    expect(search).toHaveBeenCalledWith({
      query: "find me",
      minScore: 0.9,
    });
  });

  it("caps results at limit and emits the contract shape with mode keyword", async () => {
    const search = mockSearchClient();
    search.mockResolvedValue({
      results: Array.from({ length: 5 }, (_, i) => ({
        id: `id-${i}`,
        subject: `urn:subj-${i}`,
        predicate: "urn:knows",
        graph: "",
        text: `result ${i}`,
        score: 1.0 / (i + 1),
        scoreType: "rrf" as const,
      })),
    });

    const res = await request({ query: "find me", limit: 2 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("keyword");
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toEqual({
      id: "id-0",
      subject: "urn:subj-0",
      predicate: "urn:knows",
      graph: "",
      content: "result 0",
      score: 1.0,
      scoreType: "rrf",
    });
    expect(body.results[0].content).toBe("result 0");
    expect(body.results[0]).not.toHaveProperty("object");
  });

  it("passes through the engine's hybrid mode and cosine scoreType (Phase C)", async () => {
    const search = mockSearchClient();
    search.mockResolvedValue({
      mode: "hybrid",
      results: [
        {
          id: "id-0",
          subject: "urn:s",
          predicate: "urn:p",
          graph: "",
          text: "semantic hit",
          score: 0.87,
          scoreType: "cosine",
        },
        {
          id: "id-1",
          subject: "urn:s2",
          predicate: "urn:p",
          graph: "",
          text: "keyword hit",
          score: 0.9,
          scoreType: "rrf",
        },
      ],
    });

    const res = await request({ query: "find me" });
    const body = await res.json();
    expect(body.mode).toBe("hybrid");
    // The engine's cosine signal must not be erased at the API boundary.
    expect(body.results[0].scoreType).toBe("cosine");
    expect(body.results[0].score).toBe(0.87);
    expect(body.results[0].content).toBe("semantic hit");
  });

  it("passes through semantic mode when only vectors matched", async () => {
    const search = mockSearchClient();
    search.mockResolvedValue({
      mode: "semantic",
      results: [
        {
          id: "id-0",
          subject: "urn:s",
          predicate: "urn:p",
          graph: "",
          text: "vector only",
          score: 1.0,
          scoreType: "cosine",
        },
      ],
    });

    const res = await request({ query: "###" });
    const body = await res.json();
    expect(body.mode).toBe("semantic");
    expect(body.results[0].scoreType).toBe("cosine");
  });

  it("normalized score scale: rank 0 emits 1.0", async () => {
    const search = mockSearchClient();
    search.mockResolvedValue({
      results: [
        {
          id: "id-0",
          subject: "urn:s",
          predicate: "urn:p",
          graph: "",
          text: "best",
          score: 1.0,
          scoreType: "rrf",
        },
      ],
    });

    const res = await request({ query: "find me" });
    const body = await res.json();
    expect(body.results[0].score).toBe(1.0);
    expect(body.results[0].scoreType).toBe("rrf");
  });

  it("falls back to grouped LIKE search scoped to the world and returns the contract shape", async () => {
    const search = mockSearchClient();
    search.mockRejectedValue(new Error("engine down"));

    const db = mockFallbackDb([
      { s: "urn:a", p: "urn:p", o: "alpha result", g: "" },
      { s: "urn:b", p: "urn:p", o: "beta result", g: "urn:graphB" },
    ]);

    const res = await request({ query: "result", limit: 1 }, { db });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("fallback");
    expect(body.results).toHaveLength(1);

    const row = body.results[0];
    expect(row.content).toBe("alpha result");
    expect(row.object).toBeUndefined();
    expect(row.score).toBeNull();
    expect(row.scoreType).toBe("unranked");
    expect(row.id).toBeTypeOf("string");
    expect(row.subject).toBe("urn:a");
    expect(row.graph).toBe("");

    // The world_uid scope wraps all three LIKE clauses (regression for the
    // operator-precedence leak where world_uid only bound to `o LIKE`).
    expect(db.prepare).toHaveBeenCalledWith(
      expect.stringContaining(
        "(s LIKE ? OR p LIKE ? OR o LIKE ?) AND world_uid = ?",
      ),
    );
    expect(db.bind).toHaveBeenCalledWith(
      "%result%",
      "%result%",
      "%result%",
      "test-world",
      1,
    );
  });
});
