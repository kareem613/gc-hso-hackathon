#!/usr/bin/env node
/* ==========================================================================
   Dataset ingest: files -> AlloyDB

   Reads the raw dataset files from DATASETS_DIR (the GCS FUSE mount in
   GKE, or ./datasets locally), parses them with the shared parsers, and
   loads them into AlloyDB. Idempotent: each dataset's tables are truncated
   and reloaded inside a single transaction.
   ========================================================================== */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pool, withTransaction, bulkInsert, waitForDb } from "./lib/db.js";
import {
  parseWlcSyslog,
  parseRadarXml,
  parseTrafficJson,
  parseForumJson,
} from "./lib/parsers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASETS_DIR = process.env.DATASETS_DIR || path.resolve(__dirname, "../datasets");

async function readOptional(name) {
  try {
    return await readFile(path.join(DATASETS_DIR, name), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}

async function applySchema() {
  const sql = await readFile(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
}

async function recordLoad(client, dataset, sourceFile, rowCount) {
  await client.query(
    `INSERT INTO dataset_loads (dataset, source_file, row_count, loaded_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (dataset) DO UPDATE
       SET source_file = EXCLUDED.source_file,
           row_count = EXCLUDED.row_count,
           loaded_at = now()`,
    [dataset, sourceFile, rowCount]
  );
}

async function loadWlc() {
  const file = "wlc_syslog.log";
  const events = parseWlcSyslog(await readOptional(file));
  return withTransaction(async (client) => {
    await client.query("TRUNCATE wlc_events RESTART IDENTITY");
    const n = await bulkInsert(
      client,
      "wlc_events",
      [
        "epoch", "controller", "ap_id", "ssid", "event", "mac", "hostname",
        "snr_db", "status", "duration_s", "reason", "util_pct", "is_anomaly",
        "attrs", "raw",
      ],
      events.map((e) => [
        e.epoch, e.controller, e.ap_id, e.ssid, e.event, e.mac, e.hostname,
        e.snr_db, e.status, e.duration_s, e.reason, e.util_pct, e.isAnomaly,
        JSON.stringify(e.attrs), e.raw,
      ])
    );
    await recordLoad(client, "wlc_events", file, n);
    return { table: "wlc_events", rows: n };
  });
}

async function loadRadar() {
  const file = "yow_tower_radar.xml";
  const tracks = parseRadarXml(await readOptional(file));
  return withTransaction(async (client) => {
    await client.query("TRUNCATE radar_pings, radar_tracks RESTART IDENTITY");
    const t = await bulkInsert(
      client,
      "radar_tracks",
      ["track_id", "callsign", "radar_type", "transponder_squawk", "rcs_profile", "remark"],
      tracks.map((tr) => [
        tr.track_id, tr.callsign, tr.radar_type, tr.transponder_squawk, tr.rcs_profile, tr.remark,
      ])
    );
    const pingRows = [];
    for (const tr of tracks) {
      for (const p of tr.pings) {
        pingRows.push([
          tr.track_id, p.epoch, p.timestamp_utc, p.lat, p.lng,
          p.altitude_ft, p.speed_kts, p.heading_deg,
        ]);
      }
    }
    const p = await bulkInsert(
      client,
      "radar_pings",
      ["track_id", "epoch", "timestamp_utc", "lat", "lng", "altitude_ft", "speed_kts", "heading_deg"],
      pingRows
    );
    await recordLoad(client, "radar_tracks", file, t);
    await recordLoad(client, "radar_pings", file, p);
    return { table: "radar_tracks/radar_pings", rows: `${t}/${p}` };
  });
}

async function loadTraffic() {
  let file = "";
  let text = "";
  for (const candidate of ["road_traffic.json", "road_traffic_sample.json"]) {
    text = await readOptional(candidate);
    if (text) {
      file = candidate;
      break;
    }
  }
  const segments = parseTrafficJson(text);
  return withTransaction(async (client) => {
    await client.query("TRUNCATE road_snapshots, road_segments RESTART IDENTITY");
    const s = await bulkInsert(
      client,
      "road_segments",
      ["segment_id", "name", "road_class", "speed_limit_kmh", "path", "source_file"],
      segments.map((seg) => [
        seg.segment_id, seg.name, seg.road_class, seg.speed_limit_kmh,
        JSON.stringify(seg.path), file || "road_traffic.json",
      ])
    );
    const snapRows = [];
    for (const seg of segments) {
      for (const snap of seg.snapshots) {
        snapRows.push([seg.segment_id, snap.epoch, snap.timestamp_est, snap.speed_kmh, snap.congestion]);
      }
    }
    const n = await bulkInsert(
      client,
      "road_snapshots",
      ["segment_id", "epoch", "timestamp_est", "speed_kmh", "congestion"],
      snapRows
    );
    await recordLoad(client, "road_segments", file || "road_traffic.json", s);
    await recordLoad(client, "road_snapshots", file || "road_traffic.json", n);
    return { table: "road_segments/road_snapshots", rows: `${s}/${n}` };
  });
}

async function loadForum() {
  const file = "ottawa_tech_forums.json";
  const threads = parseForumJson(await readOptional(file));
  return withTransaction(async (client) => {
    await client.query("TRUNCATE forum_posts, forum_threads RESTART IDENTITY");
    const t = await bulkInsert(
      client,
      "forum_threads",
      [
        "thread_id", "subforum", "title", "author", "posted_relative",
        "created_at_utc", "epoch", "views", "replies_count", "body",
      ],
      threads.map((th) => [
        th.thread_id, th.subforum, th.title, th.author, th.posted_relative,
        th.created_at_utc, th.epoch, th.views, th.replies_count, th.body,
      ])
    );
    const postRows = [];
    for (const th of threads) {
      for (const p of th.posts) {
        postRows.push([
          th.thread_id, p.post_number, p.author, p.timestamp_utc, p.epoch, p.posted_relative, p.body,
        ]);
      }
    }
    const p = await bulkInsert(
      client,
      "forum_posts",
      ["thread_id", "post_number", "author", "timestamp_utc", "epoch", "posted_relative", "body"],
      postRows
    );
    await recordLoad(client, "forum_threads", file, t);
    await recordLoad(client, "forum_posts", file, p);
    return { table: "forum_threads/forum_posts", rows: `${t}/${p}` };
  });
}

async function main() {
  console.log(`==> Ingesting datasets from ${DATASETS_DIR} into AlloyDB (${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || "postgres"} as ${process.env.PGUSER || "<default>"})`);
  await waitForDb();
  console.log("==> Applying schema...");
  await applySchema();

  const results = [];
  for (const [label, fn] of [
    ["WLC syslog", loadWlc],
    ["Radar tracks", loadRadar],
    ["Road traffic", loadTraffic],
    ["Forum threads", loadForum],
  ]) {
    console.log(`==> Loading ${label}...`);
    const r = await fn();
    console.log(`    ${r.table}: ${r.rows} rows`);
    results.push(r);
  }

  console.log("==> Ingest complete.");
  console.table(results);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("Ingest failed:", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
