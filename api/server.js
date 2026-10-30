/* ==========================================================================
   Starter API Server: AlloyDB -> JSON

   Connects to AlloyDB through the AlloyDB Auth Proxy sidecar (127.0.0.1:5432
   with IAM database authentication — see ./lib/db.js). Nginx proxies /api/*
   requests to this server on port 8080.
   ========================================================================== */

import express from "express";
import { pool, waitForDb } from "./lib/db.js";

const app = express();
const PORT = Number(process.env.PORT || 8080);

app.disable("x-powered-by");
app.set("etag", "strong");
app.use(express.json());

const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/* ---------- Health ---------- */
app.get("/api/health", asyncRoute(async (_req, res) => {
  try {
    const r = await pool.query("SELECT now() AS now, current_user AS usr");
    res.json({ ok: true, db: { now: r.rows[0].now, user: r.rows[0].usr } });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
}));

/* ---------- Application Routes ---------- */
// TODO: Add your /api/* endpoints querying AlloyDB via `pool` here.

/* ---------- Fallbacks ---------- */
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  console.error("[api] error:", err);
  res.status(500).json({ error: err.message || "Internal error" });
});

const server = app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});

// Don't block startup on the DB (k8s probes hit /api/health), but log readiness.
waitForDb({ attempts: 60, delayMs: 2000 })
  .then(() => console.log("[api] database connection OK"))
  .catch((err) => console.error("[api] database never became ready:", err.message));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`[api] ${sig} received, shutting down`);
    server.close(() => pool.end().finally(() => process.exit(0)));
  });
}
