---
name: getting-started
description: >-
  Onboards a developer to this repository by giving a brief project introduction,
  verifying local CLI prerequisites (gcloud, kubectl, gke-gcloud-auth-plugin),
  interactively guiding them through creating their local .env and k8s/config/infra.env
  files, and checking the local datasets/ folder so they are ready to run the deployment
  scripts. Use whenever the user asks to get started, triggers /getting-started or
  gettingstarted, asks how to set up or configure the repo, or asks for help creating
  .env or infra.env.
---

# Getting Started Onboarding Skill

Guide the developer step-by-step through the manual setup required before running the automated GKE deployment scripts in `scripts/`. Keep the interaction concise, conversational, and walk through one step at a time rather than dumping a wall of instructions.

---

## Step 1: Brief Introduction & Pre-Flight CLI Check

1. **Give a 2–3 sentence intro:**
   - Explain that this project is an interactive Google Maps geospatial dataset explorer (built as a hackathon exercise) that visualizes synchronized wireless syslogs, radar tracks, telemetry feeds, and road traffic across a scrubbable timeline, deployed to GKE using Kustomize, Config Connector, and a GCS FUSE volume.
   - State what you will help them set up right now so the automated scripts can run cleanly:
     1. Local CLI prerequisites (`gcloud`, `kubectl`, `gke-gcloud-auth-plugin`)
     2. Infrastructure configuration (`k8s/config/infra.env`)
     3. Application configuration (`.env` with `GOOGLE_MAPS_API_KEY`)
     4. Local `./datasets/` files

2. **Run a read-only CLI & auth check automatically:**
   - Check that `gcloud`, `kubectl`, and `gke-gcloud-auth-plugin` are installed on `PATH`.
   - Check the active `gcloud` authenticated account (`gcloud auth list --filter=status:ACTIVE --format="value(account)"`) and current default project (`gcloud config get-value project`).
   - Report the pre-flight results briefly:
     - If `kubectl` or `gke-gcloud-auth-plugin` is missing, provide the install command (`gcloud components install kubectl gke-gcloud-auth-plugin` or `sudo apt-get install -y kubectl google-cloud-cli-gke-gcloud-auth-plugin`) and wait for them to install it.
     - If `gcloud` has no active authenticated account, ask them to run `gcloud auth login` first.

---

## Step 2: Create `k8s/config/infra.env`

1. Check if `k8s/config/infra.env` already exists and inspect `k8s/config/infra.env.example` for the expected keys.
2. **Determine `PROJECT_ID` and `REGION` with the developer:**
   - Show any default project detected from `gcloud config get-value project` (and optionally run `gcloud projects list --format="table(projectId,name)"` if none is set or if they aren't sure which project ID to use).
   - Remind them that the target GCP project needs billing enabled and sufficient IAM permissions (`Owner`, or `Editor` + `Project IAM Admin` + `Security Admin` + `Service Usage Admin`) so `./scripts/bootstrap-infra.sh` can create service accounts, a VPC, and a GKE cluster.
   - Ask them to confirm:
     - **`PROJECT_ID`** (required — must not remain `your-gcp-project-id`)
     - **`REGION`** (default: `us-east1`)
     - Whether to keep the default cluster sizing (`MACHINE_TYPE=e2-standard-2`, `MIN_NODES=1`, `MAX_NODES=2` — note that `e2-standard-2` provides required CPU headroom for Config Connector and the GCS FUSE sidecar) and default resource names.
3. **Write `k8s/config/infra.env`:**
   - **CRITICAL FORMATTING RULE:** Write plain, **unquoted** `KEY=VALUE` lines with no `"..."` or `'...'` quotes and no trailing inline comments. Kustomize's `configMapGenerator` (`envs: [infra.env]`) treats quote characters literally, which would corrupt resource names and annotations.
4. **Validate Kustomize rendering:**
   - Run:
     ```bash
     kubectl kustomize k8s/infra/gcp >/dev/null && kubectl kustomize k8s/app/overlays/gcp >/dev/null
     ```
   - Confirm both overlays render cleanly with zero errors before moving to Step 3.

---

## Step 3: Create `.env` (`GOOGLE_MAPS_API_KEY`)

1. Check if `.env` already exists at the repository root (note: never print an existing secret key value in full in chat).
2. If `.env` is missing or still contains the placeholder value from `.env.example`:
   - Ask the developer for their **Google Maps JavaScript API** key (`GOOGLE_MAPS_API_KEY`).
   - If they need to create one first, give concise directions:
     1. Enable the **Maps JavaScript API** (`gcloud services enable maps-backend.googleapis.com --project="<PROJECT_ID>"`, or in Cloud Console under **APIs & Services > Library**).
     2. Go to **Google Cloud Console > APIs & Services > Credentials > Create Credentials > API key** (and optionally restrict the key to the **Maps JavaScript API**).
3. Once provided, write `.env` at the repository root:
   ```dotenv
   GOOGLE_MAPS_API_KEY=<their-key>
   ```
   (Do not wrap the value in quotes unless needed, and verify `.env` remains untracked via `git check-ignore -q .env`).

---

## Step 4: Verify `./datasets/` Files

1. Check `./datasets/` for the dataset files uploaded by `./scripts/upload-datasets.sh`:
   - `incident_briefing.md`
   - `wlc_syslog.log`
   - `yow_tower_radar.xml`
   - `gtv2_collar_telemetry.csv`
   - `road_traffic.json`
2. If `./datasets/` is empty or missing required files:
   - Try checking whether `./scripts/copy-dataset.sh` has an accessible source directory; if so, offer to run `./scripts/copy-dataset.sh`.
   - Otherwise, let the developer know where to place their dataset files (`./datasets/`) and note that Steps 1–4 of the deployment scripts (`bootstrap-infra.sh` through `deploy-app.sh`) can still run while they obtain the dataset files, as `./datasets/` is only required at Step 5 (`./scripts/upload-datasets.sh`).

---

## Step 5: Readiness Summary & Handoff

Present a compact readiness summary table (`CLI & Auth`, `k8s/config/infra.env`, `.env`, `./datasets/`), then show the deployment commands in order:

```bash
./scripts/bootstrap-infra.sh
./scripts/apply-core-infra.sh
./scripts/build-image.sh
./scripts/deploy-app.sh
./scripts/upload-datasets.sh
./scripts/port-forward.sh
```

Ask whether they want to run the scripts themselves or have you run them step-by-step.
