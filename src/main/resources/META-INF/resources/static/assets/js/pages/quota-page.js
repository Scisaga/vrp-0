import { getJson, isoDurationToSeconds, putJson, durationToIso } from "../utils/api.js";
import { getEngineLocale, localizeApiError, t } from "../i18n/engine-i18n.js";
import { invalidateMapRuntimeContext } from "../utils/map-runtime-preload.js";

export function quotaPage() {
  return {
    loading: true,
    saving: false,
    error: "",
    notice: "",
    showApiKey: false,
    locale: getEngineLocale(),
    localeChangeHandler: null,
    form: {
      key: "",
      qps: 10,
      quota: 10000,
      intervalSeconds: 86400,
      waitTimeoutSeconds: 10,
      geocodeProvider: "AMAP",
      addressResolverUrl: "http://127.0.0.1:5000/api/resolve",
      addressResolverFallbackToAmap: false
    },
    async init() {
      this.localeChangeHandler = (event) => {
        this.locale = event.detail?.locale || getEngineLocale();
      };
      window.addEventListener?.("vrp:locale-changed", this.localeChangeHandler);
      await this.load();
    },
    destroy() {
      if (this.localeChangeHandler) {
        window.removeEventListener?.("vrp:locale-changed", this.localeChangeHandler);
        this.localeChangeHandler = null;
      }
    },
    t(key, params = {}) {
      return t(key, params, this.locale);
    },
    toggleApiKeyVisibility() {
      this.showApiKey = !this.showApiKey;
    },
    maskedApiKey() {
      return this.form.key ? "********" : "";
    },
    async load() {
      this.loading = true;
      this.error = "";
      try {
        const data = await getJson("/quota");
        this.form = {
          key: data.key || "",
          qps: data.qps ?? 10,
          quota: data.quota ?? 10000,
          intervalSeconds: isoDurationToSeconds(data.interval) || 86400,
          waitTimeoutSeconds: isoDurationToSeconds(data.wait_timeout) || 10,
          geocodeProvider: data.geocode_provider || "AMAP",
          addressResolverUrl: data.address_resolver_url || "http://127.0.0.1:5000/api/resolve",
          addressResolverFallbackToAmap: Boolean(data.address_resolver_fallback_to_amap)
        };
        window.dispatchEvent(new CustomEvent("vrp:connection", { detail: { online: true, labelKey: "connection.quotaAvailable" } }));
      } catch (error) {
        this.error = localizeApiError(error);
        window.dispatchEvent(new CustomEvent("vrp:connection", { detail: { online: false, labelKey: "connection.quotaUnavailable" } }));
      } finally {
        this.loading = false;
      }
    },
    async save() {
      this.saving = true;
      this.error = "";
      this.notice = "";
      try {
        await putJson("/quota", {
          key: this.form.key,
          qps: Number(this.form.qps),
          quota: Number(this.form.quota),
          interval: durationToIso(this.form.intervalSeconds),
          wait_timeout: durationToIso(this.form.waitTimeoutSeconds),
          geocode_provider: this.form.geocodeProvider,
          address_resolver_url: this.form.addressResolverUrl,
          address_resolver_fallback_to_amap: Boolean(this.form.addressResolverFallbackToAmap)
        });
        invalidateMapRuntimeContext();
        this.notice = this.t("quota.saveSuccess");
        await this.load();
      } catch (error) {
        this.error = localizeApiError(error);
      } finally {
        this.saving = false;
      }
    },
    clearNotice() {
      this.notice = "";
    },
    clearError() {
      this.error = "";
    }
  };
}
