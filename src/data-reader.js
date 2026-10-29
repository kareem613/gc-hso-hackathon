/* ==========================================================================
   Data Reader Interface & Concrete File-Based Implementation
   ========================================================================== */

/**
 * Base interface for reading incident geospatial datasets.
 * Concrete implementations (e.g., FileDataReader, DatabaseDataReader) must
 * implement these async methods and return pure, storage-agnostic domain objects.
 */
export class DataReader {
  /**
   * @returns {Promise<{ hasData: boolean, minEpoch: number, maxEpoch: number }>}
   */
  async getTimelineBounds() {
    throw new Error("DataReader.getTimelineBounds() must be implemented by subclass");
  }

  /**
   * @returns {Promise<{
   *   facilityName: string,
   *   lat: number,
   *   lng: number,
   *   coordsLabel: string,
   *   accessPoints: Array<{ id: string, label: string, lat: number, lng: number, outdoor: boolean }>
   * }>}
   */
  async getFacilityBriefing() {
    throw new Error("DataReader.getFacilityBriefing() must be implemented by subclass");
  }

  /**
   * @param {{ startEpoch?: number, endEpoch?: number }} [window]
   * @returns {Promise<{
   *   available: boolean,
   *   events: Array<Object>,
   *   totalEvents: number
   * }>}
   */
  async getWlcEvents(window = {}) {
    throw new Error("DataReader.getWlcEvents() must be implemented by subclass");
  }

  /**
   * @param {{ startEpoch?: number, endEpoch?: number }} [window]
   * @returns {Promise<{
   *   available: boolean,
   *   tracks: Array<Object>,
   *   totalTracks: number,
   *   totalPings: number
   * }>}
   */
  async getRadarTracks(window = {}) {
    throw new Error("DataReader.getRadarTracks() must be implemented by subclass");
  }

  /**
   * @param {{ startEpoch?: number, endEpoch?: number }} [window]
   * @returns {Promise<{
   *   available: boolean,
   *   points: Array<Object>,
   *   totalPoints: number,
   *   hardwareGroups: Array<{
   *     hw: string,
   *     desc: string,
   *     isGtv2: boolean,
   *     tagCount: number,
   *     totalPoints: number,
   *     windowPoints: number
   *   }>
   * }>}
   */
  async getCollarTelemetry(window = {}) {
    throw new Error("DataReader.getCollarTelemetry() must be implemented by subclass");
  }

  /**
   * @param {{ startEpoch?: number, endEpoch?: number }} [window]
   * @returns {Promise<{
   *   available: boolean,
   *   sourceFile: string,
   *   segments: Array<Object>,
   *   totalSegments: number,
   *   evalEpoch: number
   * }>}
   */
  async getRoadTraffic(window = {}) {
    throw new Error("DataReader.getRoadTraffic() must be implemented by subclass");
  }
}

/* ==========================================================================
   Internal Helpers & Static File Parsers
   ========================================================================== */

async function yieldToMain() {
  if ("scheduler" in globalThis && "yield" in globalThis.scheduler) {
    return await globalThis.scheduler.yield();
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function findEpochRangeIndices(sortedArr, startEp, endEp) {
  if (startEp === undefined && endEp === undefined) {
    return [0, sortedArr.length];
  }
  const minEp = startEp ?? -Infinity;
  const maxEp = endEp ?? Infinity;

  let lo = 0;
  let hi = sortedArr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedArr[mid].epoch < minEp) lo = mid + 1;
    else hi = mid;
  }
  const startIdx = lo;

  hi = sortedArr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedArr[mid].epoch <= maxEp) lo = mid + 1;
    else hi = mid;
  }
  return [startIdx, lo];
}

function parseWlcSyslog(text) {
  if (!text || !text.trim()) return [];
  const lines = text.trim().split(/\r?\n/);
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
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

    events.push({
      raw: line,
      epoch,
      controller,
      ap_id: kv.ap_id || "SYSTEM",
      ssid: kv.ssid || null,
      event: kv.event || "LOG",
      mac: kv.mac || null,
      hostname: kv.hostname || null,
      snr_db: kv.snr_db ? parseInt(kv.snr_db, 10) : null,
      status: kv.status || null,
      duration_s: kv.duration_s ? parseInt(kv.duration_s, 10) : null,
      reason: kv.reason || null,
      util_pct: kv.util_pct ? parseInt(kv.util_pct, 10) : null,
      isAnomaly,
    });
  }
  events.sort((a, b) => a.epoch - b.epoch);
  return events;
}

function parseRadarXml(xmlText) {
  if (!xmlText || !xmlText.trim()) return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const trackEls = Array.from(doc.querySelectorAll("Track"));

  return trackEls.map((tr) => {
    const track_id = tr.getAttribute("track_id") || "TRK";
    const callsign = tr.getAttribute("callsign") || "UNKN";
    const radar_type = tr.getAttribute("radar_type") || "PRIMARY_PSR";
    const transponder_squawk = tr.getAttribute("transponder_squawk") || "NONE";
    const rcs_profile = tr.getAttribute("rcs_profile") || "UNKNOWN";
    const remark = tr.querySelector("ControllerRemark")?.textContent?.trim() || "";
    const isBioFlock = rcs_profile === "BIO_FLOCK_NON_RIGID";
    const isVfrSpecial =
      rcs_profile === "ROTORCRAFT_LIGHT" ||
      rcs_profile === "SEAPLANE_SINGLE_PROP" ||
      rcs_profile === "LIGHT_SINGLE_PROP";
    const isWeather = rcs_profile === "WEATHER_PRECIP";

    const pings = Array.from(tr.querySelectorAll("Ping")).map((p) => {
      const timestamp_utc = p.getAttribute("timestamp_utc");
      const epoch = Math.floor(Date.parse(timestamp_utc) / 1000);
      const lat = parseFloat(p.getAttribute("lat"));
      const lng = parseFloat(p.getAttribute("lon"));
      const heading_deg = parseFloat(p.getAttribute("heading_deg")) || 0;
      return {
        timestamp_utc,
        epoch,
        lat,
        lng,
        altitude_ft: parseFloat(p.getAttribute("altitude_ft")),
        speed_kts: parseFloat(p.getAttribute("speed_kts")),
        heading_deg,
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
      isBioFlock,
      isVfrSpecial,
      isWeather,
      pings,
    };
  });
}

function parseCollarCsv(csvText) {
  if (!csvText || !csvText.trim()) return [];
  const lines = csvText.trim().split(/\r?\n/);
  const rows = [];
  let lastTsRaw = "";
  let lastEpoch = NaN;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      !line ||
      line.startsWith("#") ||
      line.startsWith("timestamp,") ||
      line.startsWith("timestamp_est,") ||
      line.startsWith("ts_local_est,")
    ) {
      continue;
    }
    const parts = line.split(",");
    if (parts.length < 8) continue;
    const [
      timestamp_est,
      tag_id,
      collar_hw,
      latStr,
      lngStr,
      altStr,
      speedStr,
      hdgStr,
    ] = parts;
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

    // Cache last parsed timestamp string (cuts 99.6% of Date.parse calls across 35k+ rows)
    let epoch = lastEpoch;
    if (timestamp_est !== lastTsRaw) {
      lastTsRaw = timestamp_est;
      const rawTs = timestamp_est.trim().replace(" ", "T");
      const hasTz = /[Zz]|[+-]\d{2}:\d{2}$/.test(rawTs);
      epoch = Math.floor(
        Date.parse(hasTz ? rawTs : `${rawTs}-05:00`) / 1000
      );
      lastEpoch = epoch;
    }
    if (Number.isNaN(epoch)) continue;

    rows.push({
      timestamp_est,
      epoch,
      tag_id,
      collar_hw,
      lat,
      lng,
      altitude_m: parseFloat(altStr),
      speed_kmh: parseFloat(speedStr),
      heading_deg: parseFloat(hdgStr),
      isGtv2: collar_hw === "GTV2",
    });
  }
  rows.sort((a, b) => a.epoch - b.epoch);
  return rows;
}

function parseIncidentBriefing(mdText, wlcEvents) {
  let facilityName = "Carling Campus Government Complex";
  let lat = 45.3507;
  let lng = -75.8518;
  let coordsLabel = "45.3507° N, -75.8518° W";

  if (mdText) {
    const facMatch = mdText.match(/\*\*Facility:\*\*\s*([^\n(]+)/i);
    if (facMatch && facMatch[1].trim()) {
      facilityName = facMatch[1].trim();
    }

    const coordMatch = mdText.match(
      /([0-9]+\.[0-9]+)°\s*([NS]),\s*(-?[0-9]+\.[0-9]+)°\s*([EW])/i
    );
    if (coordMatch) {
      let parsedLat = parseFloat(coordMatch[1]);
      if (coordMatch[2].toUpperCase() === "S") parsedLat = -parsedLat;
      let parsedLng = parseFloat(coordMatch[3]);
      if (coordMatch[4].toUpperCase() === "W" && parsedLng > 0) {
        parsedLng = -parsedLng;
      }
      if (!Number.isNaN(parsedLat) && !Number.isNaN(parsedLng)) {
        lat = parsedLat;
        lng = parsedLng;
        coordsLabel = `${Math.abs(lat).toFixed(4)}° ${
          lat >= 0 ? "N" : "S"
        }, ${lng.toFixed(4)}° ${lng <= 0 ? "W" : "E"}`;
      }
    }
  }

  const outdoorSet = new Set();
  if (mdText) {
    const apMatches = mdText.matchAll(/`(AP-[A-Za-z0-9-]+)`/g);
    for (const m of apMatches) {
      outdoorSet.add(m[1]);
    }
  }
  if (outdoorSet.size === 0) {
    outdoorSet.add("AP-West-Gate");
    outdoorSet.add("AP-Central-Courtyard");
    outdoorSet.add("AP-East-Pavilion");
  }

  const seenAps = new Set();
  const accessPoints = [];
  for (const apId of outdoorSet) {
    seenAps.add(apId);
    accessPoints.push({
      id: apId,
      label: `${apId} (Outdoor)`,
      lat,
      lng,
      outdoor: true,
    });
  }
  for (const ev of wlcEvents) {
    if (ev.ap_id && ev.ap_id !== "SYSTEM" && !seenAps.has(ev.ap_id)) {
      seenAps.add(ev.ap_id);
      accessPoints.push({
        id: ev.ap_id,
        label: `${ev.ap_id} (Indoor)`,
        lat,
        lng,
        outdoor: outdoorSet.has(ev.ap_id),
      });
    }
  }

  if (accessPoints.length === 0) {
    accessPoints.push(
      { id: "AP-West-Gate", label: "AP-West-Gate (Outdoor)", lat, lng, outdoor: true },
      { id: "AP-Central-Courtyard", label: "AP-Central-Courtyard (Outdoor)", lat, lng, outdoor: true },
      { id: "AP-East-Pavilion", label: "AP-East-Pavilion (Outdoor)", lat, lng, outdoor: true }
    );
  }

  return {
    facilityName,
    lat,
    lng,
    coordsLabel,
    accessPoints,
  };
}

function classifyCongestionForSpeed(speedKmh, limitKmh) {
  const ratio = limitKmh > 0 ? speedKmh / limitKmh : 1;
  if (ratio >= 0.72) return "free";
  if (ratio >= 0.45) return "moderate";
  if (ratio >= 0.25) return "heavy";
  return "stop_and_go";
}

function parseTrafficJson(jsonText) {
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
      .map((s) => {
        const rawTs = String(s.timestamp_est || "").trim().replace(" ", "T");
        const hasTz = /[Zz]|[+-]\d{2}:\d{2}$/.test(rawTs);
        const epoch = Math.floor(
          Date.parse(hasTz ? rawTs : `${rawTs}-05:00`) / 1000
        );
        return {
          timestamp_est: s.timestamp_est,
          epoch,
          speed_kmh: Number(s.speed_kmh) || 0,
          congestion: s.congestion || "free",
        };
      })
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

function evaluateSegmentTrafficAtEpoch(seg, evalEpoch) {
  const snaps = seg.snapshots;
  let speedKmh = seg.speed_limit_kmh;

  if (snaps.length > 0) {
    if (evalEpoch <= snaps[0].epoch) {
      speedKmh = snaps[0].speed_kmh;
    } else if (evalEpoch >= snaps[snaps.length - 1].epoch) {
      speedKmh = snaps[snaps.length - 1].speed_kmh;
    } else {
      for (let i = 0; i < snaps.length - 1; i++) {
        const a = snaps[i];
        const b = snaps[i + 1];
        if (evalEpoch >= a.epoch && evalEpoch <= b.epoch) {
          const span = Math.max(1, b.epoch - a.epoch);
          const t = (evalEpoch - a.epoch) / span;
          speedKmh = Math.round(a.speed_kmh + (b.speed_kmh - a.speed_kmh) * t);
          break;
        }
      }
    }
  }

  return {
    segment_id: seg.segment_id,
    name: seg.name,
    road_class: seg.road_class,
    speed_limit_kmh: seg.speed_limit_kmh,
    path: seg.path,
    evalEpoch,
    speed_kmh: speedKmh,
    congestion: classifyCongestionForSpeed(speedKmh, seg.speed_limit_kmh),
  };
}

/* ==========================================================================
   Concrete Implementation: FileDataReader (Static Files in /datasets/)
   ========================================================================== */

/* ==========================================================================
   CachedDataReader: shared in-memory cache + windowing for concrete readers

   Subclasses only implement `_loadRaw()` which returns the parsed, sorted
   dataset records. Everything else (timeline bounds, per-call binary-search
   windowing, collar grouping) is shared so FileDataReader and ApiDataReader
   behave identically from the UI's perspective.
   ========================================================================== */

class CachedDataReader extends DataReader {
  #loadPromise = null;
  #cache = null;

  /**
   * @returns {Promise<{
   *   wlcEvents: Array<Object>,
   *   radarTracks: Array<Object>,
   *   collarPoints: Array<Object>,
   *   trafficSegments: Array<Object>,
   *   trafficSourceFile: string
   * }>}
   */
  async _loadRaw() {
    throw new Error("CachedDataReader._loadRaw() must be implemented by subclass");
  }

  async _ensureLoaded() {
    if (this.#cache) return this.#cache;
    if (!this.#loadPromise) {
      this.#loadPromise = this._loadRaw().then((raw) => {
        this.#cache = this.#buildCache(raw);
        return this.#cache;
      });
    }
    return this.#loadPromise;
  }

  #buildCache({
    wlcEvents,
    radarTracks,
    collarPoints,
    trafficSegments,
    trafficSourceFile,
  }) {
    const hasWlc = wlcEvents.length > 0;
    const facilityBriefing = parseIncidentBriefing("", wlcEvents);
    const hasTraffic = trafficSegments.length > 0;
    const hasRadar = radarTracks.length > 0;
    const hasCollarTelemetry = collarPoints.length > 0;

    let totalRadarPings = 0;
    for (const tr of radarTracks) {
      totalRadarPings += tr.pings.length;
    }

    // Group collar points by collar_hw for fast per-group binary search
    const hwStatsMap = new Map();
    for (const pt of collarPoints) {
      let rec = hwStatsMap.get(pt.collar_hw);
      if (!rec) {
        const desc =
          pt.collar_hw === "GTV2"
            ? "Tag_Branta · Collar Telemetry"
            : pt.collar_hw === "BUOY-V1"
            ? "Buoy_OTT · River Telemetry"
            : "Telemetry Device Group";
        rec = {
          hw: pt.collar_hw,
          desc,
          isGtv2: pt.isGtv2,
          tags: new Set(),
          points: [],
          totalPoints: 0,
        };
        hwStatsMap.set(pt.collar_hw, rec);
      }
      rec.tags.add(pt.tag_id);
      rec.points.push(pt);
      rec.totalPoints++;
    }

    const hwOrder = ["GTV2", "BUOY-V1"];
    const collarHwGroups = Array.from(hwStatsMap.values()).sort((a, b) => {
      const ia = hwOrder.indexOf(a.hw);
      const ib = hwOrder.indexOf(b.hw);
      if (ia !== -1 && ib !== -1) return ia - ib;
      return a.hw.localeCompare(b.hw);
    });

    // Compute global timeline bounds across all available datasets
    let minEpoch = Infinity;
    let maxEpoch = -Infinity;

    if (wlcEvents.length) {
      minEpoch = Math.min(minEpoch, wlcEvents[0].epoch);
      maxEpoch = Math.max(maxEpoch, wlcEvents[wlcEvents.length - 1].epoch);
    }
    for (const tr of radarTracks) {
      if (tr.pings.length) {
        minEpoch = Math.min(minEpoch, tr.pings[0].epoch);
        maxEpoch = Math.max(maxEpoch, tr.pings[tr.pings.length - 1].epoch);
      }
    }
    if (collarPoints.length) {
      minEpoch = Math.min(minEpoch, collarPoints[0].epoch);
      maxEpoch = Math.max(maxEpoch, collarPoints[collarPoints.length - 1].epoch);
    }
    for (const seg of trafficSegments) {
      if (seg.snapshots.length) {
        minEpoch = Math.min(minEpoch, seg.snapshots[0].epoch);
        maxEpoch = Math.max(maxEpoch, seg.snapshots[seg.snapshots.length - 1].epoch);
      }
    }

    const hasAnyDataset = hasWlc || hasRadar || hasCollarTelemetry || hasTraffic;
    if (!Number.isFinite(minEpoch) || !Number.isFinite(maxEpoch)) {
      const nowEpoch = Math.floor(Date.now() / 1000);
      minEpoch = nowEpoch - 3600;
      maxEpoch = nowEpoch;
    } else if (maxEpoch <= minEpoch) {
      maxEpoch = minEpoch + 60;
    }

    return {
      hasAnyDataset,
      facilityBriefing,
      hasWlc,
      wlcEvents,
      hasRadar,
      radarTracks,
      totalRadarPings,
      hasCollarTelemetry,
      collarPoints,
      collarHwGroups,
      hasTraffic,
      trafficSourceFile,
      trafficSegments,
      minEpoch,
      maxEpoch,
    };
  }

  async getTimelineBounds() {
    const cache = await this._ensureLoaded();
    return {
      hasData: cache.hasAnyDataset,
      minEpoch: cache.minEpoch,
      maxEpoch: cache.maxEpoch,
    };
  }

  async getFacilityBriefing() {
    const cache = await this._ensureLoaded();
    return cache.facilityBriefing;
  }

  async getWlcEvents({ startEpoch, endEpoch } = {}) {
    const cache = await this._ensureLoaded();
    const [startIdx, endIdx] = findEpochRangeIndices(
      cache.wlcEvents,
      startEpoch,
      endEpoch
    );
    return {
      available: cache.hasWlc,
      events: cache.wlcEvents.slice(startIdx, endIdx),
      totalEvents: cache.wlcEvents.length,
    };
  }

  async getRadarTracks({ startEpoch, endEpoch } = {}) {
    const cache = await this._ensureLoaded();
    const tracks = cache.radarTracks.map((tr) => {
      const [pStart, pEnd] = findEpochRangeIndices(tr.pings, startEpoch, endEpoch);
      return {
        track_id: tr.track_id,
        callsign: tr.callsign,
        radar_type: tr.radar_type,
        transponder_squawk: tr.transponder_squawk,
        rcs_profile: tr.rcs_profile,
        remark: tr.remark,
        isBioFlock: tr.isBioFlock,
        isVfrSpecial: tr.isVfrSpecial,
        isWeather: tr.isWeather,
        totalTrackPings: tr.pings.length,
        pings: tr.pings.slice(pStart, pEnd),
      };
    });

    return {
      available: cache.hasRadar,
      tracks,
      totalTracks: cache.radarTracks.length,
      totalPings: cache.totalRadarPings,
    };
  }

  async getCollarTelemetry({ startEpoch, endEpoch } = {}) {
    const cache = await this._ensureLoaded();
    const [cStart, cEnd] = findEpochRangeIndices(
      cache.collarPoints,
      startEpoch,
      endEpoch
    );
    const hardwareGroups = cache.collarHwGroups.map((grp) => {
      const [gStart, gEnd] = findEpochRangeIndices(
        grp.points,
        startEpoch,
        endEpoch
      );
      return {
        hw: grp.hw,
        desc: grp.desc,
        isGtv2: grp.isGtv2,
        tagCount: grp.tags.size,
        totalPoints: grp.totalPoints,
        windowPoints: gEnd - gStart,
      };
    });

    return {
      available: cache.hasCollarTelemetry,
      points: cache.collarPoints.slice(cStart, cEnd),
      totalPoints: cache.collarPoints.length,
      hardwareGroups,
    };
  }

  async getRoadTraffic({ startEpoch, endEpoch } = {}) {
    const cache = await this._ensureLoaded();
    const sEp = startEpoch ?? cache.minEpoch;
    const eEp = endEpoch ?? cache.maxEpoch;
    const evalEpoch = Math.floor((sEp + eEp) / 2);

    const segments = cache.trafficSegments.map((seg) =>
      evaluateSegmentTrafficAtEpoch(seg, evalEpoch)
    );

    return {
      available: cache.hasTraffic,
      sourceFile: cache.trafficSourceFile,
      segments,
      totalSegments: cache.trafficSegments.length,
      evalEpoch,
    };
  }
}

/* ==========================================================================
   Concrete Implementation: FileDataReader (Static Files in /datasets/)
   ========================================================================== */

export class FileDataReader extends CachedDataReader {
  #basePath;

  /**
   * @param {{ basePath?: string }} [options]
   */
  constructor({ basePath = "/datasets" } = {}) {
    super();
    this.#basePath = basePath.replace(/\/+$/, "");
  }

  async _loadRaw() {
    const base = this.#basePath;
    const fetchText = async (url, optional = false) => {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          if (optional) return "";
          throw new Error(`HTTP ${res.status} fetching ${url}`);
        }
        const contentType = res.headers.get("content-type") || "";
        if (optional && contentType.includes("text/html")) {
          return "";
        }
        return await res.text();
      } catch (err) {
        if (optional) return "";
        throw err;
      }
    };

    let trafficSourceFile = "road_traffic.json";
    const [wlcText, radarText, collarText, trafficText] =
      await Promise.all([
        fetchText(`${base}/wlc_syslog.log`, true),
        fetchText(`${base}/yow_tower_radar.xml`, true),
        fetchText(`${base}/gtv2_collar_telemetry.csv`, true),
        (async () => {
          for (const name of ["road_traffic.json", "road_traffic_sample.json"]) {
            const txt = await fetchText(`${base}/${name}`, true);
            if (txt) {
              trafficSourceFile = name;
              return txt;
            }
          }
          return "";
        })(),
      ]);

    const wlcEvents = parseWlcSyslog(wlcText);
    const trafficSegments = parseTrafficJson(trafficText);
    await yieldToMain();
    const radarTracks = parseRadarXml(radarText);
    await yieldToMain();
    const collarPoints = parseCollarCsv(collarText);

    return { wlcEvents, radarTracks, collarPoints, trafficSegments, trafficSourceFile };
  }
}

/* ==========================================================================
   Concrete Implementation: ApiDataReader (AlloyDB via the /api backend)

   Fetches each dataset once in bulk from the Node.js API (which reads from
   AlloyDB) and then reuses the shared in-memory windowing, so the timeline
   scrubber stays as responsive as with local files.
   ========================================================================== */

export class ApiDataReader extends CachedDataReader {
  #baseUrl;

  /**
   * @param {{ baseUrl?: string }} [options]
   */
  constructor({ baseUrl = "/api" } = {}) {
    super();
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async #fetchJson(path, optional = false) {
    const url = `${this.#baseUrl}${path}`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        if (optional) return null;
        throw new Error(`HTTP ${res.status} fetching ${url}`);
      }
      return await res.json();
    } catch (err) {
      if (optional) return null;
      throw err;
    }
  }

  async _loadRaw() {
    const [wlc, radar, traffic, collar] = await Promise.all([
      this.#fetchJson("/wlc-events"),
      this.#fetchJson("/radar-tracks"),
      this.#fetchJson("/road-traffic"),
      this.#fetchJson("/collar-telemetry", true),
    ]);

    // Server guarantees sorted-by-epoch output; sort defensively anyway since
    // the shared windowing relies on it.
    const wlcEvents = (wlc?.events || []).slice().sort((a, b) => a.epoch - b.epoch);

    const radarTracks = (radar?.tracks || []).map((tr) => ({
      track_id: tr.track_id,
      callsign: tr.callsign,
      radar_type: tr.radar_type,
      transponder_squawk: tr.transponder_squawk,
      rcs_profile: tr.rcs_profile,
      remark: tr.remark || "",
      isBioFlock: Boolean(tr.isBioFlock),
      isVfrSpecial: Boolean(tr.isVfrSpecial),
      isWeather: Boolean(tr.isWeather),
      pings: (tr.pings || []).slice().sort((a, b) => a.epoch - b.epoch),
    }));
    await yieldToMain();

    const trafficSegments = (traffic?.segments || []).map((seg) => ({
      segment_id: seg.segment_id || "SEG",
      name: seg.name || "Road Segment",
      road_class: seg.road_class || "Road",
      speed_limit_kmh: Number(seg.speed_limit_kmh) || 50,
      path: Array.isArray(seg.path) ? seg.path : [],
      snapshots: (seg.snapshots || []).slice().sort((a, b) => a.epoch - b.epoch),
    }));

    const collarPoints = (collar?.points || []).slice().sort((a, b) => a.epoch - b.epoch);

    return {
      wlcEvents,
      radarTracks,
      collarPoints,
      trafficSegments,
      trafficSourceFile: traffic?.sourceFile || "road_traffic.json",
    };
  }
}

/**
 * Factory: choose the DataReader implementation from runtime config.
 * @param {{ DATA_SOURCE?: string }} env parsed from /.env
 * @returns {DataReader}
 */
export function createDataReader(env = {}) {
  const source = String(env.DATA_SOURCE || "file").trim().toLowerCase();
  if (source === "alloydb" || source === "api") {
    return new ApiDataReader();
  }
  return new FileDataReader();
}
