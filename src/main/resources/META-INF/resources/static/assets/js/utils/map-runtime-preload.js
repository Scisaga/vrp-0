import { getJson } from "./api.js";

const AMAP_SCRIPT_SELECTOR = 'script[data-vrp-scenario-amap="true"]';
let mapContextPromise = null;
let amapSdkPromise = null;

function amapScriptUrl(mapContext) {
  if (!mapContext?.enabled || String(mapContext.provider || "").toLowerCase() !== "amap"
    || !mapContext.js_url || !mapContext.browser_key) {
    return "";
  }
  const separator = mapContext.js_url.includes("?") ? "&" : "?";
  return `${mapContext.js_url}${separator}key=${encodeURIComponent(mapContext.browser_key)}`;
}

function addConnectionHint(url, relation) {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }
  const origin = new URL(url, window.location.href).origin;
  const exists = [...document.head.querySelectorAll(`link[rel="${relation}"]`)]
    .some((link) => link.href === `${origin}/` || link.href === origin);
  if (exists) {
    return;
  }
  const link = document.createElement("link");
  link.rel = relation;
  link.href = origin;
  if (relation === "preconnect") {
    link.crossOrigin = "anonymous";
  }
  link.dataset.vrpMapRuntimeHint = "true";
  document.head.appendChild(link);
}

function warmAmap(mapContext) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(null);
  }
  if (window.AMap) {
    return Promise.resolve(window.AMap);
  }
  if (amapSdkPromise) {
    return amapSdkPromise;
  }
  const url = amapScriptUrl(mapContext);
  if (!url) {
    return Promise.resolve(null);
  }
  addConnectionHint(url, "dns-prefetch");
  addConnectionHint(url, "preconnect");

  amapSdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(AMAP_SCRIPT_SELECTOR);
    const script = existing || document.createElement("script");
    const loaded = () => {
      if (window.AMap) {
        resolve(window.AMap);
        return;
      }
      script.remove();
      reject(new Error("AMap JS SDK loaded without exposing window.AMap"));
    };
    const failed = () => {
      script.remove();
      reject(new Error("Failed to preload AMap JS SDK"));
    };
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    if (!existing) {
      script.src = url;
      script.async = true;
      script.fetchPriority = "high";
      script.dataset.vrpScenarioAmap = "true";
      document.head.appendChild(script);
    }
  }).catch((error) => {
    amapSdkPromise = null;
    throw error;
  });
  return amapSdkPromise;
}

export function getMapRuntimeContext() {
  if (!mapContextPromise) {
    mapContextPromise = getJson("/map_context").catch((error) => {
      mapContextPromise = null;
      throw error;
    });
  }
  return mapContextPromise;
}

export function invalidateMapRuntimeContext() {
  mapContextPromise = null;
}

export async function warmMapRuntime() {
  const mapContext = await getMapRuntimeContext();
  if (String(mapContext?.provider || "").toLowerCase() === "amap") {
    await warmAmap(mapContext);
  } else if (mapContext?.js_url) {
    addConnectionHint(mapContext.js_url, "dns-prefetch");
    addConnectionHint(mapContext.js_url, "preconnect");
  }
  return mapContext;
}
