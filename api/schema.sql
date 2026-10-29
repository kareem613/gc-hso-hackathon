-- AlloyDB schema for the Incident Response Geospatial Console.
-- Applied idempotently by ingest.js before every (re)load.

CREATE TABLE IF NOT EXISTS wlc_events (
  id          BIGSERIAL PRIMARY KEY,
  epoch       BIGINT        NOT NULL,
  controller  TEXT          NOT NULL,
  ap_id       TEXT          NOT NULL,
  ssid        TEXT,
  event       TEXT          NOT NULL,
  mac         TEXT,
  hostname    TEXT,
  snr_db      INTEGER,
  status      TEXT,
  duration_s  INTEGER,
  reason      TEXT,
  util_pct    INTEGER,
  is_anomaly  BOOLEAN       NOT NULL DEFAULT FALSE,
  attrs       JSONB         NOT NULL DEFAULT '{}'::jsonb,
  raw         TEXT          NOT NULL
);
CREATE INDEX IF NOT EXISTS wlc_events_epoch_idx ON wlc_events (epoch);
CREATE INDEX IF NOT EXISTS wlc_events_ap_id_idx ON wlc_events (ap_id);

CREATE TABLE IF NOT EXISTS radar_tracks (
  track_id            TEXT PRIMARY KEY,
  callsign            TEXT NOT NULL,
  radar_type          TEXT NOT NULL,
  transponder_squawk  TEXT NOT NULL,
  rcs_profile         TEXT NOT NULL,
  remark              TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS radar_pings (
  id             BIGSERIAL PRIMARY KEY,
  track_id       TEXT              NOT NULL REFERENCES radar_tracks (track_id) ON DELETE CASCADE,
  epoch          BIGINT            NOT NULL,
  timestamp_utc  TEXT              NOT NULL,
  lat            DOUBLE PRECISION  NOT NULL,
  lng            DOUBLE PRECISION  NOT NULL,
  altitude_ft    DOUBLE PRECISION,
  speed_kts      DOUBLE PRECISION,
  heading_deg    DOUBLE PRECISION  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS radar_pings_track_epoch_idx ON radar_pings (track_id, epoch);
CREATE INDEX IF NOT EXISTS radar_pings_epoch_idx ON radar_pings (epoch);

CREATE TABLE IF NOT EXISTS road_segments (
  segment_id       TEXT PRIMARY KEY,
  name             TEXT    NOT NULL,
  road_class       TEXT    NOT NULL,
  speed_limit_kmh  INTEGER NOT NULL,
  path             JSONB   NOT NULL,  -- [{"lat":..,"lng":..}, ...]
  source_file      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS road_snapshots (
  id             BIGSERIAL PRIMARY KEY,
  segment_id     TEXT    NOT NULL REFERENCES road_segments (segment_id) ON DELETE CASCADE,
  epoch          BIGINT  NOT NULL,
  timestamp_est  TEXT    NOT NULL,
  speed_kmh      INTEGER NOT NULL,
  congestion     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS road_snapshots_segment_epoch_idx ON road_snapshots (segment_id, epoch);

CREATE TABLE IF NOT EXISTS forum_threads (
  thread_id        TEXT PRIMARY KEY,
  subforum         TEXT,
  title            TEXT NOT NULL,
  author           TEXT,
  posted_relative  TEXT,
  created_at_utc   TIMESTAMPTZ,
  epoch            BIGINT,
  views            INTEGER,
  replies_count    INTEGER,
  body             TEXT
);
CREATE INDEX IF NOT EXISTS forum_threads_epoch_idx ON forum_threads (epoch);

CREATE TABLE IF NOT EXISTS forum_posts (
  id               BIGSERIAL PRIMARY KEY,
  thread_id        TEXT    NOT NULL REFERENCES forum_threads (thread_id) ON DELETE CASCADE,
  post_number      INTEGER NOT NULL,
  author           TEXT,
  timestamp_utc    TIMESTAMPTZ,
  epoch            BIGINT,
  posted_relative  TEXT,
  body             TEXT
);
CREATE INDEX IF NOT EXISTS forum_posts_thread_idx ON forum_posts (thread_id, post_number);

-- Bookkeeping for ingest runs (lets the API/UI report provenance).
CREATE TABLE IF NOT EXISTS dataset_loads (
  dataset      TEXT PRIMARY KEY,
  source_file  TEXT NOT NULL,
  row_count    BIGINT NOT NULL,
  loaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
