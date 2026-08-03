const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "scenario.html"), "utf8");
const componentRequirements = fs.readFileSync(path.resolve(root, "..", "..", "..", "scenario-ui", "component-dependencies.json"), "utf8");
const registry = JSON.parse(fs.readFileSync(path.join(root, "assets", "scenario-runtime", "registry.json"), "utf8"));
const engineIndex = fs.readFileSync(path.join(root, "index.html"), "utf8");
const engineHost = fs.readFileSync(path.join(root, "pages/scenario-component.html"), "utf8");
const engineHostPage = fs.readFileSync(path.join(root, "assets/js/pages/scenario-component-page.js"), "utf8");
const scenarioEntry = fs.readFileSync(path.join(root, "assets/js/scenario-component-entry.js"), "utf8");
const dateTimeComponent = fs.readFileSync(path.join(root, "assets/js/components/date-time-24-input.js"), "utf8");
const scenarioRuntime = fs.readFileSync(path.join(root, "assets/js/utils/scenario-component-runtime.js"), "utf8");
const hostDependencies = fs.readFileSync(path.join(root, "assets/js/utils/scenario-host-dependencies.js"), "utf8");
const frame = fs.readFileSync(path.join(root, "assets/js/components/frame.js"), "utf8");
const scenarioDetailPage = fs.readFileSync(path.join(root, "assets/js/pages/scenario-detail-page.js"), "utf8");
const resultPage = fs.readFileSync(path.join(root, "assets/js/pages/solver-job-detail-page.js"), "utf8");
const scoreProgress = fs.readFileSync(path.join(root, "assets/js/utils/solver-score-progress.mjs"), "utf8");
const resultTemplate = fs.readFileSync(path.join(root, "pages/solver-job-detail.html"), "utf8");
const mapPage = fs.readFileSync(path.join(root, "assets/js/pages/solver-job-map-page.js"), "utf8");
const projectRoot = path.resolve(root, "..", "..", "..", "..", "..", "..");
const buildGradle = fs.readFileSync(path.join(projectRoot, "build.gradle.kts"), "utf8");
const imageVersionMetadata = fs.readFileSync(path.join(projectRoot, "gateway", "image-version.yaml"), "utf8");

function escaped(value) {
  return [...value]
    .map((character) => character.codePointAt(0) > 0x7f
      ? `\\u${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`
      : character)
    .join("");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function staticFile(url) {
  const prefix = "/static/assets/";
  assert(url.startsWith(prefix), "Host dependency 路径必须位于 /static/assets/");
  return path.join(root, "assets", url.slice(prefix.length));
}

const buildVersion = buildGradle.match(/^version\s*=\s*"([^"]+)"$/m)?.[1];
const imageVersion = imageVersionMetadata.match(/^\s+version:\s*(\S+)\s*$/m)?.[1];
assert(
  buildVersion && imageVersion === buildVersion,
  "gateway/image-version.yaml 的 image.version 必须与 build.gradle.kts 的版本一致"
);

const manifest = JSON.stringify(JSON.parse(componentRequirements), null, 2);
assert(
  html.includes('<template data-scenario-ui-manifest>\n' + manifest + '\n</template>'),
  "scenario.html dependency manifest 必须与 component-dependencies.json 一致"
);
assert(Buffer.byteLength(html) <= 1_000_000, "scenario.html 必须小于 1 MB");
assert(!/data:font\//i.test(html), "scenario.html 不得内联 Material 字体");
assert(!html.includes("new Function(atob("), "scenario.html 不得内联并执行 Plotly");
assert(html.includes("--font-sans:"), "scenario.html 必须内联构建期生成的 Tailwind CSS");
assert(html.includes(".w-\\[6\\.25rem\\] {"), "scenario.html 必须包含所用 Tailwind 工具类样式");
assert(!html.includes("tailwind_scenario"), "scenario.html 不得声明或引用私有 Tailwind Host 依赖");
assert(!hostDependencies.includes("tailwind_scenario"), "Engine Host 不得声明私有 Tailwind 依赖");
assert(
  !Object.keys(registry.provides || {}).some((key) => key.startsWith("tailwind_scenario@")),
  "Host registry 不得提供私有 Tailwind 依赖"
);
assert(!engineIndex.includes("assets/vendor/plotly/plotly-basic.min.js"), "Engine 外壳不得全局预加载 Plotly");
assert(
  scenarioRuntime.includes("loadHostDependencyRegistry")
    && scenarioRuntime.includes("prepareScenarioDependencies"),
  "Engine Runtime 必须在执行 Scenario UI 前准备 Host 依赖"
);
[
  "data-scenario-ui-manifest",
  "element.content?.textContent",
  "SCENARIO_RUNTIME_VERSION_UNSUPPORTED",
  "SCENARIO_RUNTIME_DEPENDENCY_UNSUPPORTED",
  "SCENARIO_RUNTIME_DEPENDENCY_LOAD_FAILED",
  "link.integrity",
  "document.fonts.load"
].forEach((fragment) => {
  assert(hostDependencies.includes(fragment), `Engine Host dependency Runtime 缺少：${fragment}`);
});

assert(registry.runtime_version === "scenario_host_runtime_v1", "Host registry Runtime 版本错误");
for (const [key, provider] of Object.entries(registry.provides || {})) {
  const entryFile = staticFile(provider.entry);
  assert(fs.existsSync(entryFile), "Host dependency 缺少入口文件：" + key);
  assert(provider.entry_sha256 === sha256(entryFile), "Host dependency 入口 hash 不匹配：" + key);
  for (const [url, hash] of Object.entries(provider.files || {})) {
    const file = staticFile(url);
    assert(fs.existsSync(file), "Host dependency 缺少文件：" + key);
    assert(hash === sha256(file), "Host dependency 文件 hash 不匹配：" + key);
  }
}

const scriptCount = (html.match(/<script/g) || []).length;
const exportCount = (html.match(/<script export/g) || []).length;
assert(scriptCount === 1 && exportCount === 1, "scenario.html 必须且只能包含一个 script export");
assert(!html.includes("<link") && !html.includes("<iframe") && !html.includes("postMessage"), "scenario.html 不得依赖 link、iframe 或 postMessage");
assert(
  html.includes('class="responsive-page-root"')
    && html.includes('class="responsive-workspace-main flex flex-col min-[1600px]:overflow-hidden"'),
  "中心工作区必须在窄屏纵向可达并在桌面约束局部滚动"
);

const dateTimeInputs = html.match(/<vrp-date-time-24\b[^>]*>/g) || [];
assert(dateTimeInputs.length > 0, "Scenario UI 必须保留日期时间输入控件");
assert(
  !html.includes('type="datetime-local"')
    && scenarioEntry.includes('import "./components/date-time-24-input.js";')
    && dateTimeComponent.includes('datetime24-picker-calendar')
    && dateTimeComponent.includes('datetime24-picker-time-columns')
    && dateTimeComponent.includes('"select-time"'),
  "Scenario UI 的日期时间输入控件必须统一使用带月历和时间滚动列的 24 小时制组件"
);

["场景名称", "创建求解任务", "地图选点"].forEach((label) => {
  assert(html.includes(escaped(label)), `中心工作区缺少：${label}`);
});

[
  "scenario.field.loadWeightWithUnit",
  "scenario.field.volumeCapacityWithUnit",
  "scenario.field.weightWithUnit",
  "scenario.field.volumeWithUnit"
].forEach((key) => {
  assert(html.includes(key), `场景重量或体积表头缺少单位文案：${key}`);
});

assert(
  html.includes("scenario-result-state-changed")
    && html.includes("job_id: job?.id || job?.job_id || null")
    && html.includes("status: job?.status || null"),
  "结果视图必须向 Host 上报稳定的任务 ID 与状态事件"
);

assert(
  html.includes('x-ref="planningDialog"')
    && html.includes('scenario-planning-drawer')
    && html.includes('height: 100dvh;')
    && html.includes('.w-\\[6\\.25rem\\] {')
    && html.includes('openPlanningDrawer()')
    && html.includes('closePlanningDrawer()'),
  "Scenario UI 必须提供独立的规划求解抽屉"
);

assert(
  !html.includes(escaped("求解历史"))
    && !scenarioDetailPage.includes("jobHistory")
    && !scenarioDetailPage.includes("primaryTab"),
  "Scenario UI 创建页不得包含任务历史、任务状态胶囊或工作区 Tab"
);

["L/100km", "kWh/100km", "m³", "result.agent.ton"].forEach((unit) => {
  assert(resultPage.includes(unit), `结果车辆与成本缺少单位或本地化 key：${unit}`);
});

assert(
  mapPage.includes('return root?.host || pageRoot;')
    && mapPage.includes('return document.fullscreenElement || root?.fullscreenElement || null;')
    && mapPage.includes('await target.requestFullscreen();'),
  "一张图大屏模式必须由 Shadow Host 承担全屏顶层与指针交互"
);

[
  'x-ref="importSolveRequestDialog"',
  "engine-create-actions",
  '@click="saveScenario(false)"',
  '@click="generateMatrix()"',
  '@click="deleteScenario()"',
  '@click="zoomScoreCurve(',
  '@click="resetScoreCurveViewport()"'
].forEach((fragment) => {
  assert(!html.includes(fragment), `scenario.html 不得包含 Engine 外壳片段：${fragment}`);
});

[
  "scenario-console-toolbar",
  'x-ref="importSolveRequestDialog"',
  'x-ref="component"'
].forEach((fragment) => {
  assert(engineHost.includes(fragment), `Engine 本地页面缺少外壳资源：${fragment}`);
});

assert(
  !engineHost.includes("toggleSidebarPanel('constraints')"),
  "Engine 本地页面不得保留右侧场景约束面板"
);

assert(
  html.includes('x-if="showScenarioOverview"')
    && html.includes('x-if="showAvailableAgentTrend"')
    && html.includes("currentScenarioStats()")
    && html.includes("scenario-sidebar-column")
    && html.includes("scenario-sidebar-panel")
    && html.includes("scenario-main-grid--with-sidebar")
    && html.includes("scenario-main-grid--sidebar-collapsed")
    && html.includes("@media (min-width: 1600px)")
    && html.includes("grid-template-columns: minmax(0, 1fr) 400px")
    && html.includes("grid-template-columns: minmax(0, 1fr) 0")
    && html.includes("scenario-sidebar-toggle")
    && html.includes(".scenario-sidebar-column--collapsed .scenario-sidebar-toggle")
    && html.includes("transform: translate(-100%, -50%)")
    && html.includes("isSidebarPanelOpen(panel)")
    && html.includes("toggleSidebarPanel(panel)")
    && html.includes("toggleScenarioSidebar()")
    && engineHostPage.includes("scenario_overview: true")
    && engineHostPage.includes("available_agent_trend: true")
    && !engineHost.includes("场景概览")
    && !engineHost.includes("空闲车辆趋势")
    && !engineHost.includes("workspace.stats")
    && scenarioEntry.includes("component.refreshAvailableAgentTrend")
    && scenarioEntry.includes("component.clearAvailableAgentTrend"),
  "场景概览与空闲车辆趋势必须位于组件右侧栏，仅由 Engine context 启用"
);

const resultTemplateRoot = resultTemplate.trimStart().split(/\r?\n/, 1)[0];
assert(
  resultTemplateRoot.includes('x-data="solverJobDetailPage"') && !/\sx-init\s*=/.test(resultTemplateRoot),
  "任务详情根节点只能由 Alpine 自动调用 init()，不得重复声明 x-init"
);

assert(
  resultPage.includes("previewMap: true")
    && resultPage.includes("this.warmMapSdk().catch(() => {});")
    && resultPage.includes("await this.waitForMapSdkWarmup();")
    && resultPage.includes("this.deferGanttRender();")
    && resultTemplate.includes('<template x-if="ganttReady">'),
  "任务详情必须默认预热地图 SDK，并在地图启动后再渲染 Gantt 时间线"
);

assert(
  resultTemplate.includes('<template x-if="row.dotStyle">')
    && html.includes('<template x-if="row.dotStyle">'),
  "Gantt 明细须仅在有对应阶段颜色时展示状态图标"
);

assert(
  resultTemplate.includes('width: min(30rem, calc(100vw - 30px));')
    && resultTemplate.includes('class="shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-slate-800"')
    && resultPage.includes('width: "min(30rem, calc(100vw - 30px))"')
    && html.includes('width: min(30rem, calc(100vw - 30px));')
    && html.includes('class="shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-slate-800"'),
  "Gantt 浮框时间值须保持单行展示"
);

assert(
  resultPage.includes("bindGanttPopoverScrollRoot()")
    && resultPage.includes('scrollRoot.addEventListener("scroll", this.boundGanttPopoverReposition, true)')
    && resultPage.includes("unbindGanttPopoverScrollRoot()")
    && resultPage.includes("ganttPopoverRepositionFrame"),
  "Gantt 浮框须监听组件滚动，并按动画帧跟随排程块"
);

assert(
  resultTemplate.includes('class="px-[1.25rem] py-[0.15625rem] transition"')
    && resultTemplate.includes('class="gantt-agent-label identifier-trigger w-[11.875rem] shrink-0 px-[0.9375rem] py-[0.15625rem] text-left"')
    && resultTemplate.includes('class="flex w-[11.875rem] shrink-0 items-center gap-[0.625rem] pt-[0.15625rem]"')
    && resultTemplate.includes('style="min-height: 3.125rem;"')
    && resultTemplate.includes('class="absolute top-0 h-[3.125rem] overflow-visible rounded-[0.46875rem] border-[1.25px] text-left text-[0.9375rem]/[1.25rem] transition ring-[1.25px]"')
    && html.includes('class="px-[1.25rem] py-[0.15625rem] transition"')
    && html.includes('class="gantt-agent-label identifier-trigger w-[11.875rem] shrink-0 px-[0.9375rem] py-[0.15625rem] text-left"')
    && html.includes('class="flex w-[11.875rem] shrink-0 items-center gap-[0.625rem] pt-[0.15625rem]"')
    && html.includes('style="min-height: 3.125rem;"')
    && html.includes('class="absolute top-0 h-[3.125rem] overflow-visible rounded-[0.46875rem] border-[1.25px] text-left text-[0.9375rem]/[1.25rem] transition ring-[1.25px]"'),
  "Gantt 排程行须紧凑，且不改变排程条高度"
);

assert(
  scenarioEntry.includes('navigate(destination)')
    && scenarioEntry.includes('target: detail.target')
    && !scenarioEntry.includes('context.host')
    && !scenarioEntry.includes('routePath(')
    && engineHostPage.includes('const target = String(event.detail?.target || "");')
    && engineHostPage.includes('target === "result"')
    && engineHostPage.includes('target === "map"'),
  "Scenario UI 必须只通过无 Host 的 target 导航事件请求 Host 切换视图"
);

assert(
  frame.includes('route: "/solver-map"')
    && frame.includes('page: "scenario-component"')
    && frame.includes('menu: false')
    && !frame.includes('window.location.replace'),
  "一张图必须作为隐藏路由加载，不得重定向回任务详情"
);

assert(
  html.includes('name="engine-result-toolbar-start"')
    && engineHostPage.includes('slot: "engine-result-toolbar-start"')
    && engineHostPage.includes('className: "action-secondary"')
    && !engineHostPage.includes('className: "action-secondary ml-2"')
    && engineHostPage.includes('key: "scenario.host.backToJobs"'),
  "Engine 求解任务详情页必须在刷新按钮左侧提供返回任务列表操作"
);

assert(
  scenarioDetailPage.includes('scenarioPersisted: true')
    && scenarioDetailPage.includes('scenarioPersistedProvided: false')
    && scenarioDetailPage.includes('if (this.scenarioPersistedProvided && !this.scenarioPersisted)')
    && scenarioDetailPage.includes('navigate({ target: "result", result_job_id: jobId })')
    && scenarioEntry.includes('component.openPlanningDrawer = openPlanningDrawer')
    && engineHostPage.includes('scenarioPersisted: false')
    && engineHostPage.includes('scenario_persisted: false'),
  "首次保存前必须由 Engine 禁用规划求解，并通过组件公开抽屉能力"
);

assert(
  !scenarioDetailPage.includes('isGatewayHost')
    && !scenarioDetailPage.includes('isEngineHost')
    && !html.includes('x-show="!isEngineHost() && !isGatewayHost()"')
    && !html.includes('<span>规划求解</span>'),
  "Scenario UI 不得提供内部规划求解入口或按 Host 身份分支"
);

assert(
  engineHostPage.includes('this.mapPage = route.startsWith("/solver-map")')
    && engineHostPage.includes('view: this.mapPage ? "map" : (this.resultPage ? "result" : "create")')
    && engineHostPage.includes('result_job_id: this.resultPage ? currentHashQueryParam("id") : ""')
    && scenarioEntry.includes('["result", "map"].includes(context.view)')
    && scenarioEntry.includes('context?.result_job_id'),
  "Engine Host 与 Scenario UI 必须以 map 视图初始化一张图路由，并通过 context 传入任务 ID"
);

assert(
  !html.includes("vrp:scenario:jump-ticket")
    && !scenarioDetailPage.includes("sessionStorage")
    && scenarioDetailPage.includes("async focusTicket(ticketId)")
    && scenarioEntry.includes("component.focusScenarioTicket = focusScenarioTicket")
    && engineHostPage.includes('intent === "focus_ticket"')
    && engineHostPage.includes("focusScenarioTicket?.(ticketId)"),
  "工单跳转必须通过导航意图交给 Engine Host 定位，且不得依赖 sessionStorage"
);

[
  "applyScenarioValidationErrors",
  "clearScenarioValidationErrors",
  "applyGatewayValidationErrors",
  "validationRowClass",
  "request_payload.plan.tickets"
].forEach((fragment) => {
  assert(html.includes(fragment), `Scenario UI 必须支持服务端字段错误定位：${fragment}`);
});

assert(
  !resultTemplate.includes("result.toolbar.autoRefresh")
    && !resultTemplate.includes("copySolveRequestPayload()")
    && !resultPage.includes("syncAutoRefreshOnJobLoad()"),
  "结果任务详情不得提供自动刷新或复制请求参数"
);

assert(
  resultPage.includes('buildSolverScoreProgress(this.job)')
    && scoreProgress.includes("hardPenalty(score)")
    && resultPage.includes('type: "bar"')
    && resultPage.includes("const hardPoints = progress.finalPoint")
    && resultPage.includes("yaxis2")
    && resultPage.includes("yaxis3")
    && resultPage.includes("scoreAxisRange(displayPoints, \"medium\")")
    && resultPage.includes("scoreAxisRange(displayPoints, \"soft\")")
    && resultPage.includes("latestScorePointAtOrBefore")
    && resultPage.includes("onScoreCurvePointerMove(event)")
    && resultPage.includes("updateScoreCurveHoverHighlight(sample)")
    && resultPage.includes("const hoverTarget = this.$refs.scoreChartShell || chart")
    && resultPage.includes('hoverTarget.addEventListener("pointermove", this.boundScoreCurvePointerMove, true)')
    && resultPage.includes('hoverTarget.addEventListener("pointerleave", this.boundScoreCurvePointerLeave)')
    && resultPage.includes('target.removeEventListener("pointermove", this.boundScoreCurvePointerMove, true)')
    && resultPage.includes('window.addEventListener("pointermove", this.boundScoreCurveGlobalPointerMove, true)')
    && resultPage.includes('window.removeEventListener("pointermove", this.boundScoreCurveGlobalPointerMove, true)')
    && resultPage.includes("onScoreCurveGlobalPointerMove(event)")
    && resultPage.includes('document.addEventListener("visibilitychange", this.boundScoreCurveVisibilityChange)')
    && resultPage.includes('window.addEventListener("focus", this.boundScoreCurveLifecycleChange)')
    && resultPage.includes('window.addEventListener("pagehide", this.boundScoreCurveLifecycleChange)')
    && resultPage.includes('document.addEventListener("freeze", this.boundScoreCurveLifecycleChange)')
    && resultPage.includes('document.addEventListener("resume", this.boundScoreCurveLifecycleChange)')
    && resultPage.includes("onScoreCurveVisibilityChange()")
    && resultPage.includes("suppressScoreCurveHoverUntilPointerMoves()")
    && resultPage.includes("scoreCurveHoverRequiresFreshPointerMove")
    && resultPage.includes("setScoreCurveHoverElementsVisible(visible)")
    && resultPage.includes("element.hidden = !visible")
    && resultPage.includes('element.style.setProperty("display", "none", "important")')
    && resultPage.includes("this.setScoreCurveHoverElementsVisible(false)")
    && resultPage.includes("const xAxis = layout?.xaxis")
    && resultPage.includes("const yAxis = layout?.yaxis")
    && resultPage.includes("left: xAxis._offset")
    && resultPage.includes("width: xAxis._length")
    && scoreProgress.includes("point.x > elapsed")
    && resultPage.includes("guideLeft")
    && resultPage.includes("hovermode: false")
    && !resultPage.includes("expandSingleScorePointAcrossJobWindow"),
  "结果曲线必须在同图展示 Medium/Soft 双轴趋势和 Hard 罚分柱；悬浮线不得吸附到前方点或补造过程点"
);

[
  "Medium、Soft 使用双轴展示原始历史最优得分",
  "Hard 罚分柱与折线共用时间轴",
  "当前时间：",
  "最近采样："
].forEach((label) => {
  assert(html.includes(escaped(label)), `Scenario UI 缺少搜索进度展示：${label}`);
});

[
  "评分速度",
  "累计评分",
  "最近步骤选择 Move",
  "最近步骤接受 Move"
].forEach((label) => {
  assert(!html.includes(escaped(label)), `Scenario UI 不得展示搜索活动摘要：${label}`);
});

assert(
  resultPage.includes('navigate({ target: "create", intent: "focus_ticket", ticket_id: value })')
    && mapPage.includes('navigate({ target: "create", intent: "focus_ticket", ticket_id: value })')
    && scenarioEntry.includes('...(detail.ticket_id ? { ticket_id: String(detail.ticket_id) } : {})'),
  "结果页和一张图必须上报带工单号的无 Host 场景定位意图"
);

assert(
  engineHost.includes('<div class="flex-1 min-h-0 overflow-hidden">\n    <div x-ref="component" class="h-full min-h-0"></div>'),
  "Engine 结果页必须以受限高度挂载 Scenario UI，避免结果内容被裁切"
);

[
  ".js-plotly-plot .plotly .main-svg {",
  ".js-plotly-plot .plotly .main-svg .draglayer {",
  "position: absolute;",
  "pointer-events: none;",
  "pointer-events: all;"
].forEach((fragment) => {
  assert(html.includes(fragment), `Scenario UI 必须在 Shadow DOM 内保留 Plotly 悬浮交互样式：${fragment}`);
});

console.log("[verify:scenario] scenario.html boundary and delivery checks passed");
