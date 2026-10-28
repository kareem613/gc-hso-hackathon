# HSO Incident Response Geospatial Console (`#INC-2026-1012`)

Interactive Google Maps geospatial dataset explorer for **Carling Campus Government Complex (`FAC-OTT-01`)**, visualizing synchronized WLC syslogs, CYOW primary/secondary radar tracks, collar & river buoy telemetry, and road traffic segments across a scrubbable timeline.

## Architecture

The Kubernetes deployment is structured with **Kustomize** and **Config Connector** so that `gcloud` imperative scripting is limited strictly to bootstrapping the GKE cluster, while core GCP services, IAM bindings, Artifact Registry, and Cloud Storage are declared in Kubernetes manifests — keeping the application base portable across **Google Cloud (GCP)** and **Google Distributed Cloud (GDC)**.

```text
k8s/
├── config/               # Dynamic project/region Kustomize config (sourced from infra.env)
├── infra/
│   └── gcp/              # Config Connector: GCP APIs, Artifact Registry, Cloud Build & GKE Node IAM
└── app/
    ├── base/             # Cloud-agnostic Deployment, ClusterIP Service, ServiceAccount & ReadOnlyMany PVC
    └── overlays/
        └── gcp/          # Config Connector StorageBucket, Workload Identity & GCS FUSE CSI PV
```

### How Datasets Are Served
The browser never accesses Cloud Storage directly (no public bucket, CORS rules, or client-side GCP credentials):
1. `FileDataReader` (`src/data-reader.js`) fetches same-origin paths under `/datasets/*`.
2. Nginx (`nginx:1.27-alpine`) serves `/usr/share/nginx/html/datasets/*` from a standard Kubernetes `PersistentVolumeClaim` (`datasets-pvc`).
3. On GKE (`k8s/app/overlays/gcp`), `datasets-pvc` binds to a `gcsfuse.csi.storage.gke.io` `PersistentVolume` authenticated via **Workload Identity** (`roles/storage.objectViewer` on the private `<PROJECT_ID>-datasets` bucket).

---

## Prerequisites

- `gcloud` CLI authenticated (`gcloud auth login`) with Owner / IAM Admin permissions on a target GCP project
- `kubectl` (with `gke-gcloud-auth-plugin` installed)
- A **Google Maps JavaScript API** key
- Dataset files placed in `./datasets/` (e.g., via `./scripts/copy-dataset.sh` if using the companion dataset generator repo):
  - `incident_briefing.md`
  - `wlc_syslog.log`
  - `yow_tower_radar.xml`
  - `gtv2_collar_telemetry.csv`
  - `road_traffic.json`

---

## Configuration

Create the two gitignored local configuration files from their templates:

```bash
cp .env.example .env
cp k8s/config/infra.env.example k8s/config/infra.env
```

1. Edit `.env` and set your `GOOGLE_MAPS_API_KEY`.
2. Edit `k8s/config/infra.env` and set `PROJECT_ID` (and optionally `REGION`, `MACHINE_TYPE`, `MIN_NODES`, `MAX_NODES`).

---

## End-to-End GKE Deployment

Run the lifecycle scripts in order from the repository root:

```bash
# 1. Bootstrap custom VPC/subnet, least-privilege GKE node & Config Connector SAs, and private-node GKE cluster
./scripts/bootstrap-infra.sh

# 2. Declaratively enable GCP APIs, create Artifact Registry, and bind Cloud Build & GKE node IAM via Config Connector
./scripts/apply-core-infra.sh

# 3. Build and push the Nginx frontend container image via Cloud Build
./scripts/build-image.sh

# 4. Create the runtime .env Secret and deploy the app, private GCS bucket, Workload Identity, and GCS FUSE mount
./scripts/deploy-app.sh

# 5. Upload local ./datasets/* files into gs://<PROJECT_ID>-datasets/
./scripts/upload-datasets.sh

# 6. Forward http://localhost:8080 -> svc/hso-console:80
./scripts/port-forward.sh
```

Open `http://localhost:8080` in your browser.

---

## Teardown

To cleanly remove all deployed resources (using Config Connector to delete the `StorageBucket`, `ArtifactRegistryRepository`, and app/Cloud Build service accounts before deleting the bootstrap GKE cluster, bootstrap service accounts, subnet, and VPC):

```bash
./scripts/teardown-infra.sh
```
