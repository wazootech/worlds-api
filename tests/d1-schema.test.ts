import { describe, expect, it } from "vitest";
import { CONTROL_PLANE_DDL } from "../src/lib/d1-schema";

describe("world identity DDL", () => {
  it("stores the world primary key as world_id without changing API-key IDs", () => {
    expect(CONTROL_PLANE_DDL[0]).toContain("world_id TEXT PRIMARY KEY");
    expect(CONTROL_PLANE_DDL[0]).not.toContain("uid TEXT PRIMARY KEY");
    expect(CONTROL_PLANE_DDL[3]).toContain("uid TEXT PRIMARY KEY");
  });
});
