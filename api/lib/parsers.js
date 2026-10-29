/* ==========================================================================
   Server-side dataset parsers (Node.js)

   These mirror the browser parsers in src/data-reader.js so that records
   stored in AlloyDB have exactly the same shape the frontend expects. The
   only runtime difference is XML parsing (fast-xml-parser instead of the
   browser DOMParser).
   ========================================================================== */

import { XMLParser } from "fast-xml-parser";

const KNOWN_WLC_KEYS = new Set([
  "ap_id",
  "ssid",
  "event",
  "mac",
  "hostname",
  "snr_db",
  "status",
  "duration_s",
  "reason",
  "util_pct",
]);

function toIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function toFloatOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

function parseEstTimestamp(raw) {
  const ts = String(raw || "").trim().replace(" ", "T");
  if (!ts) return NaN;
  const hasTz = /[Zz]|[+-]\d{2}:\d{2}$/.test(ts);
  return Math.floor(Date.parse(hasTz ? ts : `${ts}-05:00`) / 1000);
}

/**
 * @param {string} text
 * @returns {Array<Object>} events sorted by epoch
 */
export function parseWlcSyslog(text) {
  if (!text || !text.trim()) return [];
  const events = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const epoch = parseInt(parts[0], 10);
    if (Number.isNaN(epoch)) continue;
    const controller = parts[1];
    const kv = {};
    for (let i = 2; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf("=");
      if (eqIdx > 0) {
        const k = parts[i].slice(0, eqIdx);
        const v = parts[i].slice(eqIdx + 1).replace(/^"|"$/g, "");
        kv[k] = v;
      }
    }
    const isAnomaly =
      Boolean(kv.hostname && kv.hostname.startsWith("GTV2-")) ||
      Boolean(kv.mac && kv.mac.toUpperCase().startsWith("24:0A:C4")) ||
      kv.event === "CHANNEL_UTIL_HIGH" ||
      kv.event === "ASSOC_TABLE_SATURATED";

    const attrs = {};
    for (const [k, v] of Object.entries(kv)) {
      if (!KNOWN_WLC_KEYS.has(k)) attrs[k] = v;
    }

    events.push({
      raw: line,
      epoch,
      controller,
      ap_id: kv.ap_id || "SYSTEM",
      ssid: kv.ssid || null,
      event: kv.event || "LOG",
      mac: kv.mac || null,
      hostname: kv.hostname || null,
      snr_db: toIntOrNull(kv.snr_db),
      status: kv.status || null,
      duration_s: toIntOrNull(kv.duration_s),
      reason: kv.reason || null,
      util_pct: toIntOrNull(kv.util_pct),
      isAnomaly,
      attrs,
    });
  }
  events.sort((a, b) => a.epoch - b.epoch);
  return events;
}

/**
 * @param {string} xmlText
 * @returns {Array<Object>} tracks with pings sorted by epoch
 */
export function parseRadarXml(xmlText) {
  if (!xmlText || !xmlText.trim()) return [];
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    isArray: (name) => name === "Track" || name === "Ping",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
  });
  const doc = parser.parse(xmlText);

  // Tracks may be nested under <RadarFeed><Tracks><Track> or directly under <RadarFeed>.
  const tracks = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "Track" && Array.isArray(value)) {
        tracks.push(...value);
      } else if (value && typeof value === "object") {
        walk(value);
      }
    }
  };
  walk(doc);

  return tracks.map((tr) => {
    const track_id = tr.track_id || "TRK";
    const callsign = tr.callsign || "UNKN";
    const radar_type = tr.radar_type || "PRIMARY_PSR";
    const transponder_squawk = tr.transponder_squawk || "NONE";
    const rcs_profile = tr.rcs_profile || "UNKNOWN";
    const remarkRaw = tr.ControllerRemark;
    const remark =
      typeof remarkRaw === "string"
        ? remarkRaw.trim()
        : remarkRaw && typeof remarkRaw === "object" && "#text" in remarkRaw
        ? String(remarkRaw["#text"]).trim()
        : "";

    const pings = (tr.Ping || []).map((p) => {
      const timestamp_utc = p.timestamp_utc;
      return {
        timestamp_utc,
        epoch: Math.floor(Date.parse(timestamp_utc) / 1000),
        lat: parseFloat(p.lat),
        lng: parseFloat(p.lon),
        altitude_ft: toFloatOrNull(p.altitude_ft),
        speed_kts: toFloatOrNull(p.speed_kts),
        heading_deg: parseFloat(p.heading_deg) || 0,
      };
    });
    pings.sort((a, b) => a.epoch - b.epoch);

    return {
      track_id,
      callsign,
      radar_type,
      transponder_squawk,
      rcs_profile,
      remark,
      pings,
    };
  });
}

/**
 * @param {string} jsonText
 * @returns {Array<Object>} segments with snapshots sorted by epoch
 */
export function parseTrafficJson(jsonText) {
  if (!jsonText) return [];
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const rawSegments = Array.isArray(data?.segments) ? data.segments : [];
  return rawSegments.map((seg) => {
    const path = (seg.path || []).map(([lat, lng]) => ({ lat, lng }));
    const snapshots = (seg.snapshots || [])
      .map((s) => ({
        timestamp_est: s.timestamp_est,
        epoch: parseEstTimestamp(s.timestamp_est),
        speed_kmh: Number(s.speed_kmh) || 0,
        congestion: s.congestion || "free",
      }))
      .filter((s) => !Number.isNaN(s.epoch))
      .sort((a, b) => a.epoch - b.epoch);

    return {
      segment_id: seg.segment_id || "SEG",
      name: seg.name || "Road Segment",
      road_class: seg.road_class || "Road",
      speed_limit_kmh: Number(seg.speed_limit_kmh) || 50,
      path,
      snapshots,
    };
  });
}

/**
 * @param {string} jsonText
 * @returns {Array<Object>} forum threads with posts
 */
export function parseForumJson(jsonText) {
  if (!jsonText) return [];
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const threads = Array.isArray(data?.threads) ? data.threads : [];
  return threads.map((t) => {
    const createdEpoch = t.created_at_utc
      ? Math.floor(Date.parse(t.created_at_utc) / 1000)
      : null;
    const posts = (t.posts || []).map((p, idx) => ({
      post_number: Number(p.post_number) || idx + 1,
      author: p.author || null,
      timestamp_utc: p.timestamp_utc || null,
      epoch: p.timestamp_utc ? Math.floor(Date.parse(p.timestamp_utc) / 1000) : null,
      posted_relative: p.posted_relative || null,
      body: p.body || null,
    }));
    return {
      thread_id: t.thread_id,
      subforum: t.subforum || null,
      title: t.title || "(untitled)",
      author: t.author || null,
      posted_relative: t.posted_relative || null,
      created_at_utc: t.created_at_utc || null,
      epoch: Number.isNaN(createdEpoch) ? null : createdEpoch,
      views: toIntOrNull(t.views),
      replies_count: toIntOrNull(t.replies_count),
      body: t.body || null,
      posts,
    };
  });
}
