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
