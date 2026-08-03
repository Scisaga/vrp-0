let herePromise = null;
let hereMarkerIcon = null;

const HERE_FIT_VIEW_MAX_ZOOM = 18;
// smallHereMarkerIcon() anchors the pin tip at the geographic coordinate;
// its circular head is 26.125 px above that tip.
const HERE_SMALL_MARKER_HEAD_OFFSET_Y = -26.125;
// Keep the complete marker icon and route ends off the canvas edge while
// retaining HERE's own calculated zoom (no additional zoom-in delta).
const HERE_VIEWPORT_PADDING = { top: 60, right: 40, bottom: 40, left: 40 };
const HERE_STYLE_LINK_ATTR = "data-vrp-scenario-here-css";
const DARK_MAP_STYLE = "amap://styles/darkblue";

function smallHereMarkerIcon(H) {
  if (hereMarkerIcon) return hereMarkerIcon;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 28 38">',
    '<path fill="#0ea5a4" d="M14 0C6.7 0 .8 5.9.8 13.2c0 9.7 13.2 24.8 13.2 24.8s13.2-15.1 13.2-24.8C27.2 5.9 21.3 0 14 0Z"/>',
    '<circle cx="14" cy="13.2" r="5.2" fill="#fff" fill-opacity=".94"/>',
    '</svg>'
  ].join("");
  hereMarkerIcon = new H.map.Icon(svg, {
    size: { w: 30, h: 40 },
    anchor: { x: 15, y: 40 }
  });
  return hereMarkerIcon;
}

function mapContext() {
  return window.VrpScenarioGateway?.context?.map_context || null;
}

function hereLanguage(locale) {
  return locale === "en-US" || locale === "en" ? "en" : "zh";
}

function dayBaseLayer(layers) {
  return layers?.vector?.normal?.map
    || layers?.raster?.normal?.map;
}

function nightBaseLayer(layers) {
  // Some localized HERE vector-layer catalogs omit mapnight.  The localized
  // raster night layer is still available, and is preferable to silently
  // falling back to the light vector map.
  return layers?.vector?.normal?.mapnight
    || layers?.raster?.normal?.mapnight
    || dayBaseLayer(layers);
}

function mapThemeFromStyle(mapStyle) {
  return mapStyle === DARK_MAP_STYLE ? "dark" : "light";
}

function baseLayerForTheme(layers, theme) {
  return theme === "dark" ? nightBaseLayer(layers) : dayBaseLayer(layers);
}

function hereUrls(context) {
  const core = context?.js_url || "";
  if (!context?.enabled || context.provider !== "here" || !context.browser_key || !core) {
    return null;
  }
  const root = core.replace(/mapsjs-core\.js(?:\?.*)?$/, "");
  return {
    core,
    service: `${root}mapsjs-service.js`,
    ui: `${root}mapsjs-ui.js`,
    events: `${root}mapsjs-mapevents.js`,
    css: context.css_url || `${root}mapsjs-ui.css`
  };
}

function loadScript(src, marker) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[${marker}="true"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load HERE JS SDK")), { once: true });
      if (window.H) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset[marker.replace(/^data-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = "true";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Failed to load HERE JS SDK"));
    document.head.appendChild(script);
  });
}

function loadCss(href, root = document) {
  if (!href) return;
  const host = root?.head || root;
  if (!host?.querySelector || !host?.append) return;
  if (host.querySelector(`link[${HERE_STYLE_LINK_ATTR}="true"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute(HERE_STYLE_LINK_ATTR, "true");
  host.append(link);
}

export async function loadHere() {
  if (window.H?.service?.Platform) return window.H;
  if (herePromise) return herePromise;
  const urls = hereUrls(mapContext());
  if (!urls) throw new Error("HERE 地图运行上下文不可用");
  herePromise = (async () => {
    loadCss(urls.css);
    await loadScript(urls.core, "data-vrp-scenario-here-core");
    await loadScript(urls.service, "data-vrp-scenario-here-service");
    await loadScript(urls.ui, "data-vrp-scenario-here-ui");
    await loadScript(urls.events, "data-vrp-scenario-here-events");
    return window.H;
  })();
  return herePromise;
}

function point(value) {
  const candidate = Array.isArray(value)
    ? { lng: Number(value[0]), lat: Number(value[1]) }
    : value && typeof value === "object"
      ? { lng: Number(value.lng ?? value.lon), lat: Number(value.lat) }
      : null;
  return Number.isFinite(candidate?.lng) && Number.isFinite(candidate?.lat) ? candidate : null;
}

function toHPoint(H, value) {
  const normalized = point(value);
  return normalized ? new H.geo.Point(normalized.lat, normalized.lng) : null;
}

function withOpacity(color, opacity) {
  const alpha = Number(opacity);
  if (!Number.isFinite(alpha) || alpha >= 1) return color;
  const boundedAlpha = Math.max(0, alpha);
  const match = /^#([0-9a-f]{6})$/i.exec(String(color || ""));
  if (!match) return color;
  const value = match[1];
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${boundedAlpha})`;
}

function pixelOffset(value) {
  return {
    x: Number.isFinite(Number(value?.x)) ? Number(value.x) : 0,
    y: Number.isFinite(Number(value?.y)) ? Number(value.y) : 0
  };
}

function labelDomMarker(H, position, label, labelAnchor = "") {
  if (!label?.content) return null;
  const { x, y } = pixelOffset(label.offset);
  const anchoredY = y + (labelAnchor === "pin-head" ? HERE_SMALL_MARKER_HEAD_OFFSET_Y : 0);
  const root = document.createElement("div");
  root.style.cssText = "position:relative;width:0;height:0;overflow:visible;pointer-events:auto;";
  const content = document.createElement("div");
  content.style.cssText = `position:absolute;left:${x}px;top:${anchoredY}px;transform:translate(-50%,-50%);white-space:nowrap;`;
  content.innerHTML = String(label.content);
  root.append(content);
  return new H.map.DomMarker(position, { icon: new H.map.DomIcon(root), volatility: true });
}

function contentDomMarker(H, position, content) {
  const root = document.createElement("div");
  root.style.cssText = "position:relative;overflow:visible;pointer-events:auto;";
  root.innerHTML = String(content || "");
  return new H.map.DomMarker(position, { icon: new H.map.DomIcon(root), volatility: true });
}

function circleMarkerIcon(H, options = {}) {
  const radius = Math.max(1.25, Number(options.radius || 5));
  const strokeWidth = Math.max(0, Number(options.strokeWeight || 1.25));
  const size = Math.ceil((radius + strokeWidth + 1.25) * 2);
  const center = size / 2;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<circle cx="${center}" cy="${center}" r="${radius}" stroke="${options.strokeColor || "#34d399"}" stroke-width="${strokeWidth}" fill="${options.fillColor || "#020617"}" fill-opacity="${Number.isFinite(Number(options.fillOpacity)) ? Number(options.fillOpacity) : 0.7}"/>`,
    "</svg>"
  ].join("");
  return new H.map.Icon(svg, { size: { w: size, h: size }, anchor: { x: center, y: center } });
}

class HereOverlay {
  constructor(object) {
    this.object = object;
    this.map = null;
    this.listeners = new Map();
  }
  setMap(map) {
    if (this.map && this.object) {
      this.map._map.removeObject(this.object);
      this.map._objects.delete(this);
    }
    this.map = map || null;
    if (this.map && this.object) {
      this.map._map.addObject(this.object);
      this.map._objects.add(this);
      this.map._attachDraggableOverlay?.(this);
    }
  }
  getMap() { return this.map; }
  fitPoints() { return []; }
  on(name, callback) {
    if (name === "dragend") {
      const callbacks = this.listeners.get(name) || [];
      callbacks.push(callback);
      this.listeners.set(name, callbacks);
      return;
    }
    this.object?.addEventListener?.(name, (event) => {
      return callback(event);
    });
  }
  emit(name, event) { (this.listeners.get(name) || []).forEach((callback) => callback(event)); }
}

class HereMarker extends HereOverlay {
  constructor(H, options = {}) {
    const position = toHPoint(H, options.position || [0, 0]);
    const contentMarker = Object.prototype.hasOwnProperty.call(options, "content")
      ? contentDomMarker(H, position, options.content)
      // HERE's default pin is visually much larger than the AMap marker used
      // by this page. Keep a compact 30 × 40 px pin under ticket badges.
      : new H.map.Marker(position, { volatility: true, icon: smallHereMarkerIcon(H) });
    const labelMarker = labelDomMarker(H, position, options.label, options.vrpLabelAnchor);
    const mapObjects = [contentMarker, labelMarker].filter(Boolean);
    const object = mapObjects.length === 1
      ? mapObjects[0]
      : (() => {
        const group = new H.map.Group();
        group.addObjects(mapObjects);
        return group;
      })();
    super(object);
    this._mapObjects = mapObjects;
    this._primaryMarker = contentMarker;
    this.object.draggable = Boolean(options.draggable);
    this.position = options.position || [0, 0];
  }
  setPosition(value) {
    const geometry = toHPoint(window.H, value);
    if (!geometry) return;
    this.position = value;
    this._mapObjects.forEach((object) => object.setGeometry?.(geometry));
  }
  fitPoints() { return [point(this.position)].filter(Boolean); }
  emitDragEnd() {
    const geo = this._primaryMarker?.getGeometry?.();
    if (geo) this.position = [geo.lng, geo.lat];
    this.emit("dragend", { lnglat: { getLng: () => geo?.lng, getLat: () => geo?.lat } });
  }
  on(name, callback) {
    if (name === "dragend") {
      return super.on(name, callback);
    }
    this._mapObjects.forEach((object) => object.addEventListener?.(name, callback));
  }
}

class HerePolyline extends HereOverlay {
  constructor(H, options = {}) {
    const line = new H.geo.LineString();
    const path = (options.path || []).map(point).filter(Boolean);
    path.forEach((normalized) => {
      if (normalized) line.pushPoint({ lat: normalized.lat, lng: normalized.lng });
    });
    const style = {
      strokeColor: withOpacity(options.strokeColor || "#34d399", options.strokeOpacity),
      lineWidth: options.strokeWeight || 5
    };
    // HERE validates a supplied lineDash value. Do not pass `undefined` for a
    // solid route: omit the property entirely and only set it for dashes.
    if (options.strokeStyle === "dashed") {
      style.lineDash = [10, 5];
    }
    // HERE's ARROW dash image changes the complete route into a short-dash
    // pattern, unlike AMap's subtle directional decoration. Keep the original
    // solid/dashed route semantics rather than changing its visual hierarchy.
    super(new H.map.Polyline(line, { style }));
    this.path = path;
  }
  fitPoints() { return this.path; }
}

class HereCircleMarker extends HereOverlay {
  constructor(H, options = {}) {
    const normalized = point(options.center || [0, 0]);
    // AMap.CircleMarker.radius is in screen pixels, while H.map.Circle uses
    // meters. Use an SVG marker so ticket dots keep their intended pixel size
    // at every HERE zoom level.
    super(new H.map.Marker(new H.geo.Point(normalized.lat, normalized.lng), {
      volatility: true,
      icon: circleMarkerIcon(H, options)
    }));
    this.center = normalized;
  }
  fitPoints() { return this.center ? [this.center] : []; }
}

class HereInfoWindow {
  constructor() { this.content = ""; this.bubble = null; }
  setContent(content) { this.content = content; }
  open(map, position) {
    const H = window.H;
    if (!map?._ui || !H) return;
    this.close();
    const normalized = point(position);
    this.bubble = new H.ui.InfoBubble({ lat: normalized.lat, lng: normalized.lng }, { content: this.content });
    map._ui.addBubble(this.bubble);
  }
  close() { this.bubble?.close?.(); this.bubble = null; }
}

class HereMap {
  constructor(H, container, options = {}) {
    const context = mapContext();
    const center = point(options.center || [116.397428, 39.90923]);
    const platform = new H.service.Platform({ apikey: context.browser_key });
    // Keep roads and administrative labels for route context, but suppress
    // HERE base-map POIs so they do not compete with ticket/engineer markers.
    const layers = platform.createDefaultLayers({ pois: false, lg: hereLanguage(context?.locale) });
    // scenario.html is mounted in a ShadowRoot. HERE's UI stylesheet loaded in
    // document.head does not cross that boundary, so install it in the owning
    // root as well before creating map UI objects.
    loadCss(hereUrls(context)?.css, container?.getRootNode?.());
    this._mapTheme = mapThemeFromStyle(options.mapStyle);
    this._container = container;
    if (container?.dataset) {
      container.dataset.vrpMapTheme = this._mapTheme;
    }
    // Scenario maps use HERE's supplied night layer by default; callers may
    // still request the light layer explicitly for compatibility.
    const baseLayer = baseLayerForTheme(layers, this._mapTheme);
    this._map = new H.Map(container, baseLayer, {
      center: { lat: center.lat, lng: center.lng },
      zoom: options.zoom || 11,
      pixelRatio: window.devicePixelRatio || 1,
      padding: HERE_VIEWPORT_PADDING
    });
    this._platform = platform;
    this._layers = layers;
    this._locale = hereLanguage(context?.locale);
    this._ui = H.ui.UI.createDefault(this._map, layers);
    // MapSettingsControl may initialize its own default layer while creating
    // controls. Apply the requested light or dark layer again after UI setup.
    this._map.setBaseLayer?.(baseLayer);
    // The AMap pages do not expose provider-native map chrome. Keep HERE's UI
    // only for InfoBubble support and hide its zoom, map-settings and scale
    // controls to avoid a second, visually inconsistent control set.
    ["zoom", "mapsettings", "scalebar"].forEach((name) => {
      this._ui.getControl?.(name)?.setVisibility?.(false);
    });
    this._behavior = new H.mapevents.Behavior(new H.mapevents.MapEvents(this._map));
    this._objects = new Set();
    this._draggedOverlay = null;
    this._map.addEventListener("pointermove", (event) => this._moveDraggedOverlay(event));
    this._map.addEventListener("pointerup", () => this._endDraggedOverlay());
    this._map.addEventListener("pointercancel", () => this._endDraggedOverlay());
  }
  add(overlays) { (Array.isArray(overlays) ? overlays : [overlays]).forEach((overlay) => { if (overlay?.object) { overlay.map = this; this._objects.add(overlay); this._map.addObject(overlay.object); this._attachDraggableOverlay(overlay); } }); }
  remove(overlays) { (Array.isArray(overlays) ? overlays : [overlays]).forEach((overlay) => { if (overlay?.object) { this._map.removeObject(overlay.object); overlay.map = null; this._objects.delete(overlay); } }); }
  clearMap() { this._map.removeObjects([...this._objects].map((item) => item.object)); this._objects.clear(); }
  on(name, callback) {
    // HERE Maps emits user clicks as `tap` once H.mapevents is enabled; it does not
    // emit the AMap-compatible `click` event used by the scenario picker.
    const hereEventName = name === "click" ? "tap" : name;
    this._map.addEventListener(hereEventName, (event) => {
      if (name !== "click") return callback(event);
      const pointer = event.currentPointer || {};
      const geo = this._map.screenToGeo(pointer.viewportX || 0, pointer.viewportY || 0);
      callback({ lnglat: { getLng: () => geo.lng, getLat: () => geo.lat } });
    });
  }
  resize() { this._map.getViewPort().resize(); }
  destroy() {
    this._endDraggedOverlay();
    this._behavior?.disable?.();
    this._ui?.dispose?.();
    this._map.dispose?.();
    this._objects.clear();
  }
  setCenter(value) { const normalized = point(value); this._map.setCenter({ lat: normalized.lat, lng: normalized.lng }); }
  setZoom(value) { this._map.setZoom(value); }
  getZoom() { return this._map.getZoom(); }
  setZoomAndCenter(zoom, center) { this.setZoom(zoom); this.setCenter(center); }
  setMapStyle(mapStyle) {
    const theme = mapThemeFromStyle(mapStyle);
    if (theme === this._mapTheme) return;
    this._mapTheme = theme;
    if (this._container?.dataset) {
      this._container.dataset.vrpMapTheme = theme;
    }
    this._map.setBaseLayer?.(baseLayerForTheme(this._layers, theme));
  }
  setMapLocale(locale) {
    const language = hereLanguage(locale);
    if (language === this._locale) return;
    const layers = this._platform.createDefaultLayers({ pois: false, lg: language });
    const baseLayer = baseLayerForTheme(layers, this._mapTheme);
    this._layers = layers;
    this._locale = language;
    // Replacing just the base layer requests labels in the new language while
    // preserving the existing map instance, view and Scenario overlays.
    this._map.setBaseLayer?.(baseLayer);
  }
  setFitView(overlays, _immediately, _avoid, maxZoom = HERE_FIT_VIEW_MAX_ZOOM) {
    const selected = overlays || [...this._objects];
    const fitPoints = selected.flatMap((overlay) => overlay?.fitPoints?.() || []);
    if (!fitPoints.length) return;

    // H.map.Marker / H.map.Polyline do not all implement getBoundingBox().
    // Build an unattached group of marker copies instead: H.map.Group is the
    // common HERE API that can reliably calculate a bounding box for any set
    // of route vertices and markers without changing the rendered overlays.
    const group = new window.H.map.Group();
    group.addObjects(fitPoints.map(({ lat, lng }) => new window.H.map.Marker({ lat, lng })));
    const bounds = group.getBoundingBox?.();
    if (!bounds) return;

    // HERE keeps its native fitted extent: it must not apply AMap's additional
    // 1.5-level zoom-in adjustment. Cap only the zoom that HERE calculates.
    // HERE finishes its bounds calculation asynchronously, so listen for the
    // end event and retain a two-frame fallback for SDK/browser versions that
    // omit it.
    const fitRequest = (this._fitRequest || 0) + 1;
    this._fitRequest = fitRequest;
    let adjusted = false;
    const applyZoomAdjustment = () => {
      if (adjusted || this._fitRequest !== fitRequest) return;
      adjusted = true;
      this._map.removeEventListener?.("mapviewchangeend", applyZoomAdjustment);
      const fittedZoom = Number(this._map.getZoom());
      const cappedMaxZoom = Number.isFinite(Number(maxZoom)) ? Number(maxZoom) : HERE_FIT_VIEW_MAX_ZOOM;
      if (Number.isFinite(fittedZoom)) {
        this._map.setZoom(Math.min(cappedMaxZoom, fittedZoom));
      }
    };
    this._map.addEventListener?.("mapviewchangeend", applyZoomAdjustment);
    this._map.getViewModel().setLookAtData({ bounds });
    window.requestAnimationFrame(() => window.requestAnimationFrame(applyZoomAdjustment));
  }
  _attachDraggableOverlay(overlay) {
    if (!overlay?.object?.draggable || overlay._vrpHereDragAttached) return;
    overlay._vrpHereDragAttached = true;
    overlay.object.addEventListener("pointerdown", (event) => {
      this._draggedOverlay = overlay;
      this._behavior?.disable?.();
      event.stopPropagation?.();
    });
  }
  _moveDraggedOverlay(event) {
    if (!this._draggedOverlay) return;
    const pointer = event.currentPointer || {};
    const geo = this._map.screenToGeo(pointer.viewportX || 0, pointer.viewportY || 0);
    this._draggedOverlay.setPosition?.([geo.lng, geo.lat]);
  }
  _endDraggedOverlay() {
    if (!this._draggedOverlay) return;
    const overlay = this._draggedOverlay;
    this._draggedOverlay = null;
    this._behavior?.enable?.();
    overlay.emitDragEnd?.();
  }
}

/** Installs the subset of AMap's API used by the existing pages on top of HERE Maps JS. */
export async function loadHereAsAmapCompatibility() {
  const H = await loadHere();
  if (window.AMap?._vrpHereCompatibility) return window.AMap;
  class MapCompat extends HereMap { constructor(container, options) { super(H, container, options); } }
  class MarkerCompat extends HereMarker { constructor(options) { super(H, options); } }
  class PolylineCompat extends HerePolyline { constructor(options) { super(H, options); } }
  class CircleCompat extends HereCircleMarker { constructor(options) { super(H, options); } }
  class PixelCompat {
    constructor(x = 0, y = 0) {
      this.x = Number.isFinite(Number(x)) ? Number(x) : 0;
      this.y = Number.isFinite(Number(y)) ? Number(y) : 0;
    }
  }
  window.AMap = { Map: MapCompat, Marker: MarkerCompat, Polyline: PolylineCompat, CircleMarker: CircleCompat, InfoWindow: HereInfoWindow, Pixel: PixelCompat, _vrpHereCompatibility: true };
  return window.AMap;
}
