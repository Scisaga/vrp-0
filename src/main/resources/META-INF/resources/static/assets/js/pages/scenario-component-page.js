import { basicSetup, EditorView } from "../../vendor/codemirror/codemirror/dist/index.js";
import { EditorState } from "../../vendor/codemirror/@codemirror/state/dist/index.js";
import { linter } from "../../vendor/codemirror/@codemirror/lint/dist/index.js";
import { json, jsonParseLinter } from "../../vendor/codemirror/@codemirror/lang-json/dist/index.js";
import { mountScenarioComponent } from "../utils/scenario-component-runtime.js";
import { engineScenarioActions } from "../utils/scenario-component-engine-actions.js";
import { buildRoute, copyText, currentHashQueryParam, deleteRequest, getJson, postJson, putJson, notify } from "../utils/api.js";
import { getMapRuntimeContext } from "../utils/map-runtime-preload.js";
import { getEngineLocale, localizeApiError, t as engineT } from "../i18n/engine-i18n.js";

function createButton({ slot, className, key, action = "", disabled = false, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.slot = slot;
  button.className = className;
  button.dataset.i18nKey = key;
  if (action) {
    button.dataset.resultAction = action;
  }
  button.disabled = disabled;
  button.textContent = engineT(key);
  button.addEventListener("click", onClick);
  return button;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mapContextForLocale(mapContext, locale) {
  const context = plainObject(mapContext)
    ? mapContext
    : { enabled: false, provider: "none" };
  return {
    ...context,
    // map_context.locale remains the sole SDK input.  Engine deliberately
    // projects its selected display language into that input for this host.
    locale: locale === "en-US" ? "en-US" : "zh-CN"
  };
}

function scenarioRequest(element) {
  const draft = element?.getScenarioDraft?.();
  if (!draft?.request_payload) {
    throw new Error(engineT("scenario.host.scenarioNotReady"));
  }
  return draft;
}

function matrixSaveUrl(draft) {
  const options = draft?.request_payload?.options || {};
  const params = new URLSearchParams({
    build: "true",
    matrix_mode: options.matrix_mode || "MANHATTAN"
  });
  return `/scenario?${params}`;
}

function parseSolveTime(value) {
  const match = String(value || "").trim().toUpperCase().match(/^PT(\d+)([SMH])$/);
  if (!match || Number(match[1]) < 1) {
    throw new Error(engineT("scenario.host.solveTimeInvalid"));
  }
  return `${match[1]}${match[2]}`;
}

export function scenarioComponentPage() {
  return {
    error: "",
    ready: false,
    initialized: false,
    resultPage: false,
    mapPage: false,
    saving: false,
    scenarioDirty: false,
    element: null,
    scenarioPersisted: false,
    scenarioProviderMismatch: false,
    pendingTicketFocusId: "",
    componentContext: null,
    localeChangeHandler: null,
    locale: getEngineLocale(),
    hostControlButtons: [],
    resultState: { jobId: null, status: null },
    importRequestDialog: {
      open: false,
      text: "",
      error: "",
      editor: null,
      pendingPasteFormat: false
    },
    async init() {
      if (this.initialized) {
        return;
      }
      this.initialized = true;
      const route = window.location.hash.replace(/^#/, "");
      this.mapPage = route.startsWith("/solver-map");
      this.resultPage = this.mapPage || route.startsWith("/solver-job");
      this.pendingTicketFocusId = this.resultPage ? "" : String(currentHashQueryParam("focus_ticket") || "").trim();
      const locale = getEngineLocale();
      this.componentContext = {
        component_version: "vrp0",
        locale,
        view: this.mapPage ? "map" : (this.resultPage ? "result" : "create"),
        result_job_id: this.resultPage ? currentHashQueryParam("id") : "",
        map_context: mapContextForLocale(await this.loadMapContext(), locale),
        ...(this.resultPage ? {} : { scenario_overview: true, available_agent_trend: true }),
        create_context: this.resultPage ? null : {
          request_schema: {},
          constraint_override_schema: {},
          constraint_override_defaults: {},
          scenario_persisted: false
        },
        result_context: null
      };
      const element = mountScenarioComponent(this.$refs.component, this.componentContext, engineScenarioActions());
      this.element = element;
      element.addEventListener("scenario-ready", () => this.handleScenarioReady());
      element.addEventListener("scenario-error", (event) => {
        this.error = localizeApiError({
          code: event.detail?.code,
          params: event.detail?.params,
          status: 500
        });
      });
      element.addEventListener("scenario-navigate", (event) => this.handleComponentNavigation(event));
      element.addEventListener("scenario-dirty-state-changed", (event) => {
        this.scenarioDirty = Boolean(event.detail?.dirty);
      });
      element.addEventListener("scenario-result-state-changed", (event) => {
        this.resultState = {
          jobId: event.detail?.job_id || null,
          status: event.detail?.status || null
        };
        this.refreshResultControlStates();
      });
      this.localeChangeHandler = (event) => {
        const locale = event.detail?.locale || getEngineLocale();
        this.locale = locale;
        this.componentContext = {
          ...(this.componentContext || {}),
          locale,
          map_context: mapContextForLocale(this.componentContext?.map_context, locale)
        };
        this.element?.updateContext?.(this.componentContext);
        this.refreshHostControlLabels();
      };
      window.addEventListener("vrp:locale-changed", this.localeChangeHandler);
    },
    t(key, params = {}) {
      return engineT(key, params, this.locale);
    },
    refreshHostControlLabels() {
      this.hostControlButtons.forEach((button) => {
        button.textContent = engineT(button.dataset.i18nKey, {}, this.locale);
      });
    },
    refreshResultControlStates() {
      const status = this.resultState.status;
      const hasJob = Boolean(this.resultState.jobId);
      const running = status === "SOLVING_SCHEDULED" || status === "SOLVING_ACTIVE";
      this.hostControlButtons.forEach((button) => {
        switch (button.dataset.resultAction) {
          case "stop":
            button.disabled = !hasJob || !running;
            break;
          case "delete":
            button.disabled = !hasJob || !["SOLVING_FINISHED", "ERROR"].includes(status);
            break;
          default:
            break;
        }
      });
    },
    async handleScenarioReady() {
      this.ready = true;
      try {
        if (this.resultPage) {
          if (!this.mapPage) {
            this.appendResultControls(this.element);
          }
          return;
        }
        await this.loadScenarioDraft();
        await this.focusPendingTicket();
        await this.element.refreshAvailableAgentTrend?.();
      } catch (error) {
        this.error = localizeApiError(error);
      }
    },
    async loadMapContext() {
      try {
        return await getMapRuntimeContext();
      } catch (_error) {
        return { enabled: false, provider: "none" };
      }
    },
    async loadScenarioDraft() {
      this.scenarioProviderMismatch = false;
      try {
        const scenario = await getJson("/scenario");
        this.scenarioPersisted = true;
        this.scenarioDirty = false;
        this.element.replaceScenarioDraft?.({ request_payload: scenario, scenario_persisted: true });
      } catch (error) {
        if (error?.payload?.error_code === "scenario_map_provider_mismatch") {
          this.scenarioProviderMismatch = true;
          return;
        }
        if (error?.status !== 404) {
          throw error;
        }
        this.scenarioPersisted = false;
        this.scenarioDirty = false;
        this.element.replaceScenarioDraft?.({ request_payload: null, scenario_persisted: false });
      }
    },
    clearPendingTicketFocusRoute() {
      const rawRoute = String(window.location.hash || "#/scenario").replace(/^#/, "");
      const [path, rawQuery = ""] = rawRoute.split("?", 2);
      const query = new URLSearchParams(rawQuery);
      query.delete("focus_ticket");
      const nextRoute = query.toString() ? `${path}?${query.toString()}` : path;
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${nextRoute}`);
    },
    async focusPendingTicket() {
      const ticketId = this.pendingTicketFocusId;
      if (!ticketId) {
        return;
      }
      this.pendingTicketFocusId = "";
      this.clearPendingTicketFocusRoute();
      const result = await this.element?.focusScenarioTicket?.(ticketId);
      if (!result?.focused) {
        notify(this.t("scenario.host.ticketNotFound", { ticketId }), "warning");
      }
    },
    async runLocalAction(action) {
      this.error = "";
      this.saving = true;
      try {
        await action();
      } catch (error) {
        this.error = localizeApiError(error);
        notify(this.error, "danger");
      } finally {
        this.saving = false;
      }
    },
    async saveScenario() {
      await this.runLocalAction(async () => {
        const draft = scenarioRequest(this.element);
        const saved = await putJson("/scenario", draft.request_payload);
        this.scenarioPersisted = true;
        this.scenarioDirty = false;
        this.element.replaceScenarioDraft?.({ request_payload: saved, scenario_persisted: true });
        await this.element.refreshAvailableAgentTrend?.();
        notify(this.t("scenario.host.scenarioSaved"), "success");
      });
    },
    async generateMatrix() {
      await this.runLocalAction(async () => {
        const draft = scenarioRequest(this.element);
        const saved = await putJson(matrixSaveUrl(draft), draft.request_payload);
        this.scenarioPersisted = true;
        this.scenarioDirty = false;
        this.element.replaceScenarioDraft?.({ request_payload: saved, scenario_persisted: true });
        await this.element.refreshAvailableAgentTrend?.();
        notify(this.t("scenario.host.scenarioSavedAndBuilt"), "success");
      });
    },
    async deleteScenario() {
      if (!window.confirm(this.t("scenario.host.deleteScenarioConfirm"))) {
        return;
      }
      await this.runLocalAction(async () => {
        await deleteRequest("/scenario");
        this.scenarioProviderMismatch = false;
        this.scenarioPersisted = false;
        this.scenarioDirty = false;
        this.element.replaceScenarioDraft?.({ request_payload: null, scenario_persisted: false });
        this.element.clearAvailableAgentTrend?.();
        notify(this.t("scenario.host.scenarioDeleted"), "success");
      });
    },
    openPlanningDrawer() {
      if (!this.scenarioPersisted) {
        this.error = this.t("scenario.host.saveRequired");
        notify(this.error, "danger");
        return false;
      }
      return this.element?.openPlanningDrawer?.() || false;
    },
    buildSolveRequestPayload() {
      const draft = scenarioRequest(this.element);
      const request = draft.request_payload || {};
      const options = request.options || {};
      return {
        scenario_name: request.name || "",
        scenario: request,
        solve_options: {
          solve_time: draft.expected_solve_duration || "PT30S",
          matrix_mode: options.matrix_mode || "MANHATTAN",
          build_transit_matrix: Boolean(options.build_transit_matrix),
          draw_route: Boolean(options.draw_route)
        }
      };
    },
    async copySolveRequestPayload() {
      try {
        if (!await copyText(JSON.stringify(this.buildSolveRequestPayload(), null, 2))) {
          throw new Error(this.t("scenario.host.copyFailed"));
        }
        notify(this.t("scenario.host.requestCopied"), "success");
      } catch (error) {
        this.error = localizeApiError(error);
      }
    },
    openImportSolveRequestDialog() {
      this.importRequestDialog.open = true;
      this.importRequestDialog.error = "";
      this.$nextTick(() => {
        if (!this.$refs.importSolveRequestDialog.open) {
          this.$refs.importSolveRequestDialog.showModal();
        }
        this.initImportRequestEditor();
        this.setImportRequestEditorText(this.importRequestDialog.text || "");
        this.importRequestDialog.editor?.focus();
      });
    },
    closeImportSolveRequestDialog() {
      if (this.$refs.importSolveRequestDialog?.open) {
        this.$refs.importSolveRequestDialog.close();
      }
      this.importRequestDialog.open = false;
      this.importRequestDialog.error = "";
    },
    initImportRequestEditor() {
      if (this.importRequestDialog.editor || !this.$refs.importSolveRequestEditor) {
        return;
      }
      this.importRequestDialog.editor = new EditorView({
        state: EditorState.create({
          doc: this.importRequestDialog.text || "",
          extensions: [
            basicSetup,
            json(),
            linter(jsonParseLinter()),
            EditorView.lineWrapping,
            EditorView.domEventHandlers({ paste: () => { this.importRequestDialog.pendingPasteFormat = true; return false; } }),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) {
                return;
              }
              this.importRequestDialog.text = update.state.doc.toString();
              this.importRequestDialog.error = "";
              if (this.importRequestDialog.pendingPasteFormat) {
                this.importRequestDialog.pendingPasteFormat = false;
                window.setTimeout(() => this.tryFormatImportRequestJson(), 0);
              }
            }),
            EditorView.theme({
              "&": { height: "20rem", fontSize: "16.25px", border: "1.25px solid rgba(148, 163, 184, 0.45)", borderRadius: "0.625rem", overflow: "hidden", backgroundColor: "rgba(255, 255, 255, 0.88)" },
              ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace" },
              ".cm-content": { padding: "0.9375rem 0", minHeight: "100%" },
              ".cm-gutters": { backgroundColor: "rgba(248, 250, 252, 0.95)", borderRight: "1.25px solid rgba(226, 232, 240, 0.95)" },
              ".cm-activeLineGutter": { backgroundColor: "rgba(16, 185, 129, 0.08)" },
              ".cm-activeLine": { backgroundColor: "rgba(16, 185, 129, 0.05)" },
              "&.cm-focused": { outline: "2.5px solid rgba(16, 185, 129, 0.18)", outlineOffset: "0" }
            })
          ]
        }),
        parent: this.$refs.importSolveRequestEditor
      });
    },
    destroyImportRequestEditor() {
      this.importRequestDialog.editor?.destroy();
      this.importRequestDialog.editor = null;
      this.importRequestDialog.pendingPasteFormat = false;
    },
    getImportRequestEditorText() {
      return this.importRequestDialog.editor?.state.doc.toString() || this.importRequestDialog.text || "";
    },
    setImportRequestEditorText(value) {
      const text = String(value ?? "");
      this.importRequestDialog.text = text;
      const editor = this.importRequestDialog.editor;
      if (!editor || editor.state.doc.toString() === text) {
        return;
      }
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
    },
    tryFormatImportRequestJson() {
      const raw = this.getImportRequestEditorText();
      if (!raw.trim()) {
        return false;
      }
      try {
        const formatted = JSON.stringify(JSON.parse(raw), null, 2);
        if (formatted !== raw) {
          this.setImportRequestEditorText(formatted);
        }
        return true;
      } catch (_error) {
        return false;
      }
    },
    applyImportedSolveRequest() {
      this.importRequestDialog.error = "";
      let parsed;
      try {
        parsed = JSON.parse(this.getImportRequestEditorText());
      } catch (_error) {
        this.importRequestDialog.error = this.t("scenario.host.invalidJson");
        return;
      }
      const scenario = parsed?.scenario || parsed?.request_payload;
      if (!plainObject(scenario)) {
        this.importRequestDialog.error = this.t("scenario.host.missingScenario");
        return;
      }
      const options = parsed?.solve_options || scenario.options || {};
      try {
        const current = scenarioRequest(this.element);
        const expected = options.solve_time ? `PT${parseSolveTime(options.solve_time)}` : current.expected_solve_duration;
        let matrixMode = String(options.matrix_mode || scenario.options?.matrix_mode || "MANHATTAN").toUpperCase();
        if (matrixMode === "AMAP") matrixMode = "ROUTING";
        if (!["ROUTING", "MANHATTAN"].includes(matrixMode)) {
          throw new Error(this.t("scenario.host.invalidMatrixMode"));
        }
        this.element.replaceScenarioDraft?.({
          request_payload: scenario,
          expected_solve_duration: expected,
          solve_options: {
            matrix_mode: matrixMode,
            build_transit_matrix: options.build_transit_matrix ?? scenario.options?.build_transit_matrix ?? true,
            draw_route: options.draw_route ?? scenario.options?.draw_route ?? false
          }
        });
        this.element.clearAvailableAgentTrend?.();
        this.setImportRequestEditorText("");
        this.closeImportSolveRequestDialog();
        notify(this.t("scenario.host.importApplied"), "success");
      } catch (error) {
        this.importRequestDialog.error = localizeApiError(error);
      }
    },
    appendResultControls(element) {
      this.hostControlButtons = [
        createButton({
          slot: "engine-result-toolbar-start",
          className: "action-secondary",
          key: "scenario.host.backToJobs",
          onClick: () => {
            window.location.hash = "#/solver-jobs";
          }
        }),
        createButton({
          slot: "engine-result-actions",
          className: "action-danger",
          key: "scenario.host.stopSolving",
          action: "stop",
          disabled: true,
          onClick: () => this.runLocalAction(async () => {
            const job = element.getScenarioResult?.();
            if (!job?.id || !["SOLVING_SCHEDULED", "SOLVING_ACTIVE"].includes(job.status)) throw new Error(this.t("scenario.host.noStoppableJob"));
            await postJson("/solver_job/terminate");
            await element.refreshScenarioResult?.();
            notify(this.t("scenario.host.stopRequested"), "success");
          })
        }),
        createButton({
          slot: "engine-result-actions",
          className: "action-danger",
          key: "scenario.host.deleteJob",
          action: "delete",
          disabled: true,
          onClick: () => this.runLocalAction(async () => {
            const job = element.getScenarioResult?.();
            if (!job?.id || !["SOLVING_FINISHED", "ERROR"].includes(job.status)) throw new Error(this.t("scenario.host.noDeletableJob"));
            if (!window.confirm(this.t("scenario.host.deleteJobConfirm"))) return;
            await deleteRequest(`/solver_job/${encodeURIComponent(job.id)}`);
            notify(this.t("scenario.host.jobDeleted"), "success");
            window.location.hash = "#/solver-job";
          })
        })
      ];
      element.append(...this.hostControlButtons);
      this.refreshResultControlStates();
    },
    handleComponentNavigation(event) {
      const target = String(event.detail?.target || "");
      const resultJobId = String(event.detail?.result_job_id || "").trim();
      const intent = String(event.detail?.intent || "");
      const ticketId = String(event.detail?.ticket_id || "").trim();
      if (target === "create" && intent === "focus_ticket" && ticketId) {
        window.location.hash = `#${buildRoute("/scenario", { focus_ticket: ticketId })}`;
        return;
      }
      if (target === "create") {
        window.location.hash = "#/scenario";
        return;
      }
      if (target === "result") {
        window.location.hash = `#${buildRoute("/solver-job", { id: resultJobId || currentHashQueryParam("id") })}`;
        return;
      }
      if (target === "map") {
        window.location.hash = `#${buildRoute("/solver-map", { id: resultJobId || currentHashQueryParam("id") })}`;
      }
    },
    destroy() {
      if (this.localeChangeHandler) {
        window.removeEventListener("vrp:locale-changed", this.localeChangeHandler);
        this.localeChangeHandler = null;
      }
      this.destroyImportRequestEditor();
      this.$refs?.component?.replaceChildren();
      this.element = null;
    }
  };
}
