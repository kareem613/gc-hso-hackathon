/* ==========================================================================
   Core Google Maps Bootstrap, Basemap/Theme Controls & Shared Popup Helper
   ========================================================================== */

export const FACILITY_CENTER = { lat: 45.3507, lng: -75.8518 };
export const FACILITY_NAME = "Carling Campus Government Complex";
export const FACILITY_COORDS_LABEL = "45.3507° N, -75.8518° W";
export const DEFAULT_ZOOM = 15;

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

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function loadEnvConfig() {
  const env = {};
  try {
    const res = await fetch("/.env");
    if (res.ok) {
      for (const raw of (await res.text()).split(/\r?\n/)) {
        const line = raw.trim();
        const eq = line.indexOf("=");
        if (line && !line.startsWith("#") && eq > 0) {
          env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
        }
      }
    }
  } catch {}
  return env;
}

function bootstrapGoogleMapsLoader(key) {
  if (window.google?.maps?.importLibrary) return;
  ((g) => {
    var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window;
    b = b[c] || (b[c] = {});
    var d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(),
      u = () => h || (h = new Promise(async (f, n) => {
        await (a = m.createElement("script"));
        e.set("libraries", [...r] + "");
        for (k in g) e.set(k.replace(/[A-Z]/g, (t) => "_" + t[0].toLowerCase()), g[k]);
        e.set("callback", c + ".maps." + q);
        a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
        d[q] = f;
        a.onerror = () => (h = n(Error(p + " could not load.")));
        a.nonce = m.querySelector("script[nonce]")?.nonce || "";
        m.head.append(a);
      }));
    d[l] ? console.warn(p + " only loads once.") : (d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)));
  })({ key, v: "weekly" });
}

function renderKvRows(rows = []) {
  return rows
    .map(([k, v]) => `<div class="map-popup-kv-row"><span class="map-popup-kv-key">${esc(k)}:</span><span class="map-popup-kv-val">${esc(v)}</span></div>`)
    .join("");
}

export async function initMapCore({ onMapModeChange } = {}) {
  let map = null;
  let mapType = "hybrid";
  let infoWindow = null;

  document.getElementById("btn-zoom-facility")?.addEventListener("click", () => {
    if (!map) return;
    map.panTo(FACILITY_CENTER);
    map.setZoom(16);
  });

  const mapModeBtns = document.querySelectorAll("#map-mode-group .seg-btn");
  mapModeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      mapType = btn.getAttribute("data-map-mode") || "hybrid";
      mapModeBtns.forEach((b) => b.classList.toggle("active", b === btn));
      if (!map) return;
      map.setMapTypeId(mapType === "hybrid" ? "hybrid" : "roadmap");
      map.setOptions({ styles: mapType === "dark" ? DARK_MAP_STYLES : mapType === "light" ? LIGHT_MAP_STYLES : null });
      onMapModeChange?.(mapType);
    });
  });

  const themeBtn = document.getElementById("btn-theme-toggle");
  const metaScheme = document.querySelector('meta[name="color-scheme"]');
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)");
  const getTheme = () => {
    const pinned = localStorage.getItem("color-scheme");
    return pinned === "dark" || pinned === "light" ? pinned : sysDark.matches ? "dark" : "light";
  };
  const applyTheme = (scheme) => {
    document.documentElement.classList.remove("theme-dark", "theme-light");
    if (scheme === "dark" || scheme === "light") document.documentElement.classList.add(`theme-${scheme}`);
    if (metaScheme) metaScheme.content = scheme === "dark" || scheme === "light" ? scheme : "light dark";
    if (themeBtn) themeBtn.textContent = getTheme() === "dark" ? "☀ Light UI" : "☾ Dark UI";
  };
  applyTheme(localStorage.getItem("color-scheme"));
  sysDark.addEventListener("change", () => !localStorage.getItem("color-scheme") && applyTheme(null));
  themeBtn?.addEventListener("click", () => {
    const next = getTheme() === "dark" ? "light" : "dark";
    localStorage.setItem("color-scheme", next);
    applyTheme(next);
  });

  const env = await loadEnvConfig();
  bootstrapGoogleMapsLoader(env.GOOGLE_MAPS_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY || "");
  const { Map, InfoWindow, Circle } = await google.maps.importLibrary("maps");

  const mapEl = document.getElementById("map-canvas");
  map = new Map(mapEl, {
    center: FACILITY_CENTER,
    zoom: DEFAULT_ZOOM,
    mapTypeId: "hybrid",
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });
  infoWindow = new InfoWindow({ headerDisabled: true });
  mapEl.addEventListener("click", (e) => e.target.closest("[data-popup-close]") && infoWindow.close());

  const openPopup = ({ pill = "Incident Briefing", color = "#10b981", title = "", tag = "", rows = [], sections = [], position = FACILITY_CENTER }) => {
    const extraHtml = sections
      .map((s) => `<div class="map-popup-section-label">${esc(s.label)}</div><div class="map-popup-kv-list is-borderless">${renderKvRows(s.rows)}</div>`)
      .join("");
    infoWindow.setContent(`
      <div class="map-popup-card" style="--popup-accent:${esc(color)}">
        <div class="map-popup-accent"></div>
        <div class="map-popup-body">
          <div class="map-popup-top">
            <span class="map-popup-dataset-pill"><span class="map-popup-dot"></span>${esc(pill)}</span>
            <button type="button" class="map-popup-close" data-popup-close aria-label="Close popup">×</button>
          </div>
          <div class="map-popup-title-row">
            <span class="map-popup-title">${esc(title)}</span>
            ${tag ? `<span class="map-popup-tag">${esc(tag)}</span>` : ""}
          </div>
          ${rows.length ? `<div class="map-popup-kv-list">${renderKvRows(rows)}</div>` : ""}
          ${extraHtml}
        </div>
      </div>`);
    infoWindow.setPosition(position);
    infoWindow.open(map);
  };

  const fetchJson = async (url, opts) => {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
    return res.json();
  };

  return { map, google: window.google, Circle, InfoWindow, getMapType: () => mapType, openPopup, fetchJson };
}
