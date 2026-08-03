import { getJson, safeArray } from "../utils/api.js";
import { getEngineLocale, localizeApiError, t as engineMessage } from "../i18n/engine-i18n.js";

export function mcpPage() {
  return {
    loading: true,
    error: "",
    notice: "",
    noticeTimer: null,
    clientTab: "harness",
    locale: getEngineLocale(),
    localeChangeHandler: null,
    sections: {
      status: true,
      origins: true,
      tools: true,
      usage: true
    },
    meta: {
      enabled: false,
      path: "/mcp",
      allowed_origins: [],
      tools: [],
      transport: "Streamable HTTP",
      auth_mode: "Bearer Token"
    },
    async init() {
      this.locale = getEngineLocale();
      this.localeChangeHandler = (event) => {
        this.locale = event.detail?.locale || getEngineLocale();
      };
      window.addEventListener("vrp:locale-changed", this.localeChangeHandler);
      await this.load();
    },
    destroy() {
      window.removeEventListener("vrp:locale-changed", this.localeChangeHandler);
      this.clearNotice();
    },
    t(key, params = {}) {
      return engineMessage(key, params, this.locale);
    },
    async load() {
      this.loading = true;
      this.error = "";
      this.clearNotice();
      try {
        const data = await getJson("/mcp/meta");
        this.meta = {
          enabled: Boolean(data.enabled),
          path: data.path || "/mcp",
          allowed_origins: safeArray(data.allowed_origins),
          tools: safeArray(data.tools),
          transport: data.transport || "Streamable HTTP",
          auth_mode: data.auth_mode || "Bearer Token"
        };
        window.dispatchEvent(new CustomEvent("vrp:connection", {
          detail: {
            online: true,
            labelKey: this.meta.enabled ? "connection.mcpAvailable" : "connection.mcpDisabled"
          }
        }));
      } catch (error) {
        this.error = localizeApiError(error);
        window.dispatchEvent(new CustomEvent("vrp:connection", {
          detail: {
            online: false,
            labelKey: "connection.mcpUnavailable"
          }
        }));
      } finally {
        this.loading = false;
      }
    },
    clearNotice() {
      if (this.noticeTimer) {
        window.clearTimeout(this.noticeTimer);
        this.noticeTimer = null;
      }
      this.notice = "";
    },
    showNotice(message) {
      this.clearNotice();
      this.notice = message;
      this.noticeTimer = window.setTimeout(() => {
        this.notice = "";
        this.noticeTimer = null;
      }, 5000);
    },
    clearError() {
      this.error = "";
    },
    mcpUrl() {
      const origin = window.location.origin || "";
      return `${origin}${this.meta.path || "/mcp"}`;
    },
    summaryStatusLabel() {
      return this.meta.enabled ? "ENABLED" : "DISABLED";
    },
    summaryStatusClass() {
      return this.meta.enabled
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-slate-50 text-slate-600";
    },
    transportSummary() {
      return String(this.meta.transport || "Streamable HTTP")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
    },
    authSummary() {
      return String(this.meta.auth_mode || "Bearer Token")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
    },
    async copyMcpUrl() {
      try {
        await navigator.clipboard.writeText(this.mcpUrl());
        this.showNotice(this.t("mcp.copyUrlSuccess"));
      } catch (_error) {
        this.showNotice(this.t("mcp.copyUrlFallback", { url: this.mcpUrl() }));
      }
    },
    openMcpDoc() {
      window.open("/mcp/doc", "_blank", "noopener");
    },
    selectClientTab(tab) {
      this.clientTab = tab;
    },
    isClientTab(tab) {
      return this.clientTab === tab;
    },
    clientTabTitle() {
      if (this.clientTab === "vscode") return "VS Code";
      if (this.clientTab === "codex") return "Codex";
      return "Harness";
    },
    clientTabDescription() {
      return this.t(`mcp.client.${this.clientTab}.description`);
    },
    mcpClientConfig() {
      const endpoint = this.mcpUrl();
      if (this.clientTab === "vscode") {
        return JSON.stringify({
          inputs: [
            {
              type: "promptString",
              id: "vrp0-mcp-token",
              description: "VRP-0 MCP Bearer Token",
              password: true
            }
          ],
          servers: {
            vrp0: {
              type: "http",
              url: endpoint,
              headers: {
                Authorization: "Bearer ${input:vrp0-mcp-token}"
              }
            }
          }
        }, null, 2);
      }
      if (this.clientTab === "codex") {
        return `export VRP0_MCP_TOKEN='<${this.t("mcp.client.bearerTokenPlaceholder")}>'\n\n[mcp_servers.vrp0]\nenabled = true\nurl = "${endpoint}"\nbearer_token_env_var = "VRP0_MCP_TOKEN"`;
      }
      return `# ${this.t("mcp.client.harness.secretComment")}\nconnector:\n  name: VRP-0 MCP\n  identifier: vrp0_mcp\n  accountIdentifier: <your_account_id>\n  orgIdentifier: <your_org_id>\n  projectIdentifier: <your_project_id>\n  type: Mcp\n  spec:\n    serverUrl: ${endpoint}\n    auth:\n      type: CustomHeader\n      spec:\n        headerName: Authorization\n        headerValueRef: <your_vrp0_bearer_secret>\n    executeOnDelegate: false`;
    },
    isExpanded(section) {
      return this.sections[section] !== false;
    },
    toggleSection(section) {
      this.sections[section] = !this.isExpanded(section);
    },
    statusTone() {
      return this.meta.enabled ? "text-emerald-700" : "text-amber-700";
    },
    statusText() {
      return this.meta.enabled ? this.t("mcp.status.enabled") : this.t("mcp.status.disabled");
    },
    allowedOriginsText() {
      return this.meta.allowed_origins.length > 0
        ? this.meta.allowed_origins.join("\n")
        : this.t("mcp.origin.none");
    }
  };
}
