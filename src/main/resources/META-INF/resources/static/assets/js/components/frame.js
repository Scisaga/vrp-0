const ROUTES = [
  {
    route: "/scenario",
    page: "scenario-component",
    titleKey: "route.scenario.title",
    descKey: "route.scenario.desc",
    labelKey: "route.scenario.title",
    icon: "inventory_2",
    menu: true
  },
  {
    route: "/solver-jobs",
    page: "solver-job-list",
    titleKey: "route.jobs.title",
    descKey: "route.jobs.desc",
    labelKey: "route.jobs.menu",
    icon: "work_history",
    menu: true
  },
  {
    route: "/solver-job",
    page: "scenario-component",
    titleKey: "route.job.title",
    descKey: "route.job.desc",
    labelKey: "route.job.title",
    icon: "timeline",
    menu: false
  },
  {
    route: "/solver-map",
    page: "scenario-component",
    titleKey: "route.map.title",
    descKey: "route.map.desc",
    labelKey: "route.map.title",
    icon: "map",
    menu: false
  },
  {
    route: "/quota",
    page: "quota",
    titleKey: "route.quota.title",
    descKey: "route.quota.desc",
    labelKey: "route.quota.menu",
    icon: "tune",
    menu: true
  },
  {
    route: "/mcp",
    page: "mcp",
    titleKey: "route.mcp.title",
    descKey: "route.mcp.desc",
    labelKey: "route.mcp.menu",
    icon: "hub",
    menu: true
  }
];

const FALLBACK_PAGE_HTML = {
  "scenario-detail": `
    <div class="page-shell p-[1.25rem]">
      <div class="metric-card">
        <div class="field-label" x-text="t('scenario.fallback.title')"></div>
        <div class="mt-[0.9375rem] text-[1.09375rem]/[1.5625rem] text-slate-700" x-text="t('scenario.fallback.description')"></div>
      </div>
    </div>
  `
};

function findRoute(hash) {
  const normalized = (hash || "#/scenario").replace(/^#/, "").split("?")[0];
  return ROUTES.find((item) => item.route === normalized) || ROUTES[0];
}

export function frameShell() {
  return {
    menuItems: ROUTES.filter((item) => item.menu),
    currentRoute: "",
    currentHash: "",
    currentPageTitle: "",
    currentPageDescription: "",
    connectionState: "online",
    connectionStateKey: "connection.available",
    connectionStateLabel: "",
    nowText: "--",
    sidebarCollapsed: false,
    mobileMenuOpen: false,
    locale: getEngineLocale(),
    notification: { message: "", tone: "info" },
    notifyTimer: null,
    async boot() {
      this.locale = initEngineLocale();
      this.currentPageTitle = t("route.scenario.title", {}, this.locale);
      this.currentPageDescription = t("route.scenario.desc", {}, this.locale);
      this.connectionStateLabel = t(this.connectionStateKey, {}, this.locale);
      this.tickClock();
      window.setInterval(() => this.tickClock(), 1000);
      window.addEventListener("hashchange", () => this.handleRouteChange());
      window.addEventListener("vrp:connection", (event) => {
        this.connectionState = event.detail?.online ? "online" : "offline";
        this.connectionStateKey = event.detail?.labelKey || (event.detail?.online ? "connection.available" : "connection.unavailable");
        this.connectionStateLabel = t(
          this.connectionStateKey,
          event.detail?.params || {},
          this.locale
        );
      });
      window.addEventListener("vrp:notify", (event) => {
        this.showNotification(event.detail?.message, event.detail?.tone);
      });
      window.addEventListener("vrp:locale-changed", (event) => {
        this.locale = event.detail?.locale || getEngineLocale();
        this.tickClock();
        this.currentPageTitle = t(findRoute(this.currentHash).titleKey, {}, this.locale);
        this.currentPageDescription = t(findRoute(this.currentHash).descKey, {}, this.locale);
        this.connectionStateLabel = t(this.connectionStateKey, {}, this.locale);
      });
      await this.handleRouteChange();
    },
    tickClock() {
      this.nowText = new Intl.DateTimeFormat(this.locale, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).format(new Date());
    },
    isActive(route) {
      return this.currentRoute === route
        || (route === "/solver-jobs" && ["/solver-job", "/solver-map"].includes(this.currentRoute));
    },
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
    },
    setLocale(value) {
      this.locale = setEngineLocale(value);
    },
    t(key, params = {}) {
      return t(key, params, this.locale);
    },
    clearNotification() {
      if (this.notifyTimer) {
        window.clearTimeout(this.notifyTimer);
        this.notifyTimer = null;
      }
      this.notification = { message: "", tone: "info" };
    },
    showNotification(message, tone = "info") {
      const text = String(message || "").trim();
      if (!text) return;

      this.clearNotification();
      this.notification = { message: text, tone };
      this.notifyTimer = window.setTimeout(() => this.clearNotification(), 3000);
    },
    async go(route) {
      const target = route.startsWith("#") ? route : `#${route}`;
      if (window.location.hash === target) {
        await this.handleRouteChange();
        return;
      }
      window.location.hash = target;
    },
    async handleRouteChange(force = false) {
      const nextHash = window.location.hash || "#/scenario";
      const route = findRoute(window.location.hash);
      if (!force && route.route === this.currentRoute && this.currentHash === nextHash && this.$refs.pageOutlet.children.length > 0) {
        return;
      }
      this.currentRoute = route.route;
      this.currentHash = nextHash;
      this.currentPageTitle = t(route.titleKey, {}, this.locale);
      this.currentPageDescription = t(route.descKey, {}, this.locale);

      let html = FALLBACK_PAGE_HTML[route.page] || "";
      try {
        const response = await fetch(`pages/${route.page}.html`, { cache: "no-store" });
        html = await response.text();
      } catch (_error) {
      }
      this.$refs.pageOutlet.innerHTML = html;
      if (window.Alpine) {
        window.Alpine.initTree(this.$refs.pageOutlet);
      }
    }
  };
}
import {
  getEngineLocale,
  initEngineLocale,
  setEngineLocale,
  t
} from "../i18n/engine-i18n.js";
