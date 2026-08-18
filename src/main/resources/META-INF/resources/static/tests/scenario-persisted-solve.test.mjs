import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.resolve(testDirectory, "../assets/js/pages/scenario-detail-page.js");
const engineActionsPath = path.resolve(testDirectory, "../assets/js/utils/scenario-component-engine-actions.js");
const solverJobDetailPagePath = path.resolve(testDirectory, "../assets/js/pages/solver-job-detail-page.js");
const solverJobMapPagePath = path.resolve(testDirectory, "../assets/js/pages/solver-job-map-page.js");

async function loadPageModule() {
  return loadModule(pagePath);
}

async function loadEngineActionsModule() {
  return loadModule(engineActionsPath);
}

async function loadModule(entryPoint) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false
  });
  const module = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}

function validScenario() {
  return {
    name: "已保存场景",
    desc: "测试规划求解",
    planning_date: "2026-07-16",
    start_time_input: "2026-07-16T08:00",
    end_time_input: "2026-07-16T18:00",
    plan: {
      depos: [],
      agents: [],
      tickets: [],
      skus: [],
      cost_parameter: {},
      constraint_configuration: {}
    }
  };
}

test("新建求解任务默认使用 Manhattan 矩阵方式", async () => {
  const { scenarioDetailPage } = await loadPageModule();
  const page = scenarioDetailPage();

  assert.equal(page.matrixMode, "MANHATTAN");
  assert.equal(page.buildSolveRequestPayload().solve_options.matrix_mode, "MANHATTAN");
});

test("组件校验摘要隐藏技术路径并使用紧凑的可读文案", async () => {
  const { scenarioDetailPage } = await loadPageModule();
  const page = scenarioDetailPage();
  page.t = (key, params = {}) => ({
    "scenario.validation.singleTitle": "请修正此项后继续",
    "scenario.validation.multipleTitle": `请修正以下 ${params.count} 项后继续`,
    "scenario.validation.fallbackMessage": "字段内容不符合要求。"
  })[key];
  page.gatewayValidationErrors = [{
    path: "request_payload.options.matrix_mode",
    code: "ENUM_MISMATCH",
    message: "矩阵生成方式仅支持 ROUTING 或 MANHATTAN。"
  }];

  assert.equal(page.validationSummaryTitle(), "请修正此项后继续");
  assert.equal(page.validationErrorMessage(page.gatewayValidationErrors[0]), "矩阵生成方式仅支持 ROUTING 或 MANHATTAN。");
  assert.doesNotMatch(page.formatValidationError(page.gatewayValidationErrors[0]), /request_payload/);

  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    page.dismissValidationSummary();
    assert.equal(page.validationSummaryDismissed, true);
    assert.equal(page.gatewayValidationErrors.length, 1, "关闭摘要不应清除结构化校验错误");
  } finally {
    globalThis.window = previousWindow;
  }

  page.gatewayValidationErrors.push({ path: "request_payload.name", code: "REQUIRED", message: "场景名称不能为空。" });
  assert.equal(page.validationSummaryTitle(), "请修正以下 2 项后继续");
});

test("Routing 矩阵方式按场景图商展示，但请求仍提交 ROUTING", async () => {
  const { scenarioDetailPage } = await loadPageModule();
  const page = scenarioDetailPage();
  page.scenario = { ...validScenario(), map_provider: "HERE" };
  page.matrixMode = "ROUTING";

  assert.equal(page.routingMatrixModeLabel(), "Here");
  assert.equal(page.buildSolveRequestPayload().scenario.map_provider, "HERE");
  assert.equal(page.buildSolveRequestPayload().solve_options.matrix_mode, "ROUTING");

  page.scenario.map_provider = "AMAP";
  assert.equal(page.routingMatrixModeLabel(), "Amap");
  assert.equal(page.buildSolveRequestPayload().solve_options.matrix_mode, "ROUTING");
});

test("求解选项变更不改变场景保存状态，但场景数据变更仍会标记未保存", async () => {
  const previousWindow = globalThis.window;
  const dirtyEvents = [];
  globalThis.window = {
    VrpScenarioGateway: {
      context: {},
      notifyDirty(dirty) { dirtyEvents.push(dirty); },
      notifyCreateReadiness() {}
    }
  };

  try {
    const { scenarioDetailPage } = await loadPageModule();
    const page = scenarioDetailPage();
    page.gatewayMode = true;
    page.scenario = { ...validScenario(), map_provider: "HERE" };
    page.markGatewayPristine();

    page.solveTimeValue = 60;
    page.matrixMode = "ROUTING";
    page.buildTransitMatrix = false;
    page.drawRoute = true;
    page.syncGatewayDirtyState();

    assert.equal(page.gatewayDirty, false);
    assert.deepEqual(dirtyEvents, [false]);
    assert.equal(page.buildGatewayCreateRequest(false).request_payload.options.draw_route, true);
    assert.equal(page.buildGatewayCreateRequest(false).request_payload.options.matrix_mode, "ROUTING");

    page.scenario.name = "已修改场景";
    page.syncGatewayDirtyState();
    assert.equal(page.gatewayDirty, true);
    assert.deepEqual(dirtyEvents, [false, true]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("长标识保留完整值，交由展示容器按实际宽度截断", async () => {
  const { scenarioDetailPage } = await loadPageModule();
  const { solverJobDetailPage } = await loadModule(solverJobDetailPagePath);
  const { solverJobMapPage } = await loadModule(solverJobMapPagePath);
  const ticketId = "12345678901";
  const scenarioPage = scenarioDetailPage();
  scenarioPage.scenario = validScenario();
  scenarioPage.scenario.plan.agents.push({ id: ticketId, name: "" });

  assert.equal(scenarioPage.agentDisplayText(ticketId), ticketId);
  assert.equal(solverJobMapPage().agentDisplayName({ id: ticketId, name: "" }), ticketId);
  assert.equal("shortIdentifier" in scenarioPage, false);
  assert.equal("shortIdentifier" in solverJobDetailPage(), false);
});

test("场景描述在弹框中编辑，应用前不改变页面草稿", async () => {
  const dialog = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; }
  };
  const descriptionInput = {
    focused: false,
    scrollTop: 88,
    selection: null,
    focus() { this.focused = true; },
    setSelectionRange(start, end) { this.selection = [start, end]; }
  };
  const { scenarioDetailPage } = await loadPageModule();
  const page = scenarioDetailPage();
  page.scenario = validScenario();
  page.$refs = { descriptionDialog: dialog, descriptionEditorInput: descriptionInput };
  page.$nextTick = (callback) => callback?.();

  page.openDescriptionEditor();
  assert.equal(dialog.open, true);
  assert.equal(descriptionInput.focused, true);
  assert.deepEqual(descriptionInput.selection, [0, 0]);
  assert.equal(descriptionInput.scrollTop, 0);
  assert.equal(page.descriptionEditor.value, "测试规划求解");

  page.descriptionEditor.value = "仅在编辑器中修改";
  page.closeDescriptionEditor();
  assert.equal(page.scenario.desc, "测试规划求解");

  page.openDescriptionEditor();
  page.descriptionEditor.value = "应用后的场景描述";
  page.applyDescriptionEditor();
  assert.equal(page.scenario.desc, "应用后的场景描述");
  assert.equal(dialog.open, false);
});

test("终态任务的完成时间使用任务更新时间，不使用规划结束时间", async () => {
  const { solverJobDetailPage } = await loadModule(solverJobDetailPagePath);
  const page = solverJobDetailPage();
  const completedAt = "2026-07-23 12:08:50";

  for (const status of ["SOLVING_FINISHED", "ERROR"]) {
    page.job = {
      status,
      create_time: "2026-07-23 12:03:57",
      // 该字段属于场景规划时间窗，不能被当作任务完成时间展示。
      end_date_time: "2026-07-14 23:59:00",
      update_time: completedAt
    };

    const completeTime = page.taskSummaryRows().find((row) => row.key === "completeTime");
    assert.equal(completeTime.value, page.displayJobDateTime(completedAt));
  }
});

test("求解详情仅在运行态安排后台刷新，并在终态停止", async () => {
  const previousWindow = globalThis.window;
  const timers = new Map();
  const clearedTimers = [];
  let nextTimerId = 1;
  globalThis.window = {
    setTimeout(callback, delay) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(timerId) {
      clearedTimers.push(timerId);
      timers.delete(timerId);
    }
  };

  try {
    const { solverJobDetailPage } = await loadModule(solverJobDetailPagePath);
    const page = solverJobDetailPage();

    page.job = { id: "running-job", status: "SOLVING_ACTIVE" };
    page.syncResultPolling();
    assert.equal(page.resultPollTimer, 1);
    assert.equal(timers.get(1)?.delay, 5000);

    let refreshCount = 0;
    page.refresh = async () => {
      refreshCount += 1;
      page.job = { id: "finished-job", status: "SOLVING_FINISHED" };
      page.syncResultPolling();
    };
    const scheduledRefresh = timers.get(1);
    timers.delete(1);
    await scheduledRefresh.callback();
    assert.equal(refreshCount, 1);
    assert.equal(page.resultPollTimer, null);
    assert.equal(timers.size, 0);

    page.job = { id: "running-job", status: "SOLVING_SCHEDULED" };
    page.syncResultPolling();
    assert.equal(page.resultPollTimer, 2);

    page.job = { id: "finished-job", status: "ERROR" };
    page.syncResultPolling();
    assert.equal(page.resultPollTimer, null);
    assert.deepEqual(clearedTimers, [2]);
    assert.equal(timers.size, 0);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("求解中不在隐藏的地图容器创建预览，完成后先 resize 再清空或绘制", async () => {
  const previousWindow = globalThis.window;
  const frames = [];
  globalThis.window = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      callback();
      return frames.length;
    },
    setTimeout(callback) {
      callback();
      return 0;
    }
  };

  try {
    const { solverJobDetailPage } = await loadModule(solverJobDetailPagePath);
    const hiddenMap = {
      clearMapCalls: 0,
      clearMap() { this.clearMapCalls += 1; }
    };
    const solvingPage = solverJobDetailPage();
    solvingPage.job = { status: "SOLVING_ACTIVE" };
    solvingPage.$refs = { previewMap: { _vrpMap: hiddenMap } };
    solvingPage.preparePreviewMap = async () => {
      throw new Error("求解中不应创建地图");
    };

    await solvingPage.drawPreviewMap();
    assert.equal(hiddenMap.clearMapCalls, 1);

    const visibleMap = {
      resizeCalls: 0,
      clearMapCalls: 0,
      resize() { this.resizeCalls += 1; },
      clearMap() { this.clearMapCalls += 1; }
    };
    const completedPage = solverJobDetailPage();
    completedPage.job = { status: "SOLVING_FINISHED", plan: { agents: [] } };
    completedPage.$refs = { previewMap: {} };
    completedPage.$nextTick = async () => {};
    completedPage.preparePreviewMap = async () => visibleMap;

    assert.equal(completedPage.previewMapLoading, true);
    await completedPage.drawPreviewMap();
    assert.equal(completedPage.previewMapLoading, false, "地图创建并完成首次绘制后应关闭加载提示");
    assert.equal(visibleMap.resizeCalls, 1);
    assert.equal(visibleMap.clearMapCalls, 1);
    assert.equal(frames.length, 2);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("手动地址解析覆盖已有坐标，自动补齐仍保留已有坐标", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const response = {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "application/json" },
    json: async () => [{
      id: "geocode-hd",
      name: "北京市海淀区",
      address: "北京市海淀区",
      cityname: "北京市",
      location: "116.297700,39.959893"
    }]
  };
  const createPage = async () => {
    const { scenarioDetailPage } = await loadPageModule();
    const page = scenarioDetailPage();
    page.scenario = { city_hint: "", plan: { depos: [], agents: [], tickets: [], skus: [] } };
    return page;
  };
  const createRow = () => ({
    address: "海淀服务中心",
    city: "北京市",
    poi_location: "116.315700,39.983900",
    loc: {
      id: "old-poi",
      location: "116.315700,39.983900",
      loc: { lat: 39.9839, lon: 116.3157 },
      entr_location: "116.315700,39.983900",
      entr_loc: { lat: 39.9839, lon: 116.3157 }
    }
  });

  globalThis.window = {
    setTimeout: () => 1,
    clearTimeout() {}
  };
  globalThis.fetch = async () => response;

  try {
    const manualPage = await createPage();
    const manualRow = createRow();
    await manualPage.lookupPoiForCell("depos", 0, manualRow, "address", "city", "loc");

    assert.equal(manualRow.loc.location, "116.297700,39.959893");
    assert.equal(manualRow.loc.entr_location, "116.2977,39.959893");
    assert.equal(manualRow.poi_location, "116.297700,39.959893");
    assert.equal(manualRow.address, "海淀服务中心");
    assert.equal(manualRow.city, "北京市");
    assert.equal(manualPage.flash.message, "位置已更新。");

    const automaticPage = await createPage();
    const automaticRow = createRow();
    await automaticPage.resolveLocationForRow(automaticRow, "address", "city", "loc");

    assert.equal(automaticRow.loc.location, "116.315700,39.983900");
    assert.equal(automaticRow.poi_location, "116.315700,39.983900");
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
  }
});

test("Gateway 对话草稿导入时主动补齐缺失地址或坐标", async () => {
  const previousWindow = globalThis.window;
  const searched = [];
  const reversed = [];
  globalThis.window = {
    VrpScenarioGateway: {
      isScenarioComponent: true,
      context: {},
      actions: {
        async search_text_address({ keyword, city }) {
          searched.push({ keyword, city });
          return {
            ok: true,
            data: {
              candidates: [{
                candidate_id: `poi-${keyword}`,
                name: keyword,
                formatted_address: `${city}${keyword}`,
                coordinate: { lng: 116.31, lat: 39.99 },
                address_components: { city, district: "海淀区" }
              }]
            }
          };
        },
        async resolve_coordinate_address({ points }) {
          reversed.push(points[0]);
          return {
            ok: true,
            data: {
              items: [{
                status: "resolved",
                candidate_id: "poi-ticket",
                name: "望京南地铁站",
                formatted_address: "北京市朝阳区望京南地铁站",
                coordinate: { lng: points[0].lng, lat: points[0].lat },
                address_components: { city: "北京市", district: "朝阳区" }
              }]
            }
          };
        }
      },
      notifyDirty() {},
      notifyCreateReadiness() {},
      scheduleResize() {}
    }
  };

  try {
    const { scenarioDetailPage } = await loadPageModule();
    const page = scenarioDetailPage();
    page.gatewayMode = true;
    page.scheduleAdaptiveTableFit = () => {};
    const result = await page.applyGatewayCreateData({
      request_payload: {
        name: "维修调度",
        planning_date: "2026-08-06",
        start_time: "08:00",
        end_time: "20:00",
        plan: {
          depos: [{ id: "depot-1", loc: { address: "北京市东城区仓库", location: "116.40,39.90" } }],
          agents: [{ id: "agent-1", name: "小王", start_loc: { name: "北京大学", cityname: "北京市" } }],
          tickets: [{ id: "ticket-1", loc: { location: "116.4819,39.9865" } }]
        }
      }
    });

    assert.deepEqual(result.locationResolution, { resolved: 2, failed: 0, skipped: 1 });
    assert.deepEqual(searched, [{ keyword: "北京大学", city: "北京市" }]);
    assert.equal(reversed.length, 1);
    assert.equal(page.scenario.plan.agents[0].start_address, "北京大学");
    assert.equal(page.scenario.plan.agents[0].start_loc.location, "116.31,39.99");
    assert.equal(page.scenario.plan.tickets[0].address, "北京市朝阳区望京南地铁站");
    assert.equal(page.scenario.plan.tickets[0].loc.location, "116.4819,39.9865");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("确认提案输出业务大纲而不是内部字段和值", async () => {
  const { scenarioDetailPage } = await loadPageModule();
  const page = scenarioDetailPage();
  const translations = {
    "scenario.outline.scope": "规划范围",
    "scenario.outline.scale": "场景规模",
    "scenario.outline.timeAndRules": "时间与关键规则",
    "scenario.outline.planningDate": "规划日期",
    "scenario.outline.timeRange": "总体时间",
    "scenario.outline.cities": "主要区域",
    "scenario.outline.shifts": "工程师班次",
    "scenario.outline.serviceDuration": "工单服务时长",
    "scenario.outline.minutes": "分钟",
    "scenario.outline.adjusted": "已按当前方案调整",
    "scenario.outline.locationComplete": "地址和坐标已完整。",
    "constraint.minimize_travel_time": "尽量减少路途时间"
  };
  page.t = (key) => translations[key] || key;
  page.scenario = {
    ...validScenario(),
    name: "北京维修调度",
    city_hint: "北京市",
    plan: {
      depos: [{ id: "depot-1", city: "北京市", address: "东城区仓库", loc: { location: "116.4,39.9" } }],
      agents: [{ id: "agent-1", name: "小王", start_city: "北京市", start_address: "北京大学", start_loc: { location: "116.3,39.9" }, shift_start_time_input: "2026-07-16T09:00", shift_off_time_input: "2026-07-16T16:00" }],
      tickets: [{ id: "ticket-1", city: "北京市", address: "望京南", loc: { location: "116.5,39.9" }, duration_minutes: 120 }],
      skus: [],
      cost_parameter: {},
      constraint_configuration: {
        minimize_travel_time: "0hard/0medium/9soft"
      }
    }
  };

  const outline = page.buildGatewayScenarioOutline();
  const serialized = JSON.stringify(outline);
  assert.match(serialized, /北京维修调度|规划范围|工程师班次|09:00–16:00|尽量减少路途时间|已按当前方案调整/);
  assert.doesNotMatch(serialized, /minimize_travel_time|0hard\/0medium\/9soft|request_payload/);
});

test("仓库、工程师和工单可直接编辑坐标，并同步 POI 的位置与入口位置", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    setTimeout: () => 1,
    clearTimeout() {}
  };

  try {
    const { scenarioDetailPage } = await loadPageModule();
    const page = scenarioDetailPage();
    page.t = (key) => key;
    page.scenario = {
      city_hint: "Auckland",
      plan: {
        depos: [{ address: "Depot address", city: "Auckland", poi_location: "174.7600,-36.8500", loc: { id: "depot-poi", location: "174.7600,-36.8500" } }],
        agents: [{ start_address: "Agent address", start_city: "Auckland", start_location: "174.7610,-36.8510", start_loc: { id: "agent-poi", location: "174.7610,-36.8510" } }],
        tickets: [{ address: "Ticket address", city: "Auckland", poi_location: "174.7620,-36.8520", loc: { id: "ticket-poi", location: "174.7620,-36.8520" } }],
        skus: []
      }
    };

    const cases = [
      ["depos", "loc", "174.7633,-36.8485", "poi_location", "address", "city"],
      ["agents", "start_loc", "174.7644,-36.8474", "start_location", "start_address", "start_city"],
      ["tickets", "loc", "174.7655,-36.8463", "poi_location", "address", "city"]
    ];
    for (const [tab, field, input, previewField, addressField, cityField] of cases) {
      const row = page.scenario.plan[tab][0];
      const address = row[addressField];
      const city = row[cityField];
      page.editingCell = { tab, rowIndex: 0, field, type: "coordinate", draftValue: input };

      assert.equal(page.commitEditingCell(), true);
      assert.equal(row[field].location, input);
      assert.equal(row[field].entr_location, input);
      assert.equal(row[field].loc.lon, Number(input.split(",")[0]));
      assert.equal(row[field].loc.lat, Number(input.split(",")[1]));
      assert.equal(row[field].entr_loc.lon, Number(input.split(",")[0]));
      assert.equal(row[field].entr_loc.lat, Number(input.split(",")[1]));
      assert.equal(row[previewField], input);
      assert.equal(row[field].id.endsWith("-poi"), true);
      assert.equal(row[addressField], address);
      assert.equal(row[cityField], city);
    }

    const depot = page.scenario.plan.depos[0];
    page.editingCell = { tab: "depos", rowIndex: 0, field: "loc", type: "coordinate", draftValue: "181,-36.8" };
    assert.equal(page.commitEditingCell(), false);
    assert.equal(page.editingCell.draftValue, "181,-36.8");
    assert.equal(depot.loc.location, "174.7633,-36.8485");
    assert.equal(page.flash.message, "scenario.coordinateFormatError");
  } finally {
    globalThis.window = previousWindow;
  }
});

test("场景表格列宽按各列范围钳制，并在测量后切换为锁定状态", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    getComputedStyle: () => ({ fontSize: "16px" })
  };
  globalThis.document = { documentElement: {} };

  try {
    const { scenarioDetailPage } = await loadPageModule();
    const page = scenarioDetailPage();
    const columns = [
      { dataset: { columnMin: "9rem", columnMax: "11rem", columnGrow: "1" }, style: {} },
      { dataset: { columnMin: "8rem", columnMax: "10rem", columnGrow: "2" }, style: {} },
      { dataset: { columnMin: "5rem", columnMax: "7rem", columnGrow: "1" }, style: {} }
    ];
    const headerCells = [100, 220, 90].map((width) => ({
      getBoundingClientRect: () => ({ width })
    }));
    const table = {
      dataset: {},
      style: {},
      offsetWidth: 0,
      parentElement: { clientWidth: 448 },
      querySelectorAll: () => columns,
      tHead: { rows: [{ cells: headerCells }] }
    };
    page.$root = {
      querySelector: (selector) => selector === '[data-adaptive-table="depos"]' ? table : null
    };

    assert.equal(page.fitAdaptiveTableColumns("depos"), true);
    assert.deepEqual(columns.map((column) => column.style.width), ["176px", "160px", "112px"]);
    assert.equal(table.style.width, "448px");
    assert.equal(table.dataset.columnsFitted, "true");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test("可用空间不足时优先扩展仍被截断的信息列，坐标够用后不吸收剩余宽度", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = {
    getComputedStyle: () => ({ fontSize: "16px" })
  };
  globalThis.document = { documentElement: {} };

  try {
    const { scenarioDetailPage } = await loadPageModule();
    const page = scenarioDetailPage();
    const columns = [
      { dataset: { columnMin: "9rem", columnMax: "10rem" }, style: {} },
      { dataset: { columnMin: "20rem", columnMax: "36rem", columnGrow: "4" }, style: {} },
      { dataset: { columnMin: "5rem", columnMax: "6rem" }, style: {} }
    ];
    const headerCells = [160, 560, 80].map((width) => ({
      getBoundingClientRect: () => ({ width })
    }));
    const table = {
      dataset: {},
      style: {},
      offsetWidth: 0,
      parentElement: { clientWidth: 680 },
      querySelectorAll: () => columns,
      tHead: { rows: [{ cells: headerCells }] }
    };
    page.$root = {
      querySelector: (selector) => selector === '[data-adaptive-table="depos"]' ? table : null
    };

    assert.equal(page.fitAdaptiveTableColumns("depos"), true);
    assert.deepEqual(columns.map((column) => column.style.width), ["160px", "440px", "80px"]);
    assert.equal(table.style.width, "680px");
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});

test("快速切换标签时仅执行最新表格的列宽计算", async () => {
  const previousWindow = globalThis.window;
  const nextTicks = [];
  const frames = [];
  globalThis.window = {
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame() {}
  };

  try {
    const { scenarioDetailPage } = await loadPageModule();
    const page = scenarioDetailPage();
    const fittedTabs = [];
    page.$nextTick = (callback) => nextTicks.push(callback);
    page.fitAdaptiveTableColumns = (tab) => fittedTabs.push(tab);

    page.scheduleAdaptiveTableFit("cost_parameter");
    page.scheduleAdaptiveTableFit("tickets");
    nextTicks.forEach((callback) => callback());
    frames.forEach((callback) => callback());

    assert.deepEqual(fittedTabs, ["tickets"]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("无 host context 时首次保存前禁用规划求解，保存状态生效后失败不跳转、成功上报结果导航", async () => {
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  let submitCalls = 0;
  let navigation = "";
  let submitResponse = { ok: false, error: { message: "保存失败" } };
  const dialog = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; }
  };

  globalThis.window = {
    VrpScenarioGateway: {
      isScenarioComponent: true,
      context: {},
      actions: {
        async submit_scenario() {
          submitCalls += 1;
          return submitResponse;
        }
      },
      navigate(destination) {
        navigation = destination;
      },
      notifyDirty() {},
      notifyCreateReadiness() {},
      notifyWorkspaceChanged() {},
      scheduleResize() {}
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    dispatchEvent() {}
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };

  try {
    const { scenarioDetailPage } = await loadPageModule();
    const page = scenarioDetailPage();
    page.$refs = { planningDialog: dialog };
    page.$nextTick = (callback) => callback?.();
    page.scenario = validScenario();
    page.gatewayMode = true;

    assert.equal(page.openPlanningDrawer(), true);
    page.closePlanningDrawer();

    await page.applyGatewayCreateData({ scenario_persisted: false });
    page.scenario = validScenario();
    assert.equal(page.openPlanningDrawer(), false);
    await page.solveScenario();
    assert.equal(submitCalls, 0);
    assert.equal(navigation, "");

    await page.applyGatewayCreateData({ scenario_persisted: true });
    page.scenario = validScenario();
    assert.equal(page.openPlanningDrawer(), true);
    assert.equal(dialog.open, true);

    await page.solveScenario();
    assert.equal(submitCalls, 1);
    assert.equal(navigation, "");

    submitResponse = { ok: true, data: { job_id: "job-42" } };
    await page.solveScenario();
    assert.equal(submitCalls, 2);
    assert.deepEqual(navigation, { target: "result", result_job_id: "job-42" });
    assert.equal(dialog.open, false);
  } finally {
    globalThis.window = previousWindow;
    globalThis.CustomEvent = previousCustomEvent;
  }
});

test("组件公开抽屉不依赖 host 字段", async () => {
  const previousWindow = globalThis.window;
  const dialog = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; }
  };
  globalThis.window = {
    VrpScenarioGateway: {
      isScenarioComponent: true,
      context: {}
    }
  };

  try {
    const { scenarioDetailPage } = await loadPageModule();
    const page = scenarioDetailPage();
    page.$refs = { planningDialog: dialog };
    page.$nextTick = (callback) => callback?.();
    page.scenario = validScenario();

    assert.equal(page.openPlanningDrawer(), true);
    assert.equal(page.planningDrawer.open, true);
    assert.equal(dialog.open, true);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("右侧场景概览与空闲车辆趋势由 context 展示能力启用", async () => {
  const previousWindow = globalThis.window;
  let availableAgentLoads = 0;
  const makePage = async (context) => {
    globalThis.window = {
      VrpScenarioGateway: {
        isScenarioComponent: true,
        context,
        actions: {
          async load_available_agent_windows() {
            availableAgentLoads += 1;
            return { ok: true, data: [{ start_time: "08:00", end_time: "10:00", available_agents: 3 }] };
          }
        },
        registerComponent() {},
        notifyDirty() {},
        notifyCreateReadiness() {},
        scheduleResize() {}
      },
      setInterval() { return 1; },
      clearInterval() {}
    };
    const { scenarioDetailPage } = await loadPageModule();
    const page = scenarioDetailPage();
    await page.init();
    return page;
  };

  try {
    const enginePage = await makePage({ scenario_overview: true, available_agent_trend: true });
    enginePage.scenario = validScenario();
    enginePage.scenario.plan.depos.push({ id: "depot-1" });
    enginePage.scenario.plan.tickets.push({ id: "ticket-1" });
    assert.equal(enginePage.showScenarioOverview, true);
    assert.equal(enginePage.showAvailableAgentTrend, true);
    assert.deepEqual(enginePage.currentScenarioStats(), [
      ["仓库", 1],
      ["车辆/工程师", 0],
      ["工单", 1],
      ["SKU", 0]
    ]);
    assert.equal(enginePage.isSidebarPanelOpen("overview"), true);
    enginePage.toggleSidebarPanel("overview");
    assert.equal(enginePage.isSidebarPanelOpen("overview"), false);
    enginePage.toggleSidebarPanel("availableAgents");
    assert.equal(enginePage.isSidebarPanelOpen("availableAgents"), true);
    enginePage.$nextTick = (callback) => callback();
    assert.equal(enginePage.sidebarCollapsed, false);
    enginePage.toggleScenarioSidebar();
    assert.equal(enginePage.sidebarCollapsed, true);
    enginePage.toggleScenarioSidebar();
    assert.equal(enginePage.sidebarCollapsed, false);
    await enginePage.refreshAvailableAgentTrend();
    assert.equal(availableAgentLoads, 1);
    assert.deepEqual(enginePage.availableAgentWindows, [{ start_time: "08:00", end_time: "10:00", available_agents: 3 }]);

    const gatewayPage = await makePage({});
    assert.equal(gatewayPage.showScenarioOverview, false);
    assert.equal(gatewayPage.showAvailableAgentTrend, false);
    await gatewayPage.refreshAvailableAgentTrend();
    assert.equal(availableAgentLoads, 1);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("结果、地图和工单定位使用无 Host 的语义导航目标", async () => {
  const previousWindow = globalThis.window;
  const destinations = [];
  globalThis.window = {
    VrpScenarioGateway: {
      isScenarioComponent: true,
      navigate(destination) {
        destinations.push(destination);
      }
    }
  };

  try {
    const { solverJobDetailPage } = await loadModule(solverJobDetailPagePath);
    const { solverJobMapPage } = await loadModule(solverJobMapPagePath);
    const result = solverJobDetailPage();
    result.job = { id: "result-42" };
    result.openMap();
    result.openScenarioTicket("ticket-7");

    const map = solverJobMapPage();
    map.job = { id: "result-42" };
    map.simulationValue = new Date("2026-07-14T08:00:00").getTime();
    const focusedAgent = {
      tickets: [{
        id: "ticket-8",
        arrival_time: "2026-07-14 09:00:00",
        departure_time: "2026-07-14 09:30:00"
      }]
    };
    assert.equal(map.jumpableNextTicketId(focusedAgent), "ticket-8");
    map.openScenarioTicket(map.jumpableNextTicketId(focusedAgent));
    map.backToDetail();

    assert.deepEqual(destinations, [
      { target: "map", result_job_id: "result-42" },
      { target: "create", intent: "focus_ticket", ticket_id: "ticket-7" },
      { target: "create", intent: "focus_ticket", ticket_id: "ticket-8" },
      { target: "result", result_job_id: "result-42" }
    ]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("一张图回放从最早仓库出发播放到最后一个工单结束", async () => {
  const { simulationBounds, solverJobMapPage } = await loadModule(solverJobMapPagePath);
  const job = {
    start_date_time: "2026-07-14 00:00:00",
    end_date_time: "2026-07-15 00:00:00",
    plan: {
      agents: [
        {
          id: "agent-without-tickets",
          shift_start_time: "2026-07-14 06:00:00",
          shift_off_time: "2026-07-14 20:00:00",
          tickets: []
        },
        {
          id: "agent-1",
          shift_start_time: "2026-07-14 08:10:00",
          shift_off_time: "2026-07-14 18:00:00",
          tickets_done_time: "2026-07-14 17:00:00",
          tickets: [
            {
              id: "ticket-1",
              arrival_time: "2026-07-14 09:00:00",
              departure_time: "2026-07-14 09:30:00"
            },
            {
              id: "ticket-2",
              arrival_time: "2026-07-14 16:00:00",
              departure_time: "2026-07-14 16:20:00"
            }
          ]
        },
        {
          id: "agent-2",
          shift_start_time: "2026-07-14 07:45:00",
          shift_off_time: "2026-07-14 19:00:00",
          tickets_done_time: "2026-07-14 16:50:00",
          tickets: [
            {
              id: "ticket-3",
              arrival_time: "2026-07-14 11:00:00",
              departure_time: "2026-07-14 11:25:00"
            }
          ]
        },
        {
          id: "virtual-agent",
          is_virtual: true,
          shift_start_time: "2026-07-14 05:00:00",
          tickets: [{
            id: "virtual-ticket",
            arrival_time: "2026-07-14 20:00:00",
            departure_time: "2026-07-14 21:00:00"
          }]
        }
      ]
    }
  };
  const bounds = simulationBounds(job);

  assert.deepEqual(bounds, {
    min: new Date("2026-07-14T07:45:00").getTime(),
    max: new Date("2026-07-14T16:20:00").getTime()
  });

  const map = solverJobMapPage();
  map.job = job;
  map.bounds = bounds;
  const ticks = map.simulationTicks();
  assert.equal(ticks[0].timeLabel, "07:45");
  assert.equal(ticks.at(-1).timeLabel, "16:20");

  map.focusAgentId = "agent-1";
  map.simulationValue = bounds.max;
  assert.equal(map.currentState(map.currentFocusAgent()).current, "__map_return_complete__");
  assert.equal(map.currentFocusCompletedTasks(), 2);
  assert.equal(map.currentFocusRemainingTasks(), 0);
});

test("Engine submit action 仅在场景保存成功后才提交求解", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  const response = (ok, payload) => ({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Save failed",
    headers: { get: () => "application/json" },
    json: async () => payload
  });

  try {
    const { engineScenarioActions } = await loadEngineActionsModule();
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), method: options.method || "GET" });
      return response(false, { message: "保存失败" });
    };

    const input = {
      expected_solve_duration: "PT30S",
      request_payload: { options: { matrix_mode: "AMAP", build_transit_matrix: true, draw_route: false } }
    };
    const failed = await engineScenarioActions().submit_scenario(input);
    assert.equal(failed.ok, false);
    assert.deepEqual(requests, [{ url: "/scenario?build=true&matrix_mode=AMAP", method: "PUT" }]);

    requests.length = 0;
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), method: options.method || "GET" });
      return options.method === "PUT"
        ? response(true, {})
        : response(true, { id: "job-42", status: "SOLVING_SCHEDULED" });
    };
    const success = await engineScenarioActions().submit_scenario(input);
    assert.equal(success.ok, true);
    assert.equal(success.data.job_id, "job-42");
    assert.deepEqual(requests, [
      { url: "/scenario?build=true&matrix_mode=AMAP", method: "PUT" },
      { url: "/solver_job?solve_time=PT30S&matrix_mode=AMAP&build_transit_matrix=true&draw_route=false", method: "POST" }
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Engine submit action 未指定矩阵方式时默认使用 Manhattan", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || "GET" });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => options.method === "PUT" ? {} : { id: "job-43", status: "SOLVING_SCHEDULED" }
    };
  };

  try {
    const { engineScenarioActions } = await loadEngineActionsModule();
    const result = await engineScenarioActions().submit_scenario({
      expected_solve_duration: "PT30S",
      request_payload: { options: { build_transit_matrix: true, draw_route: false } }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(requests, [
      { url: "/scenario?build=true&matrix_mode=MANHATTAN", method: "PUT" },
      { url: "/solver_job?solve_time=PT30S&matrix_mode=MANHATTAN&build_transit_matrix=true&draw_route=false", method: "POST" }
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Engine 空闲车辆趋势 action 读取现有场景时间窗接口", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || "GET" });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "application/json" },
      json: async () => [{ start_time: "08:00", end_time: "10:00", available_agents: 3 }]
    };
  };

  try {
    const { engineScenarioActions } = await loadEngineActionsModule();
    const response = await engineScenarioActions().load_available_agent_windows();
    assert.equal(response.ok, true);
    assert.deepEqual(response.data, [{ start_time: "08:00", end_time: "10:00", available_agents: 3 }]);
    assert.deepEqual(requests, [{ url: "/scenario/available_agents", method: "GET" }]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
