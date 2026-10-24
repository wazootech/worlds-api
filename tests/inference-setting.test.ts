import { beforeEach, describe, expect, it } from "vitest";
import { CONTROL_PLANE_DDL } from "../src/lib/d1-schema";
import {
  getInferenceSetting,
  loadInferenceSettings,
  setInferenceSetting,
} from "../src/lib/inference";
import {
  CreateWorldRequestSchema,
  InferenceSettingSchema,
  UpdateWorldRequestSchema,
} from "../src/lib/schemas";
import { createSqliteD1, type SqliteD1 } from "./helpers/sqlite-d1";

const A = "w_00000000000000000000000001";
const B = "w_00000000000000000000000002";

let db: SqliteD1;
let env: any;

beforeEach(async () => {
  db = createSqliteD1();
  for (const ddl of CONTROL_PLANE_DDL) await db.prepare(ddl).run();
  env = { DB: db };
  for (const [id, ns] of [
    [A, "ns1"],
    [B, "ns2"],
  ]) {
    await db
      .prepare(
        "INSERT INTO worlds (world_id, namespace, display_name) VALUES (?, ?, ?)",
      )
      .bind(id, ns, id)
      .run();
  }
});

describe("world inference setting", () => {
  it("is absent (off) until set", async () => {
    expect(await getInferenceSetting(env, A)).toBeNull();
  });

  it("round-trips and replaces the whole setting", async () => {
    await setInferenceSetting(env, A, {
      enabled: true,
      graphs: "union",
      maxAssertedQuads: 500,
    });
    expect(await getInferenceSetting(env, A)).toEqual({
      enabled: true,
      graphs: "union",
      maxAssertedQuads: 500,
    });

    await setInferenceSetting(env, A, { enabled: false });
    expect(await getInferenceSetting(env, A)).toEqual({ enabled: false });
  });

  it("lists settings per namespace and skips deleted worlds", async () => {
    await setInferenceSetting(env, A, { enabled: true });
    await setInferenceSetting(env, B, { enabled: true });
    expect([...(await loadInferenceSettings(env)).keys()].sort()).toEqual([
      A,
      B,
    ]);
    expect([...(await loadInferenceSettings(env, "ns1")).keys()]).toEqual([A]);
    await db
      .prepare("UPDATE worlds SET state = 'deleted' WHERE world_id = ?")
      .bind(A)
      .run();
    expect([...(await loadInferenceSettings(env)).keys()]).toEqual([B]);
  });
});

describe("inference request schema", () => {
  it("accepts the setting on create and update", () => {
    const inference = { enabled: true, graphs: "per-graph" as const };
    expect(CreateWorldRequestSchema.parse({ inference }).inference).toEqual(
      inference,
    );
    expect(UpdateWorldRequestSchema.parse({ inference }).inference).toEqual(
      inference,
    );
  });

  it("rejects unknown graph modes and non-positive guards", () => {
    expect(
      InferenceSettingSchema.safeParse({ enabled: true, graphs: "x" }).success,
    ).toBe(false);
    expect(
      InferenceSettingSchema.safeParse({ enabled: true, maxAssertedQuads: 0 })
        .success,
    ).toBe(false);
    expect(InferenceSettingSchema.safeParse({}).success).toBe(false);
  });
});
