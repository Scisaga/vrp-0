import { buildRoute, currentHashRoute, formatDuration, getJson, navigate, notify } from "../utils/api.js";
import { getEngineLocale, localizeApiError, t } from "../i18n/engine-i18n.js";

const RUNNING_STATUSES = new Set(["SOLVING_SCHEDULED", "SOLVING_ACTIVE"]);
const POLL_INTERVAL_MS = 5000;
const DEFAULT_QUERY_RANGE_DAYS = 7;

export function buildSolverJobListUrl(filters = {}) {
  const search = new URLSearchParams();
  [
    ["status", filters.status],
    ["create_time_from", filters.createTimeFrom],
    ["create_time_to", filters.createTimeTo],
    ["build_transit_matrix", filters.buildTransitMatrix],
    ["matrix_mode", filters.matrixMode],
    ["draw_route", filters.drawRoute]
  ].forEach(([key, value]) => {
    if (value != null && value !== "") {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return `/solver_job/list${query ? `?${query}` : ""}`;
}

function formatLocalDateTime(value) {
  const padded = (part) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${padded(value.getMonth() + 1)}-${padded(value.getDate())}`
    + `T${padded(value.getHours())}:${padded(value.getMinutes())}:${padded(value.getSeconds())}`;
}

export function createDefaultFilters(now = new Date()) {
  const createTimeTo = new Date(now);
  const createTimeFrom = new Date(now);
  createTimeFrom.setDate(createTimeFrom.getDate() - DEFAULT_QUERY_RANGE_DAYS);
  return {
    status: "",
    createTimeFrom: formatLocalDateTime(createTimeFrom),
    createTimeTo: formatLocalDateTime(createTimeTo),
    buildTransitMatrix: "",
    matrixMode: "",
    drawRoute: ""
  };
}

function statusInfo(status = "", locale = getEngineLocale()) {
  switch (status) {
    case "SOLVING_SCHEDULED":
      return { text: t("status.starting", {}, locale), className: "border-amber-500/30 bg-amber-500/10 text-amber-700" };
    case "SOLVING_ACTIVE":
      return { text: t("status.solving", {}, locale), className: "border-sky-500/30 bg-sky-500/10 text-sky-700" };
    case "SOLVING_FINISHED":
      return { text: t("status.completed", {}, locale), className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" };
    case "ERROR":
      return { text: t("status.failed", {}, locale), className: "border-rose-500/30 bg-rose-500/10 text-rose-700" };
    case "NOT_SOLVING":
      return { text: t("status.notStarted", {}, locale), className: "border-slate-300 bg-slate-100/80 text-slate-700" };
    default:
      // Preserve an enum value the UI does not yet know, so diagnostics and
      // forward-compatible API values are not hidden behind a guessed label.
      return { text: status || t("status.unknown", {}, locale), className: "border-slate-300 bg-slate-100/80 text-slate-700" };
  }
}

function displayBoolean(value, locale = getEngineLocale()) {
  if (value == null) {
    return "--";
  }
  return value ? t("boolean.yes", {}, locale) : t("boolean.no", {}, locale);
}

function displayMatrixMode(value) {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "AMAP" || normalized === "ROUTING") return "routing";
  if (normalized === "MANHATTAN") return "manhattan";
  return normalized || "--";
}

function splitDateTime(value) {
  const raw = String(value || "").replace("T", " ").trim();
  if (!raw) return { date: "--", time: "--" };
  const [date = "--", time = "--"] = raw.split(" ", 2);
  return { date, time };
}

function displayDateTime(value) {
  const { date, time } = splitDateTime(value);
  return date === "--" ? "--" : `${date} ${time}`;
}

function displayScore(value) {
  return String(value || "").trim() || "--";
}

function scoreSegments(value) {
  const match = String(value || "").trim().match(/(-?\d+)\s*hard\s*\/\s*(-?\d+)\s*medium\s*\/\s*(-?\d+)\s*soft/i);
  if (!match) return [];
  const [, hard, medium, soft] = match;
  return [
    { key: "hard", text: `${hard}hard`, colorClass: "result-summary-score-hard", separator: false },
    { key: "medium", text: `${medium}medium`, colorClass: "result-summary-score-medium", separator: true },
    { key: "soft", text: `${soft}soft`, colorClass: "result-summary-score-soft", separator: true }
  ];
}

function displaySolveFinishTime(job) {
  return job?.status === "SOLVING_FINISHED" ? displayDateTime(job.update_time) : "--";
}

export function solverJobListPage() {
  return {
    filters: createDefaultFilters(),
    jobs: [],
    loading: false,
    initialLoading: true,
    error: "",
    locale: getEngineLocale(),
    localeChangeHandler: null,
    pollTimer: null,
    async init() {
      this.localeChangeHandler = (event) => {
        this.locale = event.detail?.locale || getEngineLocale();
      };
      window.addEventListener?.("vrp:locale-changed", this.localeChangeHandler);
      await this.loadJobs();
    },
    destroy() {
      this.stopPolling();
      if (this.localeChangeHandler) {
        window.removeEventListener?.("vrp:locale-changed", this.localeChangeHandler);
        this.localeChangeHandler = null;
      }
    },
    t(key, params = {}) {
      return t(key, params, this.locale);
    },
    hasRunningJobs() {
      return this.jobs.some((job) => RUNNING_STATUSES.has(job?.status));
    },
    syncPolling() {
      if (this.hasRunningJobs() && !this.pollTimer) {
        this.pollTimer = window.setInterval(() => {
          if (currentHashRoute() !== "/solver-jobs") {
            this.stopPolling();
            return;
          }
          this.loadJobs({ silent: true });
        }, POLL_INTERVAL_MS);
      }
      if (!this.hasRunningJobs()) {
        this.stopPolling();
      }
    },
    stopPolling() {
      if (this.pollTimer) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    },
    async loadJobs(options = {}) {
      const silent = Boolean(options.silent);
      if (this.loading) return;
      this.loading = true;
      if (!silent) this.error = "";
      try {
        const response = await getJson(buildSolverJobListUrl(this.filters));
        this.jobs = Array.isArray(response) ? response : [];
      } catch (error) {
        this.error = localizeApiError(error);
        if (!silent) notify(this.error, "danger");
      } finally {
        this.loading = false;
        this.initialLoading = false;
        this.syncPolling();
      }
    },
    async search() {
      await this.loadJobs();
    },
    statusInfo,
    displayBoolean,
    displayMatrixMode,
    splitDateTime,
    displayDateTime,
    displayScore,
    scoreSegments,
    displaySolveFinishTime,
    displaySolveTime(value) {
      return formatDuration(value, this.locale);
    },
    openDetail(jobId) {
      navigate(buildRoute("/solver-job", { id: jobId }));
    },
    openMap(jobId) {
      navigate(buildRoute("/solver-map", { id: jobId }));
    }
  };
}
