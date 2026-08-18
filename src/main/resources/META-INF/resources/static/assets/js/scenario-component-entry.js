import "./components/date-time-24-input.js";
import { scenarioDetailPage } from "./pages/scenario-detail-page.js";
import { solverJobDetailPage } from "./pages/solver-job-detail-page.js";
import { solverJobMapPage } from "./pages/solver-job-map-page.js";
import { createScenarioComponentI18n, normalizeComponentLocale } from "./i18n/scenario-component-i18n.js";
import { initUiTooltips } from "./utils/ui-tooltip.js";

const templates = __SCENARIO_COMPONENT_TEMPLATES__;
const pageFactories = {
  create: scenarioDetailPage,
  result: solverJobDetailPage,
  map: solverJobMapPage
};

function firstObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || null;
}

function createPayload(context) {
  const create = context?.create_context || {};
  const draft = firstObject(create.draft);
  const payload = {
    request_payload: draft?.request_payload || create.initial_request_payload || create.initialScenario || null,
    expected_solve_duration: draft?.expected_solve_duration || create.expected_solve_duration || null,
    constraint_overrides: draft?.constraint_overrides || create.constraint_overrides || {},
    solve_options: create.solve_options || create.solveOptions || null,
    draft_revision: draft?.revision ?? null
  };
  if (Object.prototype.hasOwnProperty.call(create, "scenario_persisted")) {
    payload.scenario_persisted = Boolean(create.scenario_persisted);
  }
  return payload;
}

function resultPayload(context) {
  return context?.result_context || null;
}

function lifecycleEvent(component, name, detail = {}) {
  component.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

export function mountScenarioUi(component, root, initialContext, actions, Alpine) {
  if (!Alpine) {
    throw new Error("Scenario UI 运行依赖 Alpine 未初始化");
  }

  const rootElement = root.querySelector("#scenario-root");
  if (!rootElement) {
    throw new Error("Scenario UI 根节点缺失");
  }

  const previousBridge = window.VrpScenarioGateway;
  let context = initialContext || {};
  const i18n = createScenarioComponentI18n(context.locale, rootElement);
  // Explicit, temporary compatibility boundary for legacy templates. New
  // elements render via semantic t(key) bindings and do not rely on scanning.
  rootElement.setAttribute("data-i18n-legacy-root", "");
  let activeComponent = null;
  let activeView = ["result", "map"].includes(context.view) ? context.view : "create";
  let resultJobId = context?.result_job_id
    || context?.result_context?.task?.id
    || context?.result_context?.task?.job_id
    || "";
  let createDataInitialized = false;
  let appliedDraftRevision = null;
  let disposed = false;
  const disposeUiTooltips = initUiTooltips(root);

  Alpine.addScopeToNode(rootElement, {
    scenarioComponentPageData() {
      const factory = pageFactories[activeView] || pageFactories.create;
      const page = factory();
      page.locale = i18n.getLocale();
      page.t = function translateComponentKey(key, params = {}) {
        return i18n.t(key, params, this.locale);
      };
      page.setLocale = function setComponentLocale(nextLocale) {
        this.locale = normalizeComponentLocale(nextLocale);
        this.onLocaleChanged?.();
      };
      return page;
    }
  });

  const bridge = {
    isScenarioComponent: true,
    actions,
    context: null,
    async registerComponent(kind, pageComponent) {
      activeComponent = pageComponent;
      if (kind === "create") {
        await deliverCreateData();
        return;
      }
      try {
        await deliverResult();
      } catch (error) {
        this.sendError(error);
      }
    },
    notifyDirty(dirty) {
      lifecycleEvent(component, "scenario-dirty-state-changed", {
        dirty: Boolean(dirty),
        changed_at: new Date().toISOString()
      });
    },
    notifyCreateReadiness(ready) {
      lifecycleEvent(component, "scenario-create-readiness-changed", {
        ready: Boolean(ready),
        changed_at: new Date().toISOString()
      });
    },
    notifyResultState(job) {
      lifecycleEvent(component, "scenario-result-state-changed", {
        job_id: job?.id || job?.job_id || null,
        status: job?.status || null
      });
    },
    sendError(error) {
      const code = error?.code || error?.errorCode || "internal_error";
      const params = error?.params || error?.errorParams || {};
      lifecycleEvent(component, "scenario-error", {
        code,
        params,
        message: i18n.localizeError({ code, params })
      });
    },
    translateText(value, params) {
      return i18n.translateText(value, params);
    },
    t(key, params) {
      return i18n.t(key, params);
    },
    localizeError(error) {
      return i18n.localizeError(error);
    },
    scheduleResize() {},
    navigate(destination) {
      const detail = destination && typeof destination === "object" && !Array.isArray(destination)
        ? destination
        : null;
      if (!detail || !["create", "result", "map"].includes(detail.target)) {
        this.sendError(new Error("Scenario UI 导航目标不受支持"));
        return;
      }
      lifecycleEvent(component, "scenario-navigate", {
        target: detail.target,
        ...(detail.result_job_id ? { result_job_id: String(detail.result_job_id) } : {}),
        ...(detail.intent ? { intent: String(detail.intent) } : {}),
        ...(detail.ticket_id ? { ticket_id: String(detail.ticket_id) } : {})
      });
    }
  };

  function syncBridgeContext() {
    bridge.context = {
      ...context,
      locale: normalizeComponentLocale(context.locale),
      result_job_id: resultJobId,
      payload: context.view === "create" ? createPayload(context) : resultPayload(context)
    };
    rootElement.dataset.scenarioView = context.view || "create";
    rootElement.dataset.scenarioInternalView = activeView;
    i18n.setLocale(context.locale);
    activeComponent?.setLocale?.(context.locale);
  }

  function sameMapContextExceptLocale(previousMapContext, nextMapContext) {
    if (previousMapContext === nextMapContext) {
      return true;
    }
    if (!previousMapContext || !nextMapContext
      || typeof previousMapContext !== "object" || typeof nextMapContext !== "object") {
      return false;
    }
    const keys = new Set([
      ...Object.keys(previousMapContext),
      ...Object.keys(nextMapContext)
    ]);
    return [...keys].every((key) => key === "locale"
      || previousMapContext[key] === nextMapContext[key]);
  }

  async function resultForComponent(refresh = false) {
    if (!refresh && resultPayload(context)) {
      return resultPayload(context);
    }
    const response = await actions?.load_scenario_result?.({
      refresh,
      job_id: resultJobId || null,
      include: ["task", "result_summary", "engine_view"]
    });
    if (!response?.ok) {
      const error = response?.error || { code: "internal_error" };
      throw Object.assign(new Error(i18n.localizeError(error)), {
        code: error.code || "internal_error",
        params: error.params || {}
      });
    }
    return response.data;
  }

  async function deliverResult(refresh = false) {
    if (disposed || !activeComponent || activeView === "create") {
      return;
    }
    const payload = await resultForComponent(refresh);
    if (activeView === "map") {
      await activeComponent.applyGatewayResult?.(payload);
      return;
    }
    await activeComponent.applyGatewayResult?.(payload);
  }

  function createDraftRevision() {
    const value = Number(context?.create_context?.draft?.revision);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  function reportDraftImported(revision, accepted, message, fieldErrors = []) {
    lifecycleEvent(component, "scenario-draft-imported", {
      revision,
      accepted,
      message,
      field_errors: fieldErrors
    });
  }

  async function deliverCreateData() {
    if (disposed || !activeComponent?.applyGatewayCreateData) {
      return;
    }
    const revision = createDraftRevision();
    if (revision != null && revision === appliedDraftRevision) {
      return;
    }
    if (revision == null && createDataInitialized) {
      return;
    }
    try {
      const result = await activeComponent.applyGatewayCreateData(bridge.context.payload);
      createDataInitialized = true;
      if (revision != null) {
        appliedDraftRevision = revision;
        const resolution = result?.locationResolution || {};
        const suffix = Number(resolution.resolved || 0) > 0
          ? `，并自动补齐 ${resolution.resolved} 条地址或坐标`
          : "";
        reportDraftImported(revision, true, `JSON 草稿已导入场景表单${suffix}。`);
      }
    } catch (error) {
      if (revision != null) {
        reportDraftImported(revision, false, error?.message || "JSON 草稿无法导入当前场景。", []);
        return;
      }
      throw error;
    }
  }

  function render(view) {
    if (disposed) {
      return;
    }
    activeView = view;
    if (activeView === "create") {
      createDataInitialized = false;
      appliedDraftRevision = null;
    }
    activeComponent?.dispose?.();
    if (Alpine.destroyTree && rootElement.children.length) {
      Alpine.destroyTree(rootElement);
    }
    activeComponent = null;
    rootElement.innerHTML = (templates[view] || templates.create)
      .replace(/x-data="(?:scenarioDetailPage|solverJobDetailPage|solverJobMapPage)"/, "x-data=\"scenarioComponentPageData()\"");
    syncBridgeContext();
    Alpine.initTree(rootElement);
    i18n.translateTree();
  }

  function getScenarioDraft() {
    if (!activeComponent?.buildGatewayCreateRequest) {
      return null;
    }
    return activeComponent.buildGatewayCreateRequest(true);
  }

  function validateScenarioDraft() {
    if (!activeComponent?.validateGatewayCreate) {
      return { valid: false, errors: ["场景表单尚未初始化。"] };
    }
    try {
      const validation = activeComponent.validateGatewayCreate();
      return {
        valid: Boolean(validation?.valid),
        errors: Array.isArray(validation?.errors) ? validation.errors : []
      };
    } catch (error) {
      return { valid: false, errors: [error?.message || "场景参数校验失败。"] };
    }
  }

  function applyScenarioValidationErrors(fieldErrors) {
    activeComponent?.applyGatewayValidationErrors?.(Array.isArray(fieldErrors) ? fieldErrors : []);
  }

  function clearScenarioValidationErrors() {
    activeComponent?.clearGatewayValidationErrors?.();
  }

  async function replaceScenarioDraft(payload) {
    if (!activeComponent?.applyGatewayCreateData) {
      return;
    }
    const source = firstObject(payload) || null;
    const hasEnvelope = Boolean(source) && (
      Object.prototype.hasOwnProperty.call(source, "request_payload")
      || Object.prototype.hasOwnProperty.call(source, "expected_solve_duration")
      || Object.prototype.hasOwnProperty.call(source, "solve_options")
      || Object.prototype.hasOwnProperty.call(source, "constraint_overrides")
      || Object.prototype.hasOwnProperty.call(source, "scenario_persisted")
    );
    await activeComponent.applyGatewayCreateData(hasEnvelope ? source : { request_payload: source });
  }

  function openPlanningDrawer() {
    return activeComponent?.openPlanningDrawer?.() || false;
  }

  async function focusScenarioTicket(ticketId) {
    const normalizedTicketId = String(ticketId || "").trim();
    if (!normalizedTicketId || activeView !== "create" || typeof activeComponent?.focusTicket !== "function") {
      return { ticket_id: normalizedTicketId, focused: false };
    }
    return {
      ticket_id: normalizedTicketId,
      focused: Boolean(await activeComponent.focusTicket(normalizedTicketId))
    };
  }

  component.getScenarioDraft = getScenarioDraft;
  component.getScenarioOutline = () => activeComponent?.buildGatewayScenarioOutline?.() || null;
  component.validateScenarioDraft = validateScenarioDraft;
  component.applyScenarioValidationErrors = applyScenarioValidationErrors;
  component.clearScenarioValidationErrors = clearScenarioValidationErrors;
  component.replaceScenarioDraft = replaceScenarioDraft;
  component.openPlanningDrawer = openPlanningDrawer;
  component.focusScenarioTicket = focusScenarioTicket;
  component.refreshAvailableAgentTrend = () => activeComponent?.refreshAvailableAgentTrend?.() || Promise.resolve([]);
  component.clearAvailableAgentTrend = () => activeComponent?.clearAvailableAgentTrend?.();
  component.refreshScenarioResult = () => {
    if (activeView === "map") {
      return activeComponent?.loadJob?.({ notifyOnError: false }) || Promise.resolve();
    }
    return activeComponent?.refresh?.() || Promise.resolve();
  };
  component.getScenarioResult = () => activeComponent?.job || null;

  syncBridgeContext();
  window.VrpScenarioGateway = bridge;
  i18n.observe();
  render(activeView);

  const lifecycle = () => {
    disposed = true;
    disposeUiTooltips();
    window.dispatchEvent(new CustomEvent("vrp:scenario-detail-dispose"));
    window.dispatchEvent(new CustomEvent("vrp:solver-detail-dispose"));
    activeComponent?.dispose?.();
    if (Alpine.destroyTree && rootElement.children.length) {
      Alpine.destroyTree(rootElement);
    }
    if (window.VrpScenarioGateway === bridge) {
      window.VrpScenarioGateway = previousBridge;
    }
    i18n.disconnect();
    delete component.getScenarioDraft;
    delete component.getScenarioOutline;
    delete component.validateScenarioDraft;
    delete component.applyScenarioValidationErrors;
    delete component.clearScenarioValidationErrors;
    delete component.replaceScenarioDraft;
    delete component.openPlanningDrawer;
    delete component.focusScenarioTicket;
    delete component.refreshAvailableAgentTrend;
    delete component.clearAvailableAgentTrend;
    delete component.refreshScenarioResult;
    delete component.getScenarioResult;
  };

  lifecycle.updateContext = async (nextContext) => {
    const previousContext = context;
    const previousView = activeView;
    const previousJobId = resultJobId;
    context = nextContext || {};
    resultJobId = context?.result_job_id || context?.result_context?.task?.id || context?.result_context?.task?.job_id || resultJobId;
    syncBridgeContext();
    // A locale update only changes presentation.  In particular, do not reload
    // a result or replace a create draft: doing so can discard in-progress UI
    // state and violates the Host/Component locale-update contract.
    const localeOnly = previousView === activeView
      && previousJobId === resultJobId
      && previousContext?.view === context.view
      && sameMapContextExceptLocale(previousContext?.map_context, context.map_context)
      && previousContext?.create_context === context.create_context
      && previousContext?.result_context === context.result_context;
    if (localeOnly) {
      return;
    }
    if (context.view === "create" && activeComponent?.applyGatewayCreateData) {
      await deliverCreateData();
      return;
    }
    if (["result", "map"].includes(context.view)) {
      await deliverResult(false);
    }
  };

  return lifecycle;
}
