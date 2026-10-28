---
name: getting-started
description: >-
  Onboards a developer to this repository by giving a brief project introduction,
  verifying local CLI prerequisites (gcloud, kubectl, gke-gcloud-auth-plugin),
  and creating k8s/config/infra.env with their GCP PROJECT_ID so they can run the
  deployment scripts. Use whenever the user asks to get started, triggers
  /getting-started or gettingstarted, asks how to set up or configure the repo,
  or asks for help creating infra.env.
---

# Getting Started Onboarding Skill

Get the developer to the point where they can run all the scripts in `scripts/` with the bare minimum steps. Keep responses brief and direct.

---

## Step 1: Brief Intro, CLI Status Line & `PROJECT_ID` Prompt

In a single turn:

1. **Give a 1–2 sentence intro:**
   - Explain that this project is an interactive Google Maps geospatial explorer built as a hackathon exercise, deployed to GKE using Kustomize, Config Connector, and GCS FUSE (and that the Google Maps API + `.env` key are provisioned automatically by the scripts).

2. **Run a read-only CLI & auth check and always display a brief status line:**
   - Check `gcloud`, `kubectl`, and `gke-gcloud-auth-plugin` on `PATH`, the active `gcloud` account (`gcloud auth list --filter=status:ACTIVE --format="value(account)"`), and current default project (`gcloud config get-value project`).
   - Display a compact 1–2 line summary of the check (e.g., `CLI & Auth: gcloud (<account>), kubectl, gke-gcloud-auth-plugin ready`).
   - If a tool is missing or `gcloud` is not logged in, give the exact install/login command (`gcloud components install kubectl gke-gcloud-auth-plugin` / `gcloud auth login`) and wait for them to complete it before proceeding.

3. **Ask only for `PROJECT_ID`:**
   - Check if `k8s/config/infra.env` already exists (showing its current `PROJECT_ID` if set), otherwise suggest the detected `gcloud` default project (if any) and ask the developer to confirm or enter the GCP `PROJECT_ID` to use.
   - Do **not** prompt for `REGION`, `MACHINE_TYPE`, node counts, or resource names — keep all defaults from `k8s/config/infra.env.example` (`REGION=northamerica-northeast2`).

---

## Step 2: Write `k8s/config/infra.env` & Hand Off Scripts

Once the developer confirms `PROJECT_ID`:

1. **Write `k8s/config/infra.env` from `k8s/config/infra.env.example`:**
   - Copy all defaults from `k8s/config/infra.env.example` (`REGION=northamerica-northeast2`, `MACHINE_TYPE=e2-standard-2`, etc.) and set `PROJECT_ID=<confirmed-project-id>`.
   - **Formatting rule:** Keep plain, **unquoted** `KEY=VALUE` lines with no `"..."` or `'...'` quotes and no inline comments (Kustomize `configMapGenerator` treats quotes literally).

2. **Silently verify Kustomize syntax:**
   - Run `kubectl kustomize k8s/infra/gcp >/dev/null && kubectl kustomize k8s/app/overlays/gcp >/dev/null` silently (only mention it if an error occurs).

3. **Print the deployment scripts in order and stop:**
   - Confirm `k8s/config/infra.env` is configured, display the scripts to run in order, and stop without offering to execute them automatically:
     ```bash
     ./scripts/bootstrap-infra.sh
     ./scripts/apply-core-infra.sh
     ./scripts/build-image.sh
     ./scripts/deploy-app.sh
     ./scripts/upload-datasets.sh
     ./scripts/port-forward.sh
     ```
