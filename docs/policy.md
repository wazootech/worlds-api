# Rate limit policy

This document defines the rate limit behavior applied to API resources. Limits
are enforced **per service account** (see [Identification](#identification))
using a **token bucket** algorithm.

## Mechanism

- **Algorithm:** Token bucket. Each identity has a bucket of tokens; one token
  is consumed per request. Tokens refill continuously over the **period** until
  the bucket is full (**limit** tokens).
- **Storage:** Bucket state is stored in the `rate_limits` table (LibSQL).
- **Response:** When the limit is exceeded, the server responds with
  `429 Too Many Requests`. When enforced, `X-RateLimit-Limit`,
  `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers may be sent.

## Identification

Rate limits are **scoped per service account**. Each service account has its own
token buckets; one account's usage does not affect another's.

- **Admin:** Identity is the admin API key. Admin requests are not subject to
  rate limits.
- **Authenticated (service account):** Identity is the service account
  associated with the request. Each service account is limited independently.
- **Unauthenticated:** Not rate limited (requests are rejected with 401).

---

## Rate limits by resource

All limits are expressed as **maximum requests per minute** unless noted. The
**period** for the token bucket is 60 000 ms; **limit** is the value in the
table.

| Resource                    | Method   | Path / scope                                                | Feature ID                | Limit (req/min) | Notes                                                                                 |
| --------------------------- | -------- | ----------------------------------------------------------- | ------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| **Organizations**           |          |                                                             |                           |                 |                                                                                       |
| List organizations          | GET      | `/v1/organizations`                                         | `organizations_list`      | 120             | Paginated list.                                                                       |
| Create organization         | POST     | `/v1/organizations`                                         | `organizations_create`    | 20              |                                                                                       |
| Get organization            | GET      | `/v1/organizations/:organization`                           | `organizations_get`       | 120             |                                                                                       |
| Update organization         | PUT      | `/v1/organizations/:organization`                           | `organizations_update`    | 30              |                                                                                       |
| Delete organization         | DELETE   | `/v1/organizations/:organization`                           | `organizations_delete`    | 20              |                                                                                       |
| **Invites**                 |          |                                                             |                           |                 |                                                                                       |
| List invites                | GET      | `/v1/invites`                                               | `invites_list`            | 120             |                                                                                       |
| Create invite               | POST     | `/v1/invites`                                               | `invites_create`          | 30              |                                                                                       |
| Get invite                  | GET      | `/v1/invites/:code`                                         | `invites_get`             | 120             |                                                                                       |
| Delete invite               | DELETE   | `/v1/invites/:code`                                         | `invites_delete`          | 30              |                                                                                       |
| **Worlds**                  |          |                                                             |                           |                 |                                                                                       |
| List worlds                 | GET      | `/v1/worlds`                                                | `worlds_list`             | 120             | Scoped by organization.                                                               |
| Get world                   | GET      | `/v1/worlds/:world`                                         | `worlds_get`              | 120             |                                                                                       |
| Create world                | POST     | `/v1/worlds`                                                | `worlds_create`           | 20              | Allocates resources.                                                                  |
| Update world                | PUT      | `/v1/worlds/:world`                                         | `worlds_update`           | 30              |                                                                                       |
| Delete world                | DELETE   | `/v1/worlds/:world`                                         | `worlds_delete`           | 20              |                                                                                       |
| Download world              | GET      | `/v1/worlds/:world/download`                                | `worlds_download`         | 60              | Larger response; moderate limit.                                                      |
| **SPARQL**                  |          |                                                             |                           |                 |                                                                                       |
| Service description         | GET      | `/v1/worlds/:world/sparql` (no query)                       | `sparql_describe`         | 60              |                                                                                       |
| SPARQL query (SELECT, etc.) | GET/POST | `/v1/worlds/:world/sparql`                                  | `sparql_query`            | 60              | Read-only; may be expensive.                                                          |
| SPARQL update               | POST     | `/v1/worlds/:world/sparql`                                  | `sparql_update`           | 30              | Writes; lower limit.                                                                  |
| **Search**                  |          |                                                             |                           |                 |                                                                                       |
| Semantic search             | GET      | `/v1/search`                                                | `semantic_search`         | 30              | Uses embeddings and hybrid search. Supports `subjects` and `predicates` query params. |
| **Service accounts**        |          |                                                             |                           |                 |                                                                                       |
| List service accounts       | GET      | `/v1/organizations/:organization/service-accounts`          | `service_accounts_list`   | 120             | Paginated; scoped by organization.                                                    |
| Create service account      | POST     | `/v1/organizations/:organization/service-accounts`          | `service_accounts_create` | 20              |                                                                                       |
| Get service account         | GET      | `/v1/organizations/:organization/service-accounts/:account` | `service_accounts_get`    | 120             |                                                                                       |
| Update service account      | PUT      | `/v1/organizations/:organization/service-accounts/:account` | `service_accounts_update` | 30              |                                                                                       |
| Delete service account      | DELETE   | `/v1/organizations/:organization/service-accounts/:account` | `service_accounts_delete` | 20              |                                                                                       |
| **Logs**                    |          |                                                             |                           |                 |                                                                                       |
| List logs                   | GET      | `/v1/worlds/:world/logs`                                    | `logs_list`               | 120             | Paginated; scoped by world.                                                           |
| **Metrics**                 |          |                                                             |                           |                 |                                                                                       |
| Query metrics               | GET      | `/v1/metrics`                                               | `metrics_query`           | 120             | Read metering data.                                                                   |

---

Events below should trigger an insert into the log (world-scoped; each entry has
`world_id`). Use **LogsService** from `databases/world/logs/service.ts` with the
**world** database client (e.g. `databaseManager.get(worldId).database`) to add
entries. **Level** is the log level (`info`, `warn`, `error`, `debug`).

| Event            | When / trigger                     | World ID source | Level | Notes                                    |
| ---------------- | ---------------------------------- | --------------- | ----- | ---------------------------------------- |
| World created    | After world is created             | New world `id`  | info  | Include label in metadata.               |
| World updated    | After world metadata is updated    | `:world`        | info  | Include changed fields in metadata.      |
| World deleted    | Before world is deleted            | `:world`        | info  | Audit trail.                             |
| World downloaded | After successful download          | `:world`        | info  | Optional; may be noisy.                  |
| SPARQL query     | After SPARQL SELECT/CONSTRUCT etc. | `:world`        | info  | Include query type or size in metadata.  |
| SPARQL update    | After SPARQL INSERT/DELETE etc.    | `:world`        | info  | Writes; include update type in metadata. |

---

## Implementation audit

Checked against route implementations under `src/server/routes/v1/`.

**Implemented (match policy):**

| Resource         | Method | Path                                                        | Implemented |
| ---------------- | ------ | ----------------------------------------------------------- | ----------- |
| Organizations    | GET    | `/v1/organizations`                                         | ✓           |
| Organizations    | POST   | `/v1/organizations`                                         | ✓           |
| Organizations    | GET    | `/v1/organizations/:organization`                           | ✓           |
| Organizations    | PUT    | `/v1/organizations/:organization`                           | ✓           |
| Organizations    | DELETE | `/v1/organizations/:organization`                           | ✓           |
| Invites          | GET    | `/v1/invites`                                               | ✓           |
| Invites          | POST   | `/v1/invites`                                               | ✓           |
| Invites          | GET    | `/v1/invites/:code`                                         | ✓           |
| Invites          | DELETE | `/v1/invites/:code`                                         | ✓           |
| Worlds           | GET    | `/v1/worlds`                                                | ✓           |
| Worlds           | GET    | `/v1/worlds/:world`                                         | ✓           |
| Worlds           | POST   | `/v1/worlds`                                                | ✓           |
| Worlds           | PUT    | `/v1/worlds/:world`                                         | ✓           |
| Worlds           | DELETE | `/v1/worlds/:world`                                         | ✓           |
| Worlds           | GET    | `/v1/worlds/:world/download`                                | ✓           |
| SPARQL           | GET    | `/v1/worlds/:world/sparql`                                  | ✓           |
| SPARQL           | POST   | `/v1/worlds/:world/sparql`                                  | ✓           |
| Search           | GET    | `/v1/search`                                                | ✓           |
| Service accounts | GET    | `/v1/organizations/:organization/service-accounts`          | ✓           |
| Service accounts | POST   | `/v1/organizations/:organization/service-accounts`          | ✓           |
| Service accounts | GET    | `/v1/organizations/:organization/service-accounts/:account` | ✓           |
| Service accounts | PUT    | `/v1/organizations/:organization/service-accounts/:account` | ✓           |
| Service accounts | DELETE | `/v1/organizations/:organization/service-accounts/:account` | ✓           |
| Logs             | GET    | `/v1/worlds/:world/logs`                                    | ✓           |
| Metrics          | GET    | `/v1/metrics`                                               | ✓           |

**Missing (in policy, not implemented):**

None. All v1 routes from policy are implemented.

**Rate limiting:** The policy table defines per-resource limits above. The
codebase has a `rateLimiter` middleware and `RateLimitsService`. Limits are
applied per-route.

**Usage metering:** To record usage for billing/analytics, call
**MetricsService.record()** (`databases/core/metrics/service.ts`) with a
**MetricRecord**: `service_account_id` (identifies the service account),
**feature_id** (use the Feature ID from the table above, e.g. `semantic_search`
for GET `/v1/search`), `quantity`, and optional `metadata`. Search currently
meters with `feature_id: "semantic_search"`; other routes can be wired the same
way.

**Logs (world DB):** Log entries are stored per-world. The **LOGS** table and
indexes are defined in `databases/world/logs/queries.sql`. The
**initializeWorldDatabase** in `databases/world/init.ts` creates the logs table
and indexes in each world database.

---

## Summary

- **Read-heavy (list, get):** 120/min — organizations, invites, worlds, service
  accounts, logs, metrics.
- **Write (create, update, delete):** 20–30/min — organizations, invites,
  worlds, service accounts.
- **Sensitive or expensive (SPARQL update, search):** 10–30/min.
- **Large or compute-heavy (download, SPARQL query, service description):**
  60/min.
- **Telemetry:** Server-side usage ingest is not subject to API rate limits.

When multiple endpoints are used by the same service account, each endpoint may
use its own bucket (keyed by resource or path) or a shared bucket per service
account; implementation may choose per-route or global buckets as long as the
above limits are not exceeded for that resource.
