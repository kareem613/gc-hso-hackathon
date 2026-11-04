#!/usr/bin/env node
/* ==========================================================================
   Starter Dataset Ingest Job: GCS FUSE (/datasets) -> AlloyDB

   Executed in GKE by the one-shot `hso-ingest` Job (`./scripts/ingest-datasets.sh`),
   where `DATASETS_DIR` (/datasets) is mounted read-only from `gs://<PROJECT_ID>-datasets/`
   via GCS FUSE and AlloyDB is reachable on 127.0.0.1:5432 via the Auth Proxy sidecar.
   ========================================================================== */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pool, waitForDb } from "./lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASETS_DIR = process.env.DATASETS_DIR || path.resolve(__dirname, "../datasets");

async function listDatasetFiles() {
  try {
    const entries = await readdir(DATASETS_DIR, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function applySchema() {
  const sql = await readFile(path.join(__dirname, "schema.sql"), "utf8");
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "")
    .trim();
  if (!stripped) {
    console.log("==> schema.sql has no DDL statements yet (skipping).");
    return;
  }
  await pool.query(sql);
  console.log("==> Applied schema.sql.");
}

async function main() {
  console.log(
    `==> Starting ingest from ${DATASETS_DIR} into AlloyDB (${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || "postgres"} as ${process.env.PGUSER || "<default>"})`
  );
  await waitForDb();
  await applySchema();

  const files = await listDatasetFiles();
  if (files.length === 0) {
    console.log(`==> No dataset files found in ${DATASETS_DIR}.`);
  } else {
    console.log(`==> Discovered ${files.length} dataset file(s) in ${DATASETS_DIR}: ${files.join(", ")}`);
  }

  // TODO: Parse dataset files from DATASETS_DIR and insert records into AlloyDB.
  // Helpers available in ./lib/db.js: `withTransaction(fn)` and `bulkInsert(client, table, columns, rows)`.
  console.log("==> Starter ingest job finished (implement dataset parsing and loading in api/ingest.js).");
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("Ingest failed:", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
