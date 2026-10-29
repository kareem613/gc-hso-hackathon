/* ==========================================================================
   HSO API server: AlloyDB -> JSON for the frontend ApiDataReader

   Each endpoint returns records in exactly the shape the browser parsers in
   src/data-reader.js produce, so the frontend's ApiDataReader can reuse the
   same in-memory windowing logic as FileDataReader. All endpoints accept
   optional ?start=<epoch>&end=<epoch> for server-side range filtering.
   ========================================================================== */

import express from "express";
import { pool, waitForDb } from "./lib/db.js";

const app = express();
const PORT = Number(process.env.PORT || 8080);

app.disable("x-powered-by");
app.set("etag", "strong");

function parseWindow(req) {
  const start = req.query.start !== undefined ? Number(req.query.start) : undefined;
  const end = req.query.end !== undefined ? Number(req.query.end) : undefined;
  return {
    start: Number.isFinite(start) ? start : undefined,
    end: Number.isFinite(end) ? end : undefined,
  };
}

/** Build "epoch BETWEEN ..." fragments for an optional window. */
function epochWhere(col, { start, end }, params) {
  const clauses = [];
  if (start !== undefined) {
    params.push(start);
    clauses.push(`${col} >= $${params.length}`);
  }
  if (end !== undefined) {
    params.push(end);
    clauses.push(`${col} <= $${params.length}`);
  }
  return clauses;
}

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

/* ---------- Dataset provenance ---------- */
app.get("/api/datasets", asyncRoute(async (_req, res) => {
  const r = await pool.query(
    "SELECT dataset, source_file, row_count, loaded_at FROM dataset_loads ORDER BY dataset"
  );
  res.json({ datasets: r.rows });
}));

/* ---------- Timeline bounds across all datasets ---------- */
app.get("/api/timeline-bounds", asyncRoute(async (_req, res) => {
  const r = await pool.query(`
    SELECT MIN(e) AS min_epoch, MAX(e) AS max_epoch, COUNT(*) AS n FROM (
      SELECT epoch AS e FROM wlc_events
      UNION ALL SELECT epoch FROM radar_pings
      UNION ALL SELECT epoch FROM road_snapshots
    ) t`);
  const row = r.rows[0];
  const hasData = Number(row.n) > 0;
  res.json({
    hasData,
    minEpoch: hasData ? Number(row.min_epoch) : null,
    maxEpoch: hasData ? Number(row.max_epoch) : null,
  });
}));

/* ---------- WLC syslog events ---------- */
app.get("/api/wlc-events", asyncRoute(async (req, res) => {
  const win = parseWindow(req);
  const params = [];
  const where = epochWhere("epoch", win, params);
  const sql = `
    SELECT epoch, controller, ap_id, ssid, event, mac, hostname, snr_db, status,
           duration_s, reason, util_pct, is_anomaly AS "isAnomaly", attrs, raw
      FROM wlc_events
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY epoch, id`;
  const [rows, total] = await Promise.all([
    pool.query(sql, params),
    pool.query("SELECT COUNT(*)::bigint AS n FROM wlc_events"),
  ]);
  res.json({
    available: Number(total.rows[0].n) > 0,
    events: rows.rows,
    totalEvents: Number(total.rows[0].n),
  });
}));

/* ---------- Radar tracks + pings ---------- */
app.get("/api/radar-tracks", asyncRoute(async (req, res) => {
  const win = parseWindow(req);
  const params = [];
  const where = epochWhere("p.epoch", win, params);
  const sql = `
    SELECT t.track_id, t.callsign, t.radar_type, t.transponder_squawk, t.rcs_profile, t.remark,
           (SELECT COUNT(*)::bigint FROM radar_pings a WHERE a.track_id = t.track_id) AS "totalTrackPings",
           COALESCE(
             (SELECT json_agg(json_build_object(
                        'timestamp_utc', p.timestamp_utc,
                        'epoch', p.epoch,
                        'lat', p.lat,
                        'lng', p.lng,
                        'altitude_ft', p.altitude_ft,
                        'speed_kts', p.speed_kts,
                        'heading_deg', p.heading_deg
                      ) ORDER BY p.epoch, p.id)
                FROM radar_pings p
               WHERE p.track_id = t.track_id
                 ${where.length ? "AND " + where.join(" AND ") : ""}),
             '[]'::json) AS pings
      FROM radar_tracks t
     ORDER BY t.track_id`;
  const [rows, totals] = await Promise.all([
    pool.query(sql, params),
    pool.query(`SELECT (SELECT COUNT(*) FROM radar_tracks)::bigint AS tracks,
                       (SELECT COUNT(*) FROM radar_pings)::bigint AS pings`),
  ]);
  const tracks = rows.rows.map((tr) => ({
    ...tr,
    totalTrackPings: Number(tr.totalTrackPings),
    isBioFlock: tr.rcs_profile === "BIO_FLOCK_NON_RIGID",
    isVfrSpecial:
      tr.rcs_profile === "ROTORCRAFT_LIGHT" ||
      tr.rcs_profile === "SEAPLANE_SINGLE_PROP" ||
      tr.rcs_profile === "LIGHT_SINGLE_PROP",
    isWeather: tr.rcs_profile === "WEATHER_PRECIP",
  }));
  res.json({
    available: Number(totals.rows[0].tracks) > 0,
    tracks,
    totalTracks: Number(totals.rows[0].tracks),
    totalPings: Number(totals.rows[0].pings),
  });
}));

/* ---------- Road traffic segments + snapshots ---------- */
app.get("/api/road-traffic", asyncRoute(async (req, res) => {
  const win = parseWindow(req);
  const params = [];
  const where = epochWhere("s.epoch", win, params);
  const sql = `
    SELECT g.segment_id, g.name, g.road_class, g.speed_limit_kmh, g.path, g.source_file,
           COALESCE(
             (SELECT json_agg(json_build_object(
                        'timestamp_est', s.timestamp_est,
                        'epoch', s.epoch,
                        'speed_kmh', s.speed_kmh,
                        'congestion', s.congestion
                      ) ORDER BY s.epoch, s.id)
                FROM road_snapshots s
               WHERE s.segment_id = g.segment_id
                 ${where.length ? "AND " + where.join(" AND ") : ""}),
             '[]'::json) AS snapshots
      FROM road_segments g
     ORDER BY g.segment_id`;
  const r = await pool.query(sql, params);
  const sourceFile = r.rows[0]?.source_file || "road_traffic.json";
  const segments = r.rows.map(({ source_file, ...seg }) => seg);
  res.json({
    available: segments.length > 0,
    sourceFile,
    segments,
    totalSegments: segments.length,
  });
}));

/* ---------- Collar telemetry (not ingested; dataset does not exist) ---------- */
app.get("/api/collar-telemetry", (_req, res) => {
  res.json({ available: false, points: [], totalPoints: 0, hardwareGroups: [] });
});

/* ---------- Forum threads (ingested; no UI yet) ---------- */
app.get("/api/forum-threads", asyncRoute(async (req, res) => {
  const win = parseWindow(req);
  const params = [];
  const where = epochWhere("t.epoch", win, params);
  const sql = `
    SELECT t.thread_id, t.subforum, t.title, t.author, t.posted_relative, t.created_at_utc,
           t.epoch, t.views, t.replies_count, t.body,
           COALESCE(
             (SELECT json_agg(json_build_object(
                        'post_number', p.post_number,
                        'author', p.author,
                        'timestamp_utc', p.timestamp_utc,
                        'epoch', p.epoch,
                        'posted_relative', p.posted_relative,
                        'body', p.body
                      ) ORDER BY p.post_number)
                FROM forum_posts p WHERE p.thread_id = t.thread_id),
             '[]'::json) AS posts
      FROM forum_threads t
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY t.epoch NULLS LAST, t.thread_id`;
  const r = await pool.query(sql, params);
  res.json({ available: r.rows.length > 0, threads: r.rows, totalThreads: r.rows.length });
}));

/* ---------- Fallbacks ---------- */
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, _req, res, _next) => {
  console.error("[api] error:", err);
  res.status(500).json({ error: err.message || "Internal error" });
});

const server = app.listen(PORT, () => {
  console.log(`[api] listening on :${PORT}`);
});

// Don't block startup on the DB (nginx/k8s probes hit /api/health), but log readiness.
waitForDb({ attempts: 60, delayMs: 2000 })
  .then(() => console.log("[api] database connection OK"))
  .catch((err) => console.error("[api] database never became ready:", err.message));

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`[api] ${sig} received, shutting down`);
    server.close(() => pool.end().finally(() => process.exit(0)));
  });
}
