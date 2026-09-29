import { describe, expect, it } from "vitest";
import app from "../src/app";

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

describe("POST /worlds/:worldId/reindex endpoint", () => {
  it("rejects request without authorization token", async () => {
    const res = await app.request(
      "/worlds/w_123e4567-e89b-42d3-a456-426614174000/reindex",
      { method: "POST" },
      {},
      executionCtx,
    );
    expect(res.status).toBe(401);
  });
});
