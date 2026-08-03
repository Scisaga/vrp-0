// Provider-neutral page entry point. AMap remains the compatibility surface used by legacy pages.
export { loadAmap as loadMap, loadAmap, ensureMap, applyMapLocale, mapLocaleRequiresRecreation, buildDisplayRouteSegments, buildDisplayRoutePolylines, getAgentRouteNotice, renderAgentPreview, renderSimulation } from "./amap.js";
