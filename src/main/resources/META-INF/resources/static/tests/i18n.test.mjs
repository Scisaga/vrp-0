import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = path.resolve(testDirectory, "..");

async function loadModule(relativePath) {
  const result = await build({
    entryPoints: [path.resolve(staticRoot, relativePath)],
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

async function loadScenarioEntry() {
  const result = await build({
    entryPoints: [path.resolve(staticRoot, "assets/js/scenario-component-entry.js")],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    define: {
      __SCENARIO_COMPONENT_TEMPLATES__: JSON.stringify({ create: "", result: "", map: "" })
    }
  });
  const module = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}

test("Engine locale normalizes values and localizes typed API errors without server messages", async () => {
  const i18n = await loadModule("assets/js/i18n/engine-i18n.js");

  assert.equal(i18n.normalizeLocale("en-US"), "en-US");
  assert.equal(i18n.normalizeLocale("fr-FR"), "zh-CN");
  assert.equal(
    i18n.localizeApiError({ errorCode: "scenario_map_provider_mismatch", errorParams: { expected_provider: "AMAP" } }, "en-US"),
    "The scenario map provider must match this instance (AMAP)."
  );
  assert.equal(
    i18n.localizeApiError({ errorCode: "future_unknown_error", message: "server-only diagnostic" }, "en-US"),
    "The service is temporarily unavailable. Try again later."
  );
});

test("semantic Engine and Scenario catalogs stay complete and never use a Chinese source-text fallback", async () => {
  const engine = await loadModule("assets/js/i18n/engine-i18n.js");
  const component = await loadModule("assets/js/i18n/scenario-component-i18n.js");
  assert.deepEqual(
    Object.keys(engine.ENGINE_MESSAGES["zh-CN"]).sort(),
    Object.keys(engine.ENGINE_MESSAGES["en-US"]).sort()
  );
  assert.deepEqual(
    Object.keys(component.COMPONENT_MESSAGES["zh-CN"]).sort(),
    Object.keys(component.COMPONENT_MESSAGES["en-US"]).sort()
  );
  assert.equal(engine.t("scenario.host.planAndSolve", {}, "en-US"), "Plan and solve");
  assert.equal(engine.t("route.jobs.title", {}, "zh-CN"), "任务列表");
  assert.equal(engine.t("route.jobs.title", {}, "en-US"), "Jobs");
  assert.equal(engine.t("route.quota.title", {}, "en-US"), "Map Api");
  assert.equal(engine.t("route.mcp.title", {}, "en-US"), "Mcp Api");
  assert.equal(engine.t("route.jobs.menu", {}, "zh-CN"), "任务列表");
  assert.equal(engine.t("route.quota.menu", {}, "en-US"), "Map Api");
  assert.equal(engine.t("route.mcp.menu", {}, "en-US"), "Mcp Api");
  assert.equal(engine.t("missing.key", {}, "en-US"), "Text unavailable");
  const catalog = component.createScenarioComponentI18n("en-US", null);
  assert.equal(catalog.t("scenario.availableTechnicians"), "Available technicians");
  assert.equal(catalog.t("scenario.solveDrawer.seconds"), "s");
  assert.equal(catalog.t("scenario.solveDrawer.minutes"), "min");
  assert.equal(catalog.t("scenario.solveDrawer.hours"), "h");
  assert.equal(catalog.t("scenario.field.loadWeightWithUnit"), "Load weight (t)");
  assert.equal(catalog.t("scenario.field.volumeCapacityWithUnit"), "Volume capacity (m³)");
  assert.equal(catalog.t("scenario.field.weightWithUnit"), "Weight (t)");
  assert.equal(catalog.t("scenario.field.volumeWithUnit"), "Volume (m³)");
  assert.equal(catalog.t("scenario.validation.singleTitle"), "Fix this item to continue");
  assert.equal(catalog.t("scenario.validation.multipleTitle", { count: 3 }), "Fix these 3 items to continue");
  assert.equal(catalog.t("scenario.validation.invalidMatrixMode"), "Matrix generation mode must be ROUTING or MANHATTAN.");
  assert.equal(catalog.t("scenario.validation.dismiss"), "Dismiss validation summary");
  assert.equal(catalog.t("cost.cross_region_threshold"), "Cross-region threshold");
  assert.equal(catalog.t("cost.unit.yuan_per_trip"), "CNY/trip");
  assert.equal(catalog.t("cost.unit.per_kwh"), "/kWh");
  assert.equal(catalog.t("cost.unit.per_liter"), "/L");
  assert.equal(catalog.t("result.unit.cost"), "CNY");
  assert.equal(catalog.t("result.unit.costPerTonKm"), "CNY/t·km");
  assert.equal(catalog.t("missing.key"), "Text unavailable");
});

test("desktop navigation uses the VRP-0 logo as its only collapse control and the DFST purple highlight", () => {
  const index = fs.readFileSync(path.resolve(staticRoot, "index.html"), "utf8");
  const css = fs.readFileSync(path.resolve(staticRoot, "assets/css/style.css"), "utf8");
  assert.match(index, /class="frame-brand-button frame-top-band ui-tooltip flex w-full shrink-0 items-center border-b-\[1\.25px\] border-slate-200"/);
  assert.match(index, /@click="toggleSidebar\(\)"/);
  assert.doesNotMatch(index, /keyboard_double_arrow/);
  assert.doesNotMatch(index, /frame\.workspace/);
  assert.doesNotMatch(index, /groupLabelKey|nav-group-label/);
  assert.doesNotMatch(css, /nav-group-label/);
  assert.doesNotMatch(index, /t\(item\.descKey\)/);
  assert.match(index, /<title>VRP-0<\/title>/);
  assert.match(index, /<link rel="icon" href="assets\/img\/vrp-0-logo\.png" type="image\/png">/);
  assert.match(index, /src="assets\/img\/vrp-0-logo\.png"/);
  assert.match(index, /class="truncate text-\[1\.09375rem\]\/\[1\.5625rem\] font-medium text-slate-700">VRP-0<\/div>/);
  assert.match(index, /class="text-\[1\.25rem\]\/\[1\.875rem\] font-medium text-slate-950" x-text="currentPageTitle"/);
  assert.doesNotMatch(index, /x-text="currentPageDescription"/);
  assert.match(index, /<header class="sticky top-0 z-20 bg-white\/85 backdrop-blur">/);
  assert.match(index, /class="frame-top-band flex items-center justify-between gap-\[0\.9375rem\] border-b-\[1\.25px\] border-slate-200 px-\[1\.25rem\] py-\[0\.625rem\] min-\[800px\]:px-\[1\.875rem\]"/);
  assert.match(index, /class="rounded-\[0\.46875rem\] border-\[1\.25px\] border-slate-200 bg-white px-\[0\.3125rem\] py-\[0\.3125rem\] text-\[0\.9375rem\]\/\[1\.25rem\] font-medium text-slate-700 outline-none/);
  assert.match(index, /:class="locale === 'zh-CN' \? 'w-\[4\.375rem\]' : 'w-\[5\.625rem\]'"/);
  assert.match(index, /sidebarCollapsed \? 'min-\[960px\]:w-\[4\.375rem\]' : 'min-\[960px\]:w-\[12\.5rem\]'/);
  assert.match(index, /sidebarCollapsed \? 'flex flex-col items-center space-y-\[0\.78125rem\] px-\[0\.3125rem\] pb-\[0\.78125rem\] pt-\[0\.78125rem\]' : 'space-y-\[0\.78125rem\] px-\[0\.78125rem\] pb-\[0\.78125rem\] pt-\[0\.78125rem\]'/);
  assert.match(index, /sidebarCollapsed \? 'inline-flex h-\[2\.8125rem\] w-\[2\.8125rem\] justify-center rounded-\[0\.3125rem\] p-0' : 'flex w-full gap-\[0\.625rem\] rounded-\[0\.625rem\] px-\[0\.78125rem\] py-\[0\.46875rem\]'/);
  assert.match(index, /isActive\(item\.route\) \? 'frame-nav-item-active'/);
  assert.match(css, /--dfst-brand-purple: #4d4397;/);
  assert.match(css, /--dfst-brand-purple-border: rgb\(77 67 151 \/ 0\.2\);/);
  assert.match(css, /\.frame-top-band \{\s*height: 3\.75rem;/);
  assert.match(css, /\.frame-nav-item-active \{\s*background: var\(--dfst-brand-purple-soft\);/);
});

test("first-party Host and component templates bind screenshot copy to semantic keys", () => {
  const host = fs.readFileSync(path.resolve(staticRoot, "pages/scenario-component.html"), "utf8");
  const scenario = fs.readFileSync(path.resolve(staticRoot, "pages/scenario-detail.html"), "utf8");
  const result = fs.readFileSync(path.resolve(staticRoot, "pages/solver-job-detail.html"), "utf8");
  const map = fs.readFileSync(path.resolve(staticRoot, "pages/solver-job-map.html"), "utf8");
  const mcp = fs.readFileSync(path.resolve(staticRoot, "pages/mcp.html"), "utf8");
  const quota = fs.readFileSync(path.resolve(staticRoot, "pages/quota.html"), "utf8");
  const jobs = fs.readFileSync(path.resolve(staticRoot, "pages/solver-job-list.html"), "utf8");
  const resultFactory = fs.readFileSync(path.resolve(staticRoot, "assets/js/pages/solver-job-detail-page.js"), "utf8");
  const frame = fs.readFileSync(path.resolve(staticRoot, "assets/js/components/frame.js"), "utf8");
  const engineI18n = fs.readFileSync(path.resolve(staticRoot, "assets/js/i18n/engine-i18n.js"), "utf8");
  assert.match(host, /t\('scenario\.host\.planAndSolve'\)/);
  assert.match(scenario, /scenario\.tabHelp\.tickets/);
  assert.match(scenario, /:data-tooltip="t\(\{ depos: 'scenario\.tabHelp\.depots'/);
  assert.match(scenario, /:aria-description="t\(\{ depos: 'scenario\.tabHelp\.depots'/);
  assert.match(scenario, /\['depos','scenario\.tabs\.depots','warehouse'\]/);
  assert.match(scenario, /\['agents','scenario\.tabs\.agents','engineering'\]/);
  assert.match(scenario, /class="material-symbols-rounded text-\[22\.5px\]" aria-hidden="true" x-text="tab\[2\]"/);
  assert.doesNotMatch(scenario, />info<\/span>/);
  assert.doesNotMatch(scenario, /scenario-tab-help-tooltip-/);
  assert.doesNotMatch(scenario, /min-w-0 text-xs leading-5 text-slate-500 xl:ml-2 xl:flex-1/);
  assert.match(scenario, /t\('scenario\.availableTechnicians'\)/);
  assert.equal((scenario.match(/t\('scenario\.field\.weightWithUnit'\)/g) || []).length, 2);
  assert.equal((scenario.match(/t\('scenario\.field\.volumeWithUnit'\)/g) || []).length, 2);
  assert.match(scenario, /t\('scenario\.field\.loadWeightWithUnit'\)/);
  assert.match(scenario, /t\('scenario\.field\.volumeCapacityWithUnit'\)/);
  assert.match(scenario, /t\('scenario\.solveDrawer\.currentScenario'\)/);
  assert.match(scenario, /t\('scenario\.solveDrawer\.title'\)/);
  assert.doesNotMatch(result, /result\.toolbar\.autoRefresh|result\.toolbar\.copyRequest/);
  assert.match(result, /result\.loading\.title/);
  assert.match(result, /result\.map\.loading/);
  assert.match(result, /t\('result\.constraint\.title'\)/);
  assert.match(result, /t\('result\.summary\.jobIdAria'/);
  assert.match(result, /t\(selectedAgentRouteNotice\(\)\.key\)/);
  assert.match(map, /t\(agentRouteNotice\(agent\)\.key\)/);
  assert.match(map, /t\('map\.toolbar\.backToDetail'/);
  assert.match(map, /t\('map\.timeline\.title'/);
  assert.match(map, /t\('map\.agentPanel\.title'/);
  assert.match(map, /t\('map\.bigScreen\.replayConsole'/);
  assert.doesNotMatch(result, /[\u3400-\u9fff]/);
  assert.doesNotMatch(map, /[\u3400-\u9fff]/);
  assert.doesNotMatch(resultFactory.replace(/^\s*\/\/.*$/gm, ""), /[\u3400-\u9fff]/);
  const mapFactory = fs.readFileSync(path.resolve(staticRoot, "assets/js/pages/solver-job-map-page.js"), "utf8");
  assert.doesNotMatch(mapFactory.replace(/^\s*\/\/.*$/gm, ""), /[\u3400-\u9fff]/);
  assert.match(mcp, /t\('mcp\.workflow\.step1\.action'\)/);
  assert.match(mcp, /x-text="mcpClientConfig\(\)"/);
  assert.doesNotMatch(mcp, /[\u3400-\u9fff]/);
  assert.match(quota, /t\('quota\.geocodingProvider'\)/);
  assert.match(jobs, /t\('jobs\.filter\.status'\)/);
  assert.doesNotMatch(quota, /[\u3400-\u9fff]/);
  assert.doesNotMatch(jobs, /[\u3400-\u9fff]/);
  assert.doesNotMatch(frame, /createEngineDomTranslator|data-i18n-legacy-root|legacyPageTranslator/);
  assert.doesNotMatch(engineI18n, /MutationObserver|createEngineDomTranslator|translateEngineText/);
});

test("仓库、工程师和工单坐标位于地址列之前且支持直接编辑，地址操作不挤压地址文本", () => {
  const scenario = fs.readFileSync(path.resolve(staticRoot, "pages/scenario-detail.html"), "utf8");
  const appCss = fs.readFileSync(path.resolve(staticRoot, "assets/css/style.css"), "utf8");
  const businessCss = fs.readFileSync(path.resolve(staticRoot, "assets/css/scenario-business.source.css"), "utf8");
  assert.match(scenario, /<table class="data-table data-table-adaptive" data-adaptive-table="depos" x-init="\$nextTick\(\(\) => fitAdaptiveTableColumns\('depos'\)\)">[\s\S]*?data-column-grow="2"[\s\S]*?data-column-min="11\.25rem" data-column-max="12\.5rem" style="width: 11\.25rem;">[\s\S]*?data-column-max="45rem" data-column-grow="4"/);
  assert.match(scenario, /<thead><tr><th>ID<\/th><th>名称<\/th><th>坐标<\/th><th>地址<\/th>/);
  assert.match(scenario, /<thead><tr><th>ID<\/th><th>日期<\/th><th>名称<\/th><th>坐标<\/th><th>初始地址<\/th>/);
  assert.match(scenario, /<thead><tr><th>ID<\/th><th>类型<\/th><th>坐标<\/th><th>客户地址<\/th>/);
  assert.equal((scenario.match(/class="table-cell-button table-coordinate-cell ui-tooltip"/g) || []).length, 3);
  assert.equal((scenario.match(/beginCoordinateEdit\(/g) || []).length, 3);
  assert.equal((scenario.match(/scenario\.coordinateInputPlaceholder/g) || []).length, 6);
  assert.equal((scenario.match(/class="cell-input font-mono tabular-nums" inputmode="decimal"/g) || []).length, 3);
  assert.match(scenario, /class="table-location-cell"/);
  assert.match(scenario, /class="table-location-actions"/);
  assert.match(scenario, /class="table-cell-button table-location-address-button ui-tooltip"/);
  assert.match(scenario, /class="table-cell-main table-location-address truncate"/);
  assert.equal((scenario.match(/\btable-location-cell\b/g) || []).length, 6);
  assert.equal((scenario.match(/\btable-coordinate-cell\b/g) || []).length, 3);
  assert.equal((scenario.match(/class="table-location-meta-row"/g) || []).length, 0);
  assert.equal((scenario.match(/class="table-cell-button table-location-address-button ui-tooltip"/g) || []).length, 3);
  assert.doesNotMatch(scenario, /class="flex items-start gap-3" style="min-width: 18rem;"/);
  assert.match(businessCss, /\.table-coordinate-cell \{\s*@apply flex min-h-\[2\.8125rem\] w-full min-w-0 items-center gap-\[0\.46875rem\] px-\[0\.78125rem\] py-\[0\.15625rem\];/);
  assert.match(businessCss, /\.data-table td:has\(\.table-coordinate-cell\) \{\s*@apply p-0;/);
  assert.match(businessCss, /\.table-location-address-button \{\s*@apply min-w-0 w-auto flex-1;/);
  assert.match(businessCss, /\.table-location-meta-row \{\s*@apply flex min-w-0 flex-1 items-center gap-\[0\.46875rem\] overflow-hidden;/);
  assert.match(businessCss, /\.table-location-actions \{\s*@apply flex shrink-0 items-center gap-\[0\.625rem\] whitespace-nowrap;/);
  assert.match(appCss, /\.table-cell-link \{\s*@apply [^;]*\bpx-0\b[^;]*;/);
  assert.match(businessCss, /\.table-cell-link \{\s*@apply [^;]*\bpx-0\b[^;]*;/);
});

test("场景描述默认显示两行摘要，并通过弹框编辑", () => {
  const scenario = fs.readFileSync(path.resolve(staticRoot, "pages/scenario-detail.html"), "utf8");
  const businessCss = fs.readFileSync(path.resolve(staticRoot, "assets/css/scenario-business.source.css"), "utf8");

  assert.match(scenario, /x-ref="descriptionDialog"/);
  assert.match(scenario, /x-ref="descriptionEditorInput"/);
  assert.match(scenario, /class="scenario-description-preview ui-tooltip mt-\[0\.15625rem\]"/);
  assert.match(scenario, /@click="openDescriptionEditor\(\)"/);
  assert.doesNotMatch(scenario, />点击编辑</);
  assert.doesNotMatch(scenario, /<textarea rows="2" class="field-textarea mt-0\.5 h-\[3rem\]/);
  assert.match(businessCss, /\.scenario-description-preview \{\s*@apply flex h-\[4\.375rem\] w-full items-start gap-\[0\.625rem\] overflow-hidden/);
  assert.match(businessCss, /-webkit-line-clamp: 2;/);
});

test("场景顶部工具栏左侧保留矩阵与求解，右侧将保存、独立导入导出和删除分组", () => {
  const host = fs.readFileSync(path.resolve(staticRoot, "pages/scenario-component.html"), "utf8");
  const businessCss = fs.readFileSync(path.resolve(staticRoot, "assets/css/scenario-business.source.css"), "utf8");
  const workflowStart = host.indexOf('data-scenario-toolbar-group="workflow"');
  const managementStart = host.indexOf('data-scenario-toolbar-group="scenario-management"');
  const workflow = host.slice(workflowStart, managementStart);
  const management = host.slice(managementStart, host.indexOf('\n  </div>\n\n  <div class="flex-1', managementStart));
  const matrixIndex = workflow.indexOf('@click="generateMatrix()"');
  const solveIndex = workflow.indexOf('@click="openPlanningDrawer()"');
  const saveGroupIndex = management.indexOf('data-scenario-toolbar-section="save"');
  const saveIndex = management.indexOf('@click="saveScenario()"');
  const importGroupIndex = management.indexOf('data-scenario-toolbar-section="import-export"');
  const importIndex = management.indexOf('@click="openImportSolveRequestDialog()"');
  const exportIndex = management.indexOf('@click="copySolveRequestPayload()"');
  const dangerGroupIndex = management.indexOf('data-scenario-toolbar-section="danger"');
  const deleteIndex = management.indexOf('@click="deleteScenario()"');

  assert.ok(workflowStart >= 0 && managementStart > workflowStart);
  assert.ok(matrixIndex >= 0 && solveIndex > matrixIndex);
  assert.ok(saveGroupIndex >= 0 && saveIndex > saveGroupIndex);
  assert.ok(importGroupIndex > saveIndex && importIndex > importGroupIndex);
  assert.ok(exportIndex > importIndex);
  assert.ok(dangerGroupIndex > exportIndex && deleteIndex > dangerGroupIndex);
  assert.equal((management.match(/aria-hidden="true"/g) || []).length, 2);
  assert.doesNotMatch(management, /scenario-import-export-menu|toolbarImportMenuOpen|role="menuitem"/);
  assert.doesNotMatch(host, /formatImportRequestJson|toggleImportRequestFold|common\.format|common\.collapseAll/);
  assert.match(businessCss, /\.scenario-description-preview-text \{\s*@apply min-w-0 flex-1 break-words text-\[16\.25px\] leading-\[1\.5625rem\] text-slate-500;/);
});

test("MCP page copy and client snippets use the active semantic locale", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://vrp.example.test" } };

  try {
    const { mcpPage } = await loadModule("assets/js/pages/mcp-page.js");
    const page = mcpPage();
    page.locale = "en-US";

    assert.equal(page.t("mcp.workflow.step1.action"), "write the current scenario");
    assert.equal(page.statusText(), "Disabled");
    assert.equal(page.allowedOriginsText(), "No allowlist configured");
    assert.equal(page.clientTabTitle(), "Harness");
    assert.match(page.clientTabDescription(), /MCP Server Connector/);
    assert.match(page.mcpClientConfig(), /https:\/\/vrp\.example\.test\/mcp/);
    assert.match(page.mcpClientConfig(), /your Bearer Token/);
    assert.match(page.mcpClientConfig(), /headerName: Authorization/);
    assert.match(page.mcpClientConfig(), /headerValueRef: <your_vrp0_bearer_secret>/);

    page.selectClientTab("codex");
    assert.match(page.clientTabDescription(), /environment variable/);
    assert.match(page.mcpClientConfig(), /<your Bearer Token>/);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("solver status and boolean display mappings use the active Engine locale and preserve unknown enums", async () => {
  const list = await loadModule("assets/js/pages/solver-job-list-page.js");
  const page = list.solverJobListPage();
  assert.equal(page.statusInfo("SOLVING_ACTIVE", "en-US").text, "Solving");
  assert.equal(page.displayBoolean(true, "en-US"), "Yes");
  assert.equal(page.statusInfo("FUTURE_STATUS", "en-US").text, "FUTURE_STATUS");
});

test("Engine locale restores and persists the browser setting", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousCustomEvent = globalThis.CustomEvent;
  const storage = new Map([["vrp0.engine.locale", "en-US"]]);
  const events = [];
  globalThis.window = {
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    dispatchEvent: (event) => events.push(event)
  };
  globalThis.document = { documentElement: { setAttribute() {} } };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

  try {
    const i18n = await loadModule("assets/js/i18n/engine-i18n.js");
    assert.equal(i18n.initEngineLocale(), "en-US");
    assert.equal(i18n.setEngineLocale("zh-CN"), "zh-CN");
    assert.equal(storage.get("vrp0.engine.locale"), "zh-CN");
    assert.deepEqual(events.at(-1).detail, { locale: "zh-CN" });
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.CustomEvent = previousCustomEvent;
  }
});

test("durations use the active display locale without changing their API value", async () => {
  const api = await loadModule("assets/js/utils/api.js");
  assert.equal(api.formatDuration("PT1H2M3S", "zh-CN"), "1小时2分钟3秒");
  assert.equal(api.formatDuration("PT1H2M3S", "en-US"), "1 h 2 min 3 s");
  assert.equal(api.formatDuration("P1D", "en-US"), "1 day");
});

test("求解时间在场景、任务列表和任务详情中使用同一语言单位", async () => {
  const [scenario, list, detail] = await Promise.all([
    loadModule("assets/js/pages/scenario-detail-page.js"),
    loadModule("assets/js/pages/solver-job-list-page.js"),
    loadModule("assets/js/pages/solver-job-detail-page.js")
  ]);
  const pages = [
    scenario.scenarioDetailPage(),
    list.solverJobListPage(),
    detail.solverJobDetailPage()
  ];

  for (const locale of ["zh-CN", "en-US"]) {
    pages.forEach((page) => { page.locale = locale; });
    const expected = locale === "zh-CN" ? "1分钟30秒" : "1 min 30 s";
    pages.forEach((page) => assert.equal(page.displaySolveTime("PT1M30S"), expected));
  }
});

test("Scenario component localizes typed errors and never falls back to a server message", async () => {
  const i18n = await loadModule("assets/js/i18n/scenario-component-i18n.js");
  const catalog = i18n.createScenarioComponentI18n("en-US", null);
  assert.equal(
    catalog.localizeError({ code: "scenario_map_provider_mismatch", params: { expected_provider: "AMAP" } }),
    "The scenario map provider must match this instance (AMAP)."
  );
  assert.equal(
    catalog.localizeError({ code: "unknown_code", message: "server-only diagnostic" }),
    "The service is temporarily unavailable. Try again later."
  );
  assert.equal(
    catalog.t("map.routeNotice.carFallback"),
    "Fell back to standard car routing; truck restrictions are not considered."
  );
});

test("Scenario component ships its own inline locale catalog", () => {
  const componentHtml = fs.readFileSync(path.resolve(staticRoot, "scenario.html"), "utf8");
  assert.match(componentHtml, /scenario_map_provider_mismatch/);
  assert.match(componentHtml, /The scenario map provider must match this instance/);
  assert.match(componentHtml, /scenario\.availableTechnicians/);
  assert.match(componentHtml, /Available technicians/);
  assert.doesNotMatch(componentHtml, /engine-i18n\.js/);
  assert.doesNotMatch(componentHtml, /scenario-component-i18n\.js"/);
});

test("Scenario locale context update preserves the active result and does not reload it", async () => {
  const previousWindow = globalThis.window;
  const previousNode = globalThis.Node;
  const previousCustomEvent = globalThis.CustomEvent;
  const rootElement = {
    nodeType: 1,
    dataset: {},
    children: [],
    childNodes: [],
    setAttribute() {},
    hasAttribute() { return false; },
    getAttribute() { return null; },
    querySelectorAll() { return []; }
  };
  const root = { querySelector: (selector) => selector === "#scenario-root" ? rootElement : null };
  const component = { dispatchEvent() {} };
  let scope = null;
  let page = null;
  let calls = 0;
  globalThis.Node = { ELEMENT_NODE: 1, TEXT_NODE: 3 };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.window = {
    dispatchEvent() {},
    VrpScenarioGateway: null
  };
  const Alpine = {
    addScopeToNode(_node, nextScope) { scope = nextScope; },
    initTree() {
      page = scope.scenarioComponentPageData();
      window.VrpScenarioGateway.registerComponent("result", page);
    },
    destroyTree() {}
  };

  try {
    const { mountScenarioUi } = await loadScenarioEntry();
    const context = {
      view: "result",
      locale: "zh-CN",
      result_job_id: "job-1",
      map_context: { enabled: true, provider: "amap", locale: "zh-CN" },
      result_context: null
    };
    const lifecycle = mountScenarioUi(component, root, context, {
      load_scenario_result: async () => {
        calls += 1;
        return { ok: true, data: { task: { id: "job-1" } } };
      }
    }, Alpine);
    await Promise.resolve();
    assert.equal(calls, 1);

    await lifecycle.updateContext({
      ...context,
      locale: "en-US",
      map_context: { enabled: true, provider: "amap", locale: "en-US" }
    });
    assert.equal(calls, 1);
    assert.equal(window.VrpScenarioGateway.context.locale, "en-US");
    assert.equal(window.VrpScenarioGateway.context.map_context.locale, "en-US");
  } finally {
    globalThis.window = previousWindow;
    globalThis.Node = previousNode;
    globalThis.CustomEvent = previousCustomEvent;
  }
});
