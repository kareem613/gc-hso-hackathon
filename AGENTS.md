# Agent Instructions (`AGENTS.md`)

## Project Structure & References
- **Scenario Context:** Read `incident_briefing.md` at the repo root (`incident_briefing.md` is reference context only and is never deployed or fetched over HTTP).
- **Architecture & Pitfalls:** Before modifying infrastructure, data ingestion/API routes, or Google Maps rendering, consult:
  - `docs/architecture/infrastructure.md` — GKE, Config Connector, GCS FUSE, AlloyDB IAM, and runtime `/`, `/.env`, `/api/*` contracts.
  - `docs/architecture/data-access.md` — `datasets/` -> GCS FUSE -> `Job/hso-ingest` (`api/ingest.js` + `api/schema.sql`) -> AlloyDB -> `api/server.js` (`/api/*`) guidelines and pitfalls.
  - `docs/architecture/maps-performance.md` — 60fps single-`<canvas>` `OverlayView`, Mercator + 2-anchor affine projection, DPR sprite caching, and `Uint8Array` overdraw culling.
- **Onboarding & Progress Tracking:**
  - Run the `hso-getting-started` skill (`.agents/skills/hso-getting-started/SKILL.md`) when configuring `manifests/config/infra.env`.
  - Run the `hso-status-update` skill (`.agents/skills/hso-status-update/SKILL.md`) to audit local/live progress against `status.md` and see what to do next (`investigation_guide.md`).
  - **Never update `status.md` without direct approval or an explicit request from the user.** Always ask and wait for confirmation before modifying `status.md`.

## Querying AlloyDB from Antigravity CLI

AlloyDB runs on a private VPC IP with Workload Identity + IAM database authentication via the `alloydb-auth-proxy` sidecar in `deploy/hso-console`.

### 1. AlloyDB MCP Server (Preferred)
`./scripts/mcp-alloydb.sh` opens an ephemeral `kubectl port-forward` to `deploy/hso-console:5432` and launches Google's **MCP Toolbox for Databases** (`npx -y @toolbox-sdk/server --prebuilt postgres --stdio`) authenticated as `hso-app-gsa@<PROJECT_ID>.iam`.

To register it in Antigravity CLI (`~/.gemini/config/mcp_config.json`, or via **MCP Servers > Manage MCP Servers > View raw config**):
```json
{
  "mcpServers": {
    "alloydb": {
      "command": "/absolute/path/to/repo/scripts/mcp-alloydb.sh"
    }
  }
}
```
Once loaded, use the `alloydb` MCP tools (`execute_sql`, `list_tables`, `get_query_plan`, `database_overview`, etc.) directly.

##
When asked to investigate incidents, you will only use data that is available in AlloyDB. If a definitive root cause cannot be determined, you will report that. If a definitive root cause can be determined, you will explain the reasoning sourcing specific data. When reporting finding identify them in terms of inference or proven fact. Inferences are not to be use as conclusive evidence. If further data is needed, indicate so.