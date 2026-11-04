/* ==========================================================================
   Incident Response Geospatial Console (#INC-2026-1012)
   Facility AP Overlay & Pluggable Dataset Module Loader
   ========================================================================== */

import { FACILITY_CENTER, FACILITY_NAME, FACILITY_COORDS_LABEL, initMapCore } from "./map-core.js";

const OUTDOOR_APS = ["AP-West-Gate", "AP-Central-Courtyard", "AP-East-Pavilion"];

// Register dataset visualization modules under src/datasets/*.js as you build them.
// Each module should export `async function initDataset(ctx) { ... }`.
const DATASET_MODULES = [
  // "./datasets/wlc-syslog.js",
  // "./datasets/road-traffic.js",
  // "./datasets/tower-radar.js",
];

function buildFacilityOverlay(ctx) {
  const { map, google, Circle, getMapType, openPopup } = ctx;

  const circle = new Circle({
    strokeColor: "#10b981",
    strokeOpacity: 0.9,
    strokeWeight: 2,
    fillColor: "#10b981",
    fillOpacity: 0.16,
    map,
    center: FACILITY_CENTER,
    radius: 260,
    clickable: true,
  });

  const makeLabel = (mode) => ({
    text: "FAC-OTT-01 (APs)",
    color: mode === "light" ? "#0f172a" : "#f8fafc",
    fontSize: "11px",
    fontWeight: "700",
  });

  const marker = new google.maps.Marker({
    position: FACILITY_CENTER,
    map,
    title: `FAC-OTT-01 ${FACILITY_NAME} (${FACILITY_COORDS_LABEL})`,
    label: makeLabel(getMapType()),
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

  const showFacilityPopup = () =>
    openPopup({
      pill: "Incident Briefing",
      color: "#10b981",
      title: "FAC-OTT-01 Campus APs",
      tag: `${OUTDOOR_APS.length} Collocated APs`,
      rows: [
        ["Facility", FACILITY_NAME],
        ["Coordinates", FACILITY_COORDS_LABEL],
        ["SSID", "GOV_GUEST_WIFI"],
      ],
      sections: [
        {
          label: "Access Points (* = Outdoor Guest Wi-Fi)",
          rows: OUTDOOR_APS.map((id) => [`${id}*`, "Outdoor (Collocated)"]),
        },
      ],
      position: FACILITY_CENTER,
    });

  marker.addListener("click", showFacilityPopup);
  circle.addListener("click", showFacilityPopup);

  return { marker, circle, updateMapMode: (mode) => marker.setLabel(makeLabel(mode)) };
}

window.addEventListener("DOMContentLoaded", async () => {
  let facility = null;
  const ctx = await initMapCore({
    onMapModeChange: (mode) => facility?.updateMapMode(mode),
  });

  facility = buildFacilityOverlay(ctx);
  ctx.facility = facility;

  for (const modulePath of DATASET_MODULES) {
    try {
      const mod = await import(modulePath);
      await mod.initDataset?.(ctx);
    } catch (err) {
      console.error(`[dataset] Failed to load ${modulePath}:`, err);
    }
  }
});
