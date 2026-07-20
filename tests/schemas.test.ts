import { describe, expect, it } from "vitest";
import {
  CreateWorldRequestSchema,
  UpdateWorldRequestSchema,
  SearchRequestSchema,
  SparqlRequestSchema,
  ImportRequestSchema,
  ApiKeyCreateRequestSchema,
  WorldResourceSchema,
} from "../src/lib/schemas";

describe("CreateWorldRequestSchema", () => {
  it("accepts a valid create world request", () => {
    const result = CreateWorldRequestSchema.safeParse({
      worldId: "my-world",
      databaseUrl: "libsql://example.com",
    });
    expect(result.success).toBe(true);
  });

  it("accepts with all optional fields", () => {
    const result = CreateWorldRequestSchema.safeParse({
      worldId: "my-world",
      displayName: "My World",
      databaseUrl: "libsql://example.com",
      databaseAuthToken: "token123",
      namespace: "my-namespace",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing worldId", () => {
    const result = CreateWorldRequestSchema.safeParse({
      databaseUrl: "libsql://example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty worldId", () => {
    const result = CreateWorldRequestSchema.safeParse({
      worldId: "",
      databaseUrl: "libsql://example.com",
    });
    expect(result.success).toBe(false);
  });

  it("accepts without databaseUrl (optional)", () => {
    const result = CreateWorldRequestSchema.safeParse({
      worldId: "my-world",
    });
    expect(result.success).toBe(true);
  });
});

describe("UpdateWorldRequestSchema", () => {
  it("accepts valid update with displayName", () => {
    const result = UpdateWorldRequestSchema.safeParse({
      displayName: "Updated Name",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing displayName", () => {
    const result = UpdateWorldRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty displayName", () => {
    const result = UpdateWorldRequestSchema.safeParse({
      displayName: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional namespace", () => {
    const result = UpdateWorldRequestSchema.safeParse({
      displayName: "Name",
      namespace: "my-namespace",
    });
    expect(result.success).toBe(true);
  });
});

describe("SearchRequestSchema", () => {
  it("accepts valid search request", () => {
    const result = SearchRequestSchema.safeParse({
      query: "find me",
    });
    expect(result.success).toBe(true);
  });

  it("accepts with optional limit and namespace", () => {
    const result = SearchRequestSchema.safeParse({
      query: "find me",
      limit: 10,
      namespace: "my-namespace",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing query", () => {
    const result = SearchRequestSchema.safeParse({
      limit: 10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty query", () => {
    const result = SearchRequestSchema.safeParse({
      query: "",
    });
    expect(result.success).toBe(false);
  });

  it("defaults limit to 20", () => {
    const result = SearchRequestSchema.safeParse({
      query: "find me",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it("rejects negative limit", () => {
    const result = SearchRequestSchema.safeParse({
      query: "find me",
      limit: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe("SparqlRequestSchema", () => {
  it("accepts valid SPARQL request", () => {
    const result = SparqlRequestSchema.safeParse({
      query: "SELECT * WHERE { ?s ?p ?o }",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing query", () => {
    const result = SparqlRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty query", () => {
    const result = SparqlRequestSchema.safeParse({
      query: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional namespace", () => {
    const result = SparqlRequestSchema.safeParse({
      query: "SELECT * WHERE { ?s ?p ?o }",
      namespace: "my-namespace",
    });
    expect(result.success).toBe(true);
  });
});

describe("ImportRequestSchema", () => {
  it("accepts valid import request", () => {
    const result = ImportRequestSchema.safeParse({
      data: "some rdf data",
    });
    expect(result.success).toBe(true);
  });

  it("defaults contentType to text/turtle", () => {
    const result = ImportRequestSchema.safeParse({
      data: "some rdf data",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contentType).toBe("text/turtle");
    }
  });

  it("rejects missing data", () => {
    const result = ImportRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty data", () => {
    const result = ImportRequestSchema.safeParse({
      data: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts with explicit contentType", () => {
    const result = ImportRequestSchema.safeParse({
      data: "[{}, {}, {}]",
      contentType: "application/json",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contentType).toBe("application/json");
    }
  });
});

describe("ApiKeyCreateRequestSchema", () => {
  it("accepts valid API key creation request", () => {
    const result = ApiKeyCreateRequestSchema.safeParse({
      namespace: "my-namespace",
    });
    expect(result.success).toBe(true);
  });

  it("accepts with optional worldId and name", () => {
    const result = ApiKeyCreateRequestSchema.safeParse({
      namespace: "my-namespace",
      worldId: "my-world",
      name: "My Key",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing namespace", () => {
    const result = ApiKeyCreateRequestSchema.safeParse({
      name: "My Key",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty namespace", () => {
    const result = ApiKeyCreateRequestSchema.safeParse({
      namespace: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("WorldResourceSchema", () => {
  it("accepts valid world resource", () => {
    const result = WorldResourceSchema.safeParse({
      name: "namespaces/ns/worlds/my-world",
      uid: "w_abc123",
      namespace: "ns",
      worldId: "my-world",
      displayName: "My World",
      state: "active",
      storage: "libsql-per-world",
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts with optional deleteTime and expireTime", () => {
    const result = WorldResourceSchema.safeParse({
      name: "namespaces/ns/worlds/my-world",
      uid: "w_abc123",
      namespace: "ns",
      worldId: "my-world",
      displayName: "My World",
      state: "deleted",
      storage: "libsql-per-world",
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
      deleteTime: "2026-01-15T00:00:00.000Z",
      expireTime: "2026-02-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid storage value", () => {
    const result = WorldResourceSchema.safeParse({
      name: "namespaces/ns/worlds/my-world",
      uid: "w_abc123",
      namespace: "ns",
      worldId: "my-world",
      displayName: "My World",
      state: "active",
      storage: "invalid-storage",
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});
