import { buildAgentTimeline, nonVirtualAgents, parseApiDateTime, parseLocationString } from "./vrp-model.js";
import { loadHereAsAmapCompatibility } from "./here.js";

let amapPromise = null;
const FIT_VIEW_AVOID = [0, 0, 0, 0];
const FIT_VIEW_MAX_ZOOM = 18;
const FIT_VIEW_ZOOM_IN_DELTA = 1.5;
const LIGHT_MAP_STYLE = "amap://styles/normal";
const DARK_MAP_STYLE = "amap://styles/darkblue";
const DEFAULT_MAP_STYLE = DARK_MAP_STYLE;
const AMAP_STYLE_ATTR = "data-vrp-amap-shadow-style";
const AMAP_ENGLISH_DARK_FALLBACK_CLASS = "vrp-amap-en-dark-fallback";

function scenarioMapContext() {
  return window.VrpScenarioGateway?.context?.map_context || null;
}

/**
 * Map SDKs use provider-specific language identifiers.  Keep that conversion
 * at the SDK boundary: Scenario UI and Engine still exchange the public
 * zh-CN/en-US locale contract through context.map_context.locale.
 */
export function amapLanguage(locale) {
  return locale === "en-US" || locale === "en" ? "en" : "zh_cn";
}

function normalizedMapLocale(mapContext) {
  return mapContext?.locale === "en-US" || mapContext?.locale === "en"
    ? "en-US"
    : "zh-CN";
}

function mapStyleForTheme(theme) {
  return theme === "light" ? LIGHT_MAP_STYLE : DEFAULT_MAP_STYLE;
}

function mapThemeForStyle(mapStyle) {
  return mapStyle === DARK_MAP_STYLE ? "dark" : "light";
}

function applyAmapEnglishDarkFallback(map, mapContext) {
  const container = map?._vrpMapContainer;
  if (!container?.classList) {
    return;
  }
  // AMap JS API 1.4 serves English base tiles without honoring darkblue.
  // Only that compatibility path uses a base-layer filter; Chinese maps keep
  // the native darkblue theme shown by the provider.
  const enabled = mapContext?.provider === "amap"
    && normalizedMapLocale(mapContext) === "en-US"
    && map?._vrpMapTheme === "dark";
  container.classList.toggle(AMAP_ENGLISH_DARK_FALLBACK_CLASS, enabled);
}

/**
 * Update only the provider's base-map labels.  This deliberately does not
 * touch Scenario UI's locale or recreate the map, so an Engine locale switch
 * retains the current viewport, overlays and selected route.
 */
export function applyMapLocale(map, mapContext = scenarioMapContext()) {
  if (!map) {
    return false;
  }
  const locale = normalizedMapLocale(mapContext);
  applyAmapEnglishDarkFallback(map, mapContext);
  if (map._vrpMapLocale === locale) {
    return false;
  }

  if (typeof map.setMapLocale === "function") {
    map.setMapLocale(locale);
    map._vrpMapLocale = locale;
    return true;
  }
  if (typeof map.setLang === "function") {
    map.setLang(amapLanguage(locale));
    map._vrpMapLocale = locale;
    // AMap resets to its light default base layer while changing language.
    // Restore the selected map style afterwards (and once again after the
    // current SDK turn) so the language update never changes the active theme.
    const mapStyle = map._vrpAppliedMapStyle;
    if (mapStyle && typeof map.setMapStyle === "function") {
      map.setMapStyle(mapStyle);
      Promise.resolve().then(() => {
        if (map._vrpMapLocale === locale) {
          map.setMapStyle(mapStyle);
        }
      });
    }
    return true;
  }
  return false;
}

/**
 * Legacy AMap 1.4 reloads its base tiles for setLang(). That reload can drop
 * mapStyle, so callers recreate only the provider map with both options at
 * construction time and immediately redraw the same business overlays.
 */
export function mapLocaleRequiresRecreation(map, mapContext = scenarioMapContext()) {
  const nextLocale = normalizedMapLocale(mapContext);
  return Boolean(
    map
    && mapContext?.provider === "amap"
    && map._vrpMapLocale
    && map._vrpMapLocale !== nextLocale
  );
}

function mapScriptUrl(mapContext) {
  if (!mapContext?.enabled || mapContext.provider !== "amap" || !mapContext.js_url || !mapContext.browser_key) {
    return "";
  }
  const separator = mapContext.js_url.includes("?") ? "&" : "?";
  return `${mapContext.js_url}${separator}key=${encodeURIComponent(mapContext.browser_key)}`;
}

function isAmapStyle(style) {
  const text = style?.textContent || "";
  return text.includes(".amap-") || text.includes("#amap");
}

function mirrorAmapStyles(root) {
  if (!root || root === document || typeof root.querySelector !== "function") {
    return;
  }
  const styles = [...document.head.querySelectorAll("style")].filter(isAmapStyle);
  styles.forEach((source, index) => {
    const key = source.dataset.vrpAmapStyleKey || `amap-${index}`;
    source.dataset.vrpAmapStyleKey = key;
    if (root.querySelector(`style[${AMAP_STYLE_ATTR}="${key}"]`)) {
      return;
    }
    const target = document.createElement("style");
    target.setAttribute(AMAP_STYLE_ATTR, key);
    target.textContent = source.textContent;
    root.append(target);
  });
}

export async function loadAmap() {
  if (scenarioMapContext()?.provider === "here") {
    return loadHereAsAmapCompatibility();
  }
  if (window.AMap) {
    return window.AMap;
  }
  if (amapPromise) {
    return amapPromise;
  }

  amapPromise = (async () => {
    const componentUrl = mapScriptUrl(scenarioMapContext());
    if (!componentUrl) {
      throw new Error("地图运行上下文不可用");
    }
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-vrp-scenario-amap="true"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window.AMap), { once: true });
        existing.addEventListener("error", () => reject(new Error("Failed to load AMap JS SDK")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = componentUrl;
      script.async = true;
      script.dataset.vrpScenarioAmap = "true";
      script.onload = () => resolve(window.AMap);
      script.onerror = () => reject(new Error("Failed to load AMap JS SDK"));
      document.head.appendChild(script);
    });
  })();

  return amapPromise;
}

export async function ensureMap(container, options = {}) {
  const AMap = await loadAmap();
  const root = container?.getRootNode?.();
  const mapContext = scenarioMapContext();
  mirrorAmapStyles(root);
  const mapStyle = options.mapStyle || mapStyleForTheme(options.mapTheme);
  const mapTheme = mapThemeForStyle(mapStyle);
  if (!container._vrpMap) {
    container._vrpMap = new AMap.Map(container, {
      resizeEnable: true,
      zoom: options.zoom || 11,
      center: options.center || [116.397428, 39.90923],
      mapStyle,
      lang: amapLanguage(mapContext?.locale)
    });
    // lang is already applied at construction time.  Calling setLang again
    // immediately makes AMap reload the base tiles and drops mapStyle.
    container._vrpMap._vrpMapLocale = normalizedMapLocale(mapContext);
    container._vrpMap._vrpAppliedMapStyle = mapStyle;
  } else {
    applyMapStyle(container._vrpMap, mapStyle);
  }
  container._vrpMap._vrpMapTheme = mapTheme;
  container._vrpMap._vrpMapContainer = container;
  if (container.dataset) {
    container.dataset.vrpMapTheme = mapTheme;
  }
  applyAmapEnglishDarkFallback(container._vrpMap, mapContext);
  applyMapLocale(container._vrpMap, mapContext);
  // AMap may append its internal positioning rules while creating the map.
  // Mirror once more so marker panes in a Scenario UI Shadow Root receive them.
  mirrorAmapStyles(root);
  return container._vrpMap;
}

function applyMapStyle(map, mapStyle = DEFAULT_MAP_STYLE) {
  if (!map || typeof map.setMapStyle !== "function") {
    return false;
  }
  if (map._vrpAppliedMapStyle === mapStyle) {
    return false;
  }
  map._vrpAppliedMapStyle = mapStyle;
  map.setMapStyle(mapStyle);
  return true;
}

function ensureTicketInfoWindow(map) {
  if (!map) {
    return null;
  }
  const AMap = window.AMap;
  if (!map._vrpTicketInfoWindow) {
    map._vrpTicketInfoWindow = new AMap.InfoWindow({
      offset: new AMap.Pixel(0, -22.5),
      isCustom: false,
      autoMove: true
    });
  }
  return map._vrpTicketInfoWindow;
}

function openTicketInfoWindow(map, position, ticketId) {
  if (!map || !position || !ticketId) {
    return;
  }
  const infoWindow = ensureTicketInfoWindow(map);
  if (!infoWindow) {
    return;
  }
  infoWindow.setContent(
    `<div style="padding:5px 10px;color:#0f172a;font-size:15px;font-weight:600;white-space:nowrap;">${ticketId}</div>`
  );
  infoWindow.open(map, position);
}

function normalizeCoordinatePoint(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isNaN(lng) && !Number.isNaN(lat)) {
      return [lng, lat];
    }
    return null;
  }
  if (point && typeof point === "object") {
    const lng = Number(point.lon ?? point.lng ?? point.longitude);
    const lat = Number(point.lat ?? point.latitude);
    if (!Number.isNaN(lng) && !Number.isNaN(lat)) {
      return [lng, lat];
    }
  }
  return null;
}

function buildPath(agent) {
  const points = [];
  const start = parseLocationString(agent?.start_loc?.location);
  if (start) {
    points.push(start);
  }
  (agent?.tickets || []).forEach((ticket) => {
    const point = parseLocationString(ticket?.loc?.location);
    if (point) {
      points.push(point);
    }
  });
  if (start) {
    points.push(start);
  }
  return points;
}

function buildRouteStops(agent) {
  return buildPath(agent);
}

function normalizedRouteSource(route) {
  return String(route?.route_source ?? route?.routeSource ?? "").trim().toUpperCase();
}

function normalizeRouteEndpoint(point) {
  if (point && typeof point === "object" && !Array.isArray(point)
    && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lon))) {
    // Route.LOC serializes the AMap longitude in `lat` and latitude in `lon`.
    return [Number(point.lat), Number(point.lon)];
  }
  return normalizeCoordinatePoint(point);
}

export function buildDisplayRouteSegments(agent) {
  const routes = Array.isArray(agent?.routes) ? agent.routes : [];
  const routeStops = buildRouteStops(agent);
  const hasMatchingStops = routeStops.length === routes.length + 1;
  const segments = routes.map((route, index) => {
    const rawPath = Array.isArray(route?.polyline)
      ? route.polyline.map(normalizeCoordinatePoint).filter(Boolean)
      : [];
    const source = normalizedRouteSource(route);
    const isRoadRoute = rawPath.length >= 2;
    const origin = normalizeRouteEndpoint(route?.origin) || (hasMatchingStops ? routeStops[index] : null);
    const destination = normalizeRouteEndpoint(route?.destination) || (hasMatchingStops ? routeStops[index + 1] : null);
    const path = isRoadRoute
      ? normalizeTravelPath(origin, destination, rawPath)
      : normalizeTravelPath(origin, destination, []);

    if (path.length < 2) {
      return null;
    }
    return {
      path,
      source,
      estimated: !isRoadRoute,
      legacy: !source
    };
  }).filter(Boolean);

  if (segments.length) {
    return segments;
  }

  const fallbackPath = buildPath(agent);
  return fallbackPath.length >= 2
    ? [{ path: fallbackPath, source: "", estimated: true, legacy: true }]
    : [];
}

export function buildDisplayRoutePolylines(agent) {
  return buildDisplayRouteSegments(agent).map((segment) => segment.path);
}

export function getAgentRouteNotice(agent) {
  const routes = Array.isArray(agent?.routes) ? agent.routes : [];
  if (!routes.length) {
    return null;
  }
  const sources = routes.map(normalizedRouteSource);

  if (sources.includes("ESTIMATED")) {
    return {
      kind: "estimated",
      key: "map.routeNotice.estimated"
    };
  }
  if (sources.includes("CAR_FALLBACK")) {
    return {
      kind: "car-fallback",
      key: "map.routeNotice.carFallback"
    };
  }
  if (routes.some((route) => !normalizedRouteSource(route)
    && (!Array.isArray(route?.polyline) || route.polyline.length < 2))) {
    return {
      kind: "legacy",
      key: "map.routeNotice.legacy"
    };
  }
  return null;
}

function escapeMapLabelText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildMapPillLabel(text, color, textColor = color, fullText = "") {
  const displayText = String(text ?? "");
  const tooltipText = String(fullText ?? "");
  const tooltipAttributes = tooltipText && tooltipText !== displayText
    ? ` class="ui-tooltip" data-tooltip="${escapeMapLabelText(tooltipText)}"`
    : "";
  return `<div${tooltipAttributes} style="padding:2.5px 7.5px;border-radius:1248.75px;background:#020617;border:1.25px solid ${color};color:${textColor};font-size:13.75px;white-space:nowrap;">${escapeMapLabelText(displayText)}</div>`;
}

function compactMapLabel(value, maxLength = 14) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  const head = Math.max(6, maxLength - 5);
  return `${text.slice(0, head)}…${text.slice(-4)}`;
}

function normalizeFitViewResult(result) {
  if (Array.isArray(result)) {
    return {
      zoom: Number(result[0]),
      center: result[1]
    };
  }
  if (result && typeof result === "object") {
    return {
      zoom: Number(result.zoom ?? result[0]),
      center: result.center ?? result.target ?? result[1]
    };
  }
  return { zoom: NaN, center: null };
}

function applyFitView(map, overlays) {
  if (!map || !Array.isArray(overlays) || !overlays.length) {
    return;
  }
  try {
    if (typeof map.getFitZoomAndCenterByOverlays === "function" && typeof map.setZoomAndCenter === "function") {
      const fitResult = map.getFitZoomAndCenterByOverlays(overlays, FIT_VIEW_AVOID, FIT_VIEW_MAX_ZOOM);
      const { zoom, center } = normalizeFitViewResult(fitResult);
      if (Number.isFinite(zoom) && center) {
        map.setZoomAndCenter(
          Math.min(FIT_VIEW_MAX_ZOOM, zoom + FIT_VIEW_ZOOM_IN_DELTA),
          center,
          true
        );
        return;
      }
    }
  } catch (_error) {
    // Fallback to SDK fitView when JSAPI variants differ across versions.
  }
  map.setFitView(overlays, true, FIT_VIEW_AVOID, FIT_VIEW_MAX_ZOOM);
}

function removeMapOverlays(map, overlays) {
  if (!map || !Array.isArray(overlays) || !overlays.length) {
    return;
  }
  if (typeof map.remove === "function") {
    try {
      map.remove(overlays);
      return;
    } catch (_error) {
      // Fall through to per-overlay cleanup when SDK remove signatures differ.
    }
  }
  overlays.forEach((overlay) => {
    overlay?.setMap?.(null);
  });
}

function ensureSimulationState(map) {
  if (!map._vrpSimulationState) {
    map._vrpSimulationState = {
      signature: "",
      staticOverlays: [],
      focusedStaticOverlays: [],
      dynamicMarkersByAgentId: {},
      focusedDynamicOverlays: []
    };
  }
  return map._vrpSimulationState;
}

function resetSimulationState(map) {
  const state = ensureSimulationState(map);
  removeMapOverlays(map, [
    ...state.staticOverlays,
    ...Object.values(state.dynamicMarkersByAgentId)
  ]);
  state.signature = "";
  state.staticOverlays = [];
  state.focusedStaticOverlays = [];
  state.dynamicMarkersByAgentId = {};
  state.focusedDynamicOverlays = [];
  return state;
}

function buildSimulationSignature(job, agents, visibilityMap, routeVisibilityMap, focusedAgentId) {
  return JSON.stringify({
    jobId: job?.id || "",
    focusedAgentId: focusedAgentId || "",
    agents: agents.map((agent) => ({
      id: agent.id,
      visible: visibilityMap[agent.id] !== false,
      routeVisible: routeVisibilityMap?.[agent.id] !== false
    }))
  });
}

/**
 * Merge preview stops that resolve to the same geographic coordinate. A
 * delivery and its dependent service job often share an address; drawing one
 * marker per ticket would let the later sequence badge hide the earlier one.
 */
export function buildAgentPreviewMarkerGroups(agent, hoveredTicketId = "") {
  const groupsByPosition = new Map();
  const groups = [];

  (agent?.tickets || []).forEach((ticket, index) => {
    const position = parseLocationString(ticket?.loc?.location);
    if (!position) {
      return;
    }
    const key = `${position[0]},${position[1]}`;
    let group = groupsByPosition.get(key);
    if (!group) {
      group = { position, stops: [], hovered: false };
      groupsByPosition.set(key, group);
      groups.push(group);
    }
    group.stops.push({ ticket, sequence: index + 1 });
    group.hovered ||= hoveredTicketId === ticket.id;
  });

  return groups.map((group) => ({
    ...group,
    label: group.stops.map((stop) => stop.sequence).join("/"),
    ticketIds: group.stops.map((stop) => stop.ticket.id).filter(Boolean)
  }));
}

export function renderAgentPreview(map, agent, hoveredTicketId = "") {
  if (!map) {
    return;
  }
  const infoWindow = ensureTicketInfoWindow(map);
  infoWindow?.close();
  map.clearMap();
  delete map._vrpSimulationState;
  if (!agent) {
    return;
  }

  const AMap = window.AMap;
  const routeSegments = buildDisplayRouteSegments(agent);
  const routeOverlays = [];
  routeSegments.forEach((segment) => {
    const polyline = new AMap.Polyline({
      path: segment.path,
      strokeColor: "#34d399",
      strokeWeight: 6.25,
      strokeOpacity: 0.82,
      strokeStyle: segment.estimated ? "dashed" : "solid",
      showDir: !segment.estimated,
      dirColor: "#f8fafc"
    });
    map.add(polyline);
    routeOverlays.push(polyline);
  });

  const markers = [];
  const start = parseLocationString(agent?.start_loc?.location);
  if (start) {
    markers.push(new AMap.Marker({
      position: start
    }));
  }

  buildAgentPreviewMarkerGroups(agent, hoveredTicketId).forEach((group) => {
    const { position } = group;
    const activeColor = group.hovered ? "#f59e0b" : "#0f172a";
    const borderColor = group.hovered ? "#fbbf24" : "#34d399";
    const marker = new AMap.Marker({
      position,
      // HereMarker reads this compatibility hint to place the sequence badge
      // over the pin's circular head. AMap ignores the extra option.
      vrpLabelAnchor: "pin-head",
      label: {
        offset: new AMap.Pixel(0, 0),
        content: `<div style="box-sizing:border-box;min-width:25px;height:25px;padding:0 5px;display:flex;align-items:center;justify-content:center;border-radius:12.5px;background:${activeColor};border:1.25px solid ${borderColor};color:#fff;font-size:13.75px;font-weight:600;line-height:1;white-space:nowrap;">${group.label}</div>`
      }
    });
    marker.on("click", () => openTicketInfoWindow(map, position, group.ticketIds.join(" / ")));
    markers.push(marker);
  });

  if (markers.length) {
    map.add(markers);
  }
  const fitOverlays = [...routeOverlays, ...markers];
  if (fitOverlays.length) {
    applyFitView(map, fitOverlays);
  }
}

function interpolatePoint(startPoint, endPoint, ratio) {
  const lng = startPoint[0] + ((endPoint[0] - startPoint[0]) * ratio);
  const lat = startPoint[1] + ((endPoint[1] - startPoint[1]) * ratio);
  return [lng, lat];
}

function pointDistance(startPoint, endPoint) {
  return Math.hypot(endPoint[0] - startPoint[0], endPoint[1] - startPoint[1]);
}

function dedupeSequentialPoints(path) {
  return path.filter((point, index) => {
    if (index === 0) {
      return true;
    }
    return pointDistance(path[index - 1], point) > 1e-9;
  });
}

function normalizeTravelPath(startPoint, endPoint, path) {
  const normalizedPath = Array.isArray(path) ? path.map(normalizeCoordinatePoint).filter(Boolean) : [];
  if (!startPoint || !endPoint) {
    return dedupeSequentialPoints(normalizedPath);
  }
  if (!normalizedPath.length) {
    return [startPoint, endPoint];
  }

  const travelPath = [...normalizedPath];
  if (pointDistance(travelPath[0], startPoint) > 1e-9) {
    travelPath.unshift(startPoint);
  }
  if (pointDistance(travelPath[travelPath.length - 1], endPoint) > 1e-9) {
    travelPath.push(endPoint);
  }
  return dedupeSequentialPoints(travelPath);
}

function buildTravelPaths(agent, timeline) {
  const routeSegments = buildDisplayRouteSegments(agent);
  return timeline.slice(0, -1).map((currentStop, index) => {
    const nextStop = timeline[index + 1];
    return normalizeTravelPath(currentStop?.position, nextStop?.position, routeSegments[index]?.path);
  });
}

function interpolateAlongPath(path, ratio) {
  if (!Array.isArray(path) || !path.length) {
    return null;
  }
  if (path.length === 1) {
    return path[0];
  }

  const boundedRatio = Math.max(0, Math.min(1, ratio));
  const segmentLengths = [];
  let totalLength = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segmentLength = pointDistance(path[index], path[index + 1]);
    segmentLengths.push(segmentLength);
    totalLength += segmentLength;
  }
  if (totalLength <= 0) {
    return path[path.length - 1];
  }

  const targetLength = totalLength * boundedRatio;
  let traversedLength = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (segmentLength <= 0) {
      continue;
    }
    if (traversedLength + segmentLength >= targetLength) {
      const segmentRatio = (targetLength - traversedLength) / segmentLength;
      return interpolatePoint(path[index], path[index + 1], segmentRatio);
    }
    traversedLength += segmentLength;
  }

  return path[path.length - 1];
}

function positionForAgentAtTime(agent, simulationTime) {
  const timeline = buildAgentTimeline(agent);
  if (!timeline.length) {
    return parseLocationString(agent?.start_loc?.location);
  }
  const travelPaths = buildTravelPaths(agent, timeline);

  const currentTime = parseApiDateTime(simulationTime);
  if (!currentTime) {
    return timeline[0].position;
  }

  for (let index = 0; index < timeline.length - 1; index += 1) {
    const current = timeline[index];
    const next = timeline[index + 1];
    const currentArrival = parseApiDateTime(current.time);
    const currentDeparture = parseApiDateTime(current.departure_time || current.time);
    const nextArrival = parseApiDateTime(next.time);
    if (!currentArrival || !nextArrival) {
      continue;
    }
    if (currentTime >= currentArrival && currentTime <= currentDeparture) {
      return current.position;
    }
    if (currentTime > currentDeparture && currentTime < nextArrival) {
      const progress = (currentTime.getTime() - currentDeparture.getTime()) / Math.max(1, nextArrival.getTime() - currentDeparture.getTime());
      return interpolateAlongPath(travelPaths[index], progress) || interpolatePoint(current.position, next.position, progress);
    }
  }

  return timeline[timeline.length - 1].position;
}

export async function renderSimulation(mapContainer, job, visibilityMap, routeVisibilityMap, simulationTime, options = {}) {
  const map = await ensureMap(mapContainer, { zoom: 10, mapTheme: options.mapTheme });
  const infoWindow = ensureTicketInfoWindow(map);
  infoWindow?.close();
  const AMap = window.AMap;
  const agents = nonVirtualAgents(job);
  const palette = ["#34d399", "#60a5fa", "#f59e0b", "#f472b6", "#a78bfa", "#f87171"];
  const focusedAgentId = options.focusedAgentId || "";
  // Show direction only when exactly one route is visible: a single-engineer
  // result or the "只看当前" view. Showing arrows for every engineer would make
  // the overview map substantially harder to read.
  const singleVisibleRoute = agents.filter((agent) => (
    visibilityMap[agent.id] !== false
    && routeVisibilityMap?.[agent.id] !== false
    && buildDisplayRouteSegments(agent).length > 0
  )).length === 1;
  const simulationState = ensureSimulationState(map);
  if (options.refreshOverlays) {
    resetSimulationState(map);
  }
  const sceneSignature = buildSimulationSignature(job, agents, visibilityMap, routeVisibilityMap, focusedAgentId);
  if (simulationState.signature !== sceneSignature) {
    resetSimulationState(map);
    simulationState.signature = sceneSignature;
    const staticOverlays = [];
    const focusedStaticOverlays = [];

    agents.forEach((agent, index) => {
      if (visibilityMap[agent.id] === false) {
        return;
      }
      const focused = focusedAgentId === agent.id;
      const color = palette[index % palette.length];
      const strokeColor = color;
      const showRouteDirection = focused || singleVisibleRoute;
      const strokeWeight = showRouteDirection ? 7.5 : (focused ? 6.25 : 3.75);
      const strokeOpacity = focused ? 0.8 : 0.45;
      const markerRadius = focused ? 7.5 : 5;
      const markerFill = "#020617";
      const routeSegments = buildDisplayRouteSegments(agent);
      if (routeVisibilityMap?.[agent.id] !== false) {
        routeSegments.forEach((segment) => {
          const polyline = new AMap.Polyline({
            path: segment.path,
            strokeColor,
            strokeWeight,
            strokeOpacity,
            strokeStyle: segment.estimated ? "dashed" : "solid",
            showDir: showRouteDirection && !segment.estimated,
            dirColor: "#f8fafc"
          });
          staticOverlays.push(polyline);
          if (focused) {
            focusedStaticOverlays.push(polyline);
          }
        });
      }

      (agent?.tickets || []).forEach((ticket) => {
        const position = parseLocationString(ticket?.loc?.location);
        if (!position) {
          return;
        }
        const marker = new AMap.CircleMarker({
          center: position,
          radius: markerRadius,
          strokeColor: color,
          strokeWeight: focused ? 2.5 : 1.25,
          fillColor: markerFill,
          fillOpacity: focused ? 0.9 : 0.78
        });
        marker.on("click", () => openTicketInfoWindow(map, position, ticket.id));
        staticOverlays.push(marker);
        if (focused) {
          focusedStaticOverlays.push(marker);
        }

        if (ticket.id && focusedAgentId && focused) {
          const ticketLabelMarker = new AMap.Marker({
            position,
            content: "<div style='width:0;height:0;'></div>",
            label: {
              offset: new AMap.Pixel(0, 0),
              content: buildMapPillLabel(ticket.id, color, "#e2e8f0")
            }
          });
          ticketLabelMarker.on("click", () => openTicketInfoWindow(map, position, ticket.id));
          staticOverlays.push(ticketLabelMarker);
          if (focused) {
            focusedStaticOverlays.push(ticketLabelMarker);
          }
        }
      });
    });

    if (staticOverlays.length) {
      map.add(staticOverlays);
    }
    simulationState.staticOverlays = staticOverlays;
    simulationState.focusedStaticOverlays = focusedStaticOverlays;
  }

  const nextVisibleAgentIds = new Set();
  simulationState.focusedDynamicOverlays = [];
  let focusedCurrentPosition = null;

  agents.forEach((agent, index) => {
    if (visibilityMap[agent.id] === false) {
      return;
    }
    nextVisibleAgentIds.add(agent.id);
    const focused = focusedAgentId === agent.id;
    const color = palette[index % palette.length];

    const currentPosition = positionForAgentAtTime(agent, simulationTime);
    if (currentPosition) {
      let currentMarker = simulationState.dynamicMarkersByAgentId[agent.id] || null;
      if (!currentMarker || currentMarker._vrpFocused !== focused) {
        removeMapOverlays(map, currentMarker ? [currentMarker] : []);
        const fullAgentLabel = agent.name || agent.id;
        const compactAgentLabel = compactMapLabel(fullAgentLabel);
        currentMarker = new AMap.Marker({
          position: currentPosition,
          label: {
            offset: new AMap.Pixel(0, focused ? -10 : -5),
            content: buildMapPillLabel(compactAgentLabel, color, focused ? color : "#e2e8f0", fullAgentLabel)
          }
        });
        currentMarker._vrpFocused = focused;
        simulationState.dynamicMarkersByAgentId[agent.id] = currentMarker;
        map.add(currentMarker);
      } else if (typeof currentMarker.setPosition === "function") {
        currentMarker.setPosition(currentPosition);
      }
      if (focused) {
        focusedCurrentPosition = currentPosition;
        simulationState.focusedDynamicOverlays.push(currentMarker);
      }
    } else if (simulationState.dynamicMarkersByAgentId[agent.id]) {
      removeMapOverlays(map, [simulationState.dynamicMarkersByAgentId[agent.id]]);
      delete simulationState.dynamicMarkersByAgentId[agent.id];
    }
  });

  Object.keys(simulationState.dynamicMarkersByAgentId).forEach((agentId) => {
    if (nextVisibleAgentIds.has(agentId)) {
      return;
    }
    removeMapOverlays(map, [simulationState.dynamicMarkersByAgentId[agentId]]);
    delete simulationState.dynamicMarkersByAgentId[agentId];
  });

  const dynamicOverlays = Object.values(simulationState.dynamicMarkersByAgentId);
  const overlays = [...simulationState.staticOverlays, ...dynamicOverlays];
  const focusedOverlays = [...simulationState.focusedStaticOverlays, ...simulationState.focusedDynamicOverlays];
  if (overlays.length) {
    if (options.followFocusedAgent && focusedCurrentPosition) {
      const nextZoom = Math.max(12, Number(map.getZoom?.() || 12));
      if (typeof map.setZoomAndCenter === "function") {
        map.setZoomAndCenter(nextZoom, focusedCurrentPosition, true);
      } else if (typeof map.setCenter === "function") {
        map.setCenter(focusedCurrentPosition);
      }
    } else if (options.fitMode === "focused" && focusedOverlays.length) {
      applyFitView(map, focusedOverlays);
    } else if (options.fitMode === "visible") {
      applyFitView(map, overlays);
    }
  }
  return map;
}
