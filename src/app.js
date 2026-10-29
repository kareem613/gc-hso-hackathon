/* ==========================================================================
   HSO Incident Response Geospatial Console (#INC-2026-1012)
   High-Performance Canvas OverlayView, Pluggable DataReader & Time Scrubber UI
   ========================================================================== */

import { createDataReader } from "./data-reader.js";

// Selected at startup from /.env (DATA_SOURCE=alloydb|file); see createDataReader().
let dataReader = null;
let DATA_SOURCE_LABEL = "Local Files";

const FACILITY_CENTER = { lat: 45.3507, lng: -75.8518 };
const REGIONAL_CENTER = { lat: 45.355, lng: -75.8518 };

let FACILITY_NAME = "Carling Campus Government Complex";
let FACILITY_COORDS_LABEL = "45.3507° N, -75.8518° W";

let ALL_APS = [
  { id: "AP-West-Gate", label: "AP-West-Gate (Outdoor)", lat: 45.3507, lng: -75.8518, outdoor: true },
  { id: "AP-Central-Courtyard", label: "AP-Central-Courtyard (Outdoor)", lat: 45.3507, lng: -75.8518, outdoor: true },
  { id: "AP-East-Pavilion", label: "AP-East-Pavilion (Outdoor)", lat: 45.3507, lng: -75.8518, outdoor: true },
];

const DARK_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#082f49" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#38bdf8" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#0f1f1c" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#162032" }] },
];

const LIGHT_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#f8fafc" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#475569" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#bae6fd" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#0369a1" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#f1f5f9" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#e2e8f0" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#cbd5e1" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#cbd5e1" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
];

const state = {
  mapType: "hybrid",
  hasAnyDataset: false,
  trafficSourceFile: "road_traffic.json",
  globalMinEpoch: 0,
  globalMaxEpoch: 0,
  windowStartEpoch: 0,
  windowEndEpoch: 0,
  available: {
    wlc: false,
    radar: false,
    collars: false,
    traffic: false,
  },
  layers: {
    wlc: false,
    radar: false,
    collars: false,
    traffic: false,
  },
  selectedFlights: new Set(),
  selectedCollarHw: new Set(),
  catalog: {
    radarTracks: [],
    collarHwGroups: [],
  },
  filtered: {
    collarPoints: [],
    activeRadarTracks: [],
    activeTrafficSegments: [],
  },
  map: null,
  infoWindow: null,
  canvasOverlay: null,
  overlays: {
    apItems: [],
  },
  flightRowDomMap: new Map(),
  collarHwRowDomMap: new Map(),
  filterRafId: 0,
  syncSeq: 0,
  lastSyslogKey: "",
  isPlaying: false,
  playbackSpeed: 5,
  playbackRafId: 0,
  lastFrameTimeMs: 0,
  playbackFloatStart: 0,
};

/* ==========================================================================
   1. Projection Math, UI Color Mapping & Time Formatting Helpers
   ========================================================================== */

function latLngToWorld(lat, lng) {
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    wx: 256 * (0.5 + lng / 360),
    wy: 256 * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
  };
}

const MERCATOR_CACHE = new WeakMap();

function getMercatorCoords(pt) {
  let coords = MERCATOR_CACHE.get(pt);
  if (!coords) {
    coords = latLngToWorld(pt.lat, pt.lng);
    MERCATOR_CACHE.set(pt, coords);
  }
  return coords;
}

const REF_POINT_A = {
  lat: 45.3,
  lng: -75.95,
  ...latLngToWorld(45.3, -75.95),
};
const REF_POINT_B = {
  lat: 45.45,
  lng: -75.7,
  ...latLngToWorld(45.45, -75.7),
};

function epochToUtcIsoShort(epoch) {
  return new Date(epoch * 1000).toISOString().replace(".000Z", "Z");
}

function epochToEstString(epoch) {
  const estMs = (epoch - 5 * 3600) * 1000;
  return new Date(estMs).toISOString().slice(0, 19).replace("T", " ") + " EST";
}

function getTrackColor(track) {
  if (track.isBioFlock) return "#06b6d4";
  if (track.isVfrSpecial) return "#10b981";
  if (track.isWeather) return "#ec4899";
  return "#a855f7";
}

function getCollarColor(isGtv2) {
  return isGtv2 ? "#facc15" : "#f97316";
}

function getTrafficUiStyle(congestion) {
  switch (congestion) {
    case "free":
      return { label: "Fast (Free Flow)", shortLabel: "Fast", color: "#22c55e" };
    case "moderate":
      return { label: "Moderate Traffic", shortLabel: "Moderate", color: "#f59e0b" };
    case "heavy":
      return { label: "Heavy Congestion", shortLabel: "Heavy", color: "#ef4444" };
    default:
      return { label: "Stop & Go", shortLabel: "Stop & Go", color: "#991b1b" };
  }
}

/* ==========================================================================
   2. Data Initialization via DataReader Interface
   ========================================================================== */

async function loadAllDatasets() {
  const [bounds, briefing, wlcMeta, radarMeta, collarMeta, trafficMeta] =
    await Promise.all([
      dataReader.getTimelineBounds(),
      dataReader.getFacilityBriefing(),
      dataReader.getWlcEvents(),
      dataReader.getRadarTracks(),
      dataReader.getCollarTelemetry(),
      dataReader.getRoadTraffic(),
    ]);

  FACILITY_NAME = briefing.facilityName;
  FACILITY_CENTER.lat = briefing.lat;
  FACILITY_CENTER.lng = briefing.lng;
  FACILITY_COORDS_LABEL = briefing.coordsLabel;
  ALL_APS = briefing.accessPoints;

  const subtitleEl = document.getElementById("header-subtitle");
  if (subtitleEl) {
    subtitleEl.textContent = `${FACILITY_COORDS_LABEL} | ${FACILITY_NAME} | Data: ${DATA_SOURCE_LABEL}`;
  }
  const apCountEl = document.getElementById("stat-wlc-aps");
  if (apCountEl) {
    apCountEl.textContent = `${ALL_APS.length} APs`;
  }

  state.available = {
    wlc: Boolean(wlcMeta.available),
    radar: Boolean(radarMeta.available),
    collars: Boolean(collarMeta.available),
    traffic: Boolean(trafficMeta.available),
  };
  state.hasAnyDataset = Boolean(bounds.hasData);
  state.trafficSourceFile = trafficMeta.sourceFile || "road_traffic.json";

  const trafficSourceEl = document.getElementById("stat-traffic-source");
  if (trafficSourceEl) {
    trafficSourceEl.textContent = state.trafficSourceFile;
  }

  for (const key of ["wlc", "radar", "collars", "traffic"]) {
    const isAvail = state.available[key];
    state.layers[key] = isAvail;

    const rowEl = document.getElementById(`layer-row-${key}`);
    if (rowEl) rowEl.hidden = !isAvail;

    const toggleEl = document.getElementById(`toggle-layer-${key}`);
    if (toggleEl) toggleEl.checked = isAvail;

    for (const legEl of document.querySelectorAll(`[data-legend-layer="${key}"]`)) {
      legEl.hidden = !isAvail;
    }
  }

  const emptyMsgEl = document.getElementById("datasets-empty-msg");
  if (emptyMsgEl) {
    emptyMsgEl.hidden = state.hasAnyDataset;
  }
  const legendEl = document.getElementById("map-legend");
  if (legendEl) {
    legendEl.hidden = !state.hasAnyDataset;
  }
  const scrubberEl = document.getElementById("timeline-scrubber-bar");
  if (scrubberEl) {
    scrubberEl.hidden = !state.hasAnyDataset;
  }

  state.catalog.radarTracks = radarMeta.tracks;
  for (const tr of radarMeta.tracks) {
    state.selectedFlights.add(tr.track_id);
  }

  state.catalog.collarHwGroups = collarMeta.hardwareGroups;
  for (const grp of collarMeta.hardwareGroups) {
    state.selectedCollarHw.add(grp.hw);
  }

  state.globalMinEpoch = bounds.minEpoch;
  state.globalMaxEpoch = bounds.maxEpoch;
  state.windowStartEpoch = bounds.minEpoch;
  state.windowEndEpoch = bounds.maxEpoch;

  initTimeWindowControls();
  initFlightSelectorDOM();
  initCollarHwSelectorDOM();
}

/* ==========================================================================
   3. Timeline Scrubber, Playback Engine & RAF Throttler
   ========================================================================== */

function formatSpanBadge(spanSec, globalSpanSec) {
  if (spanSec >= globalSpanSec - 15) {
    const hrs = Math.round(globalSpanSec / 3600);
    return `Full (${hrs}h)`;
  }
  if (spanSec < 3600) {
    return `${Math.max(1, Math.round(spanSec / 60))}m window`;
  }
  const h = Math.floor(spanSec / 3600);
  const m = Math.round((spanSec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m window` : `${h}h window`;
}

function formatUtcRangeCompact(startEp, endEp) {
  const sIso = epochToUtcIsoShort(startEp).replace("T", " ");
  const eIso = epochToUtcIsoShort(endEp).replace("T", " ");
  if (sIso.slice(0, 10) === eIso.slice(0, 10)) {
    return `UTC: ${sIso.slice(0, -1)} → ${eIso.slice(11)}`;
  }
  return `UTC: ${sIso} → ${eIso}`;
}

function formatEstRangeCompact(startEp, endEp) {
  const sEst = epochToEstString(startEp).replace(" EST", "");
  const eEst = epochToEstString(endEp).replace(" EST", "");
  if (sEst.slice(0, 10) === eEst.slice(0, 10)) {
    return `EST: ${sEst.slice(11)} → ${eEst.slice(11)}`;
  }
  return `EST: ${sEst} → ${eEst}`;
}

function initTimeWindowControls() {
  const sliderMin = document.getElementById("slider-min");
  const sliderMax = document.getElementById("slider-max");

  sliderMin.min = String(state.globalMinEpoch);
  sliderMin.max = String(state.globalMaxEpoch);
  sliderMin.value = String(state.windowStartEpoch);

  sliderMax.min = String(state.globalMinEpoch);
  sliderMax.max = String(state.globalMaxEpoch);
  sliderMax.value = String(state.windowEndEpoch);

  document.getElementById("label-global-min").textContent =
    epochToUtcIsoShort(state.globalMinEpoch).slice(0, 16).replace("T", " ") + "Z";
  document.getElementById("label-global-max").textContent =
    epochToUtcIsoShort(state.globalMaxEpoch).slice(0, 16).replace("T", " ") + "Z";

  syncTimeControlsUI();
}

function syncTimeControlsUI() {
  const sliderMin = document.getElementById("slider-min");
  const sliderMax = document.getElementById("slider-max");
  const fillEl = document.getElementById("dual-slider-fill");

  sliderMin.value = String(state.windowStartEpoch);
  sliderMax.value = String(state.windowEndEpoch);

  const globalSpan = Math.max(1, state.globalMaxEpoch - state.globalMinEpoch);
  const windowSpan = Math.max(0, state.windowEndEpoch - state.windowStartEpoch);
  const leftPct = ((state.windowStartEpoch - state.globalMinEpoch) / globalSpan) * 100;
  const rightPct = ((state.windowEndEpoch - state.globalMinEpoch) / globalSpan) * 100;

  fillEl.style.left = `${leftPct}%`;
  fillEl.style.width = `${Math.max(0.6, rightPct - leftPct)}%`;

  const utcEl = document.getElementById("scrubber-utc-readout");
  const estEl = document.getElementById("scrubber-est-readout");
  const spanEl = document.getElementById("scrubber-span-badge");

  if (utcEl) {
    utcEl.textContent = formatUtcRangeCompact(
      state.windowStartEpoch,
      state.windowEndEpoch
    );
  }
  if (estEl) {
    estEl.textContent = formatEstRangeCompact(
      state.windowStartEpoch,
      state.windowEndEpoch
    );
  }
  if (spanEl) {
    spanEl.textContent = formatSpanBadge(windowSpan, globalSpan);
  }

  // Sync active state on window width preset buttons
  const presetBtns = document.querySelectorAll("#window-preset-group .seg-btn");
  const isFull = windowSpan >= globalSpan - 15;
  presetBtns.forEach((btn) => {
    const attr = btn.getAttribute("data-window-sec");
    if (attr === "full") {
      btn.classList.toggle("active", isFull);
    } else {
      const targetSec = parseInt(attr, 10);
      btn.classList.toggle(
        "active",
        !isFull && Math.abs(windowSpan - targetSec) <= 15
      );
    }
  });
}

function stopPlayback() {
  state.isPlaying = false;
  if (state.playbackRafId) {
    cancelAnimationFrame(state.playbackRafId);
    state.playbackRafId = 0;
  }
  const playBtn = document.getElementById("btn-play-pause");
  if (playBtn) {
    playBtn.textContent = "▶ Play";
    playBtn.classList.remove("playing");
    playBtn.setAttribute("aria-label", "Play Timeline");
  }
}

function tickPlayback(nowMs) {
  if (!state.isPlaying) return;
  const dtSec = Math.min(0.1, Math.max(0, (nowMs - state.lastFrameTimeMs) / 1000));
  state.lastFrameTimeMs = nowMs;

  const windowSpan = Math.max(60, state.windowEndEpoch - state.windowStartEpoch);
  // 1x = 300 dataset seconds per real second (5 min/sec)
  const rateSecPerRealSec = 300 * state.playbackSpeed;
  state.playbackFloatStart += dtSec * rateSecPerRealSec;

  const maxStart = state.globalMaxEpoch - windowSpan;
  if (state.playbackFloatStart >= maxStart) {
    state.windowStartEpoch = Math.max(state.globalMinEpoch, maxStart);
    state.windowEndEpoch = state.globalMaxEpoch;
    syncTimeControlsUI();
    syncFilteredDataAndMap();
    stopPlayback();
    return;
  }

  const snappedStart = Math.round(state.playbackFloatStart / 15) * 15;
  if (snappedStart !== state.windowStartEpoch) {
    state.windowStartEpoch = snappedStart;
    state.windowEndEpoch = Math.min(
      state.globalMaxEpoch,
      snappedStart + windowSpan
    );
    syncTimeControlsUI();
    syncFilteredDataAndMap();
  }

  state.playbackRafId = requestAnimationFrame(tickPlayback);
}

function startPlayback() {
  const globalSpan = state.globalMaxEpoch - state.globalMinEpoch;
  let windowSpan = state.windowEndEpoch - state.windowStartEpoch;

  // Auto-switch from 'Full' to a 30m (1800s) window when Play is clicked
  if (windowSpan >= globalSpan - 15 || windowSpan <= 0) {
    windowSpan = 1800;
    state.windowStartEpoch = state.globalMinEpoch;
    state.windowEndEpoch = Math.min(
      state.globalMaxEpoch,
      state.globalMinEpoch + windowSpan
    );
  } else if (state.windowEndEpoch >= state.globalMaxEpoch - 15) {
    // Loop back to start if already at the end of the timeline
    state.windowStartEpoch = state.globalMinEpoch;
    state.windowEndEpoch = Math.min(
      state.globalMaxEpoch,
      state.globalMinEpoch + windowSpan
    );
  }

  state.isPlaying = true;
  state.playbackFloatStart = state.windowStartEpoch;
  state.lastFrameTimeMs = performance.now();

  const playBtn = document.getElementById("btn-play-pause");
  if (playBtn) {
    playBtn.textContent = "⏸ Pause";
    playBtn.classList.add("playing");
    playBtn.setAttribute("aria-label", "Pause Timeline");
  }

  syncTimeControlsUI();
  syncFilteredDataAndMap();
  state.playbackRafId = requestAnimationFrame(tickPlayback);
}

function scheduleFilterSync() {
  if (state.filterRafId) return;
  state.filterRafId = requestAnimationFrame(() => {
    state.filterRafId = 0;
    syncFilteredDataAndMap();
  });
}

/* ==========================================================================
   4. Google Maps Initialization & Sprite-Stamped HighDensityCanvasOverlay
   ========================================================================== */

const SPRITE_CACHE = new Map();

function getDotSprite(radius, fillColor, strokeColor, lineWidth, dpr) {
  const key = `${radius}:${fillColor}:${strokeColor}:${lineWidth}:${dpr}`;
  let sprite = SPRITE_CACHE.get(key);
  if (sprite) return sprite;

  const pad = Math.ceil(lineWidth + 2);
  const cssSize = Math.ceil((radius + pad) * 2);
  const c = document.createElement("canvas");
  c.width = Math.ceil(cssSize * dpr);
  c.height = Math.ceil(cssSize * dpr);
  const sctx = c.getContext("2d");
  sctx.scale(dpr, dpr);

  const half = cssSize / 2;
  sctx.beginPath();
  sctx.arc(half, half, radius, 0, Math.PI * 2);
  sctx.fillStyle = fillColor;
  sctx.fill();
  if (lineWidth > 0 && strokeColor) {
    sctx.lineWidth = lineWidth;
    sctx.strokeStyle = strokeColor;
    sctx.stroke();
  }

  sprite = { canvas: c, cssSize, half };
  SPRITE_CACHE.set(key, sprite);
  return sprite;
}

let envConfigPromise = null;

async function loadEnvConfig() {
  if (envConfigPromise) return envConfigPromise;
  envConfigPromise = (async () => {
    const env = {};
    try {
      const res = await fetch("/.env");
      if (res.ok) {
        const text = await res.text();
        for (const rawLine of text.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) continue;
          const eqIdx = line.indexOf("=");
          if (eqIdx > 0) {
            const k = line.slice(0, eqIdx).trim();
            const v = line
              .slice(eqIdx + 1)
              .trim()
              .replace(/^['"]|['"]$/g, "");
            env[k] = v;
          }
        }
      }
    } catch {}
    return env;
  })();
  return envConfigPromise;
}

/**
 * Instantiate the DataReader implementation selected by DATA_SOURCE in /.env
 * (defaults to local static files when unset).
 */
async function initDataReader() {
  const env = await loadEnvConfig();
  dataReader = createDataReader(env);
  const source = String(env.DATA_SOURCE || "file").trim().toLowerCase();
  DATA_SOURCE_LABEL =
    source === "alloydb" || source === "api" ? "AlloyDB" : "Local Files";
  document.body.dataset.dataSource = source;
}

function bootstrapGoogleMapsLoader(apiKey) {
  if (window.google?.maps?.importLibrary) return;
  ((g) => {
    var h,
      a,
      k,
      p = "The Google Maps JavaScript API",
      c = "google",
      l = "importLibrary",
      q = "__ib__",
      m = document,
      b = window;
    b = b[c] || (b[c] = {});
    var d = b.maps || (b.maps = {}),
      r = new Set(),
      e = new URLSearchParams(),
      u = () =>
        h ||
        (h = new Promise(async (f, n) => {
          await (a = m.createElement("script"));
          e.set("libraries", [...r] + "");
          for (k in g)
            e.set(
              k.replace(/[A-Z]/g, (t) => "_" + t[0].toLowerCase()),
              g[k]
            );
          e.set("callback", c + ".maps." + q);
          a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
          d[q] = f;
          a.onerror = () => (h = n(Error(p + " could not load.")));
          a.nonce = m.querySelector("script[nonce]")?.nonce || "";
          m.head.append(a);
        }));
    d[l]
      ? console.warn(p + " only loads once. Ignoring:", g)
      : (d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)));
  })({
    key: apiKey,
    v: "weekly",
  });
}

async function initGoogleMap() {
  const env = await loadEnvConfig();
  const apiKey =
    env.GOOGLE_MAPS_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY || "";
  bootstrapGoogleMapsLoader(apiKey);

  const { Map, InfoWindow, Circle, OverlayView } =
    await google.maps.importLibrary("maps");

  const mapEl = document.getElementById("map-canvas");
  state.map = new Map(mapEl, {
    center: FACILITY_CENTER,
    zoom: 15,
    mapTypeId: state.mapType === "hybrid" ? "hybrid" : "roadmap",
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    styles:
      state.mapType === "dark"
        ? DARK_MAP_STYLES
        : state.mapType === "light"
        ? LIGHT_MAP_STYLES
        : null,
  });

  state.infoWindow = new InfoWindow({ headerDisabled: true });

  mapEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-popup-close]")) {
      state.infoWindow?.close();
    }
  });

  if (state.available.wlc) {
    buildWlcOverlays(Circle);
  }
  initCanvasOverlay(OverlayView);

  state.map.addListener("bounds_changed", () => {
    state.canvasOverlay?.draw();
  });

  state.map.addListener("click", (e) => {
    if (e.latLng) {
      handleCanvasClick(e.latLng);
    }
  });

  syncFilteredDataAndMap();
}

function buildWlcOverlays(CircleClass) {
  const circle = new CircleClass({
    strokeColor: "#ef4444",
    strokeOpacity: 0.9,
    strokeWeight: 2,
    fillColor: "#ef4444",
    fillOpacity: 0.22,
    map: state.map,
    center: FACILITY_CENTER,
    radius: 260,
    clickable: true,
  });

  const marker = new google.maps.Marker({
    position: FACILITY_CENTER,
    map: state.map,
    title: `FAC-OTT-01 ${FACILITY_NAME} (${FACILITY_COORDS_LABEL})`,
    label: {
      text: "FAC-OTT-01 (APs)",
      color: "#f8fafc",
      fontSize: "11px",
      fontWeight: "700",
    },
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 12,
      fillColor: "#ef4444",
      fillOpacity: 1,
      strokeColor: "#0f172a",
      strokeWeight: 2,
    },
    zIndex: 35,
  });

  const facilityOverlay = {
    marker,
    circle,
    statsByAp: {},
    totals: { total: 0, gtv2: 0, warns: 0 },
    lastVisKey: "",
  };

  const handleClickFacility = () => {
    const rowsHtml = ALL_APS.map((ap) => {
      const st = facilityOverlay.statsByAp[ap.id] || { total: 0, gtv2: 0, warns: 0 };
      return `<div class="map-popup-kv-row">
        <span class="map-popup-kv-key">${ap.id}${ap.outdoor ? "*" : ""}:</span>
        <span class="map-popup-kv-val">${st.total} ev (${st.gtv2} GTV2)</span>
      </div>`;
    }).join("");

    const tot = facilityOverlay.totals;
    state.infoWindow.setContent(`
      <div class="map-popup-card">
        <div class="map-popup-accent" style="background-color:#ef4444;"></div>
        <div class="map-popup-body">
          <div class="map-popup-top">
            <span class="map-popup-dataset-pill">
              <span class="map-popup-dot" style="background-color:#ef4444;"></span>
              WLC Campus Syslog
            </span>
            <button type="button" class="map-popup-close" data-popup-close aria-label="Close popup">×</button>
          </div>
          <div class="map-popup-title-row">
            <span class="map-popup-title">FAC-OTT-01 Campus APs</span>
            <span class="map-popup-tag">${ALL_APS.length} Collocated APs</span>
          </div>
          <div class="map-popup-kv-list">
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Source:</span>
              <span class="map-popup-kv-val">wlc_syslog.log</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Facility:</span>
              <span class="map-popup-kv-val">${FACILITY_NAME}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Coordinates:</span>
              <span class="map-popup-kv-val">${FACILITY_COORDS_LABEL}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Window Events:</span>
              <span class="map-popup-kv-val accent">${tot.total.toLocaleString()}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">GTV2 Probe/Assoc:</span>
              <span class="map-popup-kv-val">${tot.gtv2.toLocaleString()}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Collision/Flap Warns:</span>
              <span class="map-popup-kv-val">${tot.warns.toLocaleString()}</span>
            </div>
          </div>
          <div class="map-popup-section-label">AP Breakdown (* = Outdoor Guest Wi-Fi)</div>
          <div class="map-popup-kv-list" style="border-top:none;padding-top:0;">
            ${rowsHtml}
          </div>
        </div>
      </div>
    `);
    state.infoWindow.setPosition(FACILITY_CENTER);
    state.infoWindow.open(state.map);
  };

  marker.addListener("click", handleClickFacility);
  circle.addListener("click", handleClickFacility);

  state.overlays.facilityAp = facilityOverlay;
}

function initCanvasOverlay(OverlayViewClass) {
  class HighDensityCanvasOverlay extends OverlayViewClass {
    constructor() {
      super();
      this.canvas = null;
      this.ctx = null;
      this.pixelGrid = null;
    }

    onAdd() {
      this.canvas = document.createElement("canvas");
      this.canvas.style.position = "absolute";
      this.canvas.style.pointerEvents = "none";
      this.canvas.style.top = "0";
      this.canvas.style.left = "0";
      this.ctx = this.canvas.getContext("2d");

      const panes = this.getPanes();
      panes.overlayLayer.appendChild(this.canvas);
    }

    onRemove() {
      if (this.canvas && this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
      this.canvas = null;
      this.ctx = null;
      this.pixelGrid = null;
    }

    draw() {
      if (!this.canvas || !this.ctx || !state.map) return;
      const projection = this.getProjection();
      if (!projection) return;

      const mapDiv = state.map.getDiv();
      const width = mapDiv.clientWidth;
      const height = mapDiv.clientHeight;
      if (width <= 0 || height <= 0) return;

      const center = state.map.getCenter();
      if (!center) return;
      const centerDivPx = projection.fromLatLngToDivPixel(center);
      const centerContPx = projection.fromLatLngToContainerPixel(center);
      if (!centerDivPx || !centerContPx) return;

      const offsetLeft = Math.round(centerDivPx.x - centerContPx.x);
      const offsetTop = Math.round(centerDivPx.y - centerContPx.y);

      this.canvas.style.left = `${offsetLeft}px`;
      this.canvas.style.top = `${offsetTop}px`;

      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(width * dpr);
      const targetH = Math.round(height * dpr);

      if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
        this.canvas.width = targetW;
        this.canvas.height = targetH;
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
      }

      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Fast affine transform from Mercator world coordinates (wx, wy) to container pixels (px, py)
      const pA = projection.fromLatLngToContainerPixel(
        new google.maps.LatLng(REF_POINT_A.lat, REF_POINT_A.lng)
      );
      const pB = projection.fromLatLngToContainerPixel(
        new google.maps.LatLng(REF_POINT_B.lat, REF_POINT_B.lng)
      );
      if (!pA || !pB) return;

      const scaleX = (pB.x - pA.x) / (REF_POINT_B.wx - REF_POINT_A.wx);
      const scaleY = (pB.y - pA.y) / (REF_POINT_B.wy - REF_POINT_A.wy);
      const offsetX = pA.x - REF_POINT_A.wx * scaleX;
      const offsetY = pA.y - REF_POINT_A.wy * scaleY;

      const isLightMap = state.mapType === "light";

      // 0. Draw Historical Road Traffic Overlay (Google Maps TrafficLayer style)
      if (state.layers.traffic && state.filtered.activeTrafficSegments.length > 0) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (const item of state.filtered.activeTrafficSegments) {
          const pts = item.path;
          if (pts.length < 2) continue;

          ctx.beginPath();
          for (let i = 0; i < pts.length; i++) {
            const { wx, wy } = getMercatorCoords(pts[i]);
            const px = wx * scaleX + offsetX;
            const py = wy * scaleY + offsetY;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }

          // Outer dark casing stroke so road traffic stands out on any basemap
          ctx.setLineDash([]);
          ctx.strokeStyle = isLightMap
            ? "rgba(15, 23, 42, 0.85)"
            : "rgba(2, 6, 23, 0.94)";
          ctx.lineWidth = 9.0;
          ctx.globalAlpha = 0.95;
          ctx.stroke();

          // Inner Google Maps traffic congestion color stroke
          ctx.strokeStyle = item.color;
          ctx.lineWidth = 5.2;
          ctx.globalAlpha = 0.98;
          ctx.stroke();

          // Stop-and-go dashed highlight (mimicking Google Maps dark-red/black alternating ticks)
          if (item.congestion === "stop_and_go") {
            ctx.setLineDash([5, 9]);
            ctx.strokeStyle = "#fca5a5";
            ctx.lineWidth = 2.4;
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        ctx.restore();
      }

      // 1. Draw CYOW Tower Radar Tracks & Pings
      if (state.layers.radar && state.filtered.activeRadarTracks.length > 0) {
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (const track of state.filtered.activeRadarTracks) {
          const pings = track.pings;
          const count = pings.length;
          if (count <= 0) continue;

          const trackColor = getTrackColor(track);

          // Polyline path
          if (count >= 2) {
            ctx.beginPath();
            for (let i = 0; i < count; i++) {
              const { wx, wy } = getMercatorCoords(pings[i]);
              const px = wx * scaleX + offsetX;
              const py = wy * scaleY + offsetY;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.strokeStyle = trackColor;
            ctx.lineWidth = track.isBioFlock ? 3.2 : track.isVfrSpecial ? 2.4 : 2.0;
            ctx.globalAlpha = track.isBioFlock ? 0.95 : 0.78;
            ctx.stroke();
          }

          // Ping markers via cached offscreen sprite
          const radius = track.isBioFlock ? 5.0 : track.isVfrSpecial ? 4.2 : 3.6;
          const pingSprite = getDotSprite(
            radius,
            trackColor,
            "rgba(15, 23, 42, 0.9)",
            1.4,
            dpr
          );
          ctx.globalAlpha = 0.96;

          for (let i = 0; i < count; i++) {
            const { wx, wy } = getMercatorCoords(pings[i]);
            const px = wx * scaleX + offsetX;
            const py = wy * scaleY + offsetY;
            if (px < -12 || px > width + 12 || py < -12 || py > height + 12) continue;
            ctx.drawImage(
              pingSprite.canvas,
              px - pingSprite.half,
              py - pingSprite.half,
              pingSprite.cssSize,
              pingSprite.cssSize
            );
          }
        }
        ctx.restore();
      }

      // 2. Draw Wildlife & Buoy Telemetry via Offscreen Sprite Stamps + Per-Frame Screen-Pixel Grid
      if (state.layers.collars && state.selectedCollarHw.size > 0) {
        const pts = state.filtered.collarPoints;
        const count = pts.length;

        if (count > 0) {
          const gridLen = width * height;
          if (!this.pixelGrid || this.pixelGrid.length < gridLen) {
            this.pixelGrid = new Uint8Array(gridLen);
          } else {
            this.pixelGrid.fill(0, 0, gridLen);
          }
          const grid = this.pixelGrid;

          const showBuoy = state.selectedCollarHw.has("BUOY-V1");
          const showGtv2 = state.selectedCollarHw.has("GTV2");

          ctx.save();
          ctx.globalAlpha = 0.94;

          // Pass 2A: BUOY-V1 (Orange) drawn first so GTV2 renders cleanly on top
          if (showBuoy) {
            const buoySprite = getDotSprite(
              3.6,
              "#f97316",
              "rgba(15, 23, 42, 0.85)",
              1.1,
              dpr
            );
            const half = buoySprite.half;
            const size = buoySprite.cssSize;
            const img = buoySprite.canvas;

            for (let i = 0; i < count; i++) {
              const pt = pts[i];
              if (pt.isGtv2) continue;
              const { wx, wy } = getMercatorCoords(pt);
              const px = wx * scaleX + offsetX;
              const py = wy * scaleY + offsetY;
              const ix = px | 0;
              const iy = py | 0;
              if (ix < 0 || ix >= width || iy < 0 || iy >= height) continue;

              const gIdx = iy * width + ix;
              if (grid[gIdx] & 1) continue;
              grid[gIdx] |= 1;

              ctx.drawImage(img, px - half, py - half, size, size);
            }
          }

          // Pass 2B: GTV2 (Yellow) drawn on top
          if (showGtv2) {
            const gtv2Color = isLightMap ? "#eab308" : "#facc15";
            const gtv2Sprite = getDotSprite(
              3.8,
              gtv2Color,
              "rgba(15, 23, 42, 0.85)",
              1.1,
              dpr
            );
            const half = gtv2Sprite.half;
            const size = gtv2Sprite.cssSize;
            const img = gtv2Sprite.canvas;

            for (let i = 0; i < count; i++) {
              const pt = pts[i];
              if (!pt.isGtv2) continue;
              const { wx, wy } = getMercatorCoords(pt);
              const px = wx * scaleX + offsetX;
              const py = wy * scaleY + offsetY;
              const ix = px | 0;
              const iy = py | 0;
              if (ix < 0 || ix >= width || iy < 0 || iy >= height) continue;

              const gIdx = iy * width + ix;
              if (grid[gIdx] & 2) continue;
              grid[gIdx] |= 2;

              ctx.drawImage(img, px - half, py - half, size, size);
            }
          }

          ctx.restore();
        }
      }
    }
  }

  state.canvasOverlay = new HighDensityCanvasOverlay();
  state.canvasOverlay.setMap(state.map);
}

function handleCanvasClick(clickLatLng) {
  if (!state.canvasOverlay) return;
  const projection = state.canvasOverlay.getProjection();
  if (!projection) return;

  const clickPx = projection.fromLatLngToContainerPixel(clickLatLng);
  if (!clickPx) return;

  const pA = projection.fromLatLngToContainerPixel(
    new google.maps.LatLng(REF_POINT_A.lat, REF_POINT_A.lng)
  );
  const pB = projection.fromLatLngToContainerPixel(
    new google.maps.LatLng(REF_POINT_B.lat, REF_POINT_B.lng)
  );
  if (!pA || !pB) return;

  const scaleX = (pB.x - pA.x) / (REF_POINT_B.wx - REF_POINT_A.wx);
  const scaleY = (pB.y - pA.y) / (REF_POINT_B.wy - REF_POINT_A.wy);
  const offsetX = pA.x - REF_POINT_A.wx * scaleX;
  const offsetY = pA.y - REF_POINT_A.wy * scaleY;

  let bestDistSq = 12 * 12; // 12px click hit radius
  let bestHit = null;

  // Check active radar pings first
  if (state.layers.radar) {
    for (const track of state.filtered.activeRadarTracks) {
      for (const p of track.pings) {
        const { wx, wy } = getMercatorCoords(p);
        const px = wx * scaleX + offsetX;
        const py = wy * scaleY + offsetY;
        const dSq = (px - clickPx.x) ** 2 + (py - clickPx.y) ** 2;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestHit = { type: "radar", track, ping: p };
        }
      }
    }
  }

  // Check visible collar & buoy telemetry points in active window
  if (state.layers.collars && state.selectedCollarHw.size > 0) {
    for (const pt of state.filtered.collarPoints) {
      if (!state.selectedCollarHw.has(pt.collar_hw)) continue;
      const { wx, wy } = getMercatorCoords(pt);
      const px = wx * scaleX + offsetX;
      const py = wy * scaleY + offsetY;
      const dSq = (px - clickPx.x) ** 2 + (py - clickPx.y) ** 2;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestHit = { type: "collar", pt };
      }
    }
  }

  // Check active road traffic segments (point-to-segment distance in screen pixels)
  if (!bestHit && state.layers.traffic && state.filtered.activeTrafficSegments.length > 0) {
    let bestTrafficDistSq = 10 * 10;
    for (const item of state.filtered.activeTrafficSegments) {
      const path = item.path;
      for (let i = 0; i < path.length - 1; i++) {
        const cA = getMercatorCoords(path[i]);
        const cB = getMercatorCoords(path[i + 1]);
        const ax = cA.wx * scaleX + offsetX;
        const ay = cA.wy * scaleY + offsetY;
        const bx = cB.wx * scaleX + offsetX;
        const by = cB.wy * scaleY + offsetY;
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        const t =
          lenSq > 0
            ? Math.max(0, Math.min(1, ((clickPx.x - ax) * dx + (clickPx.y - ay) * dy) / lenSq))
            : 0;
        const projX = ax + t * dx;
        const projY = ay + t * dy;
        const dSq = (clickPx.x - projX) ** 2 + (clickPx.y - projY) ** 2;
        if (dSq < bestTrafficDistSq) {
          bestTrafficDistSq = dSq;
          bestHit = {
            type: "traffic",
            item,
            lat: path[i].lat + t * (path[i + 1].lat - path[i].lat),
            lng: path[i].lng + t * (path[i + 1].lng - path[i].lng),
          };
        }
      }
    }
  }

  if (!bestHit) return;
  openHitInfoWindow(bestHit);
}

function openHitInfoWindow(hit) {
  if (hit.type === "traffic") {
    const { item, lat, lng } = hit;
    const { name, segment_id, road_class, speed_limit_kmh, speed_kmh, label, color, evalEpoch } = item;
    state.infoWindow.setContent(`
      <div class="map-popup-card">
        <div class="map-popup-accent" style="background-color:${color};"></div>
        <div class="map-popup-body">
          <div class="map-popup-top">
            <span class="map-popup-dataset-pill">
              <span class="map-popup-dot" style="background-color:${color};"></span>
              Road Traffic Sensor Feed
            </span>
            <button type="button" class="map-popup-close" data-popup-close aria-label="Close popup">×</button>
          </div>
          <div class="map-popup-title-row">
            <span class="map-popup-title">${name}</span>
            <span class="map-popup-tag">${segment_id}</span>
          </div>
          <div class="map-popup-kv-list">
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Source:</span>
              <span class="map-popup-kv-val">${state.trafficSourceFile}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Road Class:</span>
              <span class="map-popup-kv-val">${road_class}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Evaluated Time:</span>
              <span class="map-popup-kv-val">${epochToEstString(evalEpoch)}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Flow Status:</span>
              <span class="map-popup-kv-val accent" style="color:${color};">${label}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Current Speed:</span>
              <span class="map-popup-kv-val">${speed_kmh} km/h (limit ${speed_limit_kmh} km/h)</span>
            </div>
          </div>
        </div>
      </div>
    `);
    state.infoWindow.setPosition({ lat, lng });
    state.infoWindow.open(state.map);
    return;
  }
  if (hit.type === "collar") {
    const pt = hit.pt;
    const ptColor = getCollarColor(pt.isGtv2);
    state.infoWindow.setContent(`
      <div class="map-popup-card">
        <div class="map-popup-accent" style="background-color:${ptColor};"></div>
        <div class="map-popup-body">
          <div class="map-popup-top">
            <span class="map-popup-dataset-pill">
              <span class="map-popup-dot" style="background-color:${ptColor};"></span>
              Wildlife &amp; Buoy Telemetry
            </span>
            <button type="button" class="map-popup-close" data-popup-close aria-label="Close popup">×</button>
          </div>
          <div class="map-popup-title-row">
            <span class="map-popup-title">${pt.tag_id}</span>
            <span class="map-popup-tag">${pt.collar_hw}</span>
          </div>
          <div class="map-popup-kv-list">
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Source:</span>
              <span class="map-popup-kv-val">gtv2_collar_telemetry.csv</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Hardware:</span>
              <span class="map-popup-kv-val accent">${pt.collar_hw}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Timestamp:</span>
              <span class="map-popup-kv-val">${pt.timestamp_est}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Coordinates:</span>
              <span class="map-popup-kv-val">${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Altitude:</span>
              <span class="map-popup-kv-val">${pt.altitude_m} m</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Speed:</span>
              <span class="map-popup-kv-val">${pt.speed_kmh} km/h</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Heading:</span>
              <span class="map-popup-kv-val">${pt.heading_deg}°</span>
            </div>
          </div>
        </div>
      </div>
    `);
    state.infoWindow.setPosition({ lat: pt.lat, lng: pt.lng });
    state.infoWindow.open(state.map);
  } else if (hit.type === "radar") {
    const { track, ping } = hit;
    const trackColor = getTrackColor(track);
    const remarkHtml = track.remark
      ? `<div class="map-popup-remark">${track.remark}</div>`
      : "";
    state.infoWindow.setContent(`
      <div class="map-popup-card">
        <div class="map-popup-accent" style="background-color:${trackColor};"></div>
        <div class="map-popup-body">
          <div class="map-popup-top">
            <span class="map-popup-dataset-pill">
              <span class="map-popup-dot" style="background-color:${trackColor};"></span>
              CYOW Tower Radar
            </span>
            <button type="button" class="map-popup-close" data-popup-close aria-label="Close popup">×</button>
          </div>
          <div class="map-popup-title-row">
            <span class="map-popup-title">${track.callsign}</span>
            <span class="map-popup-tag">${track.track_id}</span>
          </div>
          <div class="map-popup-kv-list">
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Source:</span>
              <span class="map-popup-kv-val">yow_tower_radar.xml</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Radar Type:</span>
              <span class="map-popup-kv-val">${track.radar_type}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Squawk:</span>
              <span class="map-popup-kv-val">${track.transponder_squawk}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">RCS Profile:</span>
              <span class="map-popup-kv-val accent">${track.rcs_profile}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Timestamp:</span>
              <span class="map-popup-kv-val">${ping.timestamp_utc}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Coordinates:</span>
              <span class="map-popup-kv-val">${ping.lat.toFixed(4)}, ${ping.lng.toFixed(4)}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Altitude:</span>
              <span class="map-popup-kv-val">${ping.altitude_ft.toLocaleString()} ft</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Speed:</span>
              <span class="map-popup-kv-val">${ping.speed_kts} kts</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Heading:</span>
              <span class="map-popup-kv-val">${ping.heading_deg}°</span>
            </div>
          </div>
          ${remarkHtml}
        </div>
      </div>
    `);
    state.infoWindow.setPosition({ lat: ping.lat, lng: ping.lng });
    state.infoWindow.open(state.map);
  }
}

/* ==========================================================================
   5. Fast Dataset Filtering via DataReader & Persistent Selector DOM
   ========================================================================== */

function initFlightSelectorDOM() {
  const listEl = document.getElementById("radar-flights-list");
  if (!listEl) return;
  listEl.replaceChildren();
  state.flightRowDomMap.clear();
  if (!state.available.radar) return;

  const emptyEl = document.createElement("div");
  emptyEl.id = "radar-flights-empty";
  emptyEl.style.fontSize = "0.74rem";
  emptyEl.style.color = "var(--text-secondary)";
  emptyEl.textContent = "No radar tracks within selected time window.";
  emptyEl.hidden = true;
  listEl.appendChild(emptyEl);

  const sortedTracks = [...state.catalog.radarTracks].sort((a, b) => {
    if (a.isBioFlock !== b.isBioFlock) return a.isBioFlock ? -1 : 1;
    if (a.radar_type !== b.radar_type) {
      return a.radar_type === "PRIMARY_PSR" ? -1 : 1;
    }
    return a.callsign.localeCompare(b.callsign);
  });

  const frag = document.createDocumentFragment();
  for (const tr of sortedTracks) {
    const row = document.createElement("div");
    row.className = "flight-item";

    const label = document.createElement("label");
    label.className = "flight-check-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedFlights.has(tr.track_id);
    checkbox.addEventListener("change", (e) => {
      if (e.target.checked) {
        state.selectedFlights.add(tr.track_id);
      } else {
        state.selectedFlights.delete(tr.track_id);
      }
      syncFilteredDataAndMap();
    });

    const swatch = document.createElement("span");
    swatch.className = "flight-swatch";
    swatch.style.backgroundColor = getTrackColor(tr);

    const textWrap = document.createElement("div");
    textWrap.style.display = "flex";
    textWrap.style.flexDirection = "column";
    textWrap.style.minWidth = "0";

    const titleSpan = document.createElement("span");
    titleSpan.className = "flight-callsign";
    titleSpan.textContent = `${tr.callsign} · ${tr.track_id}`;

    const subSpan = document.createElement("span");
    subSpan.className = "flight-sub";
    subSpan.textContent = `${tr.rcs_profile} (${tr.totalTrackPings} pings)`;

    textWrap.appendChild(titleSpan);
    textWrap.appendChild(subSpan);

    label.appendChild(checkbox);
    label.appendChild(swatch);
    label.appendChild(textWrap);

    const zoomBtn = document.createElement("button");
    zoomBtn.type = "button";
    zoomBtn.className = "flight-zoom-btn";
    zoomBtn.textContent = "Zoom";
    zoomBtn.title = `Zoom to ${tr.callsign} (${tr.track_id})`;

    const rowRecord = {
      row,
      checkbox,
      subSpan,
      lastCount: tr.totalTrackPings,
      windowTrack: tr,
    };

    zoomBtn.addEventListener("click", async () => {
      if (!state.selectedFlights.has(tr.track_id)) {
        state.selectedFlights.add(tr.track_id);
        checkbox.checked = true;
        await syncFilteredDataAndMap();
      }
      focusFlightOnMap(rowRecord.windowTrack);
    });

    row.appendChild(label);
    row.appendChild(zoomBtn);
    frag.appendChild(row);

    state.flightRowDomMap.set(tr.track_id, rowRecord);
  }

  listEl.appendChild(frag);
}

function initCollarHwSelectorDOM() {
  const listEl = document.getElementById("collar-hw-list");
  if (!listEl) return;
  listEl.replaceChildren();
  state.collarHwRowDomMap.clear();
  if (!state.available.collars) return;

  const emptyEl = document.createElement("div");
  emptyEl.id = "collar-hw-empty";
  emptyEl.style.fontSize = "0.74rem";
  emptyEl.style.color = "var(--text-secondary)";
  emptyEl.textContent = "No telemetry records within selected time window.";
  emptyEl.hidden = true;
  listEl.appendChild(emptyEl);

  const frag = document.createDocumentFragment();
  for (const grp of state.catalog.collarHwGroups) {
    const row = document.createElement("div");
    row.className = "flight-item";

    const label = document.createElement("label");
    label.className = "flight-check-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedCollarHw.has(grp.hw);
    checkbox.addEventListener("change", (e) => {
      if (e.target.checked) {
        state.selectedCollarHw.add(grp.hw);
      } else {
        state.selectedCollarHw.delete(grp.hw);
      }
      syncFilteredDataAndMap();
    });

    const swatch = document.createElement("span");
    swatch.className = "flight-swatch";
    swatch.style.backgroundColor = getCollarColor(grp.isGtv2);

    const textWrap = document.createElement("div");
    textWrap.style.display = "flex";
    textWrap.style.flexDirection = "column";
    textWrap.style.minWidth = "0";

    const titleSpan = document.createElement("span");
    titleSpan.className = "flight-callsign";
    titleSpan.textContent = `${grp.hw} (${grp.tagCount} tags)`;

    const subSpan = document.createElement("span");
    subSpan.className = "flight-sub";
    subSpan.textContent = `${grp.desc} · ${grp.totalPoints.toLocaleString()} pts`;

    textWrap.appendChild(titleSpan);
    textWrap.appendChild(subSpan);

    label.appendChild(checkbox);
    label.appendChild(swatch);
    label.appendChild(textWrap);

    const zoomBtn = document.createElement("button");
    zoomBtn.type = "button";
    zoomBtn.className = "flight-zoom-btn";
    zoomBtn.textContent = "Zoom";
    zoomBtn.title = `Zoom to ${grp.hw} telemetry in active window`;

    const rowRecord = {
      row,
      checkbox,
      titleSpan,
      subSpan,
      lastKey: "",
    };

    zoomBtn.addEventListener("click", async () => {
      if (!state.selectedCollarHw.has(grp.hw)) {
        state.selectedCollarHw.add(grp.hw);
        checkbox.checked = true;
        await syncFilteredDataAndMap();
      }
      focusCollarHwOnMap(grp.hw);
    });

    row.appendChild(label);
    row.appendChild(zoomBtn);
    frag.appendChild(row);

    state.collarHwRowDomMap.set(grp.hw, rowRecord);
  }

  listEl.appendChild(frag);
}

async function syncFilteredDataAndMap() {
  const seq = ++state.syncSeq;
  const windowQuery = {
    startEpoch: state.windowStartEpoch,
    endEpoch: state.windowEndEpoch,
  };

  const [wlcRes, radarRes, collarRes, trafficRes] = await Promise.all([
    dataReader.getWlcEvents(windowQuery),
    dataReader.getRadarTracks(windowQuery),
    dataReader.getCollarTelemetry(windowQuery),
    dataReader.getRoadTraffic(windowQuery),
  ]);

  // Ignore stale async results if a newer window query was issued
  if (seq !== state.syncSeq) return;

  // 1. WLC Syslogs
  const wlcSection = document.getElementById("wlc-syslog-section");
  if (state.available.wlc) {
    const wlcEvents = wlcRes.events;
    const wlcCount = wlcEvents.length;

    document.getElementById("stat-wlc-events").textContent =
      `${wlcCount.toLocaleString()} / ${wlcRes.totalEvents.toLocaleString()}`;

    const statsByAp = {};
    for (const ap of ALL_APS) {
      statsByAp[ap.id] = { total: 0, gtv2: 0, warns: 0 };
    }
    let totalGtv2 = 0;
    let totalWarns = 0;
    for (const ev of wlcEvents) {
      const st = statsByAp[ev.ap_id];
      if (st) {
        st.total++;
        if (ev.isAnomaly) {
          st.gtv2++;
          totalGtv2++;
        }
        if (ev.event === "CHANNEL_UTIL_HIGH" || ev.event === "ASSOC_TABLE_SATURATED") {
          st.warns++;
          totalWarns++;
        }
      }
    }

    const fac = state.overlays.facilityAp;
    if (fac) {
      fac.statsByAp = statsByAp;
      fac.totals = { total: wlcCount, gtv2: totalGtv2, warns: totalWarns };
      const hasActivity = wlcCount > 0;
      const hasSpike = totalGtv2 > 0 || totalWarns > 0;
      const visKey = `${state.layers.wlc}:${hasActivity}:${hasSpike}`;

      if (fac.lastVisKey !== visKey) {
        fac.lastVisKey = visKey;
        const color = !hasActivity
          ? "#475569"
          : hasSpike
          ? "#ef4444"
          : "#10b981";

        fac.marker.setVisible(state.layers.wlc);
        fac.marker.setIcon({
          path: google.maps.SymbolPath.CIRCLE,
          scale: hasSpike ? 13 : 11,
          fillColor: color,
          fillOpacity: hasActivity ? 1 : 0.55,
          strokeColor: "#0f172a",
          strokeWeight: 2,
        });

        fac.circle.setVisible(state.layers.wlc);
        fac.circle.setOptions({
          strokeColor: color,
          fillColor: color,
          fillOpacity: hasSpike ? 0.24 : hasActivity ? 0.14 : 0.05,
        });
      }
    }

    if (wlcSection) {
      wlcSection.hidden = !state.layers.wlc;
    }
    if (state.layers.wlc) {
      renderSyslogSample(wlcEvents);
    }
  } else if (wlcSection) {
    wlcSection.hidden = true;
  }

  // 2. CYOW Tower Radar & Persistent Flight Selector List
  const radarSection = document.getElementById("radar-flights-section");
  if (state.available.radar) {
    let visibleTracks = 0;
    let visiblePings = 0;
    let tracksInWindowCount = 0;
    const activeRadarTracks = [];

    for (const track of radarRes.tracks) {
      const winCount = track.pings.length;
      const isFlightChecked = state.selectedFlights.has(track.track_id);

      const rowRec = state.flightRowDomMap.get(track.track_id);
      if (rowRec) {
        rowRec.windowTrack = track;
        const shouldHide = winCount === 0;
        if (rowRec.row.hidden !== shouldHide) {
          rowRec.row.hidden = shouldHide;
        }
        if (rowRec.checkbox.checked !== isFlightChecked) {
          rowRec.checkbox.checked = isFlightChecked;
        }
        if (winCount > 0 && rowRec.lastCount !== winCount) {
          rowRec.lastCount = winCount;
          rowRec.subSpan.textContent = `${track.rcs_profile} (${winCount} pings)`;
        }
      }

      if (winCount > 0) {
        tracksInWindowCount++;
        if (state.layers.radar && isFlightChecked) {
          visibleTracks++;
          visiblePings += winCount;
          activeRadarTracks.push(track);
        }
      }
    }

    state.filtered.activeRadarTracks = activeRadarTracks;

    const emptyEl = document.getElementById("radar-flights-empty");
    if (emptyEl) {
      emptyEl.hidden = tracksInWindowCount > 0;
    }

    document.getElementById("stat-radar-tracks").textContent =
      `${visibleTracks} / ${radarRes.totalTracks}`;
    document.getElementById("stat-radar-pings").textContent =
      `${visiblePings.toLocaleString()} / ${radarRes.totalPings.toLocaleString()}`;

    if (radarSection) {
      radarSection.hidden = !state.layers.radar;
    }
  } else {
    state.filtered.activeRadarTracks = [];
    if (radarSection) {
      radarSection.hidden = true;
    }
  }

  // 3. Wildlife & Buoy CSV Telemetry
  const collarSection = document.getElementById("collar-hw-section");
  if (state.available.collars) {
    state.filtered.collarPoints = collarRes.points;

    let visibleCollarCount = 0;
    let hwGroupsInWindow = 0;
    let visibleHwGroups = 0;
    const totalHwGroups = collarRes.hardwareGroups.length;

    for (const grp of collarRes.hardwareGroups) {
      const winPts = grp.windowPoints;
      const winTagCount = grp.tagCount;
      const isChecked = state.selectedCollarHw.has(grp.hw);

      if (state.layers.collars && isChecked) {
        visibleCollarCount += winPts;
      }

      const rowRec = state.collarHwRowDomMap.get(grp.hw);
      if (rowRec) {
        const shouldHide = winPts === 0;
        if (rowRec.row.hidden !== shouldHide) {
          rowRec.row.hidden = shouldHide;
        }
        if (rowRec.checkbox.checked !== isChecked) {
          rowRec.checkbox.checked = isChecked;
        }
        const key = `${winTagCount}:${winPts}`;
        if (winPts > 0 && rowRec.lastKey !== key) {
          rowRec.lastKey = key;
          rowRec.titleSpan.textContent = `${grp.hw} (${winTagCount} tags)`;
          rowRec.subSpan.textContent = `${grp.desc} · ${winPts.toLocaleString()} pts`;
        }
      }

      if (winPts > 0) {
        hwGroupsInWindow++;
        if (state.layers.collars && isChecked) {
          visibleHwGroups++;
        }
      }
    }

    const collarEmptyEl = document.getElementById("collar-hw-empty");
    if (collarEmptyEl) {
      collarEmptyEl.hidden = hwGroupsInWindow > 0;
    }

    document.getElementById("stat-collar-hw").textContent =
      `${visibleHwGroups} / ${totalHwGroups}`;
    document.getElementById("stat-collar-points").textContent =
      `${visibleCollarCount.toLocaleString()} / ${collarRes.totalPoints.toLocaleString()}`;

    if (collarSection) {
      collarSection.hidden = !state.layers.collars;
    }
  } else {
    state.filtered.collarPoints = [];
    if (collarSection) {
      collarSection.hidden = true;
    }
  }

  // 4. Historical Road Traffic (enriched with UI colors)
  if (state.available.traffic) {
    const activeTrafficSegments = trafficRes.segments.map((seg) => ({
      ...seg,
      ...getTrafficUiStyle(seg.congestion),
    }));
    state.filtered.activeTrafficSegments = activeTrafficSegments;

    const trafficSegEl = document.getElementById("stat-traffic-segments");
    if (trafficSegEl) {
      const shownSegs = state.layers.traffic ? trafficRes.totalSegments : 0;
      trafficSegEl.textContent = `${shownSegs} / ${trafficRes.totalSegments}`;
    }

    const trafficFlowEl = document.getElementById("stat-traffic-flow");
    if (trafficFlowEl) {
      if (!state.layers.traffic || activeTrafficSegments.length === 0) {
        trafficFlowEl.textContent = "Hidden";
      } else {
        const estClock = epochToEstString(trafficRes.evalEpoch).slice(11, 16);
        const summary = activeTrafficSegments
          .map((s) => `${s.speed_kmh}km/h`)
          .join(" · ");
        trafficFlowEl.textContent = `${estClock} EST (${summary})`;
      }
    }
  } else {
    state.filtered.activeTrafficSegments = [];
  }

  const showRightDrawer =
    (state.available.wlc && state.layers.wlc) ||
    (state.available.radar && state.layers.radar) ||
    (state.available.collars && state.layers.collars);

  const rightDrawer = document.getElementById("right-drawer");
  if (rightDrawer) {
    rightDrawer.hidden = !showRightDrawer;
  }
  const workspaceLayout = document.querySelector(".workspace-layout");
  if (workspaceLayout) {
    workspaceLayout.classList.toggle("right-hidden", !showRightDrawer);
  }

  // Redraw high-density sprite-stamped 2D canvas overlay
  state.canvasOverlay?.draw();
}

function focusCollarHwOnMap(hw) {
  const pts = state.filtered.collarPoints;
  if (!state.map || !pts.length) return;
  const bounds = new google.maps.LatLngBounds();
  const matching = [];

  for (const pt of pts) {
    if (pt.collar_hw === hw) {
      bounds.extend({ lat: pt.lat, lng: pt.lng });
      matching.push(pt);
    }
  }
  if (!matching.length) return;

  state.map.fitBounds(bounds, 70);
  const midPt = matching[Math.floor(matching.length / 2)];
  openHitInfoWindow({ type: "collar", pt: midPt });
}

function focusFlightOnMap(track) {
  if (!state.map || !track?.pings?.length) return;
  const bounds = new google.maps.LatLngBounds();
  for (const p of track.pings) {
    bounds.extend({ lat: p.lat, lng: p.lng });
  }
  state.map.fitBounds(bounds, 70);

  const midPing = track.pings[Math.floor(track.pings.length / 2)];
  openHitInfoWindow({ type: "radar", track, ping: midPing });
}

function renderSyslogSample(wlcEvents) {
  const count = wlcEvents.length;
  const firstEp = count > 0 ? wlcEvents[0].epoch : 0;
  const lastEp = count > 0 ? wlcEvents[count - 1].epoch : 0;
  const syslogKey = `${count}:${firstEp}:${lastEp}`;
  if (state.lastSyslogKey === syslogKey) return;
  state.lastSyslogKey = syslogKey;

  const container = document.getElementById("syslog-terminal");
  const badge = document.getElementById("syslog-count-badge");
  badge.textContent = `${count.toLocaleString()} events`;
  container.replaceChildren();

  if (count <= 0) {
    const empty = document.createElement("div");
    empty.className = "syslog-line";
    empty.textContent = "-- No WLC syslog events in selected time window --";
    container.appendChild(empty);
    return;
  }

  // Display events in strict chronological order
  const limit = Math.min(count, 100);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < limit; i++) {
    const ev = wlcEvents[i];
    const row = document.createElement("div");
    row.className = `syslog-line ${ev.isAnomaly ? "assoc" : "deauth"}`;
    row.textContent = ev.raw;
    frag.appendChild(row);
  }
  container.appendChild(frag);
}

/* ==========================================================================
   6. UI Event Listeners
   ========================================================================== */

function setupControls() {
  const workspaceLayout = document.querySelector(".workspace-layout");
  const leftDrawer = document.getElementById("left-drawer");
  const btnCollapseLeft = document.getElementById("btn-collapse-left");
  btnCollapseLeft.addEventListener("click", () => {
    const isCollapsed = leftDrawer.classList.toggle("collapsed");
    workspaceLayout.classList.toggle("left-collapsed", isCollapsed);
    btnCollapseLeft.textContent = isCollapsed ? "▶" : "◀";
    btnCollapseLeft.setAttribute("aria-expanded", String(!isCollapsed));
    btnCollapseLeft.title = isCollapsed ? "Expand Left Pane" : "Collapse Left Pane";
  });

  const rightDrawer = document.getElementById("right-drawer");
  const btnCollapseRight = document.getElementById("btn-collapse-right");
  btnCollapseRight.addEventListener("click", () => {
    const isCollapsed = rightDrawer.classList.toggle("collapsed");
    workspaceLayout.classList.toggle("right-collapsed", isCollapsed);
    btnCollapseRight.textContent = isCollapsed ? "◀" : "▶";
    btnCollapseRight.setAttribute("aria-expanded", String(!isCollapsed));
    btnCollapseRight.title = isCollapsed ? "Expand Right Pane" : "Collapse Right Pane";
  });

  const bindLayerCheckbox = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", (e) => {
      state.layers[key] = e.target.checked;
      syncFilteredDataAndMap();
    });
  };
  bindLayerCheckbox("toggle-layer-wlc", "wlc");
  bindLayerCheckbox("toggle-layer-radar", "radar");
  bindLayerCheckbox("toggle-layer-collars", "collars");
  bindLayerCheckbox("toggle-layer-traffic", "traffic");

  // Select All / Deselect All flights buttons
  document.getElementById("btn-flights-all").addEventListener("click", () => {
    for (const tr of state.catalog.radarTracks) {
      state.selectedFlights.add(tr.track_id);
    }
    syncFilteredDataAndMap();
  });

  document.getElementById("btn-flights-none").addEventListener("click", () => {
    state.selectedFlights.clear();
    syncFilteredDataAndMap();
  });

  // Select All / Deselect All collar_hw buttons
  document.getElementById("btn-collar-hw-all").addEventListener("click", () => {
    for (const grp of state.catalog.collarHwGroups) {
      state.selectedCollarHw.add(grp.hw);
    }
    syncFilteredDataAndMap();
  });

  document.getElementById("btn-collar-hw-none").addEventListener("click", () => {
    state.selectedCollarHw.clear();
    syncFilteredDataAndMap();
  });

  // Dual-handle range sliders (immediate UI feedback + RAF-throttled map filter)
  const sliderMin = document.getElementById("slider-min");
  const sliderMax = document.getElementById("slider-max");
  const fillEl = document.getElementById("dual-slider-fill");
  const trackWrapper = document.getElementById("timeline-track-wrapper");

  sliderMin.addEventListener("input", (e) => {
    stopPlayback();
    const val = parseInt(e.target.value, 10);
    state.windowStartEpoch = Math.min(val, state.windowEndEpoch);
    syncTimeControlsUI();
    scheduleFilterSync();
  });

  sliderMax.addEventListener("input", (e) => {
    stopPlayback();
    const val = parseInt(e.target.value, 10);
    state.windowEndEpoch = Math.max(val, state.windowStartEpoch);
    syncTimeControlsUI();
    scheduleFilterSync();
  });

  // Play / Pause button
  document.getElementById("btn-play-pause").addEventListener("click", () => {
    if (state.isPlaying) {
      stopPlayback();
    } else {
      startPlayback();
    }
  });

  // Step Backward / Forward buttons
  const stepWindowBy = (dir) => {
    stopPlayback();
    const globalSpan = state.globalMaxEpoch - state.globalMinEpoch;
    let windowSpan = state.windowEndEpoch - state.windowStartEpoch;
    if (windowSpan >= globalSpan - 15 || windowSpan <= 0) {
      windowSpan = 1800; // Default to 30m window when stepping from Full
      state.windowStartEpoch =
        dir > 0 ? state.globalMinEpoch : state.globalMaxEpoch - windowSpan;
      state.windowEndEpoch = state.windowStartEpoch + windowSpan;
    } else {
      const stepSec = Math.max(60, Math.min(900, Math.round(windowSpan / 3 / 15) * 15));
      let nextStart = state.windowStartEpoch + dir * stepSec;
      nextStart = Math.max(
        state.globalMinEpoch,
        Math.min(state.globalMaxEpoch - windowSpan, nextStart)
      );
      state.windowStartEpoch = nextStart;
      state.windowEndEpoch = nextStart + windowSpan;
    }
    syncTimeControlsUI();
    syncFilteredDataAndMap();
  };

  document.getElementById("btn-step-back").addEventListener("click", () => {
    stepWindowBy(-1);
  });

  document.getElementById("btn-step-fwd").addEventListener("click", () => {
    stepWindowBy(1);
  });

  // Window Width Preset buttons (5m, 15m, 30m, 1h, 4h, Full)
  const presetBtns = document.querySelectorAll("#window-preset-group .seg-btn");
  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      stopPlayback();
      const attr = btn.getAttribute("data-window-sec");
      if (attr === "full") {
        state.windowStartEpoch = state.globalMinEpoch;
        state.windowEndEpoch = state.globalMaxEpoch;
      } else {
        const targetSpan = parseInt(attr, 10);
        let nextStart = state.windowStartEpoch;
        if (nextStart + targetSpan > state.globalMaxEpoch) {
          nextStart = Math.max(
            state.globalMinEpoch,
            state.globalMaxEpoch - targetSpan
          );
        }
        state.windowStartEpoch = nextStart;
        state.windowEndEpoch = Math.min(
          state.globalMaxEpoch,
          nextStart + targetSpan
        );
      }
      syncTimeControlsUI();
      syncFilteredDataAndMap();
    });
  });

  // Playback Speed Preset buttons (1x, 5x, 15x, 60x)
  const speedBtns = document.querySelectorAll("#playback-speed-group .seg-btn");
  speedBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.playbackSpeed = parseInt(btn.getAttribute("data-speed"), 10) || 5;
      speedBtns.forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  // Drag the highlighted window fill bar to scrub the fixed-width window across the timeline
  let isDraggingWindow = false;
  let dragStartX = 0;
  let dragInitialStart = 0;
  let dragWindowSpan = 1800;

  fillEl.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    stopPlayback();
    const globalSpan = state.globalMaxEpoch - state.globalMinEpoch;
    let currentSpan = state.windowEndEpoch - state.windowStartEpoch;

    // If currently in Full mode, switch to a 30m window centered at the pointer click
    if (currentSpan >= globalSpan - 15) {
      currentSpan = 1800;
      const rect = trackWrapper.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const clickEpoch = state.globalMinEpoch + ratio * globalSpan;
      const centeredStart = Math.round((clickEpoch - currentSpan / 2) / 15) * 15;
      state.windowStartEpoch = Math.max(
        state.globalMinEpoch,
        Math.min(state.globalMaxEpoch - currentSpan, centeredStart)
      );
      state.windowEndEpoch = state.windowStartEpoch + currentSpan;
      syncTimeControlsUI();
      scheduleFilterSync();
    }

    isDraggingWindow = true;
    dragStartX = e.clientX;
    dragInitialStart = state.windowStartEpoch;
    dragWindowSpan = currentSpan;
    fillEl.classList.add("dragging");
    fillEl.setPointerCapture(e.pointerId);
  });

  fillEl.addEventListener("pointermove", (e) => {
    if (!isDraggingWindow) return;
    const rect = trackWrapper.getBoundingClientRect();
    if (rect.width <= 0) return;
    const globalSpan = state.globalMaxEpoch - state.globalMinEpoch;
    const deltaRatio = (e.clientX - dragStartX) / rect.width;
    const deltaSec = Math.round((deltaRatio * globalSpan) / 15) * 15;
    const nextStart = Math.max(
      state.globalMinEpoch,
      Math.min(state.globalMaxEpoch - dragWindowSpan, dragInitialStart + deltaSec)
    );
    if (nextStart !== state.windowStartEpoch) {
      state.windowStartEpoch = nextStart;
      state.windowEndEpoch = nextStart + dragWindowSpan;
      syncTimeControlsUI();
      scheduleFilterSync();
    }
  });

  const endWindowDrag = (e) => {
    if (!isDraggingWindow) return;
    isDraggingWindow = false;
    fillEl.classList.remove("dragging");
    if (e.pointerId !== undefined && fillEl.hasPointerCapture(e.pointerId)) {
      fillEl.releasePointerCapture(e.pointerId);
    }
  };
  fillEl.addEventListener("pointerup", endWindowDrag);
  fillEl.addEventListener("pointercancel", endWindowDrag);

  // Clicking on the background track jumps the sliding window to that point
  const trackBg = trackWrapper.querySelector(".dual-slider-track");
  trackBg.addEventListener("click", (e) => {
    stopPlayback();
    const rect = trackWrapper.getBoundingClientRect();
    if (rect.width <= 0) return;
    const globalSpan = state.globalMaxEpoch - state.globalMinEpoch;
    let currentSpan = state.windowEndEpoch - state.windowStartEpoch;
    if (currentSpan >= globalSpan - 15 || currentSpan <= 0) {
      currentSpan = 1800;
    }
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const clickEpoch = state.globalMinEpoch + ratio * globalSpan;
    const centeredStart = Math.round((clickEpoch - currentSpan / 2) / 15) * 15;
    state.windowStartEpoch = Math.max(
      state.globalMinEpoch,
      Math.min(state.globalMaxEpoch - currentSpan, centeredStart)
    );
    state.windowEndEpoch = state.windowStartEpoch + currentSpan;
    syncTimeControlsUI();
    syncFilteredDataAndMap();
  });

  // Zoom controls
  document.getElementById("btn-zoom-facility").addEventListener("click", () => {
    if (!state.map) return;
    state.map.panTo(FACILITY_CENTER);
    state.map.setZoom(16);
  });

  document.getElementById("btn-zoom-regional").addEventListener("click", () => {
    if (!state.map) return;
    state.map.panTo(REGIONAL_CENTER);
    state.map.setZoom(11);
  });

  // 3-way segmented Map Mode switcher (Satellite Hybrid | Dark Map | Light Map)
  const mapModeBtns = document.querySelectorAll("#map-mode-group .seg-btn");
  mapModeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-map-mode");
      state.mapType = mode;
      mapModeBtns.forEach((b) => b.classList.toggle("active", b === btn));
      if (!state.map) return;

      if (mode === "hybrid") {
        state.map.setMapTypeId("hybrid");
        state.map.setOptions({ styles: null });
      } else if (mode === "dark") {
        state.map.setMapTypeId("roadmap");
        state.map.setOptions({ styles: DARK_MAP_STYLES });
      } else if (mode === "light") {
        state.map.setMapTypeId("roadmap");
        state.map.setOptions({ styles: LIGHT_MAP_STYLES });
      }

      if (state.overlays.facilityAp) {
        state.overlays.facilityAp.marker.setLabel({
          text: "FAC-OTT-01 (APs)",
          color: mode === "light" ? "#0f172a" : "#f8fafc",
          fontSize: "11px",
          fontWeight: "700",
        });
      }

      state.canvasOverlay?.draw();
    });
  });

  // Two-state UI color-scheme toggle
  const themeBtn = document.getElementById("btn-theme-toggle");
  const metaScheme = document.querySelector('meta[name="color-scheme"]');
  const sysDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  const getEffectiveTheme = () => {
    const pinned = localStorage.getItem("color-scheme");
    if (pinned === "dark" || pinned === "light") return pinned;
    return sysDarkQuery.matches ? "dark" : "light";
  };

  const applyThemeAttribute = (scheme) => {
    document.documentElement.classList.remove("theme-dark", "theme-light");
    if (scheme === "dark") {
      document.documentElement.classList.add("theme-dark");
      metaScheme.content = "dark";
    } else if (scheme === "light") {
      document.documentElement.classList.add("theme-light");
      metaScheme.content = "light";
    } else {
      metaScheme.content = "light dark";
    }
    const effective = getEffectiveTheme();
    themeBtn.textContent =
      effective === "dark" ? "☀ Light UI" : "☾ Dark UI";
  };

  applyThemeAttribute(localStorage.getItem("color-scheme"));

  sysDarkQuery.addEventListener("change", () => {
    if (!localStorage.getItem("color-scheme")) {
      applyThemeAttribute(null);
    }
  });

  themeBtn.addEventListener("click", () => {
    const currentEffective = getEffectiveTheme();
    const nextPinned = currentEffective === "dark" ? "light" : "dark";
    localStorage.setItem("color-scheme", nextPinned);
    applyThemeAttribute(nextPinned);
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  await initDataReader();
  await loadAllDatasets();
  setupControls();
  await initGoogleMap();
});
