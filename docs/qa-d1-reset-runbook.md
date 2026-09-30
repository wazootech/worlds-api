# QA D1 reset runbook (world-identity cutover)

Operational runbook for [wazootech/worlds-api#95](https://github.com/wazootech/worlds-api/issues/95),
part of [wazootech/wazoo-api#71](https://github.com/wazootech/wazoo-api/issues/71).

**Scope: QA only.** Production databases are `worlds-api` and `wazoo-api`. Nothing in
this document applies to them, and no step here may be run against them.

Every claim below was verified against `main` and against live QA on 2026-09-29.
Commands are copy-pasteable. Run them from the repository root named in each step.

---

## 1. What is actually wrong today

Both QA services are live and healthy, and both correctly refuse to serve:

| Endpoint | `/health` | `/ready` |
| --- | --- | --- |
| `https://data-qa.wazoo.dev` | 200 | **503** |
| `https://api-qa.wazoo.dev` | 200 | **503** |

This is not a deployment failure. The code is correct; the **databases are
pre-cutover**. The readiness gates are naming the exact condition.

Observed QA state, read-only:

| | `worlds-api-qa` (data plane) | `wazoo-api-qa` (control plane) |
| --- | --- | --- |
| `worlds` primary key | `uid` | `uid` |
| `worlds` has `world_id` | no | yes, but not the key |
| `worlds` has `worlds_api_uid` | no | **yes** |
| `worlds` has `slug` | no | **yes** |
| rows | 95 worlds, 36 quads, 172 chunks, 167 api_keys | 96 users, 81 worlds, 5 usage_events, 27 tokens |

`wazoo-api-qa` is worse than the campaign record assumed: it carries **both**
`worlds_api_uid` and `slug`, which are exactly the columns
`assertWorldIdentitySchema` lists as forbidden.

Data-plane schema version in QA is **2**. The deployed SDK requires **4**.

## 2. The two schemas are authoritative — and they behave differently

This is the single most important thing to understand before running anything.

### `worlds-api-qa` — the service recreates what is **absent**, never repairs what is **wrong**

The control plane is created **by the service on first request per isolate**.
`src/app.ts:114-138` runs `ensureControlPlaneSchema` behind a `schemaInitialized`
flag that only latches on success, and `/ready` fails closed if the DDL throws.

> **Operational consequence:** you do **not** apply control-plane DDL by hand.
> **You must drop `worlds` and `api_keys` too.** This is the step most likely to be
> got wrong, and it was wrong in the first draft of this runbook. `CREATE TABLE IF
> NOT EXISTS` is a **no-op against a table that already exists**, so a pre-cutover
> `worlds` table is never repaired — the service creates the canonical schema only
> when the table is *absent*, and asserts forever when it is present-but-wrong.
>
> Observed on 2026-09-29 while executing this runbook: after dropping only the
> data-plane tables, `/ready` kept returning 503 with
> `missing columns: world_id; legacy columns present: uid; expected primary key
> world_id, found uid`. Dropping `worlds` and `api_keys` fixed it immediately.
>
> `schema.sql` does not exist in this repo and must not be reintroduced
> (it was deleted in merged #93 — [worlds-api#88](https://github.com/wazootech/worlds-api/issues/88)).

The data plane is the opposite. `CONTROL_PLANE_DDL` deliberately excludes it, and
`@worlds/cloudflare` **asserts rather than migrates**. In `ensureSchema()`:

```js
if (existingTables.rows.length > 0) {
  await assertD1SchemaCompatible(this.connection, { worldId: this.worldId });
}
// ...only then create
```

If the tables **exist**, the SDK validates them and throws. If they are **absent**,
it creates them from its own DDL and stamps the version. Its own error text says so:

> `Automatic schema creation is not an in-place migration. Apply the documented clean reset before serving traffic.`

`CREATE TABLE IF NOT EXISTS` cannot repair a pre-cutover table — the primary keys
changed (`quads.id` → `quads.quad_id`, `chunks.id` → `chunks.chunk_id`) and
`world_id` was added. A stale table is a permanent assertion failure.

> **Operational consequence:** `quads`, `chunks`, `chunks_fts` and
> `worlds_data_plane_schema` **must be dropped**, not emptied. The service recreates
> them on the next world-scoped request.

### `wazoo-api-qa` — nothing self-heals; you apply it by hand

This service has **no boot-time DDL** — `grep "CREATE TABLE" src/` returns nothing.
Its schema is hand-applied from [`schema.sql`](../../wazoo-api/schema.sql), per its
README. `/ready` only asserts; it never creates.

> **Operational consequence:** dropping tables here leaves you with **no database at
> all** until you apply `schema.sql` yourself. There is no self-healing safety net.

**`schema.sql` alone satisfies the readiness contract.** Verified by running the
real `assertWorldIdentitySchema` against a `schema.sql` database — it resolves, and
the observed pre-cutover shape correctly rejects. One gap: `schema.sql` does **not**
create `idx_worlds_world_id`.

## 3. Order of operations

Reset the **data plane first**, then the control plane.

`wazoo-api` calls `worlds-api` on world create and delete. If you reset the control
plane first, `wazoo-api` starts minting worlds against a data plane still in the
old shape, producing failures that are harder to read than the current clean 503.
Data-plane-first means the control plane is briefly unable to provision, which fails
loudly and locally.

Both are already failing closed, so nothing canonical is being served during the
window. No traffic coordination is required.

## 4. Pre-flight (read-only, safe to run now)

Run from `workspaces/wazootech/repos/worlds-api`:

```bash
npx wrangler d1 execute worlds-api-qa --remote --env qa \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" --json

npx wrangler d1 execute worlds-api-qa --remote --env qa \
  --command "PRAGMA table_info('worlds')" --json

npx wrangler d1 execute worlds-api-qa --remote --env qa \
  --command "SELECT * FROM worlds_data_plane_schema" --json
```

Run from `workspaces/wazootech/repos/wazoo-api`:

```bash
npx wrangler d1 execute wazoo-api-qa --remote --env qa \
  --command "PRAGMA table_info('worlds')" --json

npx wrangler d1 execute wazoo-api-qa --remote --env qa \
  --command "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM worlds) AS worlds, (SELECT COUNT(*) FROM usage_events) AS usage_events, (SELECT COUNT(*) FROM platform_api_tokens) AS tokens" --json
```

**Confirm before proceeding:** `worlds` PK is `uid` in both; `worlds_api_uid` and
`slug` present in `wazoo-api-qa`; data-plane version is 2, not 4. If any of these
have already changed, someone else has touched QA — stop and re-assess rather than
proceeding on stale assumptions.

## 5. The reset

### Step 1 — data plane (`worlds-api-qa`)

Drop the data-plane tables. Order does not matter here; there are no foreign keys
between them. The trigger names are `chunks_ai` and `chunks_ad` — the only two
`@worlds/cloudflare` 0.8.0 creates. Dropping `chunks_fts` removes its shadow tables
along with it.

```bash
cd workspaces/wazootech/repos/worlds-api
npx wrangler d1 execute worlds-api-qa --remote --env qa --command \
  "DROP TABLE IF EXISTS chunks_fts;
   DROP TRIGGER IF EXISTS chunks_ai;
   DROP TRIGGER IF EXISTS chunks_ad;
   DROP TABLE IF EXISTS chunks;
   DROP TABLE IF EXISTS quads;
   DROP TABLE IF EXISTS worlds_data_plane_schema;"
```

Then drop the control-plane tables as well. **They must be dropped, not left in
place** — see the note in §2; a pre-cutover `worlds` table is never repaired by the
service.

```bash
cd workspaces/wazootech/repos/worlds-api
npx wrangler d1 execute worlds-api-qa --remote --env qa --command \
  "DROP TABLE IF EXISTS api_keys;
   DROP TABLE IF EXISTS worlds;"
```

If `/ready` is still 503 after this, read the error body: it names the exact table
and column that failed. A `uid` primary key in that message means the drop did not
take effect.

### Step 2 — let the service rebuild the data plane

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://data-qa.wazoo.dev/ready
```

This one request initializes the control plane *and*, on the first world-scoped
call, the data plane. If it returns **503**, the error body names the table and
column that failed — read it before continuing.

To force the data-plane rebuild deterministically rather than waiting for organic
traffic, issue any authenticated world-scoped request (an import or a reindex).
`/ready` alone does **not** touch `quads`/`chunks`.

### Step 3 — control plane (`wazoo-api-qa`)

**Drop in FK-safe order.** This is the destructive step, and the order is not
cosmetic. `usage_events.world_id` is `ON DELETE SET NULL` and `world_limits.world_id`
is `ON DELETE CASCADE`, so dropping `worlds` while its children still exist and
foreign keys are active fires those actions. Verified locally: a naive
`DROP TABLE worlds` took `usage_events` from 1 row to 0.

Since we are discarding all QA data anyway, the simplest correct move is to drop
children first:

```bash
cd workspaces/wazootech/repos/wazoo-api
npx wrangler d1 execute wazoo-api-qa --remote --env qa --command \
  "DROP TABLE IF EXISTS usage_events;
   DROP TABLE IF EXISTS world_limits;
   DROP TABLE IF EXISTS worlds;
   DROP TABLE IF EXISTS deletion_requests;
   DROP TABLE IF EXISTS platform_api_tokens;
   DROP TABLE IF EXISTS admin_audit_events;
   DROP TABLE IF EXISTS beta_allowlist;
   DROP TABLE IF EXISTS rate_limit_entries;"
```

**Do not drop `users`.** It is not part of the world-identity cutover, its shape is
already correct, and `schema.sql` recreates it empty anyway — but leaving it costs
nothing and preserves the one table that is not implicated. (If you do drop it, the
result is identical after `schema.sql`, since no product requirement preserves QA
rows.)

### Step 4 — apply `schema.sql`

```bash
cd workspaces/wazootech/repos/wazoo-api
npx wrangler d1 execute wazoo-api-qa --remote --env qa --file schema.sql
```

### Step 5 — apply the unique index (required, not optional)

```bash
cd workspaces/wazootech/repos/wazoo-api
npx wrangler d1 execute wazoo-api-qa --remote --env qa --file migrations/2026-09-29-world-id-global-unique.sql
```

`/ready` **does not assert indexes** — it checks columns, primary keys, foreign keys
and NOT NULL only. So `/ready` will go green without this step and the omission will
not be caught. But `src/routes/worlds.ts:75` detects duplicate-ID conflicts by
matching `/UNIQUE constraint failed: (?:worlds\.world_id|...)/ `, so without the
index a cross-user duplicate world ID returns the wrong error instead of 409. This
is the same class of bug as `billing.ts:219`
([wazoo-api#73](https://github.com/wazootech/wazoo-api/issues/73)).

> **Trap — do not run the whole `migrations/` directory.** Only the 2026-09-29 file
> is safe here. `2026-09-25-world-id-canonical.sql` is historical (its own README
> says not to treat it as a step in the current cutover) and **fails** against a
> fresh `schema.sql`: verified locally, it errors with
> `no such column: worlds_api_uid`. `schema.sql` already has the post-cutover
> shape, so that migration has nothing to promote and refers to a column that no
> longer exists.

## 6. Post-flight verification

```bash
for h in data-qa api-qa; do
  printf "%-9s /health -> " "$h"
  curl -s -o /dev/null -w "%{http_code}" "https://$h.wazoo.dev/health"
  printf "  /ready -> "
  curl -s -o /dev/null -w "%{http_code}\n" "https://$h.wazoo.dev/ready"
done
```

**Pass condition: `/health` 200 and `/ready` 200 on both.**

Then confirm the shapes are genuinely canonical, not merely gate-passing:

```bash
cd workspaces/wazootech/repos/worlds-api
npx wrangler d1 execute worlds-api-qa --remote --env qa --command "PRAGMA table_info('worlds')" --json
npx wrangler d1 execute worlds-api-qa --remote --env qa --command "SELECT * FROM worlds_data_plane_schema" --json

cd ../../wazoo-api
npx wrangler d1 execute wazoo-api-qa --remote --env qa --command "PRAGMA table_info('worlds')" --json
npx wrangler d1 execute wazoo-api-qa --remote --env qa --command "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='worlds'" --json
```

Expect: `worlds` PK is `world_id` with no `uid`/`worlds_api_uid`/`slug`; data-plane
version is **4**; `idx_worlds_world_id` present.

## 7. What is destroyed, and how to get back

Destroyed, and **not** recoverable — this is a hard cut, approved for this campaign:

| Database | Lost |
| --- | --- |
| `worlds-api-qa` | 95 world rows, 167 API keys, 36 quads, 172 chunks |
| `wazoo-api-qa` | 96 users, 81 worlds, 27 platform tokens, 5 usage events |

**Data-plane rows are not orphaned — they are deleted.** The single-D1 model means
`quads`/`chunks` live in the same database, shared across all worlds and scoped by a
`world_id` column. There are no per-world databases, and no separate data-plane
instance to clean. Confirmed in `src/lib/purge.ts`: *"there's no external database to
destroy."*

### Restoring access

The reset empties `api_keys` and `platform_api_tokens`, so both services are
locked out until credentials are re-seeded. Both recovery paths use **secrets that
survive a database reset**, so neither requires the data being destroyed:

**`worlds-api`** — `WORLDS_ADMIN_KEY` exists as a QA secret
(`npx wrangler secret list --env qa`). `src/lib/auth.ts:60` accepts it as
`{ admin: true }`, bypassing `api_keys` entirely. Re-seed data-plane API keys with
`POST /v1/api-keys` using that key.

**`wazoo-api`** — `WAZOO_PLATFORM_ADMIN_TOKEN` exists as a QA secret. Re-seed with
`scripts/seed-admin-token-d1.mjs`, which requires `CLOUDFLARE_D1_DATABASE`:

```bash
cd workspaces/wazootech/repos/wazoo-api
CLOUDFLARE_D1_DATABASE=wazoo-api-qa \
  WAZOO_PLATFORM_ADMIN_TOKEN="<the existing QA secret value>" \
  node scripts/seed-admin-token-d1.mjs
```

> **Note on `--env qa`:** that script builds its own `wrangler d1 execute` invocation
> **without** `--env qa`, so a bare database name resolves against the top-level
> `[[d1_databases]]` binding. Its intended home is *inside* the OIDC-enabled CI job
> (see below), where `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are already
> exported; the hazard is running it from a laptop with a production-capable token
> present. If you do run it locally, verify the generated command or seed the row by
> hand with `--remote --env qa` and an explicit `sha256` hash of the token.

Cross-service auth survives: `wazoo-api` calls `worlds-api` with the
`WORLDS_API_ADMIN_KEY` secret, which is unaffected by the reset.

### Prefer Infisical for the re-seed and the smoke check

`wazoo-api` already fetches `WAZOO_PLATFORM_ADMIN_TOKEN` from **Infisical** (project
`wazoo`, environment `qa`) via OIDC in `.github/workflows/smoke-qa.yml`. That workflow
is `schedule` + `workflow_dispatch`, and `scripts/platform-smoke.mjs` consumes the
token for authenticated calls. So the re-seed and an authenticated post-reset
verification can both happen in CI, with no secret handled by hand.

Two caveats:

- **Infisical feeds the CI job, not the Worker.** No workflow runs `wrangler secret
  put` or a bulk secret sync; `deploy` is plain `wrangler deploy`. Worker secrets are
  still set in Cloudflare and survive a database reset — which is what this section
  relies on. Infisical is the source of truth for what *CI* can read.
- **`worlds-api` has no Infisical wiring** (zero references on its `main`). The
  data-plane `POST /v1/api-keys` re-seed is therefore still manual.

> **Check before you reset:** confirm the Infisical `qa` value of
> `WAZOO_PLATFORM_ADMIN_TOKEN` is identical to the value on the QA Worker secret.
> They must match for the smoke gate to authenticate after the re-seed. If they
> differ, decide which is authoritative and align them *first* — after a reset there
> is no data to fall back on.

## 8. Rollback position

**There is no rollback.** D1 has no point-in-time restore exposed to this workflow,
and the pre-cutover schema cannot be reconstructed from `schema.sql` — the QA
`worlds` table carried `uid` as PK plus `worlds_api_uid` and `slug`, and the rows
that populated them are gone.

This is acceptable **only because nothing is serving canonical traffic today**. Both
`/ready` endpoints are 503, so no user-visible capability is lost by proceeding.
That is the whole reason this reset is safe today, and it is also why it stops being
safe the moment `/ready` goes green somewhere.

If post-flight verification fails, the state is: schema dropped and partially
recreated, some tables present and some absent, **zero data**. Recovery is forward
only — re-run the reset from step 1. It is idempotent because every statement is
`IF NOT EXISTS` or `IF EXISTS`, and because the service rebuilds what it owns.

If `/ready` is still 503 after a completed reset, the error body names the failing
table and column. Read it before re-running anything; a repeat reset will not fix a
contract mismatch in the code, only a stale database.

## 9. Known gap this reset does not close

`wazoo-console@main` still sends `POST /v1/worlds` with a user-chosen `slug`, and
`@wazoo/client@0.2.0` still requires one
([wazoo-client-ts#22](https://github.com/wazootech/wazoo-client-ts/issues/22)).

Once `/ready` is green, the console will begin issuing requests that the cutover
code rejects. The client release chain must land before the console is used against
QA, or the first live request will fail at the create step.
