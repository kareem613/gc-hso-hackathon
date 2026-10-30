# Incident Response Geospatial Console

Starter repository for a geospatial hackathon exercise. Ships a Google Maps JavaScript starter UI (`src/`) alongside pre-wired GKE, Config Connector, GCS FUSE dataset staging, and **AlloyDB for PostgreSQL** (private IP, IAM database authentication, Node.js `/api/*` server, and one-shot Kubernetes ingest Job).

Read `incident_briefing.md` for scenario context and `docs/architecture/` for implementation guidelines and pitfalls to avoid as you build out dataset ingestion, API routes, and map visualizations.

## Configuration

> **Tip:** Using Antigravity CLI or a compatible coding agent? Ask it to run the `getting-started` skill for a guided interactive setup.

Create your local infrastructure configuration file from the template:

```bash
cp k8s/config/infra.env.example k8s/config/infra.env
```

Edit `k8s/config/infra.env` and set `PROJECT_ID` (and optionally `REGION`, `MACHINE_TYPE`, `MIN_NODES`, `MAX_NODES`).

## End-to-End GKE Deployment

Run the lifecycle scripts in order from the repository root:

```bash
# 1. Bootstrap custom VPC/subnet, least-privilege GKE node & Config Connector SAs, and private-node GKE cluster
./scripts/bootstrap-infra.sh

# 2. Declaratively enable GCP & Maps APIs, create Artifact Registry & IAM, provision AlloyDB (PSA peering,
#    cluster, primary instance, IAM DB user) via Config Connector, and provision the Maps API key (.env)
#    (first run takes ~15 min while AlloyDB provisions)
./scripts/apply-core-infra.sh

# 3. Build and push the Nginx frontend image and the Node.js API/ingest image via Cloud Build
./scripts/build-image.sh

# 4. Create the runtime .env Secret and deploy the app pod (nginx + API + AlloyDB Auth Proxy),
#    private GCS staging bucket, Workload Identity, IAM, and GCS FUSE PersistentVolume
./scripts/deploy-app.sh

# 5. Upload any dataset files placed in ./datasets/ into gs://<PROJECT_ID>-datasets/
./scripts/upload-datasets.sh

# 6. Run the Kubernetes ingest Job (applies api/schema.sql and executes api/ingest.js against /datasets -> AlloyDB)
./scripts/ingest-datasets.sh

# 7. Forward http://localhost:8090 to the Kubernetes service (override with --port <port>)
./scripts/port-forward.sh
```

Open `http://localhost:8090` in your browser.

*(For local live-reload development against AlloyDB, run `./scripts/run-local.sh` to serve `./src` on `http://localhost:8080`, tunnel to AlloyDB, and run `node --watch api/server.js` automatically.)*

## Where to Build

- **`api/schema.sql` & `api/ingest.js`:** Define idempotent AlloyDB tables/indexes and parse dataset files mounted at `/datasets` (from `gs://<PROJECT_ID>-datasets/` via GCS FUSE) into AlloyDB.
- **`api/server.js`:** Expose `/api/*` JSON endpoints querying AlloyDB through the shared pool in `api/lib/db.js` (`/api/health` is pre-wired).
- **`src/`:** Extend the starter Google Maps UI (`index.html`, `index.css`, `app.js`) to query `/api/*` and visualize datasets.

## Teardown

To cleanly remove all deployed resources (including AlloyDB, the managed Maps API key, and `.env`):

```bash
./scripts/teardown-infra.sh
```
