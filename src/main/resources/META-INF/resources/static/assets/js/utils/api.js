const JSON_HEADERS = {
  "Content-Type": "application/json"
};
const ISO_DURATION_PATTERN = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload?.message || response.statusText;
    const error = new Error(message || "Request failed");
    error.status = response.status;
    error.payload = payload;
    error.errorCode = typeof payload === "object" && payload
      ? (payload.error_code || payload.errorCode || "")
      : "";
    error.errorParams = typeof payload === "object" && payload
      ? (payload.error_params || payload.errorParams || {})
      : {};
    throw error;
  }

  return payload;
}

export async function getJson(url) {
  return request(url);
}

export async function putJson(url, payload) {
  return request(url, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export async function postJson(url, payload) {
  return request(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: payload == null ? null : JSON.stringify(payload)
  });
}

export async function deleteRequest(url) {
  return request(url, {
    method: "DELETE"
  });
}

export function getUiLocale() {
  const bridge = typeof window === "undefined" ? null : window.VrpScenarioGateway;
  if (bridge?.context?.locale === "en-US" || bridge?.context?.locale === "zh-CN") {
    return bridge.context.locale;
  }
  const engineI18n = typeof window === "undefined" ? null : window.VrpEngineI18n;
  const engineLocale = engineI18n?.getLocale?.();
  if (engineLocale === "en-US" || engineLocale === "zh-CN") {
    return engineLocale;
  }
  return typeof document !== "undefined" && document.documentElement?.lang === "en-US" ? "en-US" : "zh-CN";
}

export function formatDateTime(value, locale = getUiLocale()) {
  if (!value) {
    return "--";
  }
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

export function formatDuration(value, locale = getUiLocale()) {
  if (!value) {
    return "--";
  }
  if (typeof value !== "number" && (typeof value !== "string" || !ISO_DURATION_PATTERN.test(value))) {
    return String(value);
  }
  const seconds = typeof value === "number" ? value : isoDurationToSeconds(value);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return String(value);
  }
  const units = locale === "en-US"
    ? [[86400, "day"], [3600, "h"], [60, "min"], [1, "s"]]
    : [[86400, "天"], [3600, "小时"], [60, "分钟"], [1, "秒"]];
  let remaining = Math.floor(seconds);
  const parts = [];
  units.forEach(([amount, label]) => {
    const count = Math.floor(remaining / amount);
    if (count || (amount === 1 && !parts.length)) {
      parts.push(locale === "en-US" ? `${count} ${label}` : `${count}${label}`);
      remaining -= count * amount;
    }
  });
  return parts.join(locale === "en-US" ? " " : "");
}

export function durationToIso(totalSeconds) {
  const seconds = Number(totalSeconds || 0);
  return `PT${Math.max(0, seconds)}S`;
}

export function isoDurationToSeconds(value) {
  if (!value || typeof value !== "string") {
    return 0;
  }
  const match = value.match(ISO_DURATION_PATTERN);
  if (!match) {
    return 0;
  }
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function notify(message, tone = "info") {
  window.dispatchEvent(
    new CustomEvent("vrp:notify", {
      detail: { message, tone }
    })
  );
}

/**
 * Scenario UI is also embedded by Gateway, so it cannot import Engine locales.
 * Its Host-provided bridge owns the active locale and maps typed API failures.
 */
export function localizeRequestError(error) {
  const bridge = typeof window === "undefined" ? null : window.VrpScenarioGateway;
  if (typeof bridge?.localizeError === "function") {
    return bridge.localizeError(error);
  }
  const engineI18n = typeof window === "undefined" ? null : window.VrpEngineI18n;
  if (typeof engineI18n?.localizeApiError === "function") {
    return engineI18n.localizeApiError(error);
  }
  return "Request failed";
}

/**
 * Render a semantic request/component key. Source-text inputs are accepted
 * only while legacy component templates are being migrated.
 */
export function translateRequestText(value, params = {}) {
  const key = String(value ?? "");
  const semanticKey = /^[a-z][a-z0-9]*(?:\.[a-zA-Z0-9]+)+$/.test(key);
  const bridge = typeof window === "undefined" ? null : window.VrpScenarioGateway;
  if (semanticKey && typeof bridge?.t === "function") {
    return bridge.t(key, params);
  }
  if (typeof bridge?.translateText === "function") {
    return bridge.translateText(value, params);
  }
  const engineI18n = typeof window === "undefined" ? null : window.VrpEngineI18n;
  if (semanticKey && typeof engineI18n?.t === "function") {
    return engineI18n.t(key, params);
  }
  if (typeof engineI18n?.translateText === "function") {
    return engineI18n.translateText(value, undefined, params);
  }
  return String(value ?? "");
}

export async function copyText(value) {
  const text = String(value ?? "");
  if (!text) {
    return false;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_error) {
      // Fall through to the legacy copy path below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } catch (_error) {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function navigate(destination, navigationDetail = null) {
  const scenarioComponentBridge = window.VrpScenarioGateway;
  if (scenarioComponentBridge?.isScenarioComponent && typeof scenarioComponentBridge.navigate === "function") {
    scenarioComponentBridge.navigate(destination, navigationDetail);
    return;
  }
  if (typeof destination !== "string") {
    return;
  }
  window.location.hash = destination.startsWith("#") ? destination : `#${destination}`;
}

export function currentHashRoute() {
  const normalized = String(window.location.hash || "#/scenario").replace(/^#/, "");
  const [route] = normalized.split("?");
  return route || "/scenario";
}

export function currentHashQuery() {
  const normalized = String(window.location.hash || "").replace(/^#/, "");
  const [, query = ""] = normalized.split("?", 2);
  return new URLSearchParams(query);
}

export function currentHashQueryParam(name) {
  return currentHashQuery().get(name) || "";
}

export function buildRoute(route, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") {
      return;
    }
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${route}?${query}` : route;
}
