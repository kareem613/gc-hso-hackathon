# Application Data Access Specification & Pitfalls

Datasets in this architecture are staged to Cloud Storage (`./scripts/upload-datasets.sh`), ingested into **AlloyDB for PostgreSQL** by the one-shot `hso-ingest` Kubernetes Job (`./scripts/ingest-datasets.sh`), and served to the browser via `/api/*` JSON routes (`api/server.js`). Use these guidelines to avoid common ingestion, SQL, and UI bottlenecks as you build out the data layer.

## 1. End-to-End Data Flow

```
./datasets/* ──upload-datasets.sh──▶ gs://<PROJECT_ID>-datasets/
                                              │  GCS FUSE mount (/datasets)
                                              ▼
                                    Job/hso-ingest (api/ingest.js + api/schema.sql)
                                              │  127.0.0.1:5432 via alloydb-auth-proxy (IAM auth)
                                              ▼
                                    AlloyDB (hso-alloydb / hso-primary)
                                              ▲  127.0.0.1:5432 via alloydb-auth-proxy (IAM auth)
                                              │
Browser (src/) ──GET /api/*──▶ nginx ──proxy_pass──▶ hso-api (api/server.js, :8080)
```

- **Shared DB helpers (`api/lib/db.js`):** Pre-configures a `pg.Pool` (`pool`), `waitForDb()`, `withTransaction(fn)`, `bulkInsert(client, table, columns, rows)`, and `BIGINT` (`OID 20`) parsing to JavaScript numbers.
- **Passwordless IAM authentication:** `hso-app-sa` binds via Workload Identity to `hso-app-gsa` (`roles/alloydb.client`, `roles/alloydb.databaseUser`, `roles/serviceusage.serviceUsageConsumer`), logging in as `hso-app-gsa@<PROJECT_ID>.iam`.

## 2. Ingestion & Schema Design (`api/schema.sql`, `api/ingest.js`)

- **Make `schema.sql` and `ingest.js` idempotent:** New dataset files may arrive mid-exercise, requiring `./scripts/upload-datasets.sh` and `./scripts/ingest-datasets.sh` (after `./scripts/build-image.sh` when `api/` code changes) to run multiple times.
  - Use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` in `api/schema.sql`.
  - Reload each feed inside `withTransaction(...)` (`TRUNCATE <table> RESTART IDENTITY` followed by `bulkInsert(...)`) so partial failures roll back cleanly and re-runs never duplicate rows.
- **Treat every dataset file in `DATASETS_DIR` as optional:** A missing file (`err.code === "ENOENT"`) should log cleanly and leave that feed's table empty (`0` rows) rather than crashing the entire ingest Job.
- **Normalize mixed timestamps once to indexed Unix `epoch BIGINT` seconds:** Raw feeds often mix integer Unix seconds and ISO-8601 strings (UTC or fixed-offset local time). Parse timestamps during ingestion, store canonical integer `epoch BIGINT` columns with B-tree indexes (`(epoch)` or `(series_id, epoch)`), and keep `JSONB` columns for flexible extra attributes or coordinate arrays.
- **Deduplicate `Date.parse()` on high-frequency CSVs:** Multi-device telemetry CSVs frequently repeat the exact same ISO-8601 timestamp string across dozens of consecutive rows. Caching `{ lastRawTimestamp, lastEpoch }` during parsing eliminates >99% of `Date.parse()` calls across tens of thousands of rows.

## 3. API Contract & Frontend Reader Boundary (`api/server.js`, `src/`)

- **Isolate `/api/*` calls behind a narrow frontend reader abstraction:** Keep `fetch("/api/...")` calls out of map rendering and DOM event handlers. Have your data module return uniform structures:
  - **Global timeline bounds:** `{ hasData: boolean, minEpoch: number | null, maxEpoch: number | null }`
  - **Per-feed payloads:** `{ available: boolean, ...recordsAndCounts }`
- **Hybrid windowing (load once, slice in $O(\log n)$ client-side):**
  - Never issue network `fetch("/api/...")` requests on every 60fps timeline slider `input` event.
  - Coalesce startup fetches onto a single memoized load `Promise`, return records pre-sorted ascending by `epoch`, and slice `[startEpoch, endEpoch]` in memory in $O(\log n)$ time using binary search (`lowerBound` / `upperBound`) rather than $O(n)$ `.filter()` scans.
  - Optionally accept `?start=<epoch>&end=<epoch>` on `/api/*` routes (backed by your `epoch` SQL indexes) for server-filtered queries or ad-hoc inspection.
- **Interpolate periodic snapshot feeds:** Feeds that record periodic state snapshots (e.g., road segment speeds every 15 minutes) rather than point events should be evaluated at the active window midpoint (`Math.floor((startEpoch + endEpoch) / 2)`) by linearly interpolating between the two bracketing snapshots.

## 4. AlloyDB, Node & Progressive UI Pitfalls

- **Postgres 65,535 bind-parameter limit on large inserts:** A single parameterized `INSERT` with 35,000+ rows × multiple columns exceeds PostgreSQL's `65535`-parameter wire limit and throws an error. Always batch multi-row inserts via `bulkInsert()` in `api/lib/db.js`.
- **Node.js has no built-in browser `DOMParser`:** `api/ingest.js` runs in Node 22 (`node:22-alpine`), where `DOMParser` is undefined. When adding an XML parser library (e.g., `fast-xml-parser`), update **both** `api/package.json` and `api/package-lock.json` (`npm install --prefix api <pkg>`) so `npm ci --omit=dev` succeeds in Cloud Build.
- **AlloyDB IAM `PGUSER` formatting:** Service account IAM DB principals omit `.gserviceaccount.com` (`<sa>@<project>.iam`), and the instance must keep `alloydb.iam_authentication=on` (`k8s/infra/gcp/alloydb.yaml`); otherwise connections fail with `password authentication failed`.
- **`RangeError: Invalid time value` when zero datasets are loaded:** Guard timeline bounds when all tables are empty (`hasData: false`). Never pass `null`, `Infinity`, or `-Infinity` into `new Date(epoch * 1000).toISOString()`—fall back to finite default bounds and hide timeline controls when `hasData === false`.
- **Ghost UI controls & the CSS `[hidden]` flexbox trap:** Hide layer toggles, legend items, overlays, and detail panels whenever a feed reports `available === false` (and hide the legend and timeline scrubber completely when `hasData === false`). Keep `[hidden] { display: none !important; }` in `src/index.css`—without it, any rule like `.panel { display: flex; }` or `display: grid` overrides the browser default `[hidden]` stylesheet and leaves hidden panels visible.
