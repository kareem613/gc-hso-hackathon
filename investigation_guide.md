# Investigation Guide (`#INC-2026-1012`)

This investigation follows an iterative, data-driven workflow to uncover the root cause of the recurring guest Wi-Fi (`GOV_GUEST_WIFI`) drops at `FAC-OTT-01` (see `incident_briefing.md` for full context). You will ingest, visualize, and analyze each sensor feed one at a time in the order below, evaluating after each dataset whether the evidence is sufficient to conclusively explain the incident.

Follow the steps below for each dataset and track your progress and findings in `status.md`.

## 1. Order of Datasets to Ingest
1. `datasets/wlc_syslog.log` — Campus wireless controller syslogs
2. `datasets/road_traffic.json` — Perimeter road traffic speed & congestion telemetry
3. `datasets/yow_tower_radar.xml` — Airport tower primary & secondary radar
4. `datasets/ottawa_tech_forums.json` — Scraped local tech & engineering forums

## 2. Per-Dataset Workflow
For each dataset in order:
1. **Design AlloyDB schema:** Add idempotent `CREATE TABLE IF NOT EXISTS` and indexes in `api/schema.sql`.
2. **Update ingest job:** Parse `/datasets/<file>` and batch-insert into AlloyDB in `api/ingest.js`.
3. **Run job:** Rebuild the image and run the ingest Job (`./scripts/build-image.sh && ./scripts/ingest-datasets.sh`).
4. **Review in AlloyDB:** Verify row counts, timestamps, and sample records in AlloyDB Studio (or via the `alloydb` MCP server).
5. **Implement UI visualization & test locally** *(for geospatial/sensor datasets)*: Add `/api/*` query route(s) in `api/server.js`, visualize the dataset in `src/`, and test locally (`./scripts/run-local.sh`).
6. **Deploy & view hosted** *(for geospatial/sensor datasets)*: Build and deploy the updated app to GKE (`./scripts/build-image.sh && ./scripts/deploy-app.sh`) and view hosted (`./scripts/port-forward.sh`).
7. **Analyze data:** Query and correlate against `FAC-OTT-01` (`45.3507, -75.8518`) to determine whether the incident root cause can be determined conclusively with the data so far, and update `status.md`.
