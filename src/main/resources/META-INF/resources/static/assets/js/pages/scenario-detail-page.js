import { copyText, deleteRequest, formatDuration, getJson, localizeRequestError, navigate, notify, postJson, putJson } from "../utils/api.js";
import {
  CONSTRAINT_LABELS,
  COST_FIELDS,
  buildRawPoi,
  buildScenarioPayload,
  defaultScenario,
  formatConstraintValue,
  normalizeScenarioForView,
  parseConstraintValue,
  parseLocationString,
  splitTags,
  todayString
} from "../utils/vrp-model.js";
import { ensureMap } from "../utils/map.js";
import { shouldShowFullValueTooltip } from "../utils/ui-tooltip.js";

const SKILL_TAG_TONE_CLASSES = Object.freeze([
  "border-emerald-200 bg-emerald-50 text-emerald-700",
  "border-sky-200 bg-sky-50 text-sky-700",
  "border-amber-200 bg-amber-50 text-amber-800",
  "border-violet-200 bg-violet-50 text-violet-700",
  "border-rose-200 bg-rose-50 text-rose-700",
  "border-teal-200 bg-teal-50 text-teal-700"
]);

export function skillTagToneClass(tag) {
  const normalized = String(tag || "").trim().normalize("NFKC").toLocaleLowerCase("en-US");
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return SKILL_TAG_TONE_CLASSES[(hash >>> 0) % SKILL_TAG_TONE_CLASSES.length];
}

function blankDepot() {
  return { id: "", name: "", address: "", city: "", loc: null };
}

function blankAgent() {
  return {
    id: "",
    depo_id: "",
    date: todayString(),
    name: "",
    start_address: "",
    start_city: "",
    start_loc: null,
    skills_text: "",
    qualification_text: "",
    weight: 0,
    vol: 0,
    vehicle_type: "CAR",
    fuel_type: "",
    fuel_consumption: "",
    rented: false,
    fix_cost_daily: "",
    shift_start_time_input: `${todayString()}T08:00`,
    shift_off_time_input: `${todayString()}T18:00`,
    max_ticket_num: 0
  };
}

function blankTicket() {
  return {
    id: "",
    depo_id: "",
    pinned: false,
    type: "Delv",
    address: "",
    city: "",
    loc: null,
    skills_text: "",
    dep_ticket_ids_text: "",
    ref_ticket_ids_text: "",
    weight: 0,
    vol: 0,
    min_start_time_input: `${todayString()}T09:00`,
    max_end_time_input: `${todayString()}T18:00`,
    duration_minutes: 15,
    agent: "",
    arrival_time: "",
    create_time_input: `${todayString()}T08:00`,
    qualification_text: ""
  };
}

function blankSku() {
  return { id: "", name: "", weight: 0, vol: 0 };
}

function gatewayBridge() {
  return window.VrpScenarioGateway || null;
}

function isGatewayScenarioMode() {
  return Boolean(gatewayBridge()?.isScenarioComponent);
}

function gatewayContextPayload() {
  return gatewayBridge()?.context?.payload || null;
}

function componentActions() {
  return gatewayBridge()?.actions || null;
}

function legacyPoiFromAddressCandidate(item, fallback = {}) {
  const coordinate = item?.coordinate || {};
  const lng = Number(coordinate.lng);
  const lat = Number(coordinate.lat);
  const location = Number.isFinite(lng) && Number.isFinite(lat) ? `${lng},${lat}` : "";
  return {
    id: item?.candidate_id || fallback.id || "",
    name: item?.name || fallback.name || "",
    address: item?.formatted_address || fallback.address || "",
    location,
    pname: item?.address_components?.province || fallback.pname || "",
    cityname: item?.address_components?.city || fallback.cityname || "",
    adname: item?.address_components?.district || fallback.adname || "",
    adcode: item?.address_components?.adcode || fallback.adcode || ""
  };
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || null;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeGatewayCreateInput(input) {
  const source = firstObject(input?.payload, input?.data, input) || {};
  const requestPayload = firstObject(
    source.request_payload,
    source.requestPayload,
    source.scenario,
    source.scenario_payload,
    source.scenarioPayload,
    source
  );
  const solveOptions = firstObject(
    source.solve_options,
    source.solveOptions,
    source.options,
    requestPayload?.options
  ) || {};
  const expectedDuration = source.expected_solve_duration
    || source.expectedSolveDuration
    || solveOptions.solve_time
    || solveOptions.solveTime
    || null;
  const constraintOverrides = firstObject(
    source.constraint_overrides,
    source.constraintOverrides
  ) || {};
  return {
    requestPayload,
    solveOptions,
    expectedDuration,
    constraintOverrides
  };
}

function parseGatewaySolveDuration(value) {
  const text = String(value || "").trim();
  const match = text.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) {
    return null;
  }
  if (match[1]) {
    return { value: Number(match[1]), unit: "H" };
  }
  if (match[2]) {
    return { value: Number(match[2]), unit: "M" };
  }
  return { value: Number(match[3] || 0), unit: "S" };
}

function coerceGatewayBoolean(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(text)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(text)) {
    return false;
  }
  return fallback;
}

function hasAnyValue(row, fields) {
  return fields.some((field) => {
    const value = row?.[field];
    if (value == null) {
      return false;
    }
    if (typeof value === "string") {
      return value.trim() !== "";
    }
    if (typeof value === "object") {
      return Boolean(value.id || value.location || value.loc || value.address || value.name);
    }
    return value !== "";
  });
}

function validationError(path, code, message) {
  return { path, code, message };
}

function collectDuplicateIdErrors(rows, label, meaningfulFields, pathPrefix, errors) {
  const seen = new Map();
  safeArrayForValidation(rows).forEach((row, index) => {
    const meaningful = hasAnyValue(row, meaningfulFields);
    const id = String(row?.id || "").trim();
    if (meaningful && !id) {
      errors.push(validationError(`${pathPrefix}[${index}].id`, "REQUIRED", `${label}第 ${index + 1} 行缺少 ID。`));
      return;
    }
    if (!id) {
      return;
    }
    if (seen.has(id)) {
      errors.push(validationError(`${pathPrefix}[${index}].id`, "DUPLICATE", `${label} ID 重复（第 ${seen.get(id) + 1} 行和第 ${index + 1} 行）。`));
      return;
    }
    seen.set(id, index);
  });
}

function safeArrayForValidation(value) {
  return Array.isArray(value) ? value : [];
}

function collectNonNegativeNumberErrors(rows, label, fields, pathPrefix, errors) {
  safeArrayForValidation(rows).forEach((row, rowIndex) => {
    fields.forEach(([field, fieldLabel]) => {
      const value = row?.[field];
      if (value == null || value === "") {
        return;
      }
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue) || numberValue < 0) {
        errors.push(validationError(`${pathPrefix}[${rowIndex}].${field}`, "OUT_OF_RANGE", `${label}第 ${rowIndex + 1} 行的${fieldLabel}必须为非负数字。`));
      }
    });
  });
}

function collectJsonObjectErrors(rows, label, fields, pathPrefix, errors) {
  safeArrayForValidation(rows).forEach((row, rowIndex) => {
    fields.forEach(([field, fieldLabel]) => {
      const text = String(row?.[field] || "").trim();
      if (!text) {
        return;
      }
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          errors.push(validationError(`${pathPrefix}[${rowIndex}].${field}`, "TYPE_MISMATCH", `${label}第 ${rowIndex + 1} 行的${fieldLabel}必须是 JSON 对象。`));
        }
      } catch (_error) {
        errors.push(validationError(`${pathPrefix}[${rowIndex}].${field}`, "FORMAT_INVALID", `${label}第 ${rowIndex + 1} 行的${fieldLabel}不是合法 JSON。`));
      }
    });
  });
}

function isConstraintScoreText(value) {
  return /^-?\d+hard\/-?\d+medium\/-?\d+soft$/i.test(String(value || "").trim());
}

const DEFAULT_MAP_CENTER = [116.397428, 39.90923];

function coordinatePoiId(location) {
  return `manual_${String(location || "").replace(/[^\d.,-]/g, "").replace(/[^\d-]+/g, "_")}`;
}

function poiLocationText(poi) {
  if (!poi) {
    return "";
  }
  if (poi.location) {
    return poi.location;
  }
  const loc = poi.loc || poi.entr_loc;
  if (loc?.lat != null && loc?.lon != null) {
    return `${loc.lon},${loc.lat}`;
  }
  return "";
}

async function reverseGeocodeByServer(location) {
  const coords = parseLocationString(location);
  if (!coords) {
    return null;
  }
  const actions = componentActions();
  if (actions?.resolve_coordinate_address) {
    const [lng, lat] = coords;
    const response = await actions.resolve_coordinate_address({
      points: [{ point_id: coordinatePoiId(location), lng, lat }],
      options: { language: "zh-CN", include_components: true }
    });
    if (!response?.ok) {
      throw Object.assign(new Error(localizeRequestError(response?.error)), response?.error || {});
    }
    const item = response.data?.items?.[0];
    if (!item || item.status !== "resolved") {
      throw new Error(item?.message || "坐标逆解析失败");
    }
    const poi = legacyPoiFromAddressCandidate(item, { location });
    const address = poi.address || poi.name || location;
    const city = poi.cityname || poi.adname || poi.pname || "";
    return { address, city, poi: buildCoordinatePoi(location, poi, address, city) };
  }
  const poi = await getJson(`/pois/regeocode?location=${encodeURIComponent(location)}`);
  if (!poi || typeof poi !== "object") {
    throw new Error("坐标逆解析失败");
  }
  const address = poi.address || poi.name || location;
  const city = poi.cityname || poi.adname || poi.pname || "";
  return {
    address,
    city,
    poi: buildCoordinatePoi(location, poi, address, city)
  };
}

async function reverseGeocode(location) {
  return reverseGeocodeByServer(location);
}

async function searchPoiCandidates(keywords, city = "") {
  const keyword = String(keywords || "").trim();
  if (!keyword) {
    return [];
  }

  const actions = componentActions();
  if (actions?.search_text_address) {
    const response = await actions.search_text_address({ keyword, city, limit: 20 });
    if (!response?.ok) {
      throw Object.assign(new Error(localizeRequestError(response?.error)), response?.error || {});
    }
    return (response.data?.candidates || []).map((item) => legacyPoiFromAddressCandidate(item));
  }

  const searchRequests = city
    ? [
        `/pois?keywords=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city)}&page=1`,
        `/pois?keywords=${encodeURIComponent(keyword)}&city=&page=1`
      ]
    : [`/pois?keywords=${encodeURIComponent(keyword)}&city=&page=1`];

  for (const requestUrl of searchRequests) {
    try {
      const result = await getJson(requestUrl);
      if (Array.isArray(result) && result.length) {
        return result;
      }
    } catch (_error) {
    }
  }

  let geocodeError = null;
  try {
    const geocodeResult = await getJson(`/pois/geocode?keywords=${encodeURIComponent(keyword)}&city=${encodeURIComponent(city || "")}`);
    if (Array.isArray(geocodeResult) && geocodeResult.length) {
      return geocodeResult;
    }
  } catch (error) {
    geocodeError = error;
  }

  if (geocodeError) {
    throw geocodeError;
  }

  return [];
}

function buildCoordinatePoi(location, basePoi = {}, address = "", city = "") {
  const coords = parseLocationString(location);
  if (!coords) {
    return {
      ...basePoi,
      id: basePoi.id || coordinatePoiId(location),
      location
    };
  }
  const [lng, lat] = coords;
  return {
    ...basePoi,
    id: basePoi.id || coordinatePoiId(`${lng},${lat}`),
    location: `${lng},${lat}`,
    loc: {
      lat,
      lon: lng
    },
    entr_location: `${lng},${lat}`,
    entr_loc: {
      lat,
      lon: lng
    },
    address: address || basePoi.address || "",
    cityname: city || basePoi.cityname || ""
  };
}

function missingText(value) {
  return value == null || String(value).trim() === "";
}

function mergeMissingPoi(existing, resolved) {
  const target = plainObject(existing) ? { ...existing } : {};
  const source = plainObject(resolved) ? resolved : {};
  Object.entries(source).forEach(([key, value]) => {
    if (value == null || value === "") {
      return;
    }
    if (missingText(target[key])) {
      target[key] = value;
    }
  });
  return target;
}

export function scenarioDetailPage() {
  return {
    loading: true,
    saving: false,
    error: "",
    gatewayMode: false,
    showScenarioOverview: false,
    showAvailableAgentTrend: false,
    gatewayDirty: false,
    gatewayInitialSignature: "",
    gatewayDirtyTimer: null,
    adaptiveTableFitFrame: 0,
    adaptiveTableFitRequest: 0,
    adaptiveTableResizeObserver: null,
    adaptiveTableObservedContainer: null,
    gatewayReadinessSignature: "",
    gatewayValidationErrors: [],
    validationSummaryDismissed: false,
    configTab: "depos",
    scenario: defaultScenario(),
    scenarioPersisted: true,
    scenarioPersistedProvided: false,
    pendingScenarioReplace: false,
    availableAgentWindows: [],
    availableAgentTrendRequest: 0,
    activeSidebarPanel: "overview",
    sidebarCollapsed: false,
    solveTimeValue: 30,
    solveTimeUnit: "S",
    buildTransitMatrix: true,
    drawRoute: false,
    matrixMode: "MANHATTAN",
    planningDrawer: {
      open: false
    },
    hoveredJobId: "",
    hoveredJobTooltip: {
      left: 0,
      top: 0
    },
    hoveredJobHideTimer: null,
    locationResolutionCache: new Map(),
    locationResolutionStates: new WeakMap(),
    locationResolutionVersion: 0,
    highlightedTicketId: "",
    pendingTicketJumpScheduled: false,
    gatewayServerValidationErrors: [],
    gatewayValidationFocus: { path: "", tab: "", rowIndex: -1 },
    flash: { tone: "info", message: "" },
    flashTimer: null,
    editingCell: {
      tab: "",
      rowIndex: -1,
      field: "",
      type: "text",
      draftValue: ""
    },
    skillsEditor: {
      open: false,
      title: "编辑技能",
      row: null,
      value: ""
    },
    descriptionEditor: {
      open: false,
      value: ""
    },
    mapPicker: {
      open: false,
      title: "地图选点",
      targetRow: null,
      addressField: "",
      cityField: "",
      locField: "",
      targetCity: "",
      keyword: "",
      searchResults: [],
      selectedPoi: null,
      resolvedAddress: "",
      resolvedCity: "",
      loading: false,
      error: "",
      mapUnavailable: false,
      map: null,
      marker: null
    },
    costFields: COST_FIELDS,
    async init() {
      this.gatewayMode = isGatewayScenarioMode();
      if (this.gatewayMode) {
        const componentContext = gatewayBridge()?.context || {};
        this.showScenarioOverview = Object.prototype.hasOwnProperty.call(componentContext, "scenario_overview");
        this.showAvailableAgentTrend = Object.prototype.hasOwnProperty.call(componentContext, "available_agent_trend");
        this.loading = false;
        this.configTab = "depos";
        this.applyGatewayCreateData(gatewayContextPayload());
        this.markGatewayPristine();
        this.startGatewayDirtyWatch();
        gatewayBridge()?.registerComponent?.("create", this);
      }
    },
    dispose() {
      this.stopGatewayDirtyWatch();
      if (this.adaptiveTableFitFrame && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(this.adaptiveTableFitFrame);
        this.adaptiveTableFitFrame = 0;
      }
      this.adaptiveTableFitRequest += 1;
      this.adaptiveTableResizeObserver?.disconnect?.();
      this.adaptiveTableResizeObserver = null;
      this.adaptiveTableObservedContainer = null;
      this.closePlanningDrawer();
      this.closeSkillsEditor();
      this.closeDescriptionEditor();
      this.closeMapPicker();
      this.mapPicker.marker?.setMap?.(null);
      this.mapPicker.map?.clearMap?.();
      this.mapPicker.map?.destroy?.();
      this.mapPicker.map = null;
      this.mapPicker.marker = null;
    },
    applyGatewayCreateData(input) {
      if (plainObject(input) && Object.prototype.hasOwnProperty.call(input, "scenario_persisted")) {
        this.scenarioPersisted = Boolean(input.scenario_persisted);
        this.scenarioPersistedProvided = true;
      }
      const { requestPayload, solveOptions, expectedDuration, constraintOverrides } = normalizeGatewayCreateInput(input);
      if (requestPayload?.plan || requestPayload?.name || requestPayload?.planning_date) {
        this.scenario = normalizeScenarioForView(requestPayload);
      } else {
        this.scenario = defaultScenario();
      }
      if (Object.keys(constraintOverrides).length) {
        this.scenario.plan = this.scenario.plan || {};
        this.scenario.plan.constraint_configuration = {
          ...(this.scenario.plan.constraint_configuration || {}),
          ...constraintOverrides
        };
      }

      const duration = parseGatewaySolveDuration(expectedDuration);
      if (duration && duration.value > 0) {
        this.solveTimeValue = duration.value;
        this.solveTimeUnit = duration.unit;
      }
      this.matrixMode = String(solveOptions.matrix_mode || solveOptions.matrixMode || this.matrixMode || "MANHATTAN").toUpperCase();
      if (this.matrixMode === "AMAP") this.matrixMode = "ROUTING";
      this.buildTransitMatrix = coerceGatewayBoolean(solveOptions.build_transit_matrix ?? solveOptions.buildTransitMatrix, this.buildTransitMatrix);
      this.drawRoute = coerceGatewayBoolean(solveOptions.draw_route ?? solveOptions.drawRoute, this.drawRoute);
      this.gatewayValidationErrors = [];
      this.gatewayServerValidationErrors = [];
      this.validationSummaryDismissed = false;
      this.gatewayValidationFocus = { path: "", tab: "", rowIndex: -1 };
      this.markGatewayPristine();
      gatewayBridge()?.scheduleResize?.();
      this.scheduleAdaptiveTableFit("depos");
    },
    gatewayExpectedSolveDuration() {
      return `PT${Math.max(1, Number(this.solveTimeValue || 1))}${this.solveTimeUnit || "S"}`;
    },
    gatewayScenarioSignature() {
      return JSON.stringify({
        scenario: buildScenarioPayload(this.scenario || {}),
        constraint_overrides: this.buildConstraintOverrides()
      });
    },
    markGatewayPristine() {
      if (!this.gatewayMode) {
        return;
      }
      this.gatewayInitialSignature = this.gatewayScenarioSignature();
      this.gatewayDirty = false;
      this.gatewayReadinessSignature = this.gatewayInitialSignature;
      gatewayBridge()?.notifyDirty?.(false);
      gatewayBridge()?.notifyCreateReadiness?.(this.canSolveCurrentScenario());
    },
    syncGatewayDirtyState() {
      if (!this.gatewayMode) {
        return;
      }
      const signature = this.gatewayScenarioSignature();
      if (signature !== this.gatewayReadinessSignature) {
        this.gatewayReadinessSignature = signature;
        gatewayBridge()?.notifyCreateReadiness?.(this.canSolveCurrentScenario());
      }
      const dirty = signature !== this.gatewayInitialSignature;
      if (dirty === this.gatewayDirty) {
        return;
      }
      this.gatewayDirty = dirty;
      gatewayBridge()?.notifyDirty?.(dirty);
    },
    startGatewayDirtyWatch() {
      if (!this.gatewayMode || this.gatewayDirtyTimer) {
        return;
      }
      this.gatewayDirtyTimer = window.setInterval(() => this.syncGatewayDirtyState(), 350);
    },
    stopGatewayDirtyWatch() {
      if (!this.gatewayDirtyTimer) {
        return;
      }
      window.clearInterval(this.gatewayDirtyTimer);
      this.gatewayDirtyTimer = null;
    },
    buildConstraintOverrides() {
      return Object.fromEntries(
        this.constraintEntries()
          .filter(([key, value]) => key !== "name" && String(value || "").trim())
      );
    },
    buildGatewayCreateRequest(commit = true) {
      if (commit && !this.commitEditingCell()) {
        return null;
      }
      const requestPayload = buildScenarioPayload(this.scenario || {});
      requestPayload.options = {
        build_transit_matrix: Boolean(this.buildTransitMatrix),
        matrix_mode: this.matrixMode || "MANHATTAN",
        draw_route: Boolean(this.drawRoute)
      };
      return {
        expected_solve_duration: this.gatewayExpectedSolveDuration(),
        request_payload: requestPayload,
        constraint_overrides: this.buildConstraintOverrides()
      };
    },
    validateGatewayCreate() {
      if (!this.commitEditingCell()) {
        return {
          valid: false,
          errors: [validationError("request_payload.plan", "FORMAT_INVALID", this.t("scenario.coordinateFormatError"))]
        };
      }
      const errors = [];
      const scenario = this.scenario || {};
      const plan = scenario.plan || {};
      if (!this.hasMeaningfulScenarioDraft()) {
        errors.push(validationError("request_payload", "EMPTY_SCENARIO", "请至少填写场景描述、修改场景名称，或维护一条仓库、车辆/工程师、工单或 SKU 数据。"));
      }
      if (!String(scenario.name || "").trim()) {
        errors.push(validationError("request_payload.name", "REQUIRED", "场景名称不能为空。"));
      }
      if (!String(scenario.planning_date || "").trim()) {
        errors.push(validationError("request_payload.planning_date", "REQUIRED", "规划日期不能为空。"));
      }
      const startTime = scenario.start_time_input ? new Date(scenario.start_time_input) : null;
      const endTime = scenario.end_time_input ? new Date(scenario.end_time_input) : null;
      if (!scenario.start_time_input) {
        errors.push(validationError("request_payload.start_time", "REQUIRED", "开始时间不能为空。"));
      }
      if (!scenario.end_time_input) {
        errors.push(validationError("request_payload.end_time", "REQUIRED", "结束时间不能为空。"));
      }
      if (startTime && endTime && !Number.isNaN(startTime.getTime()) && !Number.isNaN(endTime.getTime()) && startTime >= endTime) {
        errors.push(validationError("request_payload.end_time", "OUT_OF_RANGE", "结束时间必须晚于开始时间。"));
      }
      if (!Number.isFinite(Number(this.solveTimeValue)) || Number(this.solveTimeValue) <= 0) {
        errors.push(validationError("expected_solve_duration", "OUT_OF_RANGE", "求解时间必须为正数。"));
      }
      if (!["S", "M", "H"].includes(String(this.solveTimeUnit || "").toUpperCase())) {
        errors.push(validationError("expected_solve_duration", "FORMAT_INVALID", "求解时间单位仅支持秒、分钟或小时。"));
      }
      if (!["ROUTING", "MANHATTAN"].includes(String(this.matrixMode || "").toUpperCase())) {
        errors.push(validationError("request_payload.options.matrix_mode", "ENUM_MISMATCH", this.t("scenario.validation.invalidMatrixMode")));
      }

      collectDuplicateIdErrors(plan.depos, "仓库", ["id", "name", "address", "city", "loc"], "request_payload.plan.depos", errors);
      collectDuplicateIdErrors(plan.agents, "车辆/工程师", ["id", "name", "start_address", "start_city", "start_loc"], "request_payload.plan.agents", errors);
      collectDuplicateIdErrors(plan.tickets, "工单", ["id", "address", "city", "loc"], "request_payload.plan.tickets", errors);
      collectDuplicateIdErrors(plan.skus, "SKU", ["id", "name"], "request_payload.plan.skus", errors);

      collectNonNegativeNumberErrors(plan.agents, "车辆/工程师", [
        ["weight", "载重"],
        ["vol", "容积"],
        ["fuel_consumption", "油耗/电耗"],
        ["fix_cost_daily", "每日出车费"],
        ["max_ticket_num", "最大接单量"]
      ], "request_payload.plan.agents", errors);
      collectNonNegativeNumberErrors(plan.tickets, "工单", [
        ["weight", "重量"],
        ["vol", "体积"],
        ["duration_minutes", "服务时长"]
      ], "request_payload.plan.tickets", errors);
      collectNonNegativeNumberErrors(plan.skus, "SKU", [
        ["weight", "重量"],
        ["vol", "体积"]
      ], "request_payload.plan.skus", errors);
      collectNonNegativeNumberErrors([plan.cost_parameter || {}], "成本参数", COST_FIELDS, "request_payload.plan.cost_parameter", errors);
      collectJsonObjectErrors(plan.agents, "车辆/工程师", [["qualification_text", "技能等级"]], "request_payload.plan.agents", errors);
      collectJsonObjectErrors(plan.tickets, "工单", [["qualification_text", "需求技能等级"]], "request_payload.plan.tickets", errors);
      this.constraintEntries().forEach(([key, value]) => {
        if (this.isConstraintWeightEntry(key) && !isConstraintScoreText(value)) {
          errors.push(validationError(`constraint_overrides.${key}`, "FORMAT_INVALID", `${this.humanConstraintLabel(key)} 的约束值格式应为 Nhard/Nmedium/Nsoft。`));
        }
      });

      this.gatewayServerValidationErrors = [];
      this.gatewayValidationErrors = errors;
      this.validationSummaryDismissed = false;
      if (errors.length) {
        this.showFlash(`创建参数校验失败：${this.formatValidationError(errors[0])}`, "danger");
      } else {
        this.clearFlash();
      }
      gatewayBridge()?.scheduleResize?.();
      return {
        valid: errors.length === 0,
        errors
      };
    },
    validationErrors() {
      return [...this.gatewayServerValidationErrors, ...this.gatewayValidationErrors];
    },
    validationErrorKey(error, index) {
      return `${error?.path || "validation"}-${error?.code || "FAILED"}-${index}`;
    },
    validationSummaryTitle() {
      const count = this.validationErrors().length;
      return count === 1
        ? this.t("scenario.validation.singleTitle")
        : this.t("scenario.validation.multipleTitle", { count });
    },
    validationErrorMessage(error) {
      if (typeof error === "string") {
        return error;
      }
      return error?.message || this.t("scenario.validation.fallbackMessage");
    },
    formatValidationError(error) {
      return this.validationErrorMessage(error);
    },
    dismissValidationSummary() {
      this.validationSummaryDismissed = true;
      gatewayBridge()?.scheduleResize?.();
    },
    applyGatewayValidationErrors(fieldErrors) {
      this.gatewayValidationErrors = [];
      this.gatewayServerValidationErrors = safeArrayForValidation(fieldErrors)
        .filter((item) => item && typeof item === "object")
        .map((item) => validationError(String(item.path || ""), String(item.code || "VALIDATION_FAILED"), String(item.message || "字段校验失败")));
      this.validationSummaryDismissed = false;
      const target = this.validationTarget(this.gatewayServerValidationErrors[0]?.path || "");
      this.gatewayValidationFocus = target;
      if (target.tab) {
        this.configTab = target.tab;
        window.setTimeout(() => this.revealValidationTarget(target), 0);
      }
      if (this.gatewayServerValidationErrors.length) {
        this.showFlash(`创建参数校验失败：${this.formatValidationError(this.gatewayServerValidationErrors[0])}`, "danger");
      }
      gatewayBridge()?.scheduleResize?.();
    },
    clearGatewayValidationErrors() {
      this.gatewayServerValidationErrors = [];
      this.validationSummaryDismissed = false;
      this.gatewayValidationFocus = { path: "", tab: "", rowIndex: -1 };
      gatewayBridge()?.scheduleResize?.();
    },
    validationTarget(path) {
      const row = /^request_payload\.plan\.(depos|agents|tickets|skus)\[(\d+)\]/.exec(String(path || ""));
      if (row) {
        return { path, tab: row[1], rowIndex: Number(row[2]) };
      }
      if (String(path).startsWith("request_payload.plan.cost_parameter")) {
        return { path, tab: "cost_parameter", rowIndex: -1 };
      }
      if (String(path).startsWith("constraint_overrides.")) {
        return { path, tab: "constraints", rowIndex: -1 };
      }
      return { path, tab: "", rowIndex: -1 };
    },
    validationRowClass(tab, index, baseClass = "") {
      return [baseClass, this.gatewayValidationFocus.tab === tab && this.gatewayValidationFocus.rowIndex === index ? "bg-rose-50" : ""]
        .filter(Boolean)
        .join(" ");
    },
    validationInputClass(path) {
      return this.gatewayValidationFocus.path === path ? "bg-rose-50" : "";
    },
    revealValidationTarget(target) {
      if (!target?.tab || target.rowIndex < 0) {
        return;
      }
      this.$root?.querySelector?.(`[data-validation-row="${target.tab}:${target.rowIndex}"]`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    },
    hasDisplayValue(value) {
      return value !== null && value !== undefined && String(value).trim() !== "";
    },
    displayValue(value, fallback = "--") {
      return this.hasDisplayValue(value) ? String(value) : fallback;
    },
    displayDateTime(value, fallback = "--") {
      if (!this.hasDisplayValue(value)) {
        return fallback;
      }
      return String(value).replace("T", " ");
    },
    splitDateTime(value) {
      const normalized = this.displayDateTime(value, "--");
      if (normalized === "--") {
        return { date: "--", time: "--" };
      }
      const [date = "--", time = "--"] = normalized.split(" ", 2);
      return { date, time };
    },
    displayBoolean(value, trueText = "是", falseText = "否") {
      if (trueText === "租用" && falseText === "自有") {
        return this.t(value ? "scenario.rented" : "scenario.owned");
      }
      return value ? this.t("boolean.yes") : this.t("boolean.no");
    },
    hasMeaningfulScenarioDraft() {
      const plan = this.scenario?.plan || {};
      const hasRows = (rows, keys) => Array.isArray(rows) && rows.some((row) =>
        keys.some((key) => this.hasDisplayValue(row?.[key]))
      );
      return this.hasDisplayValue(this.scenario?.desc)
        || (this.hasDisplayValue(this.scenario?.name) && this.scenario.name !== "未命名场景")
        || hasRows(plan.depos, ["id", "name", "address", "city"])
        || hasRows(plan.agents, ["id", "depo_id", "name", "start_address", "start_city"])
        || hasRows(plan.tickets, ["id", "depo_id", "address", "city", "agent"])
        || hasRows(plan.skus, ["id", "name"]);
    },
    canSolveCurrentScenario() {
      return Boolean(this.scenario?.id) || this.hasMeaningfulScenarioDraft();
    },
    displayOptionalBoolean(value, trueText = "是", falseText = "否") {
      if (value == null) {
        return "--";
      }
      return this.displayBoolean(value, trueText, falseText);
    },
    displaySolveTime(value) {
      return formatDuration(value, this.locale);
    },
    displayMatrixMode(value) {
      const normalized = String(value || "").trim().toUpperCase();
      if (normalized === "MANHATTAN") {
        return "manhattan";
      }
      if (normalized === "AMAP" || normalized === "ROUTING") {
        return "routing";
      }
      return normalized || "--";
    },
    currentMapProvider() {
      const configured = this.scenario?.map_provider ?? this.scenario?.mapProvider;
      const provider = String(configured ?? gatewayBridge()?.context?.map_context?.provider ?? "").trim().toUpperCase();
      return ["AMAP", "HERE"].includes(provider) ? provider : "";
    },
    routingMatrixModeLabel() {
      const provider = this.currentMapProvider();
      if (provider === "HERE") {
        return "Here";
      }
      if (provider === "AMAP") {
        return "Amap";
      }
      return "Routing";
    },
    agentDisplayText(agentId) {
      const rawId = String(agentId || "").trim();
      if (!rawId) {
        return "--";
      }
      const agent = this.scenario.plan.agents.find((item) => item.id === rawId);
      const name = String(agent?.name || "").trim();
      if (name) {
        return name;
      }
      return rawId;
    },
    agentDisplayTitle(agentId) {
      const rawId = String(agentId || "").trim();
      if (!rawId) {
        return "--";
      }
      const agent = this.scenario.plan.agents.find((item) => item.id === rawId);
      const name = String(agent?.name || "").trim();
      if (!name || name === rawId) {
        return rawId;
      }
      return `${name} (${rawId})`;
    },
    locationPreview(row, locField) {
      if (!row) {
        return "--";
      }
      const preview = locField === "start_loc" ? row.start_location : row.poi_location;
      return preview || poiLocationText(row[locField]) || "--";
    },
    adaptiveColumnLengthPixels(value) {
      const text = String(value || "").trim();
      const number = Number.parseFloat(text);
      if (!Number.isFinite(number)) {
        return 0;
      }
      if (text.endsWith("rem")) {
        const rootSize = typeof window !== "undefined"
          ? Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize)
          : 16;
        return number * (Number.isFinite(rootSize) ? rootSize : 16);
      }
      return number;
    },
    fitAdaptiveTableColumns(tab = this.configTab) {
      const table = this.$root?.querySelector?.(`[data-adaptive-table="${tab}"]`);
      if (!table) {
        return false;
      }
      const columns = Array.from(table.querySelectorAll("colgroup > col"));
      const headerCells = Array.from(table.tHead?.rows?.[0]?.cells || []);
      if (!columns.length || headerCells.length !== columns.length) {
        return false;
      }

      table.dataset.columnsFitted = "false";
      table.style.width = "max-content";
      columns.forEach((column) => {
        column.style.width = column.dataset.columnMin || "";
      });

      // 先恢复自动布局并读取每列的内容宽度，再把结果钳制在该列声明的范围内。
      void table.offsetWidth;
      const minimumWidths = columns.map((column) => this.adaptiveColumnLengthPixels(column.dataset.columnMin));
      const maximumWidths = columns.map((column, index) => this.adaptiveColumnLengthPixels(column.dataset.columnMax) || minimumWidths[index]);
      const growWeights = columns.map((column) => Math.max(0, Number(column.dataset.columnGrow || 0)));
      const desiredWidths = headerCells.map((cell, index) => {
        return Math.min(maximumWidths[index], Math.max(minimumWidths[index], cell.getBoundingClientRect().width));
      });

      const availableWidth = table.parentElement?.clientWidth || 0;
      const minimumTotalWidth = minimumWidths.reduce((total, width) => total + width, 0);
      const desiredTotalWidth = desiredWidths.reduce((total, width) => total + width, 0);
      let widths = desiredWidths.slice();
      let remainingWidth = Math.max(0, availableWidth - desiredTotalWidth);

      const distributeWidth = (targetWidths, weights) => {
        while (remainingWidth > 0.5) {
          const growable = widths
            .map((width, index) => ({ index, capacity: targetWidths[index] - width, weight: weights[index] }))
            .filter((item) => item.capacity > 0.5 && item.weight > 0);
          const totalWeight = growable.reduce((total, item) => total + item.weight, 0);
          if (!growable.length || totalWeight <= 0) {
            break;
          }
          let distributed = 0;
          growable.forEach((item) => {
            const share = remainingWidth * (item.weight / totalWeight);
            const delta = Math.min(item.capacity, share);
            widths[item.index] += delta;
            distributed += delta;
          });
          if (distributed <= 0.5) {
            break;
          }
          remainingWidth -= distributed;
        }
      };

      if (availableWidth > minimumTotalWidth && availableWidth < desiredTotalWidth) {
        // 内容期望宽度超过视口时，从最小宽度开始，优先满足仍被截断的高权重信息列。
        widths = minimumWidths.slice();
        remainingWidth = availableWidth - minimumTotalWidth;
        distributeWidth(desiredWidths, growWeights.map((weight) => weight || 1));
      } else if (availableWidth >= desiredTotalWidth) {
        // 内容均已获得所需宽度后，剩余空间只分给显式声明可扩展的语义列。
        distributeWidth(maximumWidths, growWeights);
      }

      columns.forEach((column, index) => {
        column.style.width = `${widths[index]}px`;
      });
      table.style.width = `${widths.reduce((total, width) => total + width, 0)}px`;
      table.dataset.columnsFitted = "true";
      const container = table.parentElement;
      if (container && typeof window !== "undefined" && typeof window.ResizeObserver === "function" && container !== this.adaptiveTableObservedContainer) {
        this.adaptiveTableResizeObserver?.disconnect?.();
        this.adaptiveTableResizeObserver = new window.ResizeObserver(() => this.scheduleAdaptiveTableFit(this.configTab));
        this.adaptiveTableResizeObserver.observe(container);
        this.adaptiveTableObservedContainer = container;
      }
      return true;
    },
    scheduleAdaptiveTableFit(tab = this.configTab) {
      if (typeof this.$nextTick !== "function" || typeof window === "undefined") {
        return;
      }
      const request = ++this.adaptiveTableFitRequest;
      this.$nextTick(() => {
        if (request !== this.adaptiveTableFitRequest) {
          return;
        }
        if (typeof window.requestAnimationFrame !== "function") {
          this.fitAdaptiveTableColumns(tab);
          return;
        }
        if (this.adaptiveTableFitFrame) {
          window.cancelAnimationFrame?.(this.adaptiveTableFitFrame);
        }
        const frame = window.requestAnimationFrame(() => {
          if (this.adaptiveTableFitFrame === frame) {
            this.adaptiveTableFitFrame = 0;
          }
          if (request !== this.adaptiveTableFitRequest) {
            return;
          }
          this.fitAdaptiveTableColumns(tab);
        });
        this.adaptiveTableFitFrame = frame;
      });
    },
    onLocaleChanged() {
      this.scheduleAdaptiveTableFit(this.configTab);
    },
    inlineEditorToken(tab, rowIndex, field) {
      return `${tab}:${rowIndex}:${field}`;
    },
    isEditingCell(tab, rowIndex, field) {
      return this.editingCell.tab === tab && this.editingCell.rowIndex === rowIndex && this.editingCell.field === field;
    },
    normalizeEditingValue(value, type = "text") {
      if (type === "checkbox") {
        return Boolean(value);
      }
      if (value === null || value === undefined) {
        return "";
      }
      return value;
    },
    coerceEditingValue(value, type = "text") {
      if (type === "number") {
        const raw = String(value ?? "").trim();
        return raw === "" ? 0 : Number(raw);
      }
      if (type === "checkbox") {
        return value === true || value === "true" || value === 1 || value === "1";
      }
      return value;
    },
    resetEditingCell() {
      this.editingCell = {
        tab: "",
        rowIndex: -1,
        field: "",
        type: "text",
        draftValue: ""
      };
    },
    beginCellEdit(tab, rowIndex, field, type = "text") {
      if (this.isEditingCell(tab, rowIndex, field)) {
        return;
      }
      if (!this.commitEditingCell()) {
        return;
      }
      const row = this.rowsForTab(tab)?.[rowIndex];
      if (!row) {
        return;
      }
      this.editingCell = {
        tab,
        rowIndex,
        field,
        type,
        draftValue: this.normalizeEditingValue(row[field], type)
      };
      // Alpine's $root magic is not available when this method is called from
      // the embedded component's Shadow DOM. Capture the containing root while
      // the clicked button is still focused so the deferred lookup stays local.
      const editorRoot = this.$root?.getRootNode?.() || document.activeElement?.shadowRoot || document;
      this.$nextTick(() => {
        window.requestAnimationFrame(() => {
          if (!this.isEditingCell(tab, rowIndex, field)) {
            return;
          }
          const token = this.inlineEditorToken(tab, rowIndex, field);
          const editor = editorRoot?.querySelector?.(`[data-inline-editor="${token}"]`);
          editor?.focus?.();
          editor?.select?.();
        });
      });
    },
    beginCoordinateEdit(tab, rowIndex, locField) {
      if (this.isEditingCell(tab, rowIndex, locField)) {
        return;
      }
      if (!this.commitEditingCell()) {
        return;
      }
      const row = this.rowsForTab(tab)?.[rowIndex];
      if (!row) {
        return;
      }
      this.editingCell = {
        tab,
        rowIndex,
        field: locField,
        type: "coordinate",
        draftValue: poiLocationText(row[locField])
      };
      const editorRoot = this.$root?.getRootNode?.() || document.activeElement?.shadowRoot || document;
      this.$nextTick(() => {
        window.requestAnimationFrame(() => {
          if (!this.isEditingCell(tab, rowIndex, locField)) {
            return;
          }
          const token = this.inlineEditorToken(tab, rowIndex, locField);
          const editor = editorRoot?.querySelector?.(`[data-inline-editor="${token}"]`);
          editor?.focus?.();
          editor?.select?.();
        });
      });
    },
    coordinateFieldsForTab(tab, locField) {
      const locationFields = {
        depos: { addressField: "address", cityField: "city", locField: "loc" },
        agents: { addressField: "start_address", cityField: "start_city", locField: "start_loc" },
        tickets: { addressField: "address", cityField: "city", locField: "loc" }
      };
      const target = locationFields[tab];
      return target?.locField === locField ? target : null;
    },
    editableCoordinate(value) {
      const text = String(value ?? "").trim();
      if (!text) {
        return { valid: true, location: "" };
      }
      const parts = text.split(",").map((part) => part.trim());
      if (parts.length !== 2 || parts.some((part) => part === "")) {
        return { valid: false, location: "" };
      }
      const [lng, lat] = parts.map(Number);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        return { valid: false, location: "" };
      }
      return { valid: true, location: `${lng},${lat}` };
    },
    applyEditedCoordinate(row, tab, locField, value) {
      const fields = this.coordinateFieldsForTab(tab, locField);
      const coordinate = this.editableCoordinate(value);
      if (!fields || !coordinate.valid) {
        this.showFlash(this.t("scenario.coordinateFormatError"), "danger");
        return false;
      }

      const currentPoi = row[locField] && typeof row[locField] === "object" ? { ...row[locField] } : {};
      if (coordinate.location) {
        row[locField] = buildCoordinatePoi(
          coordinate.location,
          currentPoi,
          row[fields.addressField] || "",
          row[fields.cityField] || this.scenario.city_hint || ""
        );
      } else {
        delete currentPoi.location;
        delete currentPoi.loc;
        delete currentPoi.entr_location;
        delete currentPoi.entr_loc;
        row[locField] = buildRawPoi(
          row[fields.addressField] || "",
          row[fields.cityField] || this.scenario.city_hint || "",
          currentPoi
        );
      }
      this.updateRowLocationPreview(row, locField);
      this.locationResolutionStates.delete(row);
      this.locationResolutionVersion += 1;
      return true;
    },
    commitEditingCell() {
      const { tab, rowIndex, field, type, draftValue } = this.editingCell;
      if (!field) {
        return true;
      }
      const row = this.rowsForTab(tab)?.[rowIndex];
      if (!row) {
        this.resetEditingCell();
        return true;
      }
      if (type === "coordinate") {
        if (!this.applyEditedCoordinate(row, tab, field, draftValue)) {
          return false;
        }
        this.resetEditingCell();
        this.scheduleAdaptiveTableFit(tab);
        return true;
      }
      const nextValue = this.coerceEditingValue(draftValue, type);
      const changed = row[field] !== nextValue;
      row[field] = nextValue;
      this.resetEditingCell();
      if (changed) {
        this.resolveEditedLocation(tab, rowIndex, row, field);
        this.scheduleAdaptiveTableFit(tab);
      }
      return true;
    },
    cancelEditingCell() {
      this.resetEditingCell();
    },
    handleCellEditorFocusOut(event, tab, rowIndex, field) {
      if (!this.isEditingCell(tab, rowIndex, field)) {
        return;
      }
      const editorShell = event.currentTarget;
      if (editorShell?.contains(event.relatedTarget)) {
        return;
      }
      // The display button is conditionally replaced by this editor. During that
      // replacement browsers can emit focusout before Alpine has moved focus to
      // the newly rendered input, so wait for the pending focus transfer first.
      this.$nextTick(() => {
        window.setTimeout(() => {
          if (!this.isEditingCell(tab, rowIndex, field)) {
            return;
          }
          if (editorShell?.contains(editorShell.ownerDocument?.activeElement)) {
            return;
          }
          this.commitEditingCell();
        }, 0);
      });
    },
    async lookupPoiForCell(tab, rowIndex, row, addressField, cityField, locField) {
      if (this.isEditingCell(tab, rowIndex, addressField) || this.isEditingCell(tab, rowIndex, locField)) {
        if (!this.commitEditingCell()) {
          return;
        }
      }
      await this.resolveLocationForRow(row, addressField, cityField, locField, {
        announce: true,
        overwriteLocation: true
      });
    },
    resolveEditedLocation(tab, _rowIndex, row, field) {
      const locationFields = {
        depos: { addressField: "address", cityField: "city", locField: "loc" },
        agents: { addressField: "start_address", cityField: "start_city", locField: "start_loc" },
        tickets: { addressField: "address", cityField: "city", locField: "loc" }
      };
      const target = locationFields[tab];
      if (!target || target.addressField !== field) {
        return;
      }
      this.resolveLocationForRow(row, target.addressField, target.cityField, target.locField);
    },
    locationSourceKey(row, addressField, cityField, locField) {
      const address = String(row?.[addressField] || "").trim();
      const addressCoordinate = parseLocationString(address);
      if (addressCoordinate) {
        return `coordinate:${addressCoordinate[0]},${addressCoordinate[1]}`;
      }
      if (address) {
        return `address:${String(row?.[cityField] || "").trim()}\u0000${address}`;
      }
      const poiCoordinate = parseLocationString(poiLocationText(row?.[locField]));
      return poiCoordinate ? `coordinate:${poiCoordinate[0]},${poiCoordinate[1]}` : "";
    },
    setLocationResolution(row, state) {
      if (!row) {
        return;
      }
      this.locationResolutionStates.set(row, state);
      this.locationResolutionVersion += 1;
    },
    locationResolutionText(row) {
      // 读取版本号使 Alpine 在异步解析状态变化后重新渲染该单元格。
      void this.locationResolutionVersion;
      const state = this.locationResolutionStates.get(row);
      if (state?.status === "resolving") {
        return this.t("scenario.resolving");
      }
      if (state?.status === "failed") {
        return this.t("scenario.resolutionFailed");
      }
      return "";
    },
    locationResolutionClass(row) {
      void this.locationResolutionVersion;
      return this.locationResolutionStates.get(row)?.status === "failed"
        ? "text-rose-600"
        : "text-slate-500";
    },
    cachedLocationResolution(key, request) {
      let pending = this.locationResolutionCache.get(key);
      if (!pending) {
        pending = Promise.resolve()
          .then(request)
          .catch((error) => {
            this.locationResolutionCache.delete(key);
            throw error;
          });
        this.locationResolutionCache.set(key, pending);
      }
      return pending;
    },
    async resolveLocationForRow(row, addressField, cityField, locField, options = {}) {
      const sourceKey = this.locationSourceKey(row, addressField, cityField, locField);
      if (!sourceKey) {
        return { status: "skipped" };
      }

      this.setLocationResolution(row, { status: "resolving", sourceKey });
      try {
        const result = await this.cachedLocationResolution(sourceKey, async () => {
          if (sourceKey.startsWith("coordinate:")) {
            return reverseGeocode(sourceKey.slice("coordinate:".length));
          }
          const separator = sourceKey.indexOf("\u0000");
          const city = sourceKey.slice("address:".length, separator);
          const keywords = sourceKey.slice(separator + 1);
          const searchCity = city || this.scenario.city_hint || "";
          const pois = await searchPoiCandidates(keywords, searchCity);
          if (!pois.length) {
            throw new Error(`未检索到地址：${keywords}`);
          }
          const poi = pois[0];
          return {
            poi,
            address: poi.address || poi.name || keywords,
            city: poi.cityname || poi.adname || poi.pname || searchCity
          };
        });

        // 用户在请求期间改动输入时，以最新输入为准，不应用过期结果。
        if (this.locationSourceKey(row, addressField, cityField, locField) !== sourceKey) {
          return { status: "stale" };
        }

        const resolvedPoi = plainObject(result?.poi) ? result.poi : null;
        if (!resolvedPoi) {
          throw new Error("地址解析未返回位置数据");
        }

        const coordinate = sourceKey.startsWith("coordinate:")
          ? sourceKey.slice("coordinate:".length)
          : "";
        let nextPoi;
        if (options.overwriteLocation) {
          const currentPoi = plainObject(row[locField]) ? row[locField] : {};
          const {
            location: _location,
            loc: _loc,
            entr_location: _entranceLocation,
            entr_loc: _entranceLoc,
            ...poiWithoutCoordinates
          } = currentPoi;
          nextPoi = { ...poiWithoutCoordinates, ...resolvedPoi };
        } else {
          nextPoi = mergeMissingPoi(row[locField], resolvedPoi);
        }
        if (coordinate && missingText(poiLocationText(nextPoi))) {
          nextPoi = buildCoordinatePoi(coordinate, nextPoi, result.address || "", result.city || "");
        }

        if (missingText(row[addressField])) {
          row[addressField] = result.address || resolvedPoi.address || resolvedPoi.name || "";
        }
        if (missingText(row[cityField])) {
          row[cityField] = result.city || resolvedPoi.cityname || resolvedPoi.adname || resolvedPoi.pname || "";
        }
        row[locField] = buildRawPoi(row[addressField] || "", row[cityField] || "", nextPoi);
        this.updateRowLocationPreview(row, locField);
        this.scheduleAdaptiveTableFit(this.configTab);
        this.scenario.city_hint = this.scenario.city_hint || row[cityField] || "";
        this.setLocationResolution(row, { status: "resolved", sourceKey });
        if (options.announce) {
          this.showFlash(options.overwriteLocation ? "位置已更新。" : "位置已自动补齐。", "success");
        }
        return { status: "resolved" };
      } catch (error) {
        if (this.locationSourceKey(row, addressField, cityField, locField) === sourceKey) {
          this.setLocationResolution(row, { status: "failed", sourceKey, message: localizeRequestError(error) });
        }
        if (options.announce) {
          this.showFlash(localizeRequestError(error), "danger");
        }
        return { status: "failed", error };
      }
    },
    async resolveImportedLocations() {
      const targets = [
        ...this.scenario.plan.depos.map((row) => [row, "address", "city", "loc"]),
        ...this.scenario.plan.agents.map((row) => [row, "start_address", "start_city", "start_loc"]),
        ...this.scenario.plan.tickets.map((row) => [row, "address", "city", "loc"])
      ];
      const summary = { resolved: 0, failed: 0 };
      // 顺序执行以复用地址服务既有限流；相同输入由缓存合并为一次请求。
      for (const [row, addressField, cityField, locField] of targets) {
        const outcome = await this.resolveLocationForRow(row, addressField, cityField, locField);
        if (outcome.status === "resolved") {
          summary.resolved += 1;
        } else if (outcome.status === "failed") {
          summary.failed += 1;
        }
      }
      return summary;
    },
    async openMapPickerForCell(tab, rowIndex, row, addressField, cityField, locField, title) {
      if (this.isEditingCell(tab, rowIndex, addressField) || this.isEditingCell(tab, rowIndex, locField)) {
        if (!this.commitEditingCell()) {
          return;
        }
      }
      await this.openMapPicker(row, addressField, cityField, locField, title);
    },
    openSkillsEditorForCell(row, title = "编辑技能") {
      this.commitEditingCell();
      this.openSkillsEditor(row, title);
    },
    firstEditableFieldForTab(tab) {
      return {
        depos: "id",
        agents: "id",
        tickets: "id",
        skus: "id"
      }[tab] || "id";
    },
    emitConnection(online, labelKey) {
      window.dispatchEvent(new CustomEvent("vrp:connection", { detail: { online, labelKey } }));
    },
    async loadScenario() {
      this.loading = true;
      this.error = "";
      this.resetEditingCell();
      try {
        const data = await getJson("/scenario/optional");
        if (!data) {
          this.scenario = defaultScenario();
          this.pendingScenarioReplace = false;
          this.availableAgentWindows = [];
          this.emitConnection(true, "当前无场景");
        } else {
          this.scenario = normalizeScenarioForView(data);
          this.pendingScenarioReplace = false;
          await this.loadAvailableAgents();
          this.emitConnection(true, "connection.scenarioAvailable");
        }
      } catch (error) {
        this.error = localizeRequestError(error);
        this.emitConnection(false, "connection.scenarioUnavailable");
        notify(this.error, "danger");
      } finally {
        this.loading = false;
        this.scheduleAdaptiveTableFit(this.configTab);
      }
    },
    async loadAvailableAgents() {
      try {
        this.availableAgentWindows = await getJson("/scenario/available_agents");
      } catch (_error) {
        this.availableAgentWindows = [];
      }
    },
    clearAvailableAgentTrend() {
      this.availableAgentTrendRequest += 1;
      this.availableAgentWindows = [];
    },
    isSidebarPanelOpen(panel) {
      return this.activeSidebarPanel === panel;
    },
    toggleSidebarPanel(panel) {
      this.activeSidebarPanel = this.activeSidebarPanel === panel ? null : panel;
    },
    toggleScenarioSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      const resize = () => {
        gatewayBridge()?.scheduleResize?.();
        this.scheduleAdaptiveTableFit(this.configTab);
      };
      if (typeof this.$nextTick === "function") {
        this.$nextTick(resize);
        return;
      }
      resize();
    },
    async refreshAvailableAgentTrend() {
      if (!this.showAvailableAgentTrend) {
        return [];
      }
      const request = ++this.availableAgentTrendRequest;
      const action = componentActions()?.load_available_agent_windows;
      if (typeof action !== "function") {
        if (request === this.availableAgentTrendRequest) {
          this.availableAgentWindows = [];
        }
        return [];
      }
      const response = await action();
      if (request !== this.availableAgentTrendRequest) {
        return this.availableAgentWindows;
      }
      if (!response?.ok) {
        this.availableAgentWindows = [];
        return [];
      }
      this.availableAgentWindows = Array.isArray(response.data) ? response.data : [];
      return this.availableAgentWindows;
    },
    showFlash(message, tone = "info") {
      if (this.flashTimer) {
        window.clearTimeout(this.flashTimer);
        this.flashTimer = null;
      }
      this.flash = { message, tone };
      if (!message) {
        return;
      }
      const duration = tone === "danger" ? 3600 : 2400;
      this.flashTimer = window.setTimeout(() => {
        this.clearFlash();
      }, duration);
    },
    clearFlash() {
      if (this.flashTimer) {
        window.clearTimeout(this.flashTimer);
        this.flashTimer = null;
      }
      this.flash.message = "";
    },
    openImportSolveRequestDialog() {
      this.commitEditingCell();
      this.importRequestDialog.open = true;
      this.importRequestDialog.error = "";
      this.$nextTick(() => {
        if (this.$refs.importSolveRequestDialog && !this.$refs.importSolveRequestDialog.open) {
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
            EditorView.domEventHandlers({
              paste: () => {
                this.importRequestDialog.pendingPasteFormat = true;
                return false;
              }
            }),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged) {
                return;
              }
              this.importRequestDialog.text = update.state.doc.toString();
              this.importRequestDialog.error = "";
              if (!this.importRequestDialog.pendingPasteFormat) {
                return;
              }
              this.importRequestDialog.pendingPasteFormat = false;
              window.setTimeout(() => {
                this.tryFormatImportRequestJson();
              }, 0);
            }),
            EditorView.theme({
              "&": {
                height: "20rem",
                fontSize: "16.25px",
                border: "1.25px solid rgba(148, 163, 184, 0.45)",
                borderRadius: "0.625rem",
                overflow: "hidden",
                backgroundColor: "rgba(255, 255, 255, 0.88)"
              },
              ".cm-scroller": {
                overflow: "auto",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace"
              },
              ".cm-content": {
                padding: "0.9375rem 0",
                minHeight: "100%"
              },
              ".cm-gutters": {
                backgroundColor: "rgba(248, 250, 252, 0.95)",
                borderRight: "1.25px solid rgba(226, 232, 240, 0.95)"
              },
              ".cm-activeLineGutter": {
                backgroundColor: "rgba(16, 185, 129, 0.08)"
              },
              ".cm-activeLine": {
                backgroundColor: "rgba(16, 185, 129, 0.05)"
              },
              "&.cm-focused": {
                outline: "2.5px solid rgba(16, 185, 129, 0.18)",
                outlineOffset: "0"
              }
            })
          ]
        }),
        parent: this.$refs.importSolveRequestEditor,
        root: this.$root?.getRootNode?.() || document
      });
    },
    destroyImportRequestEditor() {
      if (!this.importRequestDialog.editor) {
        return;
      }
      this.importRequestDialog.editor.destroy();
      this.importRequestDialog.editor = null;
      this.importRequestDialog.pendingPasteFormat = false;
      this.importRequestDialog.folded = false;
    },
    getImportRequestEditorText() {
      if (this.importRequestDialog.editor) {
        return this.importRequestDialog.editor.state.doc.toString();
      }
      return this.importRequestDialog.text || "";
    },
    setImportRequestEditorText(value) {
      const text = String(value ?? "");
      this.importRequestDialog.text = text;
      this.importRequestDialog.folded = false;
      const editor = this.importRequestDialog.editor;
      if (!editor) {
        return;
      }
      const current = editor.state.doc.toString();
      if (current === text) {
        return;
      }
      editor.dispatch({
        changes: {
          from: 0,
          to: current.length,
          insert: text
        }
      });
    },
    tryFormatImportRequestJson() {
      const raw = this.getImportRequestEditorText();
      if (!String(raw).trim()) {
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
    formatImportRequestJson() {
      if (!this.tryFormatImportRequestJson()) {
        this.importRequestDialog.error = "JSON 格式错误，请检查后重试。";
      }
    },
    toggleImportRequestFold() {
      const editor = this.importRequestDialog.editor;
      if (!editor) {
        return;
      }
      if (this.importRequestDialog.folded) {
        unfoldAll(editor);
        this.importRequestDialog.folded = false;
        return;
      }
      foldAll(editor);
      this.importRequestDialog.folded = true;
    },
    parseSolveTimeForControls(value) {
      const text = String(value || "").trim().toUpperCase();
      const match = text.match(/^PT(\d+)([SMH])$/);
      if (!match) {
        throw new Error("solve_time 格式不支持，请使用 PT30S / PT5M / PT1H。");
      }
      const parsedValue = Number(match[1]);
      const unit = match[2];
      if (!Number.isFinite(parsedValue) || parsedValue < 1) {
        throw new Error("solve_time 格式不支持，请使用 PT30S / PT5M / PT1H。");
      }
      return {
        value: parsedValue,
        unit
      };
    },
    parseSolveBooleanOption(value, fieldLabel) {
      if (value == null) {
        return null;
      }
      if (typeof value !== "boolean") {
        throw new Error(`${fieldLabel} 必须是布尔值。`);
      }
      return value;
    },
    async applyImportedSolveRequest() {
      this.commitEditingCell();
      this.importRequestDialog.error = "";

      let parsed;
      try {
        parsed = JSON.parse(this.getImportRequestEditorText() || "");
      } catch (_error) {
        this.importRequestDialog.error = "JSON 格式错误，请检查后重试。";
        return;
      }

      if (!parsed || typeof parsed !== "object" || !parsed.scenario || typeof parsed.scenario !== "object") {
        this.importRequestDialog.error = "请求 JSON 缺少 scenario 字段。";
        return;
      }

      const solveOptions = parsed.solve_options;
      let nextSolveControls = null;
      if (solveOptions != null) {
        if (typeof solveOptions !== "object") {
          this.importRequestDialog.error = "solve_options 格式错误。";
          return;
        }

        let nextMatrixMode = String(solveOptions.matrix_mode ?? this.matrixMode ?? "MANHATTAN").trim().toUpperCase();
        if (nextMatrixMode === "AMAP") nextMatrixMode = "ROUTING";
        if (!["ROUTING", "MANHATTAN"].includes(nextMatrixMode)) {
          this.importRequestDialog.error = this.t("scenario.validation.invalidMatrixMode");
          return;
        }

        let parsedSolveTime;
        try {
          parsedSolveTime = this.parseSolveTimeForControls(solveOptions.solve_time ?? `PT${Math.max(1, this.solveTimeValue)}${this.solveTimeUnit}`);
        } catch (error) {
          this.importRequestDialog.error = error.message;
          return;
        }

        let nextBuildTransitMatrix;
        let nextDrawRoute;
        try {
          nextBuildTransitMatrix = this.parseSolveBooleanOption(solveOptions.build_transit_matrix, "build_transit_matrix");
          nextDrawRoute = this.parseSolveBooleanOption(solveOptions.draw_route, "draw_route");
        } catch (error) {
          this.importRequestDialog.error = error.message;
          return;
        }

        nextSolveControls = {
          solveTimeValue: parsedSolveTime.value,
          solveTimeUnit: parsedSolveTime.unit,
          matrixMode: nextMatrixMode,
          buildTransitMatrix: nextBuildTransitMatrix == null ? this.buildTransitMatrix : nextBuildTransitMatrix,
          drawRoute: nextDrawRoute == null ? this.drawRoute : nextDrawRoute
        };
      }

      this.scenario = normalizeScenarioForView(parsed.scenario);
      this.pendingScenarioReplace = true;
      this.availableAgentWindows = [];
      this.highlightedTicketId = "";

      if (nextSolveControls) {
        this.solveTimeValue = nextSolveControls.solveTimeValue;
        this.solveTimeUnit = nextSolveControls.solveTimeUnit;
        this.matrixMode = nextSolveControls.matrixMode;
        this.buildTransitMatrix = nextSolveControls.buildTransitMatrix;
        this.drawRoute = nextSolveControls.drawRoute;
      }

      this.importRequestDialog.text = "";
      this.setImportRequestEditorText("");
      this.closeImportSolveRequestDialog();
      const resolution = await this.resolveImportedLocations();
      this.scheduleAdaptiveTableFit(this.configTab);
      const resolutionMessage = resolution.failed
        ? `位置补齐 ${resolution.resolved} 条，${resolution.failed} 条失败并保留原始内容。`
        : `已补齐 ${resolution.resolved} 条可解析位置。`;
      this.showFlash(`已回填当前场景和求解参数；${resolutionMessage}普通保存或求解不会按替换语义清理历史任务。`, resolution.failed ? "info" : "success");
    },
    openSkillsEditor(row, title = "编辑技能") {
      this.commitEditingCell();
      this.skillsEditor = {
        open: true,
        title,
        row,
        value: row?.skills_text || ""
      };
      this.$nextTick(() => {
        if (this.$refs.skillsDialog && !this.$refs.skillsDialog.open) {
          this.$refs.skillsDialog.showModal();
        }
      });
    },
    closeSkillsEditor() {
      if (this.$refs.skillsDialog?.open) {
        this.$refs.skillsDialog.close();
      }
      this.skillsEditor.open = false;
      this.skillsEditor.row = null;
      this.skillsEditor.value = "";
    },
    applySkillsEditor() {
      if (this.skillsEditor.row) {
        this.skillsEditor.row.skills_text = this.skillsEditor.value;
      }
      this.closeSkillsEditor();
    },
    openDescriptionEditor() {
      this.commitEditingCell();
      this.descriptionEditor = {
        open: true,
        value: this.scenario?.desc || ""
      };
      this.$nextTick(() => {
        if (this.$refs.descriptionDialog && !this.$refs.descriptionDialog.open) {
          this.$refs.descriptionDialog.showModal();
        }
        const focusAtStart = () => {
          const input = this.$refs.descriptionEditorInput;
          input?.focus?.();
          input?.setSelectionRange?.(0, 0);
          if (input) {
            input.scrollTop = 0;
          }
        };
        (globalThis.requestAnimationFrame || ((callback) => callback()))(focusAtStart);
      });
    },
    closeDescriptionEditor() {
      if (this.$refs?.descriptionDialog?.open) {
        this.$refs.descriptionDialog.close();
      }
      this.descriptionEditor.open = false;
      this.descriptionEditor.value = "";
    },
    applyDescriptionEditor() {
      if (this.scenario) {
        this.scenario.desc = this.descriptionEditor.value;
      }
      this.closeDescriptionEditor();
    },
    async openMapPicker(row, addressField, cityField, locField, title = "地图选点") {
      this.commitEditingCell();
      this.mapPicker.open = true;
      this.mapPicker.title = title;
      this.mapPicker.targetRow = row;
      this.mapPicker.addressField = addressField;
      this.mapPicker.cityField = cityField;
      this.mapPicker.locField = locField;
      this.mapPicker.targetCity = row?.[cityField] || this.scenario.city_hint || "";
      this.mapPicker.keyword = row?.[addressField] || row?.[locField]?.address || "";
      this.mapPicker.searchResults = [];
      this.mapPicker.selectedPoi = null;
      this.mapPicker.resolvedAddress = "";
      this.mapPicker.resolvedCity = row?.[cityField] || "";
      this.mapPicker.loading = false;
      this.mapPicker.error = "";
      this.mapPicker.mapUnavailable = false;

      try {
        await new Promise((resolve) => this.$nextTick(resolve));
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await this.ensureMapPickerMap();
        await this.initializeMapPickerSelection();
      } catch (error) {
        this.mapPicker.mapUnavailable = true;
        this.mapPicker.error = localizeRequestError(error);
      }
    },
    closeMapPicker() {
      this.mapPicker.open = false;
    },
    async ensureMapPickerMap() {
      const container = this.$refs.mapPickerCanvas;
      if (!container) {
        throw new Error("地图容器未找到");
      }
      if (!this.mapPicker.map) {
        this.mapPicker.map = await ensureMap(container, { zoom: 11, center: DEFAULT_MAP_CENTER, mapTheme: "dark" });
        this.mapPicker.map.on("click", (event) => {
          const lng = event?.lnglat?.getLng?.();
          const lat = event?.lnglat?.getLat?.();
          if (lng == null || lat == null) {
            return;
          }
          this.selectMapPickerLocation(`${lng},${lat}`);
        });
      }
      if (typeof this.mapPicker.map.resize === "function") {
        this.mapPicker.map.resize();
      }
      return this.mapPicker.map;
    },
    async initializeMapPickerSelection() {
      const row = this.mapPicker.targetRow;
      const locField = this.mapPicker.locField;
      const addressField = this.mapPicker.addressField;
      const cityField = this.mapPicker.cityField;
      const currentPoi = row?.[locField] || null;
      const currentLocation = poiLocationText(currentPoi);
      const directCoordinate = parseLocationString(row?.[addressField]) ? row[addressField] : "";
      const keyword = String(row?.[addressField] || "").trim();
      const city = row?.[cityField] || this.scenario.city_hint || "";

      if (currentLocation) {
        await this.selectMapPickerLocation(currentLocation, {
          poi: currentPoi,
          address: row?.[addressField] || currentPoi?.address || "",
          city: row?.[cityField] || currentPoi?.cityname || ""
        });
        return;
      }
      if (directCoordinate) {
        await this.selectMapPickerLocation(directCoordinate, {
          address: row?.[addressField] || "",
          city: row?.[cityField] || ""
        });
        return;
      }
      if (keyword) {
        const matched = await this.bootstrapMapPickerSearch(keyword, city);
        if (matched) {
          return;
        }
      }
      if (city) {
        const matched = await this.bootstrapMapPickerSearch(city, city);
        if (matched) {
          return;
        }
      }
      this.mapPicker.map.setCenter(DEFAULT_MAP_CENTER);
      this.mapPicker.map.setZoom(11);
    },
    async bootstrapMapPickerSearch(keyword, city) {
      try {
        this.mapPicker.searchResults = await searchPoiCandidates(keyword, city);
        if (!this.mapPicker.searchResults.length) {
          return false;
        }
        await this.chooseMapSearchResult(this.mapPicker.searchResults[0]);
        return true;
      } catch (_error) {
        return false;
      }
    },
    ensureMapPickerMarker() {
      if (!this.mapPicker.map) {
        return null;
      }
      const AMap = window.AMap;
      if (!this.mapPicker.marker) {
        this.mapPicker.marker = new AMap.Marker({
          draggable: true,
          cursor: "move"
        });
        this.mapPicker.marker.on("dragend", (event) => {
          const lng = event?.lnglat?.getLng?.();
          const lat = event?.lnglat?.getLat?.();
          if (lng == null || lat == null) {
            return;
          }
          this.selectMapPickerLocation(`${lng},${lat}`);
        });
      }
      if (!this.mapPicker.marker.getMap()) {
        this.mapPicker.marker.setMap(this.mapPicker.map);
      }
      return this.mapPicker.marker;
    },
    async searchMapPicker() {
      const keyword = String(this.mapPicker.keyword || "").trim();
      const city = this.mapPicker.targetRow?.[this.mapPicker.cityField] || this.scenario.city_hint || "";
      if (!keyword) {
        this.mapPicker.error = "请输入地址、地标或坐标后再搜索。";
        return;
      }

      const coordinateText = parseLocationString(keyword) ? keyword : "";
      this.mapPicker.loading = true;
      this.mapPicker.error = "";
      try {
        if (coordinateText) {
          this.mapPicker.searchResults = [];
          await this.selectMapPickerLocation(coordinateText, {
            address: this.mapPicker.targetRow?.[this.mapPicker.addressField] || "",
            city: this.mapPicker.targetRow?.[this.mapPicker.cityField] || ""
          });
          return;
        }
        this.mapPicker.searchResults = await searchPoiCandidates(keyword, city);
        if (!this.mapPicker.searchResults.length) {
          this.mapPicker.error = "未检索到地址，请直接点击地图选点。";
          return;
        }
      } catch (error) {
        this.mapPicker.searchResults = [];
        this.mapPicker.error = localizeRequestError(error);
      } finally {
        this.mapPicker.loading = false;
      }
    },
    isSelectedMapSearchResult(poi) {
      const current = this.mapPicker.selectedPoi;
      if (!current || !poi) {
        return false;
      }
      if (current.id && poi.id) {
        return current.id === poi.id;
      }
      return current.location && current.location === poi.location;
    },
    async chooseMapSearchResult(poi) {
      if (!poi?.location) {
        return;
      }
      this.mapPicker.keyword = poi.address || poi.name || this.mapPicker.keyword;
      this.mapPicker.searchResults = [];
      await this.selectMapPickerLocation(poi.location, {
        poi,
        address: poi.address || poi.name || "",
        city: poi.cityname || poi.adname || poi.pname || ""
      });
    },
    async selectMapPickerLocation(location, options = {}) {
      const map = this.mapPicker.map;
      if (!map) {
        return;
      }
      const coords = parseLocationString(location);
      if (!coords) {
        this.mapPicker.error = "坐标格式无效";
        return;
      }

      this.mapPicker.loading = true;
      this.mapPicker.error = "";
      const marker = this.ensureMapPickerMarker();
      marker?.setPosition(coords);
      map.setCenter(coords);
      if ((map.getZoom?.() || 0) < 13) {
        map.setZoom(13);
      }

      const fallbackPoi = buildCoordinatePoi(
        location,
        options.poi || {},
        options.address || "",
        options.city || ""
      );

      this.mapPicker.selectedPoi = fallbackPoi;
      this.mapPicker.resolvedAddress = fallbackPoi.address || options.address || "";
      this.mapPicker.resolvedCity = fallbackPoi.cityname || options.city || "";

      try {
        const result = await reverseGeocode(location);
        const reversePoi = buildCoordinatePoi(
          location,
          { ...(options.poi || {}), ...(result?.poi || {}) },
          result?.address || options.address || "",
          result?.city || options.city || ""
        );
        this.mapPicker.selectedPoi = reversePoi;
        this.mapPicker.resolvedAddress = reversePoi.address || "";
        this.mapPicker.resolvedCity = reversePoi.cityname || options.city || "";
      } catch (_error) {
        this.mapPicker.selectedPoi = fallbackPoi;
        this.mapPicker.resolvedAddress = fallbackPoi.address || options.address || "";
        this.mapPicker.resolvedCity = fallbackPoi.cityname || options.city || "";
      } finally {
        this.mapPicker.loading = false;
      }
    },
    async applyMapPickerSelection(overwriteAddress) {
      const row = this.mapPicker.targetRow;
      const locField = this.mapPicker.locField;
      const addressField = this.mapPicker.addressField;
      const cityField = this.mapPicker.cityField;
      const selectedPoi = this.mapPicker.selectedPoi;
      if (!row || !locField || !selectedPoi?.location) {
        this.mapPicker.error = "请先在地图中选择一个位置。";
        return;
      }

      let nextAddress = overwriteAddress
        ? (this.mapPicker.resolvedAddress || row[addressField] || "")
        : (row[addressField] || "");
      let nextCity = overwriteAddress
        ? (this.mapPicker.resolvedCity || row[cityField] || "")
        : (row[cityField] || "");
      let nextPoi = selectedPoi;

      if (overwriteAddress) {
        try {
          const reverseResult = await reverseGeocodeByServer(selectedPoi.location);
          const reversePoi = reverseResult?.poi;
          if (reversePoi && typeof reversePoi === "object") {
            nextPoi = buildCoordinatePoi(
              selectedPoi.location,
              { ...(row[locField] || {}), ...selectedPoi, ...reversePoi },
              reverseResult.address || nextAddress,
              reverseResult.city || nextCity
            );
            nextAddress = nextPoi.address || nextAddress;
            nextCity = nextPoi.cityname || nextCity;
          }
        } catch (_error) {
        }
      }

      row[locField] = buildRawPoi(nextAddress, nextCity, {
        ...(row[locField] || {}),
        ...nextPoi
      });

      if (overwriteAddress) {
        row[addressField] = nextAddress;
        row[cityField] = nextCity;
        this.scenario.city_hint = nextCity || this.scenario.city_hint;

        if (!nextAddress && !String(row[addressField] || "").trim()) {
          row[addressField] = nextPoi.location || "";
          row[cityField] = nextCity || row[cityField] || "";
          await this.lookupPoi(row, addressField, cityField, locField, { silent: true });
        }
      }

      this.updateRowLocationPreview(row, locField);
      this.showFlash(
        overwriteAddress ? "地图位置已回填地址、城市和坐标。" : "地图坐标已更新。",
        "success"
      );
      this.closeMapPicker();
    },
    updateRowLocationPreview(row, locField) {
      if (!row) {
        return;
      }
      const preview = poiLocationText(row[locField]);
      if (locField === "start_loc") {
        row.start_location = preview;
        return;
      }
      row.poi_location = preview;
    },
    async saveScenario(build = false, matrixMode = "MANHATTAN") {
      if (!this.commitEditingCell()) {
        return false;
      }
      this.saving = true;
      this.clearFlash();
      try {
        const payload = buildScenarioPayload(this.scenario);
        const params = new URLSearchParams();
        if (build) {
          params.set("build", "true");
          params.set("matrix_mode", matrixMode);
        }
        if (this.pendingScenarioReplace) {
          params.set("replace", "true");
        }
        const query = params.toString() ? `?${params.toString()}` : "";
        const data = await putJson(`/scenario${query}`, payload);
        this.scenario = normalizeScenarioForView(data);
        this.scheduleAdaptiveTableFit(this.configTab);
        this.scenarioPersisted = true;
        this.pendingScenarioReplace = false;
        await this.loadAvailableAgents();
        this.emitConnection(true, "场景已同步");
        this.showFlash(build ? "场景已保存，并触发地址解析/矩阵生成。" : "场景已保存。", "success");
        return true;
      } catch (error) {
        this.showFlash(localizeRequestError(error), "danger");
        this.emitConnection(false, "场景保存失败");
        return false;
      } finally {
        this.saving = false;
      }
    },
    async deleteScenario() {
      this.commitEditingCell();
      if (!window.confirm("确认删除当前场景？这会同时清空当前求解任务。")) {
        return;
      }
      try {
        await deleteRequest("/scenario");
        this.scenario = defaultScenario();
        this.scheduleAdaptiveTableFit(this.configTab);
        this.scenarioPersisted = false;
        this.pendingScenarioReplace = false;
        this.availableAgentWindows = [];
        this.showFlash("当前场景已删除。", "success");
      } catch (error) {
        this.showFlash(localizeRequestError(error), "danger");
      }
    },
    async generateMatrix() {
      this.commitEditingCell();
      await this.saveScenario(true, this.matrixMode);
    },
    async lookupPoi(row, addressField, cityField, locField, options = {}) {
      this.commitEditingCell();
      return this.resolveLocationForRow(row, addressField, cityField, locField, {
        announce: !Boolean(options?.silent)
      });
    },
    addRow(tab) {
      this.commitEditingCell();
      const target = this.rowsForTab(tab);
      const row = this.factoryForTab(tab)();
      target.push(row);
      const rowIndex = target.length - 1;
      this.$nextTick(() => {
        this.beginCellEdit(tab, rowIndex, this.firstEditableFieldForTab(tab));
      });
    },
    removeRow(tab, index) {
      this.commitEditingCell();
      const target = this.rowsForTab(tab);
      target.splice(index, 1);
      this.scheduleAdaptiveTableFit(tab);
    },
    rowsForTab(tab) {
      return this.scenario.plan[tab];
    },
    factoryForTab(tab) {
      return {
        depos: blankDepot,
        agents: blankAgent,
        tickets: blankTicket,
        skus: blankSku
      }[tab];
    },
    assignedTicketsForAgent(agentId) {
      return this.scenario.plan.tickets.filter((ticket) => ticket.agent === agentId && ticket.id);
    },
    async jumpToTicket(ticketId) {
      const value = String(ticketId || "").trim();
      if (!value || !this.scenario.plan.tickets.some((ticket) => ticket?.id === value)) {
        return false;
      }
      this.commitEditingCell();
      this.configTab = "tickets";
      this.highlightedTicketId = value;
      this.scheduleAdaptiveTableFit("tickets");
      await this.revealTicketRow(value);
      return true;
    },
    async focusTicket(ticketId) {
      const value = String(ticketId || "").trim();
      if (!value || !this.scenario.plan.tickets.some((ticket) => ticket?.id === value)) {
        return false;
      }
      await this.jumpToTicket(value);
      return true;
    },
    async revealTicketRow(ticketId) {
      if (!ticketId) {
        return;
      }
      if (typeof this.$nextTick === "function") {
        await this.$nextTick();
      }
      const rows = Array.from(this.$root?.querySelectorAll?.("[data-ticket-row]") || []);
      const targetRow = rows.find((row) => row.getAttribute("data-ticket-row") === ticketId);
      if (targetRow?.scrollIntoView) {
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        targetRow.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      }
    },
    openPlanningDrawer() {
      if (!this.commitEditingCell()) {
        return false;
      }
      if (this.scenarioPersistedProvided && !this.scenarioPersisted) {
        this.showFlash("请先保存场景后再规划求解。", "danger");
        return false;
      }
      this.planningDrawer.open = true;
      this.$nextTick(() => {
        if (this.$refs.planningDialog && !this.$refs.planningDialog.open) {
          this.$refs.planningDialog.showModal();
        }
      });
      return true;
    },
    closePlanningDrawer() {
      if (this.$refs.planningDialog?.open) {
        this.$refs.planningDialog.close();
      }
      this.planningDrawer.open = false;
    },
    async solveScenario() {
      if (!this.commitEditingCell()) {
        return;
      }
      if (this.scenarioPersistedProvided && !this.scenarioPersisted) {
        this.showFlash("请先保存场景后再规划求解。", "danger");
        return;
      }
      if (!this.canSolveCurrentScenario()) {
        this.showFlash("请先完善非空场景后再求解。", "danger");
        return;
      }
      const actions = componentActions();
      if (this.gatewayMode && actions?.submit_scenario) {
        const validation = this.validateGatewayCreate();
        if (!validation.valid) {
          return;
        }
        this.saving = true;
        try {
          const response = await actions.submit_scenario({
            ...this.buildGatewayCreateRequest(true),
            submit_behavior: { on_success: "open_result", replace_history: false }
          });
          if (!response?.ok) {
            throw Object.assign(new Error(localizeRequestError(response?.error)), response?.error || {});
          }
          const jobId = response.data?.job_id || "";
          this.markGatewayPristine();
          this.closePlanningDrawer();
          this.showFlash("求解任务已提交，正在打开任务详情。", "success");
          navigate({ target: "result", result_job_id: jobId });
          return;
        } catch (error) {
          this.showFlash(localizeRequestError(error), "danger");
          return;
        } finally {
          this.saving = false;
        }
      }
      const saved = await this.saveScenario(this.buildTransitMatrix, this.matrixMode);
      if (!saved) {
        return;
      }
      try {
        const solveTime = `PT${Math.max(1, this.solveTimeValue)}${this.solveTimeUnit}`;
        const matrixMode = encodeURIComponent(this.matrixMode || "MANHATTAN");
        const buildTransitMatrix = this.buildTransitMatrix ? "true" : "false";
        const drawRoute = this.drawRoute ? "true" : "false";
        const job = await postJson(`/solver_job?solve_time=${encodeURIComponent(solveTime)}&matrix_mode=${matrixMode}&build_transit_matrix=${buildTransitMatrix}&draw_route=${drawRoute}`);
        this.closePlanningDrawer();
        this.showFlash("求解任务已提交，正在打开任务详情。", "success");
        navigate({ target: "result", result_job_id: job?.id || "" });
      } catch (error) {
        this.showFlash(localizeRequestError(error), "danger");
      }
    },
    buildSolveRequestPayload() {
      const solveTime = `PT${Math.max(1, this.solveTimeValue)}${this.solveTimeUnit}`;
      const scenarioPayload = buildScenarioPayload(this.scenario || {});
      return {
        scenario_name: scenarioPayload.name || "",
        scenario: scenarioPayload,
        solve_options: {
          solve_time: solveTime,
          matrix_mode: this.matrixMode || "MANHATTAN",
          build_transit_matrix: Boolean(this.buildTransitMatrix),
          draw_route: Boolean(this.drawRoute)
        }
      };
    },
    async copySolveRequestPayload() {
      this.commitEditingCell();
      if (!this.canSolveCurrentScenario()) {
        this.showFlash("请先创建场景后再复制请求参数。", "danger");
        return;
      }
      try {
        const copied = await copyText(JSON.stringify(this.buildSolveRequestPayload(), null, 2));
        if (!copied) {
          throw new Error("copy-failed");
        }
        this.showFlash("请求参数已复制。", "success");
      } catch (_error) {
        this.showFlash("复制失败，请检查浏览器权限。", "danger");
      }
    },
    clearJobIdHideTimer() {
      if (this.hoveredJobHideTimer) {
        window.clearTimeout(this.hoveredJobHideTimer);
        this.hoveredJobHideTimer = null;
      }
    },
    showJobIdTooltip(jobId = "", event = null) {
      const value = String(jobId || "");
      const trigger = event?.currentTarget;
      if (!shouldShowFullValueTooltip(trigger, value)) {
        this.clearJobIdHideTimer();
        this.hoveredJobId = "";
        return;
      }
      this.clearJobIdHideTimer();
      this.hoveredJobId = value;
      if (!trigger?.getBoundingClientRect) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const tooltipWidth = 650;
      const tooltipHeight = 90;
      const padding = 20;
      const maxLeft = Math.max(padding, window.innerWidth - tooltipWidth - padding);
      const preferredTop = rect.bottom + 7.5;
      const fallbackTop = Math.max(padding, rect.top - tooltipHeight - 7.5);
      const top = preferredTop + tooltipHeight > window.innerHeight - padding ? fallbackTop : preferredTop;
      this.hoveredJobTooltip = {
        left: Math.max(padding, Math.min(rect.left, maxLeft)),
        top
      };
    },
    hideJobIdTooltip(jobId = "") {
      if (this.hoveredJobId !== String(jobId || "")) {
        return;
      }
      this.clearJobIdHideTimer();
      this.hoveredJobHideTimer = window.setTimeout(() => {
        this.hoveredJobId = "";
        this.hoveredJobHideTimer = null;
      }, 120);
    },
    async copyJobId(jobId = "") {
      const value = String(jobId || "").trim();
      if (!value) {
        return;
      }
      try {
        const copied = await copyText(value);
        if (!copied) {
          throw new Error("copy-failed");
        }
        this.showFlash("ID 已复制。", "success");
      } catch (_error) {
        this.showFlash("复制失败，请检查浏览器权限。", "danger");
      }
    },
    humanConstraintLabel(key) {
      const labelKey = CONSTRAINT_LABELS[key];
      return labelKey ? this.t(labelKey) : key;
    },
    isConstraintWeightEntry(key) {
      return key !== "name";
    },
    constraintLevelValue(key, level) {
      return parseConstraintValue(this.scenario.plan.constraint_configuration?.[key])[level];
    },
    updateConstraintLevel(key, level, value) {
      const current = parseConstraintValue(this.scenario.plan.constraint_configuration?.[key]);
      current[level] = value;
      this.scenario.plan.constraint_configuration[key] = formatConstraintValue(current);
    },
    constraintEntries() {
      return Object.entries(this.scenario.plan.constraint_configuration || {})
        .filter(([key]) => key !== "name");
    },
    currentScenarioStats() {
      const count = (items, fields) => items.filter((item) => fields.some((field) => this.hasDisplayValue(item?.[field]))).length;
      return [
        ["仓库", count(this.scenario.plan.depos, ["id", "name"])],
        ["车辆/工程师", count(this.scenario.plan.agents, ["id", "name"])],
        ["工单", count(this.scenario.plan.tickets, ["id", "address"])],
        ["SKU", count(this.scenario.plan.skus, ["id", "name"])]
      ];
    },
    setConfigTab(tab) {
      this.commitEditingCell();
      this.adaptiveTableResizeObserver?.disconnect?.();
      this.adaptiveTableResizeObserver = null;
      this.adaptiveTableObservedContainer = null;
      this.configTab = tab;
      this.highlightedTicketId = "";
      this.scheduleAdaptiveTableFit(tab);
    },
    scenarioCity() {
      return this.scenario.city_hint || this.scenario.plan.depos.find((item) => item.city)?.city || "--";
    },
    formatSkillTag(tag) {
      const raw = String(tag || "").trim();
      const match = raw.match(/^(\d+)_\d+_.+?_(E_COMMERCE|OTHER)$/);
      if (!match) {
        return raw;
      }
      const level = match[1];
      const type = this.t(match[2] === "E_COMMERCE" ? "scenario.eCommerce" : "scenario.other");
      return this.t("scenario.skillLevel", { level, type });
    },
    skillsFromText(text) {
      return splitTags(text);
    },
    ticketIdsFromText(text) {
      return splitTags(text);
    },
    skillTagToneClass
  };
}
