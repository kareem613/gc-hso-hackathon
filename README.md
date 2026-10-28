# Incident Response Geospatial Console

Interactive Google Maps geospatial dataset explorer built as an exercise for a hackathon, visualizing synchronized wireless syslog events, radar tracks, telemetry feeds, and road traffic across a scrubbable timeline.

## Configuration

> **Tip:** Using Gemini CLI or a compatible coding agent? Ask it to run the `getting-started` skill for a guided interactive setup.

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

# 2. Declaratively enable GCP & Maps APIs, create Artifact Registry & IAM via Config Connector, and provision the Maps API key (.env)
./scripts/apply-core-infra.sh

# 3. Build and push the Nginx frontend container image via Cloud Build
./scripts/build-image.sh

# 4. Create the runtime .env Secret and deploy the app, private GCS bucket, Workload Identity, and GCS FUSE mount
./scripts/deploy-app.sh

# 5. Upload local ./datasets/* files into gs://<PROJECT_ID>-datasets/
./scripts/upload-datasets.sh

# 6. Forward http://localhost:8090 to the Kubernetes service (override with --port <port>)
./scripts/port-forward.sh
```

Open `http://localhost:8090` in your browser.

*(For local development without GKE, run `./scripts/run-local.sh` to serve the app on `http://localhost:8080`, or pass `--port <port>` to override.)*

## Teardown

To cleanly remove all deployed resources (including the managed Maps API key and `.env`):

```bash
./scripts/teardown-infra.sh
```
