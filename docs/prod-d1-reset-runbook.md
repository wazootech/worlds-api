# Prod D1 reset runbook (worlds-api)

Operational runbook for the **production** cutover of `worlds-api`, the production
adaptation of [`qa-d1-reset-runbook.md`](./qa-d1-reset-runbook.md).

**Scope: the production `worlds-api` D1 database only.** This runbook does **not**
cover `wazoo-api`'s production database — see [§7](#7-the-wazoo-api-coupling-is-a-hard-gate),
which is a separate and still-unresolved scope.

> **This procedure destroys data.** It drops every table in the production
> `worlds-api` database. There is no backup step in it. Proceed only after the
> gates in §2 are satisfied.

Every claim below was verified read-only against live production on **2026-10-04**.

---

## 1. What is wrong with production today

Production is serving an **8-day-old build on a pre-cutover database**. Both halves
are true and they compound.

| | Production today | Target | Action |
| --- | --- | --- | --- |
| `worlds` primary key | `uid` | `world_id` | drop and recreate |
| `worlds` legacy columns | — | `uid` / `worlds_api_uid` / `slug` forbidden | recreated clean |
| `api_keys` primary key | `uid` | `uid` | schema already correct, **rows discarded** |
| data-plane schema marker | version 2 (v1, v2 rows) | version 4 | dropped, re-stamped |
| `https://data.wazoo.dev/health` | 200 | — | live |
| `https://data.wazoo.dev/ready` | **404** | 200 | route absent on the pre-cutover build |

A `404` on `/ready` rather than a `503` is diagnostic: the route does not exist on
the deployed build at all. Production is not failing closed on a readiness gate —
it simply predates the gate. That is why deploying the merged code against the
current database would break silently rather than loudly.

Row counts at time of writing: **12 worlds, 3 quads, 21 chunks, 25 api_keys**
(16 namespace-scoped, 9 world-linked, 0 revoked), 2 schema-marker rows.

**All of this data is approved for discard**, including the 25 `api_keys` rows.

### Why the admin key survives the wipe

Dropping `api_keys` does **not** lock the service out. In `src/lib/auth.ts:60`,
`authorize()` compares the bearer token against `env.WORLDS_API_ADMIN_KEY`
**before** it ever touches the database:

```ts
if (env.WORLDS_API_ADMIN_KEY && token === env.WORLDS_API_ADMIN_KEY) {
  return { admin: true };
}
```

The canonical key is an environment binding pushed by the Infisical → Cloudflare
Secret Sync, not a row. Authenticated `/worlds` continues to work immediately
after the reset. The 25 non-admin keys stop working, which is the intended
consequence of discarding them.

> `WORLDS_ADMIN_KEY` (no `_API_`) is still bound on the production Worker and is
> **never read** by `auth.ts`. It is inert. It is not in scope for this runbook;
> removing it needs separate approval.

---

## 2. Pre-flight (read-only)

Run from the repository root:

```bash
cd repos/worlds-api

npx wrangler d1 execute worlds-api --remote --command \
  "SELECT sql FROM sqlite_master WHERE name IN ('worlds','api_keys')" --json

npx wrangler d1 execute worlds-api --remote --command \
  "SELECT * FROM worlds_data_plane_schema ORDER BY version" --json

npx wrangler d1 execute worlds-api --remote --command \
  "SELECT (SELECT COUNT(*) FROM worlds) worlds, (SELECT COUNT(*) FROM quads) quads,
          (SELECT COUNT(*) FROM chunks) chunks, (SELECT COUNT(*) FROM api_keys) api_keys" --json

npx wrangler secret list
```

**Confirm all of these before proceeding:**

- [ ] `worlds` primary key is `uid`, and `world_id` is **not** the key
- [ ] `worlds_data_plane_schema` tops out at **version 2**, not 4
- [ ] `WORLDS_API_ADMIN_KEY` is present in `wrangler secret list`
- [ ] `data.wazoo.dev/health` is 200 and `/ready` is 404

If `/ready` already returns 200, or the marker is already version 4, **someone else
has reset production since this runbook was written.** Stop and re-assess rather
than proceeding on stale assumptions — a second blind drop destroys freshly
recreated worlds.

---

## 3. Why the tables must be dropped, not emptied

This is the failure mode that cost the QA runbook a cycle, so it is worth stating
plainly.

`ensureControlPlaneSchema` in `src/lib/d1-schema.ts` is guarded by a
`schemaInitialized` flag and runs `CREATE TABLE IF NOT EXISTS`. **That statement is
a no-op against a table that already exists.** The service creates the canonical
schema only when a table is *absent*; when a table is *present but wrong* it
asserts forever and `/ready` fails closed. Observed on QA on 2026-09-29: dropping
only the data-plane tables left `/ready` returning 503 with
`missing columns: world_id; legacy columns present: uid`.

The data plane behaves the same way but in the opposite direction.
`@worlds/cloudflare` **asserts rather than migrates** — if `quads`/`chunks` exist
it validates them and throws; if they are absent it creates them from its own DDL
and stamps the version. Its own error text says:

> Automatic schema creation is not an in-place migration. Apply the documented
> clean reset before serving traffic.

So: **drop `worlds`, `api_keys`, `quads`, `chunks`, `chunks_fts`, and
`worlds_data_plane_schema`.** Do not `DELETE FROM`. Do not hand-apply
`CONTROL_PLANE_DDL` — the service owns both planes and will rebuild them itself.

> `schema.sql` does not exist in this repo and must not be reintroduced; it was
> deleted in merged #93 ([worlds-api#88](https://github.com/wazootech/worlds-api/issues/88)).

---

## 4. The reset

### Step 1 — drop every table

One command, both planes. There are no foreign keys between these tables, so order
is not load-bearing. Dropping `chunks_fts` removes its shadow tables
(`chunks_fts_config`, `_content`, `_data`, `_docsize`, `_idx`) with it. The only
triggers `@worlds/cloudflare` 0.8.0 creates are `chunks_ai` and `chunks_ad`.

```bash
cd repos/worlds-api

npx wrangler d1 execute worlds-api --remote --command \
  "DROP TRIGGER IF EXISTS chunks_ai;
   DROP TRIGGER IF EXISTS chunks_ad;
   DROP TABLE IF EXISTS chunks_fts;
   DROP TABLE IF EXISTS chunks;
   DROP TABLE IF EXISTS quads;
   DROP TABLE IF EXISTS worlds_data_plane_schema;
   DROP TABLE IF EXISTS api_keys;
   DROP TABLE IF EXISTS worlds;"
```

**This is the irreversible step.** Everything after it is repair.

### Step 2 — let the service rebuild

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://data.wazoo.dev/ready
```

`/ready` alone initialises the **control plane** only. The **data plane**
(`quads`, `chunks`, `chunks_fts`) is created on the first request that actually
touches RDF or the index. To force it deterministically instead of waiting for
organic traffic, create a throwaway world and reindex it:

```bash
BASE=https://data.wazoo.dev
AUTH="Authorization: Bearer $WORLDS_API_ADMIN_KEY"

# 1. Create a throwaway world. CreateWorldRequest has no required fields.
#    The identifier comes back as `id`, NOT `worldId`.
WID=$(curl -s -X POST "$BASE/worlds" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"displayName":"cutover-rebuild-probe"}' | jq -r '.id')

# 2. Force the data-plane rebuild. Reindex takes no request body.
curl -s -X POST "$BASE/worlds/$WID/reindex" -H "$AUTH" | jq .

# 3. Confirm the data plane now exists at version 4
npx wrangler d1 execute worlds-api --remote --command \
  "SELECT * FROM worlds_data_plane_schema" --json
```

`POST /worlds/{worldId}/reindex` is the reliable trigger because it is
world-scoped **and** index-touching; `POST /worlds` alone only creates the
control-plane row. If reindex returns an error, read its body — it names the
table and column that failed.

> `$WID` is **server-minted** and looks like `w_<uuidv4>`. World IDs are validated
> against `/^w_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`,
> so a hand-written UUID is rejected with a `400 ZodError` on `worldId` — a
> validation error, **not** an auth error. If you see a `400` with `ZodError`,
> check the ID format before suspecting the reset.

Leave the throwaway world in place or delete it with
`DELETE /worlds/$WID`; either is fine, since all pre-cutover worlds were already
discarded.

After a successful rebuild, confirm the shapes are what the code expects:

```bash
npx wrangler d1 execute worlds-api --remote --command \
  "PRAGMA table_info('worlds')" --json

npx wrangler d1 execute worlds-api --remote --command \
  "SELECT * FROM worlds_data_plane_schema" --json
```

Expected: `worlds` has `world_id` as `pk=1, notnull=1`; the marker reads
**version 4**.

---

## 5. Deploy

The reset alone is not the cutover. The merged code is what makes `world_id` the
required primary key, and production is still running the pre-cutover build.

`deploy-prod` is a **job inside `.github/workflows/ci.yml`**, not a separate
workflow file. It runs only on `workflow_dispatch`, `needs: verify`, and invokes
`npm run deploy` with no `--env`, which targets production.

```bash
gh workflow run ci.yml --repo wazootech/worlds-api --ref main
gh run watch --repo wazootech/worlds-api
```

There is **no `health-prod` job.** Post-deploy verification is manual — §6.

---

## 6. Verification

```bash
# 1. Liveness
curl -s -o /dev/null -w "%{http_code}\n" https://data.wazoo.dev/health     # expect 200

# 2. Readiness — the route the old build did not have
curl -s https://data.wazoo.dev/ready                                       # expect {"status":"ready"}

# 3. Authenticated /worlds with the canonical key (bearer, not X-API-Key)
curl -s -H "Authorization: Bearer $WORLDS_API_ADMIN_KEY" \
  https://data.wazoo.dev/worlds                                            # expect 200 {"worlds":[]}

# 4. The retired header style must be rejected
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-API-Key: $WORLDS_API_ADMIN_KEY" \
  https://data.wazoo.dev/worlds                                            # expect 401
```

`{"worlds":[]}` is the **correct** result, not a failure: all 12 worlds were
discarded. A populated list means the reset did not take.

Check 4 is the bearer-cutover proof. If it returns 200, the old header path is
still live.

### Schema assertions

```bash
npx wrangler d1 execute worlds-api --remote --command \
  "SELECT name FROM pragma_table_info('worlds') WHERE name IN ('uid','worlds_api_uid','slug')" --json
# expect [] — no forbidden columns

npx wrangler d1 execute worlds-api --remote --command \
  "SELECT version FROM worlds_data_plane_schema" --json
# expect 4
```

---

## 7. The wazoo-api coupling is a hard gate

**Read this before §4 Step 1.** Production `wazoo-api` is **also** pre-cutover, and
this runbook does not fix it. Verified read-only on 2026-10-04:

| Production `wazoo-api` | Value |
| --- | --- |
| `worlds` primary key | `uid` |
| forbidden columns present | `worlds_api_uid`, `slug` |
| `https://api.wazoo.dev/ready` | **404** (pre-cutover build) |
| rows | 28 users, 12 worlds, 6 `platform_api_tokens` |

`wazoo-api` main's `schema.sql` requires `world_id TEXT NOT NULL PRIMARY KEY` and
carries neither forbidden column. So the two services are on opposite sides of the
same cutover.

**Why this matters even though this runbook only resets `worlds-api`:** `wazoo-api`
calls `worlds-api` on world create and delete. Resetting `worlds-api` to `world_id`
while `wazoo-api` still writes `uid`/`worlds_api_uid` produces a cross-service
mismatch. Data-plane-first ordering (as in the QA runbook §3) does not apply here
because only one plane is being touched.

`wazoo-api` is **worse off than `worlds-api` for a reset**: it has no boot-time
DDL (`grep "CREATE TABLE" src/` returns nothing), so dropping tables leaves you
with no database until `schema.sql` is applied by hand. There is no self-healing
safety net.

**Its data is also not covered by the discard approval.** That approval covered
`worlds-api`'s 12 worlds, 3 quads, and 21 chunks. It says nothing about 28 users,
6 API tokens, or the Stripe customer/subscription IDs in that table. Discarding
those is a different decision and needs its own approval.

**Gate:** confirm the intended prod cutover boundary before running §4 Step 1 (the
irreversible drop).

- [ ] `worlds-api`-only cutover, `wazoo-api` prod deploy deferred — confirm
      `wazoo-api` production does not create worlds during the window
- [ ] Both services cut over together — this is a **larger** scope than the
      handoff describes, needs its own wazoo-api prod runbook and its own data
      approval, and is not this runbook

---

## 8. `WORLDS_API_ADMIN_KEY` consolidation (decided, not yet executable)

`WORLDS_API_ADMIN_KEY` is duplicated inside the shared Infisical project
`3cc346dd-abe7-4e38-98d2-cbefba344c03`, in **both** environments, with **identical
values** (hash-compared 2026-10-04):

| Path | Environments | Consumers |
| --- | --- | --- |
| `/` | qa, prod | `wazoo-api` Worker (prod+qa), `wazoo-console` Worker (prod+qa) |
| `/worlds-api` | qa, prod | `worlds-api` Worker sync (prod+qa) |

**Decision: `/` is the single authority; `/worlds-api` gets deleted.**

The reason is consumer count and blast radius. `wazoo-api` genuinely needs this
key — it is the credential `wazoo-api` presents to `worlds-api`
(`wazoo-api/src/lib/worlds-client.ts:16`, `auth: env.WORLDS_API_ADMIN_KEY`), so
the root copy backs **four** Worker secret syncs. The `/worlds-api` copy backs only
the Worlds Worker syncs. Consolidating toward `/` removes the narrower consumer.

> Do **not** reverse this. Deleting the root copy instead would strip the source
> for four syncs, and because deletion protection is enabled
> (`disableSecretDeletion: true`) the Workers would **not** fail — they would
> silently freeze at their last-pushed value and every later rotation would fail to
> propagate without an error. That is the worst failure shape available for this
> key.

### Order of operations — the delete is the last step, not the first

1. **Repoint** the `worlds-api` Worker secret sync (prod and QA) from
   `/worlds-api` to `/`.
2. **Trigger** one sync for each and confirm `status: succeeded`.
3. **Verify** the Workers still hold a valid key — an authenticated
   `GET /worlds` returns 200 on both `data.wazoo.dev` and `data-qa.wazoo.dev`.
4. **Only then** delete `WORLDS_API_ADMIN_KEY` at path `/worlds-api` in qa and prod.
5. **Re-verify** step 3 again. A rotation test is the real proof: rotate the root
   value, trigger a sync, confirm the new value authenticates.

> **The prod and QA syncs do not behave the same. Measured 2026-10-04:** writing a
> new value to the QA paths propagated to `worlds-api-qa` within seconds with no
> manual trigger. The identical write to the prod paths did **not** propagate to
> `worlds-api` after 5+ minutes of polling, and no error was raised anywhere. So
> "the vault has the right value" proves nothing on its own in prod.
>
> Consequences for this procedure:
>
> - **Step 2 is not optional on prod.** A prod sync must be triggered explicitly.
>   Do not assume step 3 passed because the vault reads back correctly.
> - **Step 5's rotation test only detects a broken source path on QA.** Run it on
>   both environments, and on prod confirm propagation by observing the Worker
>   authenticate with the new value — not by reading the vault.
> - **Never complete step 4 on prod without a successful step 3 on prod first.**
>   Deleting the `/worlds-api` source while the prod Worker still reads from it
>   strands the binding: with deletion protection on, the Worker keeps a frozen
>   stale value and every later rotation fails silently.

### Status: blocked on step 1

Steps 1–2 require Cloudflare secret-sync configuration access. The available
`wrangler` OAuth token carries `workers_scripts(write)` but no secret-sync scope;
`GET /workers/services/<name>/environments/<env>/secrets` returns only
`{name, type}` with no source-path metadata, and the sync endpoints return
`7003 No route`. **The sync's source path is therefore unverified by direct read**
— the table above is derived from the handoff plus observed Worker bindings, not
from the sync config itself.

Whoever has the Infisical ↔ Cloudflare integration session should confirm each
sync's configured source path before step 1. Do not run step 4 on the assumption
that the table is right.

---

## 9. Rollback

There is no rollback. The data is gone and no backup was taken.

The **schema** is recoverable — re-running §4 Step 1 and §4 Step 2 reproduces
it. The **data** is not. If the reset turns out to have been wrong, the recovery
path is recreating worlds through the API, not restoring rows.

This is the accepted tradeoff: the pre-cutover data has no forward migration path,
and the service asserts rather than migrates, so a reset is the only supported
route to the target schema.

---

## 10. Related

- QA counterpart: [`qa-d1-reset-runbook.md`](./qa-d1-reset-runbook.md) — its §1
  "what is wrong today" table is **stale**; QA was reset on 2026-09-30 and is green.
- Tracking: [wazootech/workspace#152](https://github.com/wazootech/workspace/issues/152)
- DDL source of truth: `src/lib/d1-schema.ts` (`CONTROL_PLANE_DDL`)
- Data-plane objects are owned by `@worlds/cloudflare`
- [`worlds-api#91`](https://github.com/wazootech/worlds-api/pull/91) (canonical
  world identity) is **open, draft, and currently CONFLICTING**. The reset in this
  runbook is deliberately scoped so it does not depend on #91 merging.
