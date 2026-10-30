# Agent Instructions (`AGENTS.md`)

## Project Structure & References
- **Scenario Context:** Read `incident_briefing.md` at the repo root (`incident_briefing.md` is reference context only and is never deployed or fetched over HTTP).
- **Architecture & Pitfalls:** Before modifying infrastructure, data ingestion/API routes, or Google Maps rendering, consult:
  - `docs/architecture/infrastructure.md` — GKE, Config Connector, GCS FUSE, AlloyDB IAM, and runtime `/`, `/.env`, `/api/*` contracts.
  - `docs/architecture/data-access.md` — `datasets/` -> GCS FUSE -> `Job/hso-ingest` (`api/ingest.js` + `api/schema.sql`) -> AlloyDB -> `api/server.js` (`/api/*`) guidelines and pitfalls.
  - `docs/architecture/maps-performance.md` — 60fps single-`<canvas>` `OverlayView`, Mercator + 2-anchor affine projection, DPR sprite caching, and `Uint8Array` overdraw culling.
- **Onboarding:** Run the `getting-started` skill (`.agents/skills/getting-started/SKILL.md`) when configuring `k8s/config/infra.env`.

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

### 2. CLI Fallback (`kubectl exec`)
If the `alloydb` MCP server is not yet active in the current session, execute SQL through the `hso-api` container's pre-configured `pg.Pool` (`api/lib/db.js`):
```bash
kubectl exec deploy/hso-console -c hso-api -- node -e '
  import("./lib/db.js").then(async ({ pool }) => {
    const res = await pool.query(process.argv[1]);
    console.log(JSON.stringify(res.rows, null, 2));
    await pool.end();
  });
' "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
```
