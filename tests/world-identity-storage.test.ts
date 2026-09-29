import { describe, expect, it } from "vitest";
import { CONTROL_PLANE_DDL } from "../src/lib/d1-schema";

describe("World identity storage", () => {
  it("uses world_id for World identity without renaming API-key identity", () => {
    const worlds = CONTROL_PLANE_DDL.find((ddl) =>
      ddl.includes("CREATE TABLE IF NOT EXISTS worlds ("),
    );
    const apiKeys = CONTROL_PLANE_DDL.find((ddl) =>
      ddl.includes("CREATE TABLE IF NOT EXISTS api_keys ("),
    );

    expect(worlds).toContain("world_id TEXT PRIMARY KEY");
    expect(apiKeys).toContain("uid TEXT PRIMARY KEY");
    expect(apiKeys).toContain("world_id TEXT");
    expect(apiKeys).not.toContain("api_key_id");
  });
});
