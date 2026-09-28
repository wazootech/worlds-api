import { describe, expect, it } from "vitest";
import {
  ApiKeyCreateRequestSchema,
  ApiKeyCreateResponseSchema,
  ApiKeyResourceSchema,
  CreateWorldRequestSchema,
  ImportRequestSchema,
  SearchRequestSchema,
  SparqlRequestSchema,
  UpdateWorldRequestSchema,
  WorldResourceSchema,
  worldIdParam,
} from "../src/lib/schemas";

describe("CreateWorldRequestSchema", () => {
  it("accepts a minimal create world request", () => {
    const result = CreateWorldRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts with all optional fields", () => {
    const result = CreateWorldRequestSchema.safeParse({
      displayName: "My World",
      embeddingModel: "tfjs-universal-sentence-encoder",
      chunkSize: 1000,
      topK: 20,
      minScore: 0.0,
    });
    expect(result.success).toBe(true);
  });

  it("ignores caller-chosen world IDs, slugs, and storage URLs", () => {
    const result = CreateWorldRequestSchema.safeParse({
      worldId: "w_00000000-0000-4000-8000-000000000001",
      slug: "caller-chosen-slug",
      databaseUrl: "d1://example.com",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.worldId).toBeUndefined();
      expect(result.data.slug).toBeUndefined();
      expect(result.data.databaseUrl).toBeUndefined();
    }
  });

  it("strips a client-supplied namespace", () => {
    const result = CreateWorldRequestSchema.safeParse({
      namespace: "my-namespace",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.namespace).toBeUndefined();
    }
  });
});

describe("UpdateWorldRequestSchema", () => {
  it("accepts valid update with displayName", () => {
    const result = UpdateWorldRequestSchema.safeParse({
      displayName: "Updated Name",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty update body (fields validated at route level)", () => {
    const result = UpdateWorldRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects empty displayName", () => {
    const result = UpdateWorldRequestSchema.safeParse({
      displayName: "",
    });
    expect(result.success).toBe(false);
  });

  it("strips a public namespace field", () => {
    const result = UpdateWorldRequestSchema.safeParse({
      displayName: "Name",
      namespace: "my-namespace",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.namespace).toBeUndefined();
    }
  });
});

describe("SearchRequestSchema", () => {
  it("accepts valid search request", () => {
    const result = SearchRequestSchema.safeParse({
      query: "find me",
    });
    expect(result.success).toBe(true);
  });

  it("accepts with optional limit and strips public namespace", () => {
    const result = SearchRequestSchema.safeParse({
      query: "find me",
      limit: 10,
      namespace: "my-namespace",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.namespace).toBeUndefined();
    }
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

  it("rejects limit above the 100 contract cap", () => {
    const result = SearchRequestSchema.safeParse({
      query: "find me",
      limit: 101,
    });
    expect(result.success).toBe(false);
  });

  it("strips topK from the public contract", () => {
    const result = SearchRequestSchema.safeParse({
      query: "find me",
      topK: 50,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topK).toBeUndefined();
    }
  });

  it("accepts include/exclude filter with subject/predicate/graph lists", () => {
    const result = SearchRequestSchema.safeParse({
      query: "find me",
      filter: {
        include: { predicates: ["http://schema.org/name"] },
        exclude: { graphs: ["urn:private"] },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filter?.include?.predicates).toEqual([
        "http://schema.org/name",
      ]);
      expect(result.data.filter?.exclude?.graphs).toEqual(["urn:private"]);
    }
  });

  it("rejects filter with non-string subject lists", () => {
    const result = SearchRequestSchema.safeParse({
      query: "find me",
      filter: { include: { subjects: [42] } },
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

  it("strips a public namespace field", () => {
    const result = SparqlRequestSchema.safeParse({
      query: "SELECT * WHERE { ?s ?p ?o }",
      namespace: "my-namespace",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.namespace).toBeUndefined();
    }
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
      worldId: "w_00000000-0000-4000-8000-000000000001",
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
  it("accepts a canonical world resource with only id", () => {
    const result = WorldResourceSchema.safeParse({
      id: "w_00000000-0000-4000-8000-000000000001",
      displayName: "My World",
      state: "active",
      storage: "d1",
      embeddingModel: "tfjs-universal-sentence-encoder",
      chunkSize: 1000,
      topK: 20,
      minScore: 0.0,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("name");
      expect(result.data).not.toHaveProperty("worldId");
    }
  });

  it("accepts with optional deleteTime and expireTime", () => {
    const result = WorldResourceSchema.safeParse({
      id: "w_00000000-0000-4000-8000-000000000001",
      displayName: "My World",
      state: "deleted",
      storage: "d1",
      embeddingModel: "tfjs-universal-sentence-encoder",
      chunkSize: 1000,
      topK: 20,
      minScore: 0.0,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
      deleteTime: "2026-01-15T00:00:00.000Z",
      expireTime: "2026-02-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid storage value", () => {
    const result = WorldResourceSchema.safeParse({
      id: "w_00000000-0000-4000-8000-000000000001",
      displayName: "My World",
      state: "active",
      storage: "invalid-storage",
      embeddingModel: "tfjs-universal-sentence-encoder",
      chunkSize: 1000,
      topK: 20,
      minScore: 0.0,
      createTime: "2026-01-01T00:00:00.000Z",
      updateTime: "2026-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("worldIdParam", () => {
  it("accepts worlds-api UUID IDs", () => {
    expect(
      worldIdParam.safeParse({
        worldId: "w_00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(true);
  });

  it("rejects uppercase UUIDs", () => {
    expect(
      worldIdParam.safeParse({
        worldId: "w_00000000-0000-4000-8000-00000000000A",
      }).success,
    ).toBe(false);
  });

  it("rejects user-chosen slugs", () => {
    expect(worldIdParam.safeParse({ worldId: "my-world" }).success).toBe(false);
  });
});

describe("API key record id", () => {
  it("exposes id on created and listed API-key records", () => {
    const resource = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "test",
      namespace: "ns",
      scopes: ["data:read"],
      createTime: "2026-01-01T00:00:00.000Z",
    };
    const listed = ApiKeyResourceSchema.safeParse(resource);
    const created = ApiKeyCreateResponseSchema.safeParse({
      ...resource,
      token: "wzw_test",
      worldId: null,
    });

    expect(listed.success).toBe(true);
    expect(created.success).toBe(true);
    if (listed.success) expect(listed.data).not.toHaveProperty("apiKeyId");
    if (created.success) expect(created.data).not.toHaveProperty("apiKeyId");
  });

  it("constrains referenced world IDs to the canonical format", () => {
    const worldId = "w_00000000-0000-4000-8000-000000000001";
    const resource = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "test",
      namespace: "ns",
      scopes: ["data:read"],
      createTime: "2026-01-01T00:00:00.000Z",
    };

    expect(
      ApiKeyResourceSchema.safeParse({ ...resource, worldId }).success,
    ).toBe(true);
    expect(
      ApiKeyResourceSchema.safeParse({ ...resource, worldId: "my-world" })
        .success,
    ).toBe(false);
    expect(
      ApiKeyCreateResponseSchema.safeParse({
        ...resource,
        token: "wzw_test",
        worldId,
      }).success,
    ).toBe(true);
    expect(
      ApiKeyCreateResponseSchema.safeParse({
        ...resource,
        token: "wzw_test",
        worldId: "my-world",
      }).success,
    ).toBe(false);
  });
});
