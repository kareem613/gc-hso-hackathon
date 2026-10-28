# Google Maps Implementation & Performance Guide

Visualizing tens of thousands of time-series points, multi-segment polylines, and continuous timeline playback at 60fps in the Google Maps JavaScript API requires avoiding standard per-feature DOM/MVC patterns. Use these architectural specs to avoid the most common rendering bottlenecks when building your map UI from scratch.

## 1. Do Not Instantiate Thousands of Native Markers or Polylines

- **Pitfall:** Creating a `google.maps.Marker`, `AdvancedMarkerElement`, or `google.maps.Polyline` per telemetry reading or radar ping—and calling `.setMap()` / `.setOptions()` while scrubbing a timeline—stalls the browser main thread below 5fps due to per-object MVC and DOM overhead.
- **Recommended Architecture:**
  - Reserve native Maps objects (`Marker`, `Circle`) strictly for a handful of static site landmarks, plus **one** shared `google.maps.InfoWindow` reused across all popups.
  - Render all dynamic layers (traffic polylines, flight tracks/pings, and high-density telemetry point clouds) onto a **single custom `google.maps.OverlayView` HTML5 2D `<canvas>`** (or a single WebGL/deck.gl layer), keeping DOM node count constant regardless of dataset size.

## 2. `OverlayView` Canvas Alignment, Panning & HiDPI Pitfalls

Attaching a viewport-sized `<canvas>` (`mapDiv.clientWidth` × `mapDiv.clientHeight`, `pointer-events: none`) to `this.getPanes().overlayLayer` has three subtle traps:

1. **`overlayLayer` uses moving `divPixel` coordinates, not viewport coordinates:** During a pan, Google Maps translates the `overlayLayer` pane via CSS transforms. On every `draw()`, compute the offset between `projection.fromLatLngToDivPixel(center)` and `projection.fromLatLngToContainerPixel(center)` and set:
   ```js
   canvas.style.left = `${Math.round(centerDivPx.x - centerContPx.x)}px`;
   canvas.style.top  = `${Math.round(centerDivPx.y - centerContPx.y)}px`;
   ```
   Without this offset, canvas drawings drift off the basemap as soon as the user pans.
2. **`OverlayView.draw()` does not fire on every pan/zoom frame:** Register `map.addListener("bounds_changed", () => overlay.draw())` so the canvas redraws synchronously with continuous drag and zoom gestures.
3. **Blurry HiDPI rendering:** Scale the canvas backing buffer by `dpr = window.devicePixelRatio || 1` (`canvas.width = Math.round(width * dpr)`, `` canvas.style.width = `${width}px` ``) and call `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` before `ctx.clearRect(0, 0, width, height)`.

## 3. Avoid Calling `fromLatLngToContainerPixel()` Inside Tight Loops

- **Pitfall:** Calling `projection.fromLatLngToContainerPixel(new google.maps.LatLng(lat, lng))` 35,000+ times per frame allocates thousands of short-lived objects and saturates CPU during pans and playback.
- **Fix — Precomputed Web Mercator + Two-Anchor Affine Projection:**
  1. Convert `{ lat, lng }` to normalized Web Mercator world coordinates `(wx, wy)` **once** per data point (cached on load or in a `WeakMap`):
     ```js
     const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
     const wx = 256 * (0.5 + lng / 360);
     const wy = 256 * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI));
     ```
  2. At the top of `draw()`, call `projection.fromLatLngToContainerPixel()` on only **two** fixed reference anchors (`A` and `B`) to compute `scaleX`, `scaleY`, `offsetX`, and `offsetY`. Every point then projects to container pixels with two multiplies and two adds:
     ```js
     const px = wx * scaleX + offsetX;
     const py = wy * scaleY + offsetY;
     ```

## 4. Stamp Offscreen Sprites Instead of Stroking Vector Arcs

- **Pitfall:** Executing `beginPath()` + `arc()` + `fill()` + `stroke()` tens of thousands of times per frame bottlenecks the 2D canvas path rasterizer.
- **Fix:** Pre-render each marker style `(radius, fillColor, strokeColor, lineWidth, dpr)` once onto a tiny offscreen `<canvas>` cached in a `Map`, then stamp bitmaps in the render loop with `ctx.drawImage()`.

## 5. Cull Viewport Bounds & Same-Pixel Overdraw (`Uint8Array` Grid)

- **Pitfall:** When zoomed out or viewing a multi-hour window, thousands of telemetry readings project onto the exact same integer screen pixel, wasting GPU/CPU bandwidth on invisible overdraw.
- **Fix:**
  - Skip any point whose `(px, py)` falls outside `[0, width]` × `[0, height]` (plus marker radius padding).
  - Reuse a preallocated `Uint8Array(width * height)` cleared via `.fill(0, 0, width * height)` each frame. Record a per-series bitmask at `(py | 0) * width + (px | 0)` and skip `drawImage()` if that series already painted that pixel in the current frame.
  - Render background series in Pass 1 and high-interest series in Pass 2 so key tracks remain visible on top without sorting point arrays per frame.

## 6. Screen-Space Hit-Testing (Zero Per-Point Click Listeners)

- **Pitfall:** Attaching thousands of DOM elements or event listeners for point/polyline inspection.
- **Fix:** Keep `pointer-events: none` on the `<canvas>` and register a single `map.addListener("click", (e) => ...)` handler. Project the clicked `e.latLng` and visible candidates with the same two-anchor affine transform, find the closest visible point within ~`12px` (or closest polyline segment within ~`10px` using point-to-segment squared distance), and populate/open the single shared `InfoWindow` only for the winning hit.

## 7. Throttle Scrubber Updates & Minimize Sidebar DOM Churn

- **Coalesce slider input onto `requestAnimationFrame`:** High-frequency range-slider `input` and pointer-drag events fire faster than 60Hz. Update lightweight slider thumb/label state immediately, schedule data slicing + canvas redraw once per animation frame, and guard async queries with a monotonic sequence ID so out-of-order responses are ignored.
- **Mutate persistent DOM rows instead of rebuilding lists:** Build track/device filter rows once at startup and memoize each row's last rendered count—update `.hidden` and count text only when values change. Cap live log previews (e.g., 100 rows via `DocumentFragment`), memoize by `(count, firstEpoch, lastEpoch)` to skip no-op re-renders, and apply `content-visibility: auto; contain: layout style paint;` to scrollable side panels.
