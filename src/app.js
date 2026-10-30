/* ==========================================================================
   Incident Response Geospatial Console (#INC-2026-1012)
   Starter Google Maps Initialization, Facility AP Overlay & UI Controls
   ========================================================================== */

const FACILITY_CENTER = { lat: 45.3507, lng: -75.8518 };
const FACILITY_NAME = "Carling Campus Government Complex";
const FACILITY_COORDS_LABEL = "45.3507° N, -75.8518° W";
const DEFAULT_ZOOM = 15;

const OUTDOOR_APS = [
  { id: "AP-West-Gate", outdoor: true },
  { id: "AP-Central-Courtyard", outdoor: true },
  { id: "AP-East-Pavilion", outdoor: true },
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
  map: null,
  mapType: "hybrid",
  infoWindow: null,
  facilityMarker: null,
  facilityCircle: null,
};

async function loadEnvConfig() {
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

function buildFacilityOverlay(CircleClass) {
  const circle = new CircleClass({
    strokeColor: "#10b981",
    strokeOpacity: 0.9,
    strokeWeight: 2,
    fillColor: "#10b981",
    fillOpacity: 0.16,
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
      color: state.mapType === "light" ? "#0f172a" : "#f8fafc",
      fontSize: "11px",
      fontWeight: "700",
    },
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 12,
      fillColor: "#10b981",
      fillOpacity: 1,
      strokeColor: "#0f172a",
      strokeWeight: 2,
    },
    zIndex: 35,
  });

  state.facilityMarker = marker;
  state.facilityCircle = circle;

  const handleClickFacility = () => {
    const rowsHtml = OUTDOOR_APS.map(
      (ap) => `<div class="map-popup-kv-row">
        <span class="map-popup-kv-key">${ap.id}${ap.outdoor ? "*" : ""}:</span>
        <span class="map-popup-kv-val">Outdoor (Collocated)</span>
      </div>`
    ).join("");

    state.infoWindow.setContent(`
      <div class="map-popup-card">
        <div class="map-popup-accent" style="background-color:#10b981;"></div>
        <div class="map-popup-body">
          <div class="map-popup-top">
            <span class="map-popup-dataset-pill">
              <span class="map-popup-dot" style="background-color:#10b981;"></span>
              Incident Briefing
            </span>
            <button type="button" class="map-popup-close" data-popup-close aria-label="Close popup">×</button>
          </div>
          <div class="map-popup-title-row">
            <span class="map-popup-title">FAC-OTT-01 Campus APs</span>
            <span class="map-popup-tag">${OUTDOOR_APS.length} Collocated APs</span>
          </div>
          <div class="map-popup-kv-list">
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Facility:</span>
              <span class="map-popup-kv-val">${FACILITY_NAME}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">Coordinates:</span>
              <span class="map-popup-kv-val">${FACILITY_COORDS_LABEL}</span>
            </div>
            <div class="map-popup-kv-row">
              <span class="map-popup-kv-key">SSID:</span>
              <span class="map-popup-kv-val">GOV_GUEST_WIFI</span>
            </div>
          </div>
          <div class="map-popup-section-label">Access Points (* = Outdoor Guest Wi-Fi)</div>
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
}

async function initGoogleMap() {
  const env = await loadEnvConfig();
  const apiKey = env.GOOGLE_MAPS_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY || "";
  bootstrapGoogleMapsLoader(apiKey);

  const { Map, InfoWindow, Circle } = await google.maps.importLibrary("maps");

  const mapEl = document.getElementById("map-canvas");
  state.map = new Map(mapEl, {
    center: FACILITY_CENTER,
    zoom: DEFAULT_ZOOM,
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

  buildFacilityOverlay(Circle);
}

function setupControls() {
  document.getElementById("btn-zoom-facility").addEventListener("click", () => {
    if (!state.map) return;
    state.map.panTo(FACILITY_CENTER);
    state.map.setZoom(16);
  });

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

      if (state.facilityMarker) {
        state.facilityMarker.setLabel({
          text: "FAC-OTT-01 (APs)",
          color: mode === "light" ? "#0f172a" : "#f8fafc",
          fontSize: "11px",
          fontWeight: "700",
        });
      }
    });
  });

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
    themeBtn.textContent = effective === "dark" ? "☀ Light UI" : "☾ Dark UI";
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
  setupControls();
  await initGoogleMap();
});
