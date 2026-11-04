/* ==========================================================================
   PostgreSQL / AlloyDB connection pool

   Connects through the AlloyDB Auth Proxy sidecar (localhost:5432 by
   default) which handles TLS and IAM authentication (--auto-iam-authn), so
   no password is required. PG* env vars follow libpq conventions.
   ========================================================================== */

import pg from "pg";

const { Pool } = pg;

// Return BIGINT (OID 20) as JS numbers; all our epochs fit comfortably in 2^53.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD || undefined,
  database: process.env.PGDATABASE || "postgres",
  max: Number(process.env.PGPOOL_MAX || 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

/**
 * Run fn(client) inside a transaction.
 * @template T
 * @param {(client: pg.PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Multi-row INSERT helper. Batches rows to stay under the Postgres
 * 65535-parameter limit.
 * @param {pg.PoolClient} client
 * @param {string} table
 * @param {string[]} columns
 * @param {any[][]} rows
 */
export async function bulkInsert(client, table, columns, rows) {
  if (rows.length === 0) return 0;
  const batchSize = Math.max(1, Math.floor(60_000 / columns.length));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = [];
    const tuples = batch.map((row, r) => {
      const placeholders = row.map((v, c) => {
        values.push(v);
        return `$${r * columns.length + c + 1}`;
      });
      return `(${placeholders.join(",")})`;
    });
    const sql = `INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")}`;
    const res = await client.query(sql, values);
    inserted += res.rowCount;
  }
  return inserted;
}

/**
 * Wait until the database accepts connections (the Auth Proxy sidecar may
 * start a few seconds after the app container).
 */
export async function waitForDb({ attempts = 30, delayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      lastErr = err;
      console.log(`[db] not ready (attempt ${i}/${attempts}): ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
