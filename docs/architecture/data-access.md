# Application Data Access Specification & Pitfalls

When building your frontend from scratch in `src/`, design your data layer around static `/datasets/*` HTTP reads while keeping UI and map rendering decoupled from raw file formats and resilient to missing feeds.

## 1. Isolate Parsing Behind a Storage-Agnostic Reader Interface

Datasets span heterogeneous formats (space-delimited key-value `.log` syslog lines, nested `.xml` radar tracks, high-frequency `.csv` telemetry rows, and `.json` traffic/forum snapshots). Avoid scattering `fetch()` calls or format parsers across UI components:

- Define a narrow async reader abstraction (e.g., `DataReader`) returning normalized domain records and integer Unix `epoch` seconds:
  - **Global bounds:** `{ hasData: boolean, minEpoch: number, maxEpoch: number }`
  - **Per-feed window queries (`{ startEpoch, endEpoch }`):** `{ available: boolean, ...normalizedRecordsAndCounts }`
- **Why it matters:** UI controls, timeline scrubbers, and map layers consume uniform JavaScript objects, allowing you to swap a static `/datasets/*` file reader for a REST API or database reader later without rewriting rendering code.

## 2. Runtime Configuration (`/.env`) & `/datasets/*` Discovery

- **Load `GOOGLE_MAPS_API_KEY` dynamically from `GET /.env`:** Both `scripts/run-local.sh` and the GKE Nginx startup script serve `/.env` over HTTP. Parse `KEY=VALUE` lines (ignoring blank/`#` lines and stripping optional quotes) and bootstrap the Maps JS loader dynamically (`google.maps.importLibrary`) instead of hardcoding a key in `index.html`.
- **Treat every `/datasets/<file>` feed as optional:** New feeds may arrive mid-exercise via `scripts/upload-datasets.sh`, or `/datasets/` may start partially populated or completely empty.

## 3. Data Access & Progressive UI Pitfalls

- **Crashing on missing datasets or SPA HTML fallbacks:**
  - A missing file returns `HTTP 404` (or in some dev servers, an HTML fallback with `Content-Type: text/html`). Check `res.ok` *and* guard against unexpected `<!DOCTYPE html>` responses before passing text to JSON/XML/CSV parsers.
  - Return `{ available: false }` with empty collections when a file is absent or empty.
- **`RangeError: Invalid time value` when computing timeline bounds:**
  - Initializing `minEpoch = Infinity` and `maxEpoch = -Infinity` works only when at least one time-series record exists. Include **all** time-bearing feeds (including periodic road-traffic snapshot timestamps) in bounds calculation, and fall back to finite default bounds with `hasData: false` when zero datasets are present so `new Date(epoch * 1000).toISOString()` never throws.
- **Ghost UI controls and the CSS `[hidden]` flexbox trap:**
  - When a feed has `available === false`, completely hide its layer toggle, map legend items, map overlays, and detail drawer panels (and hide the timeline scrubber + legend altogether when `hasData === false`).
  - **CSS Pitfall:** Setting `el.hidden = true` in JavaScript does **nothing** if your stylesheet defines `.panel { display: flex; }` or `display: grid`, because author `display` rules override the browser UA `[hidden]` rule. Add `[hidden] { display: none !important; }` to your stylesheet and toggle `.hidden` consistently rather than mixing `.hidden` with inline `el.style.display`.
- **Blocking the main thread during startup parsing:**
  - Coalesce concurrent startup calls onto a single memoized load `Promise` so files are fetched in parallel (`Promise.all`) and parsed once.
  - Parsing large XML documents and tens of thousands of CSV lines back-to-back freezes first paint. Yield between heavy parse stages (`await scheduler.yield?.()` with a `setTimeout(r, 0)` fallback, or use a Web Worker).
- **Repeated `Date.parse()` calls on high-frequency CSVs:**
  - Multi-device telemetry CSVs often repeat the exact same ISO-8601 timestamp string across dozens of consecutive rows. Caching `{ lastRawTimestamp, lastEpoch }` during CSV parsing eliminates >99% of `Date.parse()` invocations across 30,000+ rows.
- **$O(n)$ array filtering during 60fps timeline scrubbing:**
  - Raw feeds mix Unix epoch integers and ISO-8601 strings. Convert every timestamp **once** during ingestion to integer Unix `epoch` seconds and sort each time-series array ascending.
  - Slice `[startEpoch, endEpoch]` in $O(\log n)$ time using binary search (`lowerBound` / `upperBound`) rather than running `.filter()` across tens of thousands of records on every slider movement.
- **Evaluating snapshot-based feeds (road traffic) against a time window:**
  - Periodic snapshot feeds store speed samples at fixed intervals (e.g., every 15 minutes) rather than discrete point events. Evaluate each road segment at the window midpoint (`Math.floor((startEpoch + endEpoch) / 2)`) by linearly interpolating between the two bracketing snapshots.

## 4. AlloyDB Data Path (`DATA_SOURCE=alloydb`)

The reader abstraction above is now exercised by two concrete implementations in `src/data-reader.js`, selected at startup by `createDataReader(env)` from the `DATA_SOURCE` value served in `/.env`:

| `DATA_SOURCE` | Reader | Source of truth |
|---|---|---|
| `file` (default) | `FileDataReader` | Static `/datasets/*` files (GCS FUSE mount) parsed in the browser |
| `alloydb` | `ApiDataReader` | AlloyDB for PostgreSQL via the `hso-api` container (`GET /api/*`) |

Both extend `CachedDataReader`, which owns the memoized load `Promise`, timeline-bounds calculation, collar grouping, and the $O(\log n)$ binary-search windowing. A reader only implements `_loadRaw()` and returns `{ wlcEvents, radarTracks, collarPoints, trafficSegments, trafficSourceFile }`.

### Request flow

```
Browser ──GET /api/wlc-events──▶ nginx ──proxy_pass──▶ hso-api (Node/Express, :8080)
                                                          │  pg over localhost:5432
                                                          ▼
                                              alloydb-auth-proxy sidecar (--auto-iam-authn)
                                                          │  TLS, private IP, IAM token
                                                          ▼
                                              AlloyDB hso-alloydb / hso-primary
```

- **Hybrid windowing:** `ApiDataReader` fetches each dataset **once in bulk** (`/api/wlc-events`, `/api/radar-tracks`, `/api/road-traffic`, `/api/collar-telemetry`) and then reuses the in-memory binary search, so scrubbing never hits the network. Every endpoint also accepts `?start=<epoch>&end=<epoch>` for server-side range filtering via the indexed `epoch BIGINT` columns.
- **Shape parity:** the API returns records with exactly the keys the browser parsers produce (`isAnomaly`, `pings[]`, `snapshots[]`, `path[]`, …) so the UI code is reader-agnostic. Server-side parsing lives in `api/lib/parsers.js` and mirrors `src/data-reader.js` (XML via `fast-xml-parser` instead of `DOMParser`).
- **Collar telemetry** is not ingested (the CSV is not part of `datasets/`); `/api/collar-telemetry` returns `{ available: false }` so the UI hides that layer exactly as before.
- **Forum threads** are ingested and exposed at `/api/forum-threads` (+ `?start=&end=`) but have no UI yet.

### Schema (`api/schema.sql`)

| Table | Notes |
|---|---|
| `wlc_events` | one row per syslog line; typed columns + `attrs JSONB` for unmapped `key=value` pairs; `epoch` indexed |
| `radar_tracks` / `radar_pings` | track metadata + per-ping positions; `(track_id, epoch)` indexed |
| `road_segments` / `road_snapshots` | segment geometry as `path JSONB` + 15-minute speed snapshots |
| `forum_threads` / `forum_posts` | scraped forum threads and their posts |
| `dataset_loads` | provenance: source file, row count, `loaded_at` per table (surfaced at `/api/datasets`) |

Lat/lng are `DOUBLE PRECISION`; PostGIS is not enabled.

### Ingest

`scripts/ingest-datasets.sh` runs the `hso-ingest` Kubernetes Job (`k8s/app/ingest/`): the same `hso-api` image executing `node ingest.js` with the Auth Proxy as a native sidecar (`initContainers[].restartPolicy: Always`, so it exits with the Job). It reads from the GCS FUSE mount at `/datasets`, applies `schema.sql` idempotently, and `TRUNCATE`s + bulk-inserts each dataset in its own transaction. Re-run it any time new files land in the bucket.

### Authentication

No database passwords exist anywhere. The pod's Kubernetes ServiceAccount (`hso-app-sa`) is bound via Workload Identity to `hso-app-gsa`, which holds `roles/alloydb.client`, `roles/alloydb.databaseUser`, and `roles/serviceusage.serviceUsageConsumer`. The Auth Proxy exchanges that identity for a short-lived token and the API connects as the IAM database user `hso-app-gsa@<PROJECT_ID>.iam` (granted `alloydbsuperuser` so ingest can create tables).

### Pitfalls

- **`PGUSER` must omit `.gserviceaccount.com`:** AlloyDB IAM principals for service accounts are `<name>@<project>.iam`.
- **`alloydb.iam_authentication=on`** is a per-instance database flag; without it IAM logins fail with `password authentication failed`.
- **Rollback:** redeploy with `DATA_SOURCE_OVERRIDE=file ./scripts/deploy-app.sh` to serve from the FUSE mount again without touching AlloyDB.
