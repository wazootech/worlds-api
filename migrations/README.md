# Platform ID clean reset

This is a destructive, no-preservation cutover. The reset files drop only application-owned tables; they do not copy, translate, or restore rows. Never run them in CI, a preview deployment, or a deploy workflow.

## QA order

Before any reset, stop all QA API traffic and writers, confirm the Cloudflare account and each exact database name against `wrangler.toml`, and record approval for the destructive QA reset. Keep traffic stopped until compatible deployments and smoke tests succeed. The live QA databases are `worlds-api-qa` and `wazoo-api-qa`.

From the Worlds API cutover checkout, reset the data-plane database:

```bash
npx wrangler d1 execute worlds-api-qa --remote --file migrations/2026-09-27-platform-id-clean-reset.sql
```

From the Wazoo API cutover checkout, reset and recreate the platform schema:

```bash
npx wrangler d1 execute wazoo-api-qa --remote --file migrations/2026-09-27-platform-id-clean-reset.sql
npx wrangler d1 execute wazoo-api-qa --remote --file schema.sql
```

The Worlds API worker creates its `worlds` and `api_keys` control-plane tables on the first non-health, non-OpenAPI request (including `/ready`) or scheduled event. `@worlds/cloudflare` creates `quads`, `chunks`, the full-text index, and the schema-version table when a data-plane SDK instance initializes. After the approved QA deployment, exercise world creation and a write/read round trip before treating those tables as ready.

Run the full QA E2E suite and verify the returned `world.id` is the same `w_<UUIDv4>` value used in the `worldId` path parameter and stored as `world_id`. Confirm the owner predicate still blocks cross-user access. Verify the D1 primary keys with `PRAGMA table_info` and confirm `PRAGMA foreign_key_check` returns no rows in the Wazoo API database.

## Production

Repeat the same reset only after the complete QA E2E gate passes and Ethan explicitly approves the production reset and deployment. Never infer production readiness from a local test, a schema check, or a successful QA world-create request alone.
