# Incident Response Geospatial Console

Interactive Google Maps geospatial dataset explorer built as an exercise for a hackathon, visualizing synchronized wireless syslog events, radar tracks, telemetry feeds, and road traffic across a scrubbable timeline.

Datasets are stored in **AlloyDB for PostgreSQL** (private IP, IAM authentication) and served to the frontend by a small Node.js API (`api/`) running alongside nginx in the same pod. The original static-file path (`/datasets/*` via GCS FUSE) is retained and selectable with `DATA_SOURCE=file`.

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

# 4. Create the runtime .env Secret (incl. DATA_SOURCE=alloydb) and deploy the app pod
#    (nginx + hso-api + AlloyDB Auth Proxy), private GCS bucket, Workload Identity, IAM, and GCS FUSE mount
./scripts/deploy-app.sh

# 5. Upload local ./datasets/* files into gs://<PROJECT_ID>-datasets/
./scripts/upload-datasets.sh

# 6. Load the uploaded datasets into AlloyDB (Kubernetes Job; idempotent, re-run after new uploads)
./scripts/ingest-datasets.sh

# 7. Forward http://localhost:8090 to the Kubernetes service (override with --port <port>)
./scripts/port-forward.sh
```

### Switching the data source

The frontend reads `DATA_SOURCE` from `/.env`:

| Value | Behaviour |
|---|---|
| `alloydb` (default on GKE) | `ApiDataReader` -> `GET /api/*` -> AlloyDB |
| `file` | `FileDataReader` -> static `/datasets/*` from the GCS FUSE mount |

To roll back to files without touching AlloyDB: `DATA_SOURCE_OVERRIDE=file ./scripts/deploy-app.sh`.

Open `http://localhost:8090` in your browser.

*(For local development without GKE, run `./scripts/run-local.sh` to serve the app on `http://localhost:8080`, or pass `--port <port>` to override.)*

## Teardown

To cleanly remove all deployed resources (including AlloyDB, the managed Maps API key and `.env`):

```bash
./scripts/teardown-infra.sh
```
