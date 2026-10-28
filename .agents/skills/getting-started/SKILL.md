---
name: getting-started
description: >-
  Onboards a developer in Antigravity CLI (or a compatible coding agent) by
  giving a brief project introduction, explaining and verifying local CLI
  prerequisites (gcloud, kubectl, gke-gcloud-auth-plugin), and creating
  k8s/config/infra.env with their GCP PROJECT_ID via multiple-choice prompts so
  they can run the deployment scripts. Use whenever the user asks to get
  started, triggers /getting-started or gettingstarted, asks how to set up or
  configure the repo, or asks for help creating infra.env.
---

# Getting Started Onboarding Skill

Guide the developer in Antigravity CLI to the point where they can run all the scripts in `scripts/` with the bare minimum steps. Keep responses brief and direct.

## Core Interaction Rules

1. **Explain checks before running them:** Before executing any inspection or validation command, briefly tell the user what you are about to check and why so they understand every command Antigravity CLI runs.
2. **Always use multiple-choice questions:** Every time you ask the user a question, present selectable multiple-choice options — never ask a bare open-ended question. Prefer Antigravity CLI's `ask_question` multiple-choice tool when available (its UI automatically appends an `Other` free-text option, so do not add a duplicate `"Other"` choice there); if `ask_question` is unavailable, render a numbered multiple-choice list with a final option to enter a custom value.

---

## Step 1: Intro, Explained CLI Check & Multiple-Choice `PROJECT_ID` Prompt

1. **Introduce the project & announce the prerequisite check first:**
   - Give a 1–2 sentence intro: this project is an interactive Google Maps geospatial explorer built as a hackathon exercise, deployed to GKE using Kustomize, Config Connector, and GCS FUSE (with Google Maps API enablement and `.env` key provisioning automated by the scripts).
   - **Before running any shell command**, output a short line explaining that you are about to check for `gcloud`, `kubectl`, and `gke-gcloud-auth-plugin` on `PATH`, verify active `gcloud` authentication, inspect accessible GCP projects, and check for an existing `k8s/config/infra.env`.

2. **Run the read-only CLI & auth check and display a compact status line:**
   - Check `gcloud`, `kubectl`, and `gke-gcloud-auth-plugin` on `PATH`, active `gcloud` account (`gcloud auth list --filter=status:ACTIVE --format="value(account)"`), current default project (`gcloud config get-value project`), up to 4 active accessible GCP projects (`gcloud projects list --filter="lifecycleState:ACTIVE" --limit=4 --format="value(projectId)"`), and any `PROJECT_ID` already set in `k8s/config/infra.env`.
   - Always display a compact 1–2 line summary of the result (e.g., `CLI & Auth: gcloud (<account>), kubectl, gke-gcloud-auth-plugin ready`).
   - If a tool is missing or `gcloud` is not logged in, show the exact fix command (`gcloud components install kubectl gke-gcloud-auth-plugin` or `gcloud auth login`) and ask how to proceed using multiple-choice options (e.g., `(Recommended) I've completed this step — re-run the check`, `Run the install command for me`, `Stop setup for now`). Wait until prerequisites pass before continuing.

3. **Prompt for `PROJECT_ID` via multiple choice (and nothing else):**
   - Ask which GCP `PROJECT_ID` to configure in `k8s/config/infra.env` using multiple-choice options populated from what you detected:
     - Put the existing `k8s/config/infra.env` `PROJECT_ID` (if set) or the active `gcloud` default project first, prefixed with `(Recommended)`.
     - Include the other active project IDs returned by `gcloud projects list` (deduplicated) as additional choices.
     - *(If falling back to plain text instead of `ask_question`, include a final option to type a different `PROJECT_ID`.)*
   - Do **not** prompt for `REGION`, `MACHINE_TYPE`, node counts, or resource names — keep all defaults from `k8s/config/infra.env.example` (`REGION=northamerica-northeast2`).

---

## Step 2: Write `k8s/config/infra.env`, Validate & Hand Off Scripts

Once the developer selects or enters `PROJECT_ID`:

1. **Write `k8s/config/infra.env` from `k8s/config/infra.env.example`:**
   - Copy all defaults from `k8s/config/infra.env.example` (`REGION=northamerica-northeast2`, `MACHINE_TYPE=e2-standard-2`, etc.) and set `PROJECT_ID=<selected-project-id>`.
   - **Formatting rule:** Keep plain, **unquoted** `KEY=VALUE` lines with no `"..."` or `'...'` quotes and no inline comments (Kustomize `configMapGenerator` treats quotes literally).

2. **Explain and run Kustomize syntax validation:**
   - Briefly state that you are verifying Kustomize manifest rendering against `k8s/config/infra.env`, then run:
     ```bash
     kubectl kustomize k8s/infra/gcp >/dev/null && kubectl kustomize k8s/app/overlays/gcp >/dev/null
     ```

3. **Print the deployment scripts in order and stop:**
   - Confirm `k8s/config/infra.env` is configured and validated, display the scripts to run in order, and stop without offering to execute them automatically:
     ```bash
     ./scripts/bootstrap-infra.sh
     ./scripts/apply-core-infra.sh
     ./scripts/build-image.sh
     ./scripts/deploy-app.sh
     ./scripts/upload-datasets.sh
     ./scripts/port-forward.sh
     ```
