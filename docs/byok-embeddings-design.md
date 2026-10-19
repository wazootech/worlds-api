# Design: hybrid search in production via customer BYOK embeddings

Design for [wazootech/worlds-api#1](https://github.com/wazootech/worlds-api/issues/1).
**Status: accepted (D1-D7, D9, D10); v1 implemented; BYOK is the only embedding
source and has no mode switch (it needs a KEK and a per-namespace credential).
Deviations from this document are listed in the implementing
PR: the credential routes use scope `embeddings:admin`; embedding state lives in
the new `world_embedding_state` table and budgets in `embedding_usage` (no
columns were added to `worlds`, so no ALTER or reset is needed); imports degrade
to keyword-only on budget exhaustion rather than failing with 429.**

Facts below were read from `main` at `9e82799` (worlds-api),
`wazootech/worlds-cloudflare`, and `wazootech/wazoo-api` on 2026-10-12. Anything
not observed is marked **(unverified)**.

## 1. Where we are

- Both Vectorize indexes exist and are bound (`worlds-api-v1-metadata`,
  `worlds-api-qa-v1-metadata`): 1536 dims, cosine, `world_id` filterable
  (`wrangler.toml`). One shared index per environment; worlds are separated by
  a `world_id` metadata filter inside `VectorizeVectorSearchIndex`, which
  `createCloudflareWorldsSdk` refuses to build without a `worldId`.
- `getWorldSdk` (`src/lib/world-db.ts`) threads `vectorize` but never an
  `embeddingService`, so the engine runs keyword-only. Setting
  the old embedding-provider env var threw on purpose (since removed).
- `worlds.embedding_model` exists (default `tfjs-universal-sentence-encoder`,
  `d1-schema.ts`) and is settable on create and PATCH, but nothing reads it.
  The PATCH description says "changing the embedding model triggers a reindex";
  **the handler does not** (`routes/worlds.ts`, it updates the column and
  clears the SDK cache). That doc/code divergence is fixed by this design.
- `vectorDimensions` defaults to 1536 in `createCloudflareWorldsSdk` and is also
  the width the D1 schema and search query builders are built with.
- Reindex already reports `completed_with_vector_errors` plus a `vectorSync`
  object (`enabled`, `attempted`, `upserted`, `failedUpserts`,
  `embeddingFailures`, `staleDeleteFailures`, `errors`).
- Search already reports the mode that ran (`hybrid`/`semantic`/`keyword`/
  `fallback`) and `scoreType`; the contract work from #30 is done.
- On engine failure to embed a query, search degrades to keyword (logged), it
  does not 5xx. Good; keep it.
- Rate limiting is an in-memory per-key token bucket per isolate
  (`src/app.ts`). It is not a cost control (see #39).
- Control plane (`wazoo-api`) owns users, namespaces and token minting and
  calls worlds-api with `WORLDS_API_ADMIN_KEY`. worlds-api is the data plane and
  has no user concept; its tenancy unit is `namespace`.

## 2. BYOK shape

### 2.1 Where the provider key lives

Workers secrets are per-Worker, not per-tenant, so per-customer keys cannot be
secrets. Options:

| Option                                                                      | Pros                                                                             | Cons                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| A. Envelope-encrypted in worlds-api D1, KEK as a Worker secret              | Data plane is self-sufficient; search needs no control-plane hop; fits namespace | We hold customer secrets at rest; KEK rotation is our job                               |
| B. Pass-through: control plane stores it, sends `X-Embedding-Key` per request | No key at rest in worlds-api                                                     | Every search/import caller must carry it; world tokens used directly can't; key in flight on every call, higher log-leak surface |
| C. Platform-managed embeddings only (Workers AI), no BYOK                   | No customer secrets                                                              | Not what #1 asks for; cost lands on us                                                  |

**Recommendation: A.** Search and import are called by customers with world
tokens, not through wazoo-api, so B cannot work for the main path.

Concrete shape:

- New D1 table `embedding_credentials` in `CONTROL_PLANE_DDL`
  (`src/lib/d1-schema.ts`, the single source of truth; no second schema file):
  `credential_id`, `namespace`, `provider`, `ciphertext`, `iv`, `kek_version`,
  `fingerprint` (first 8 hex of SHA-256 of the key, for support), `last4`,
  `create_time`, `rotate_time`, `revoke_time`.
- AES-256-GCM, AAD = `namespace|credential_id|provider` so a ciphertext cannot
  be replayed under another namespace.
- KEK is a Worker secret `EMBEDDING_KEK_V1` (versioned name), delivered by the
  existing Infisical Cloudflare Workers Secret Sync, registered in
  `secret-registry.md`. Rotation: add `_V2`, decrypt-with-old/encrypt-with-new
  lazily on use, retire `_V1` after a sweep. Sync deletion protection is
  already on, so a vault edit cannot silently remove the old KEK.
- Credential is **per namespace**, referenced by worlds
  (`worlds.embedding_credential_id`, nullable). Per-world keys are a strict
  superset we can add later; per-namespace matches billing and rotation reality.
- Write-only: the API never returns the key, only `fingerprint`/`last4`.

### 2.2 Rotation and revocation

- Rotate = `PUT` a new key; same `credential_id`, `rotate_time` bumped, cache
  of decrypted key (isolate memory, TTL <= 60 s) is bounded by that TTL.
  Vectors are not invalidated: the model did not change.
- Revoke = `DELETE`: ciphertext zeroed, `revoke_time` set. Worlds using it drop
  to keyword-only (mode `keyword`) and report `embeddingStatus: "no_credential"`.
  Existing vectors stay and are not queried (a query vector cannot be built).
- Provider-side `401/403` on use auto-marks the credential `invalid` after N
  consecutive failures so we stop hammering and surface it in the console.

### 2.3 Who may set it

New scope `embeddings:admin`, granted only to admin tokens and namespace-scoped
tokens minted by the control plane for a namespace owner. It is **not** in the
default `[data:read, data:write]` grant (`src/lib/auth.ts`), so existing world
tokens and API keys cannot read or replace it. Endpoint is namespace-level, so
a world-scoped token (`auth.worldId` set) is refused regardless of scope.
Related: #20 (real scopes at issuance).

## 3. Provider and model allowlist; dimensions

The index width is immutable and fixed at 1536 in all three places (Vectorize
index, `vectorDimensions`, D1 builders). Options:

| Option                                    | Verdict                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| One shared index, fix at 1536, allowlist models that can emit 1536 | **Recommended for v1.** Zero infra change; the indexes exist and are bound                                |
| One index per dimension (e.g. 768, 1536)  | Needs new bindings (a deploy), per-dimension routing, and D1 builders keyed per world; defer until demand  |
| One index per world                       | Unbounded bindings, impossible with static `wrangler.toml` bindings; rejected                              |

Allowlist (static map in code, not customer-defined strings):

| Provider | Model                    | Native dims | Admissible at 1536                         |
| -------- | ------------------------ | ----------- | ------------------------------------------ |
| openai   | `text-embedding-3-small` | 1536        | yes, default                               |
| openai   | `text-embedding-3-large` | 3072        | yes, request `dimensions: 1536` (pinned)   |
| openai   | `text-embedding-ada-002` | 1536        | yes, legacy; allow but do not advertise    |
| openrouter | `openai/text-embedding-3-small` | 1536 | yes, request `dimensions: 1536` (pinned) |
| openrouter | `openai/text-embedding-3-large` | 3072 | yes, request `dimensions: 1536` (pinned) |

OpenRouter is a vetted second provider (OpenAI-compatible endpoint at a fixed
host, no customer-supplied URL). Its allowlist ids are `openrouter/<vendor>/<model>`;
a namespace holds one credential per provider, and a world's model decides which
one is used. Only the OpenAI models are listed for now because OpenRouter
forwards `dimensions` for them; **(unverified)** until the QA round-trip runs
against OpenRouter.

Anything else (Cohere, Voyage, Gemini, local models) is a later row, admitted
only if it can emit exactly 1536 and we pin the parameter. **(unverified)**
Per-provider dimension parameters should be re-checked against provider docs
when each row is added. Two different models that both emit 1536 are *not*
vector-compatible; see section 4.

`embedding_model` becomes a validated enum of `provider/model` ids. The
existing default `tfjs-universal-sentence-encoder` is 512-dim and not
admissible; worlds holding it are keyword-only and the value is reported as
`embeddingStatus: "unconfigured"` rather than an error. Provider base URLs are
hard-coded per provider (section 7); no customer-supplied URL in v1.

## 4. Model change, failures, cost

### 4.1 Model change

Vectors from different models are meaningless against each other inside one
`world_id` partition. So a change must be a state transition, not a column
write:

1. PATCH with a new `embeddingModel` validates against the allowlist, requires
   a usable credential, writes `embedding_model` and sets
   `embedding_state = "stale"` (new column), and clears the SDK cache.
2. While `stale`, search runs **keyword-only** and says so (`mode: "keyword"`),
   rather than mixing old vectors with new-model query vectors.
3. `POST /worlds/{id}/reindex` embeds with the new model, deletes stale ids
   (the engine already tracks `staleDeleteFailures`) and sets `embedding_state
   = "ready"` only when `vectorSync` has zero failures.
4. PATCH does **not** auto-reindex: reindex spends the customer's money and,
   being synchronous (#26), can exceed Worker limits on large worlds. The PATCH
   response returns `embeddingState: "stale"` so clients can prompt. This also
   corrects the endpoint description that currently over-promises.

Cost estimate surfaced before spend: `GET /worlds/{id}` (or a dry-run reindex)
returns `chunkCount`, so the console can show "~N chunks will be embedded".

### 4.2 Failures

- `completed_with_vector_errors` keeps meaning: D1/FTS complete, vectors not.
  State stays `stale` (or `partial` after the first successful upsert); search
  keeps serving hybrid for vectors that exist, with keyword covering the rest.
- Provider `429`: bounded retry with backoff inside a batch; remaining chunks
  counted as `embeddingFailures`. Never loop unbounded.
- Provider `401/403`: stop the run immediately, report one error, mark
  credential `invalid` (2.2). Do not burn the whole batch on a dead key.
- `vectorSync.errors` strings must be provider-error classes, not raw bodies
  (section 7).

### 4.3 Rate limits, cost attribution, abuse

The existing bucket is per-isolate and keyed on token, so it neither bounds
total spend nor survives isolate churn. Needed before prod:

- **Embedding budget per namespace** in D1 (daily counters of embedded chunks
  and query embeds), enforced before the provider call, returning `429
  EMBEDDING_BUDGET_EXCEEDED` for writes/reindex and degrading to keyword for
  search. Builds on #17 (usage counters) and #39 (per-namespace aggregation).
- **Cap per reindex call** (max chunks) until #26 makes reindex asynchronous;
  excess returns a resumable cursor or a clear 4xx.
- **Attribution**: counters are tagged `namespace`, `world_id`, `operation`
  (`import`, `reindex`, `query`), exported through the #17 read surface so
  wazoo-api can show customers their own spend. Cost is on the customer's key,
  but a leaked world token can still burn it, which is why query embeds are
  budgeted too.

## 5. API surface and downstream order

worlds-api (OpenAPI regenerated via `pnpm run sync:openapi`, never hand-edited):

| Change                                                                                        | Kind          |
| --------------------------------------------------------------------------------------------- | ------------- |
| `PUT/GET/DELETE /namespaces/{ns}/embedding-credential` (GET returns metadata only)           | additive      |
| `WorldResource`: `embeddingStatus` (`unconfigured`/`no_credential`/`stale`/`ready`/`partial`/`invalid`) | additive      |
| `embeddingModel` validated as enum `provider/model` on create and PATCH                      | **breaking-ish**: free strings now 400 |
| Reindex response: unchanged shape; `vectorSync` already present                              | none          |
| New error codes: `EMBEDDING_BUDGET_EXCEEDED`, `EMBEDDING_CREDENTIAL_INVALID`                | additive      |

Merge order (a green `verify` is not evidence of live behavior; `deploy-qa`
only runs after merge, so say so in each PR):

1. `worlds-api` (data plane, includes the secret/KEK provisioning below).
2. `worlds-client-ts`, regenerate and **publish** (clients are consumed as
   published packages; a merged client is not usable until published).
3. `wazoo-client-ts`, then `wazoo-console` and `wazoo-cli`.
4. `wazoo-api` proxies the credential endpoints and enforces who may call them.

Console UX (wazoo-console, namespace settings): one "Embeddings" panel with
provider, model, key field (write-only, shows `last4` + fingerprint), status
badge from `embeddingStatus`, a "Reindex N chunks" button with the cost
estimate, and a banner on stale worlds explaining search is keyword-only until
reindex. The search UI should display the returned `mode`; it must not imply
semantic ranking when `mode` is `keyword` or `fallback`.

## 6. Rollout and acceptance

1. **Dark**: land schema, credential API, KEK provisioning. Without a KEK the
   credential store fails closed and search stays keyword-only.
2. **QA**: provision `EMBEDDING_KEK_V1` on `data-qa.wazoo.dev`. Needs a QA-only
   provider key (human-provisioned; see decision D8).
3. **Canary world** in QA, then a staff-owned namespace in prod once the prod
   KEK exists and QA is green for a full smoke cycle.
4. **Prod general**: announce. There is no switch to flip; a namespace opts in
   by storing a credential.

Kill switch: unsetting the var returns every world to keyword-only without a
data change (vectors stay; reindex repairs drift).

Acceptance (extends `wazoo-api/scripts/qa-roundtrip.mjs`, `roundtrip:qa`, which
today only asserts a keyword hit and prints `mode`):

- Search result for the marker has `mode === "hybrid"` and `scoreType` not
  `unranked`.
- Reindex returns `status: "completed"` and `vectorSync.enabled === true`,
  `failedUpserts === 0`, `embeddingFailures === 0`.
- A paraphrase query containing none of the marker's tokens returns the
  document (proves vectors, not FTS).
- Cross-world isolation: user B's world search never returns A's chunks
  (the shared index relies solely on the `world_id` filter).
- Revoke credential -> next search is `mode: "keyword"`, status 200.

## 7. Security review checklist

- [ ] **SSRF**: provider base URLs are a code constant per allowlisted provider;
      no customer-supplied host or path; redirects not followed; response size
      capped; `fetch` only to those hosts.
- [ ] **Key logging**: key never in logs, `console.error` of caught errors
      (`app.onError` logs the raw error; provider SDK errors can embed
      request headers), analytics, or `vectorSync.errors`. Scrub by class.
- [ ] **Error leakage**: provider bodies are mapped to fixed messages; the
      client never sees provider request ids tied to our account.
- [ ] **At rest**: AAD binding, per-record IV, KEK only in Worker secret,
      decrypted key never cached past TTL nor written to D1/KV/R2.
- [ ] **At the edge**: write-only API; `GET` returns fingerprint/last4;
      `Authorization` and any key header excluded from the rate-limit key and
      request logging.
- [ ] **Tenancy**: namespace taken from the token, never from the body; world
      tokens refused; test mirrors the existing cross-namespace tests.
- [ ] **Export/import**: credentials excluded from world export; imports cannot
      set `embedding_credential_id`.
- [ ] **Prompt/data egress**: customers' chunk text is sent to their chosen
      provider. State this in the console and docs; it is their data going to
      their own account, but it is egress.
- [ ] **Deletion**: deleting a namespace deletes its credentials
      (`/admin/namespaces/{ns}/delete`) and its vectors (`deleteByIds`, ids
      enumerated from D1 chunk rows), verified in a test.

## 8. Decisions

**Status (2026-10-12): D1–D7, D9 and D10 accepted as recommended.** D8 stays
open: it needs a human to provision a capped QA-only provider key into
Infisical `qa`; until then CI uses a fake provider and the live acceptance test
(`roundtrip:qa` expecting `hybrid` and `vectorSync.enabled: true`) is not run.
The table keeps the options considered; the bold entry is the decision.

| #  | Decision                       | Options                                                                          | Recommendation                                              |
| -- | ------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| D1 | Where the key lives            | A envelope in D1 + KEK secret; B pass-through; C platform-managed only           | **A**                                                       |
| D2 | Credential granularity         | per namespace; per world                                                         | **per namespace**; per-world later if asked                 |
| D3 | Dimension strategy             | fixed 1536 shared index; per-dimension indexes; per-world                        | **fixed 1536** for v1                                       |
| D4 | v1 model allowlist             | OpenAI small only; OpenAI small + large(pinned 1536) + ada; add other providers  | **small + large(pinned) ; ada accepted, not advertised**    |
| D5 | Model change behavior          | auto-reindex; mark stale + keyword until explicit reindex                        | **stale + explicit reindex**, estimate shown first          |
| D6 | Spend guard before prod        | none (rely on provider caps); per-namespace budget in D1; block on #26/#39       | **per-namespace budget in D1** is a prod gate; #26 not a gate if reindex is chunk-capped |
| D7 | `embeddingModel` validation    | keep free string; enum now (breaking for odd values)                             | **enum**; existing non-allowlisted values read as `unconfigured` |
| D8 | QA provider key for acceptance | Ethan provisions a QA-only capped OpenAI key into Infisical `qa`; use a fake provider in CI only | **QA-only capped key** (I cannot create it; secrets are a human boundary) |
| D9 | Platform fallback for customers without a key | none; Workers AI with a platform key (our cost, different dims, needs a second index) | **none** for v1                                             |
| D10 | Customer-supplied provider base URL (Azure/OpenAI-compatible) | no; yes behind allowlisted hosts | **no** for v1 (SSRF surface)                              |

Out of scope here: async reindex (#26), per-namespace rate limiting (#39),
usage read surface (#17), and search-quality measurement (#2). Each is
referenced above where it gates a decision.
