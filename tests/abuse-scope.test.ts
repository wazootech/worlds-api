import { describe, expect, it, vi } from "vitest";
import {
  FULL_TOKEN,
  getWorldSdkMock,
  READ_ONLY_TOKEN,
  request,
  useAbuseMocks,
} from "./helpers/abuse-harness";

vi.mock("../src/lib/world-db", () => ({
  resolveWorldDatabase: vi.fn(),
  getWorldSdk: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  getDb: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  uid: vi.fn(() => "mock-uid"),
  newWorldId: vi.fn(() => "w_00000000000000000000000001"),
  now: vi.fn(() => "2026-01-01T00:00:00.000Z"),
}));

useAbuseMocks();

describe("scope enforcement", () => {
  it("rejects a data:read key on a write route (import) with 403", async () => {
    const res = await request(
      READ_ONLY_TOKEN,
      "/worlds/w_00000000000000000000000001/import",
      {
        method: "POST",
        body: JSON.stringify({ data: "x", contentType: "text/plain" }),
      },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(body.error?.code).toBe("FORBIDDEN");
    expect(body.error?.message).toContain("data:write");
    expect(getWorldSdkMock).not.toHaveBeenCalled();
  });

  it("allows a data:read key on a read route (sparql)", async () => {
    const res = await request(
      READ_ONLY_TOKEN,
      "/worlds/w_00000000000000000000000001/sparql",
      {
        method: "POST",
        body: JSON.stringify({ query: "SELECT * WHERE { ?s ?p ?o }" }),
      },
    );
    expect(res.status).toBe(200);
  });

  const sparqlPath = "/worlds/w_00000000000000000000000001/sparql";
  const sparqlAs = (token: string, query: string) =>
    request(token, sparqlPath, {
      method: "POST",
      body: JSON.stringify({ query }),
    });

  // Every SPARQL UPDATE form; each must stay under SPARQL_MAX_QUERY_LENGTH.
  const updates = [
    "INSERT DATA { <urn:s> <urn:p> <urn:o> }",
    "DELETE DATA { <urn:s> <urn:p> <urn:o> }",
    "DELETE WHERE { ?s ?p ?o }",
    "INSERT { ?s <urn:p> 1 } WHERE { ?s ?p ?o }",
    "DELETE { ?s ?p ?o } INSERT { ?s ?p 1 } WHERE { ?s ?p ?o }",
    "CLEAR DEFAULT",
    "DROP ALL",
  ];

  it.each(updates)(
    "rejects SPARQL UPDATE from a data:read key before it runs: %s",
    async (query) => {
      const res = await sparqlAs(READ_ONLY_TOKEN, query);
      expect(res.status).toBe(403);
      const body = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      expect(body.error?.code).toBe("FORBIDDEN");
      expect(body.error?.message).toContain("data:write");
      expect(getWorldSdkMock).not.toHaveBeenCalled();
    },
  );

  it("allows ASK from a data:read key", async () => {
    const res = await sparqlAs(READ_ONLY_TOKEN, "ASK { ?s ?p ?o }");
    expect(res.status).toBe(200);
  });

  it.each(updates)(
    "allows SPARQL UPDATE from a data:write key: %s",
    async (query) => {
      const sparql = vi.fn().mockResolvedValue({ kind: "void" });
      getWorldSdkMock.mockResolvedValue({ sparql } as never);
      const res = await sparqlAs(FULL_TOKEN, query);
      expect(res.status).toBe(200);
      expect(sparql).toHaveBeenCalledOnce();
    },
  );

  it("allows SPARQL UPDATE from the admin key", async () => {
    getWorldSdkMock.mockResolvedValue({
      sparql: vi.fn().mockResolvedValue({ kind: "void" }),
    } as never);
    const res = await sparqlAs("test-admin-key", "DELETE WHERE { ?s ?p ?o }");
    expect(res.status).toBe(200);
  });

  it("rejects an unparseable query as INVALID_ARGUMENT without running it", async () => {
    const res = await sparqlAs(READ_ONLY_TOKEN, "DELETE THE WORLD");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("INVALID_ARGUMENT");
    expect(getWorldSdkMock).not.toHaveBeenCalled();
  });
});

describe("serialized RDF import (worlds-api#25)", () => {
  const path = "/worlds/w_00000000000000000000000001/import";
  const post = (body: Record<string, unknown>) =>
    request(FULL_TOKEN, path, { method: "POST", body: JSON.stringify(body) });
  const importMock = async () =>
    (
      (await getWorldSdkMock.mock.results[0]?.value) as {
        import: ReturnType<typeof vi.fn>;
      }
    ).import;

  it("imports Turtle when contentType is omitted (the documented default)", async () => {
    const res = await post({
      data: '@prefix ex: <http://example.org/> .\nex:a ex:name "A" ; ex:knows ex:b .',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: { quads: 2, chunks: 0 } });
    const imported = (await importMock()).mock.calls[0][0];
    expect(imported.source.kind).toBe("quads");
    expect(imported.source.quads).toHaveLength(2);
  });

  it("keeps TriG named graphs", async () => {
    const res = await post({
      contentType: "application/trig",
      data: '<http://example.org/g> { <http://example.org/s> <http://example.org/p> "o" . }',
    });
    expect(res.status).toBe(200);
    const imported = (await importMock()).mock.calls[0][0];
    expect(imported.source.quads[0].graph.value).toBe("http://example.org/g");
  });

  it("imports N-Triples, ignoring media-type parameters", async () => {
    const res = await post({
      contentType: "application/n-triples; charset=utf-8",
      data: '<http://example.org/s> <http://example.org/p> "o" .\n',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: { quads: 1, chunks: 0 } });
  });

  it("rejects malformed Turtle with 400, not a 500", async () => {
    const res = await post({ contentType: "text/turtle", data: "ex:a ex:b ." });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("INVALID_ARGUMENT");
  });

  it("enforces the quad cap on parsed Turtle", async () => {
    const lines = Array.from(
      { length: 11 },
      (_, i) => `<urn:s${i}> <urn:p> <urn:o${i}> .`,
    ).join("\n");
    const res = await post({ contentType: "text/turtle", data: lines });
    expect(res.status).toBe(413);
  });

  it("rejects JSON-LD, which is not parsed, naming the supported types", async () => {
    const res = await post({ contentType: "application/ld+json", data: "{}" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(body.error?.code).toBe("UNSUPPORTED_CONTENT_TYPE");
    expect(body.error?.message).toContain("text/turtle");
  });
});
