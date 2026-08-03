import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = path.resolve(testDirectory, "..");

async function readStaticFile(relativePath) {
  return readFile(path.join(staticRoot, relativePath), "utf8");
}

function assertRetainsTaskActions(source) {
  for (const action of [
    '@click="openMap()"',
    '@click="stopJob()"',
    '@click="deleteJob()"',
    '@click="toggleGanttViewportMode()"'
  ]) {
    assert.match(source, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(source, /result\.toolbar\.refresh/, "任务详情工具栏不应保留手动刷新按钮");
  assert.doesNotMatch(source, /setAutoRefresh|autoRefresh|copySolveRequestPayload|result\.toolbar\.copyRequest/, "任务详情工具栏不应保留自动刷新与复制请求参数操作");
  assert.doesNotMatch(source, /applyJob|canApplyJob|result\.toolbar\.applyToScenario/, "任务详情工具栏不应保留应用回场景按钮");
}

function assertDashboardLayout(source, { requireSidebarAriaLabel = true, requireCurveTooltip = true } = {}) {
  const overviewGrid = 'min-[1600px]:grid-cols-[minmax(0,2.65fr)_minmax(22.5rem,1fr)]';
  const workbenchGrid = 'min-[1600px]:grid-cols-[minmax(0,1fr)_450px]';
  const scrollContainer = '<div class="result-page-scroll panel-scroll flex-1 min-h-0 overflow-x-hidden">';
  const overviewStart = source.indexOf(overviewGrid);
  const pageContent = source.indexOf('<div class="space-y-0">');
  const summaryStart = source.indexOf('class="result-summary-panel h-full"');
  const scoreShell = source.indexOf('x-ref="scoreChartShell"');
  const ganttStart = source.indexOf("result.gantt.title");
  const sidebarStart = source.indexOf('<aside x-show="!isJobSolving()" class="min-h-[30rem] border-[1.25px] border-t-0 border-l-0 border-slate-200 min-[1600px]:sticky min-[1600px]:top-0 min-[1600px]:h-[calc(100dvh-6.875rem)] min-[1600px]:self-start">');

  assert.match(source, /<template x-if="loading && !job">[\s\S]*?role="status"[\s\S]*?result\.loading\.title[\s\S]*?result\.loading\.description/, "任务请求完成前应展示加载状态");
  assert.match(source, /<template x-if="!loading && !job">/, "无任务空状态只能在首次请求完成后展示");
  assert.notEqual(overviewStart, -1, "顶部应使用基础卡片与曲线的双栏总览布局");
  assert.match(source, /class="solver-detail-toolbar toolbar"/, "任务操作工具栏应继承通用工具栏内边距");
  assert.match(source, /class="result-page-body flex-1 min-h-0 min-\[1600px\]:overflow-hidden"/, "详情内容区应在移动端纵向可达，并仅在桌面约束局部滚动");
  assert.notEqual(source.indexOf(scrollContainer), -1, "详情主滚动区应隐藏横向溢出，避免在地图下方出现页面级横向滚动条");
  assert.ok(pageContent >= 0 && pageContent < overviewStart, "任务详情内容区不应保留底部内边距");
  assert.match(source, /class="space-y-0">\s*<div class="grid gap-y-\[0\.9375rem\] min-\[1600px\]:gap-x-0 min-\[1600px\]:gap-y-0/, "桌面端顶部面板与 Gantt 工作区应以相邻边框形成视觉分割，而非留白");
  assert.match(source, /min-\[1600px\]:items-stretch/, "基础信息面板应延伸到同一栅格行底部，避免与下方 Gantt 之间产生空白");
  assert.match(source, /result-score-panel panel-shell flex min-h-0 min-w-0 flex-col border-t-0 border-l-0 min-\[1600px\]:self-stretch/, "基础信息表与曲线应共用一条纵向分割线并等高拉伸，避免双边框和底部缺口");
  assert.ok(summaryStart > overviewStart, "基础卡片应置于顶部总览布局内");
  assert.ok(scoreShell > summaryStart, "求解曲线应置于基础卡片之后的顶部总览布局内");
  assert.match(source, /class="relative h-\[12\.5rem\]" x-ref="scoreChartShell"/, "曲线在桌面端应进一步收紧至当前高度的三分之二");
  assert.match(source, /class="result-section-toolbar toolbar gap-\[0\.625rem\]"[\s\S]*?result\.gantt\.title/, "Gantt 应复用与顶部面板一致的标题栏高度");
  assert.match(source, /x-show="!isJobSolving\(\)" class="shrink-0 px-\[1\.25rem\] pt-\[0\.3125rem\] pb-0"/, "时间轴与 Gantt 行应共用 20px 左右内边距");
  if (requireCurveTooltip) {
    assert.match(source, /result\.score\.help/, "曲线说明应通过悬浮提示图标提供");
  }
  assert.doesNotMatch(source, /class="text-xs leading-5 text-slate-500">Medium、Soft/, "曲线说明不应继续占用标题下方空间");

  assert.notEqual(source.indexOf(workbenchGrid), -1, "Gantt 工作区应保留桌面端左右双栏");
  assert.ok(ganttStart < sidebarStart, "侧栏应位于 Gantt 面板之后，同属 Gantt 工作区");
  assert.match(source, /<aside x-show="!isJobSolving\(\)"/, "求解中不应显示 Gantt 关联侧栏");
  assert.match(source, /min-\[1600px\]:sticky min-\[1600px\]:top-0 min-\[1600px\]:h-\[calc\(100dvh-6\.875rem\)\] min-\[1600px\]:self-start/, "侧栏应覆盖紧凑工具栏下的完整展示区，消除滚动后的底部白边");
  assert.doesNotMatch(source, /求解中，侧栏已清空/, "不应渲染脱离 Gantt 的求解中侧栏占位");

  const sidebarMarkers = [
    'x-ref="previewMap"',
    "taskSidebarTab === 'route'",
    "taskSidebarTab === 'engineer'",
    "taskSidebarTab === 'tickets'"
  ];
  if (requireSidebarAriaLabel) {
    sidebarMarkers.push(':aria-label="t(\'result.sidebar.label\')"');
  }
  for (const marker of sidebarMarkers) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(source, /:aria-busy="String\(previewMapLoading\)"/, "地图容器加载时应向辅助技术暴露忙碌状态");
  assert.match(source, /x-show="previewMapLoading"[\s\S]*?role="status"[\s\S]*?progress_activity[\s\S]*?result\.map\.loading/, "地图初始化完成前应显示加载图标与文字");
  const ticketTab = source.match(/<section x-show="taskSidebarTab === 'tickets'"[\s\S]*?<\/section>/)?.[0] || "";
  assert.doesNotMatch(ticketTab, /result\.sidebar\.currentTechnicianTickets/, "工单 Tab 不应保留独立标题栏");
  assert.match(ticketTab, /class="panel-scroll divide-y-\[1\.25px\] divide-slate-200"/, "工单 Tab 应直接从列表内容开始");
}

test("任务详情保留必要操作与内容面板，并移除应用回场景入口", async () => {
  const source = await readStaticFile("pages/solver-job-detail.html");

  assertRetainsTaskActions(source);
  assertDashboardLayout(source);
});

test("组件模式首次读取任务时保持加载态，不提前展示无任务空状态", async () => {
  const pageScript = await readStaticFile("assets/js/pages/solver-job-detail-page.js");
  const gatewayInit = pageScript.match(/if \(this\.gatewayMode\) \{[\s\S]*?\n      \}/)?.[0] || "";

  assert.match(pageScript, /loading: true,/, "任务详情初始状态应为加载中");
  assert.match(gatewayInit, /registerComponent\?\.\("result", this\)/, "组件模式应注册结果视图并异步读取任务");
  assert.doesNotMatch(gatewayInit, /this\.loading = false/, "组件注册时不能在任务请求完成前结束加载态");
});

test("构建后的 Scenario UI 同步保留任务详情布局", async () => {
  const scenario = await readStaticFile("scenario.html");

  assertDashboardLayout(scenario, { requireSidebarAriaLabel: false, requireCurveTooltip: false });
});

test("Gantt 工程师名称与工作时间纵向排列", async () => {
  const template = await readStaticFile("pages/solver-job-detail.html");

  assert.match(template, /class="gantt-agent-label identifier-trigger w-\[11\.875rem\] shrink-0 px-\[0\.9375rem\] py-\[0\.15625rem\] text-left"/, "工作时间应位于工程师名称下方，并将工程师列收紧至 190px");
  const ganttAgentButton = template.match(/<button[^>]*class="gantt-agent-label[^>]*>/)?.[0] || "";
  assert.doesNotMatch(ganttAgentButton, /showBusinessIdTooltip|hideBusinessIdTooltip/, "Gantt 左侧名称不应悬浮展示工程师 ID");
  assert.match(template, /class="flex w-\[11\.875rem\] shrink-0 items-center gap-\[0\.625rem\] pt-\[0\.15625rem\]"/, "时间轴标签列应与工程师列使用相同的 190px 宽度");
  assert.match(template, /class="status-pill ui-tooltip min-w-0 max-w-full flex-1 text-\[12\.5px\]" :data-tooltip="ganttView\.fullLabel" data-tooltip-overflow="\.truncate" :aria-label="ganttView\.fullLabel"/, "日期胶囊仅在紧凑范围被截断时显示完整模式与时间");
  assert.match(template, /class="truncate font-mono tabular-nums" x-text="ganttView\.compactLabel"/, "紧凑日期应使用等宽数字完整展示");
  assert.match(template, /class="compact-icon-action ui-tooltip" @click="toggleGanttViewportMode\(\)"/, "Gantt 视区切换按钮不应使用自动外边距制造空白");
  assert.match(template, /class="flex items-center gap-\[0\.625rem\]"[\s\S]*?gantt-agent-label/, "工程师文字与进度条之间仅保留紧凑间距");
  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const source = await readStaticFile(stylesheet);
    assert.match(source, /\.gantt-agent-label\s*\{\s*@apply flex-col items-start;/, "Gantt 标签应使用纵向 Flex 布局");
  }
});

test("紧凑曲线使用与容器一致的 Plotly 高度和边距", async () => {
  const pageScript = await readStaticFile("assets/js/pages/solver-job-detail-page.js");

  assert.match(pageScript, /const SCORE_CHART_MIN_HEIGHT = 200;/);
  assert.match(pageScript, /height: scoreChartHeight\(this\.\$refs\.scoreChartShell\)/);
  assert.match(pageScript, /margin: \{ l: 75, r: 75, t: 7\.5, b: 42\.5 \}/);
  assert.match(pageScript, /title: \{ text: this\.t\("result\.score\.durationAxis"\), font: \{ size: 13\.75 \} \}/);
});

test("基础卡片中的求解时间使用常规字重", async () => {
  const pageScript = await readStaticFile("assets/js/pages/solver-job-detail-page.js");

  assert.match(pageScript, /key: "solveTime",\s*label: this\.t\("result\.summary\.solveDuration"\),\s*value: this\.displaySolveTime\(this\.job\?\.solve_time \?\? this\.job\?\.solveTime\),\s*layoutClass: "result-summary-row-solve-time"\s*\}/);
});

test("约束数量值与相邻值对齐，任务 ID 复制使用全局悬浮通知", async () => {
  const template = await readStaticFile("pages/solver-job-detail.html");
  const pageScript = await readStaticFile("assets/js/pages/solver-job-detail-page.js");

  assert.match(template, /taskSummaryRows\(\)[\s\S]*?row\.kind === 'jobId'[\s\S]*?@click="copyCurrentJobId\(\)"/, "任务摘要中的任务 ID 应使用专用复制操作");

  const copyBusinessId = pageScript.match(/async copyBusinessId\([\s\S]*?\n    \},/)?.[0] || "";
  const copyCurrentJobId = pageScript.match(/async copyCurrentJobId\([\s\S]*?\n    \},/)?.[0] || "";
  for (const copyMethod of [copyBusinessId, copyCurrentJobId]) {
    assert.match(copyMethod, /notify\(this\.t\("result\.notice\.(?:idCopied|jobIdCopied)"\), "success"\)/, "ID 复制成功应通过全局悬浮通知反馈");
    assert.match(copyMethod, /notify\(this\.t\("result\.notice\.copyFailed"\), "danger"\)/, "ID 复制失败应通过全局悬浮通知反馈");
    assert.doesNotMatch(copyMethod, /showCopyNotice|this\.error\s*=/, "ID 复制反馈不应插入任务详情内容流");
  }

  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const source = await readStaticFile(stylesheet);
    assert.match(source, /\.result-summary-link-value\s*\{\s*@apply[^;]*px-\[0\.9375rem\]/, "约束数量值应与普通摘要值使用相同的 15px 左右内边距");
    assert.doesNotMatch(source, /\.result-summary-link-value\s*\{\s*@apply[^;]*px-\[1\.25rem\]/, "约束数量值不应比相邻摘要值多缩进 5px");
  }
});

test("摘要只在必要位置提供悬浮提示，鼠标点击不显示键盘焦点环", async () => {
  const template = await readStaticFile("pages/solver-job-detail.html");

  assert.doesNotMatch(
    template,
    /class="result-summary-task-meta-value"[^>]*:title="row\.value"/,
    "完整可读的任务时间不应重复显示原生悬浮提示"
  );
  assert.doesNotMatch(
    template,
    /class="result-summary-value"[^>]*:title="row\.value"/,
    "完整展示的摘要值不应重复显示原生悬浮提示"
  );
  assert.equal(
    (template.match(/focus-visible:ring-\[2\.5px\] focus-visible:ring-emerald-500\/20/g) || []).length,
    2,
    "两个可复制任务 ID 应仅在键盘聚焦时显示焦点环"
  );

  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const source = await readStaticFile(stylesheet);
    const linkRule = source.match(/\.result-summary-link-value\s*\{([\s\S]*?)\n  \}/)?.[1] || "";
    assert.match(linkRule, /focus-visible:ring-\[2\.5px\]/, "约束数量应保留键盘可见焦点环");
    assert.doesNotMatch(linkRule, /(?:^|\s)focus:ring-\[2\.5px\](?:\s|$)/, "鼠标点击约束数量时不应保留焦点环");
  }
});

test("约束弹窗表格滚动时不穿透粘性表头", async () => {
  for (const templateFile of ["pages/solver-job-detail.html", "scenario.html"]) {
    const template = await readStaticFile(templateFile);
    assert.match(template, /<table class="data-table constraint-dialog-table">/, "约束弹窗应使用独立的表格绘制模式");
  }

  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const source = await readStaticFile(stylesheet);
    assert.match(source, /\.constraint-dialog-table\s*\{\s*border-collapse: separate;\s*border-spacing: 0;/, "约束表格应分离边框绘制，避免滚动行穿透粘性表头");
  }
});

test("任务详情工具栏和曲线悬浮提示使用向下投影", async () => {
  const template = await readStaticFile("pages/solver-job-detail.html");

  assert.match(template, /class="result-score-help-trigger"[\s\S]*?aria-describedby="result-score-help-tooltip"/, "得分说明应使用可聚焦的自定义悬浮提示触发器");
  assert.match(template, /id="result-score-help-tooltip"[\s\S]*?role="tooltip"[\s\S]*?result\.score\.helpText/, "得分说明内容应由自定义 tooltip 承载");
  assert.doesNotMatch(template, /:title="t\('result\.score\.helpText'\)"/, "得分说明不应继续使用无法控制边框的浏览器原生 tooltip");

  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const source = await readStaticFile(stylesheet);
    const tooltipRule = source.match(/\.global-ui-tooltip\s*\{([\s\S]*?)\n  \}/)?.[1] || "";
    const scoreHelpTooltipRule = source.match(/\.result-score-help-tooltip\s*\{([\s\S]*?)\n  \}/)?.[1] || "";
    assert.match(tooltipRule, /border-\[1\.25px\] border-slate-200/, "悬浮提示应使用轻量边框");
    assert.match(tooltipRule, /box-shadow: 0 5px 15px rgba\(15, 23, 42, 0\.1\);/, "悬浮提示阴影应主要向下扩散，避免上、左侧过重");
    assert.match(scoreHelpTooltipRule, /border-\[1\.25px\] border-slate-200/, "得分说明悬浮提示的四边应使用同一条轻量边框");
    assert.match(scoreHelpTooltipRule, /box-shadow: 0 5px 15px rgba\(15, 23, 42, 0\.1\);/, "得分说明悬浮提示阴影应只向下扩散，不加重上、左侧");
    assert.doesNotMatch(scoreHelpTooltipRule, /border-(?:top|left|t|l)-/, "得分说明悬浮提示不得单独加粗上边或左边");
    assert.match(source, /\.solver-detail-toolbar\s*\{\s*@apply relative z-30;/, "工具栏应形成高于详情内容的层级，避免悬浮提示被图表覆盖");
    assert.match(source, /\.solver-detail-toolbar\s*\{\s*@apply relative z-30;\s*box-shadow: 0 5px 10px -5px rgba\(15, 23, 42, 0\.24\);/, "任务详情按钮行应使用只向下扩散的轻阴影");
    assert.match(source, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.global-ui-tooltip,[\s\S]*?\.result-score-help-tooltip[\s\S]*?transition: none;/, "悬浮提示动画应遵循减少动态效果偏好");
  }
});

test("摘要以任务元信息单行和 Key/Value 表格展示", async () => {
  const template = await readStaticFile("pages/solver-job-detail.html");
  const pageScript = await readStaticFile("assets/js/pages/solver-job-detail-page.js");

  assert.match(template, /class="result-summary-task-meta"/, "任务元信息应独立置于摘要顶部");
  assert.match(template, /result-summary-panel-header[\s\S]*result\.summary\.basicInfo/, "左侧基本信息应具有与曲线对齐的统一标题栏");
  assert.match(template, /result-summary-panel-header result-section-toolbar[\s\S]*result-section-title[\s\S]*result\.summary\.basicInfo/, "基本信息标题应使用加高高亮标题栏");
  assert.match(template, /taskSummaryRows\(\)/, "任务元信息应使用专用行模型");
  assert.match(template, /class="result-summary-content"/, "求解与业务指标应共同位于下方双栏区域");
  assert.match(template, /row\.layoutClass \|\| ''/, "摘要行应允许按字段类型调整内部布局，而不改变外层卡片网格");
  assert.match(template, /result-summary-value-id/, "仅任务 ID 使用专用截断样式");
  assert.match(template, /row\.kind === 'score'/, "Hard、Medium、Soft 得分应使用分段展示");
  assert.match(pageScript, /kind: parsedScore \? "score" : "value"/, "可解析得分应使用三段式视图模型");
  assert.match(pageScript, /result\.summary\.scoreHard/, "得分分段应使用本地化标签");
  assert.match(pageScript, /taskSummaryRows\(\)\s*\{/, "任务 ID、创建时间和完成时间应从求解信息中抽离");
  assert.equal((pageScript.match(/key: "task"/g) || []).length, 0, "任务信息不应再作为独立摘要面板");
  assert.match(template, /result\.summary\.basicInfo[\s\S]*result-summary-status[\s\S]*jobStatusLabel\(\)/, "任务状态胶囊应紧随基本信息标题展示");
  assert.doesNotMatch(pageScript, /statusBadge:\s*\{/, "求解信息分区不应重复承载任务状态");
  assert.match(pageScript, /key: "score"[\s\S]*key: "constraintCount"[\s\S]*key: "solveTime"/, "得分、约束数量和求解耗时应按优先级排列");
  assert.match(pageScript, /layoutClass: "result-summary-row-score"/, "得分应使用专用合并单元格样式");
  assert.doesNotMatch(pageScript, /key: "drawRoute",[\s\S]*wide: true/, "生成路线不应通过视图模型的宽行标记破坏表格结构");
  assert.doesNotMatch(template, /result-summary-row result-summary-row-empty/, "生成路线右侧空列由网格轨道保留，不额外渲染空白单元格");
  assert.match(template, /section\.key === 'solve'[\s\S]*technicalSummaryRows\(\)[\s\S]*class="result-summary-row"/, "三个技术参数应直接复用左侧结果状态的两列 Key\/Value 表格");
  assert.doesNotMatch(template, /<details class="result-summary-technical-details">/, "技术参数不应保留折叠交互");
  assert.match(template, /x-show="hasHardViolation\(\)"[\s\S]*role="alert"/, "Hard 罚分应有不只依赖颜色的危险提示");
  assert.doesNotMatch(template, /currencyUnspecified|hasCostMetrics/, "成本指标不应单独展示币种说明");
  assert.match(pageScript, /result\.unit\.cost/, "总成本预估应追加本地化单位");
  assert.match(pageScript, /result\.unit\.costPerTonKm/, "吨公里费应追加本地化复合单位");

  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const source = await readStaticFile(stylesheet);
    const genericValueRule = source.match(/\.result-summary-value\s*\{([\s\S]*?)\n  \}/)?.[1] || "";

    assert.doesNotMatch(genericValueRule, /truncate/, "除 ID 外的摘要值不得默认截断");
    assert.match(genericValueRule, /overflow: visible/, "除 ID 外的摘要值应完整展示");
    assert.match(source, /\.result-summary-value-id\s*\{\s*@apply overflow-hidden text-ellipsis whitespace-nowrap;/, "ID 应保留单行缩略行为");
    assert.match(source, /\.result-summary-task-meta\s*\{\s*@apply grid grid-cols-1 border-b-\[1\.25px\] border-slate-200;/, "任务元信息应位于表格顶部的独立一行");
    assert.match(source, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/, "完成时间左侧应与业务指标左侧共用同一列线");
    assert.match(source, /\.result-summary-row\s*\{\s*@apply grid min-w-0 grid-cols-\[minmax\(7\.1875rem,42%\)_minmax\(0,58%\)\] items-stretch border-b-\[1\.25px\] border-slate-200;/, "求解信息应使用 Key/Value 分列单元格");
    assert.match(source, /\.result-summary-grid-single \.result-summary-value\s*\{\s*@apply justify-self-end text-right;/, "业务指标应恢复为单列 Key/Value 展示");
    assert.doesNotMatch(source, /\.result-summary-grid-single \.result-summary-row\s*\{\s*grid-column: auto;/, "业务指标的定位类必须保留其桌面列位置，吨公里费应位于成本预估正下方");
    assert.match(source, /min-height: 2\.03125rem;/, "基础信息卡片的数据行应进一步收紧至约 32.5px");
    assert.match(source, /\.result-summary-row-draw-route\s*\{\s*grid-column: 1;\s*grid-row: 5;/, "生成路线应占用左侧 Key\/Value 列，右侧保留一对属性值位置");
    assert.doesNotMatch(source, /result-summary-technical-/, "技术参数不应拥有与结果状态表格不同的专用样式");
    assert.match(source, /grid-template-rows: repeat\(5, 2\.054688rem\);/, "结果状态五行填满基础信息区，消除末行与面板下边的窄间距");
    assert.match(source, /\.result-summary-grid\s*\{\s*display: contents;/, "桌面端应将左右摘要行放入同一组网格轨道");
    assert.match(source, /\.result-summary-heading\s*\{\s*@apply flex items-center gap-\[0\.625rem\] border-b-\[1\.25px\] border-slate-200 px-\[0\.9375rem\] py-\[0\.15625rem\] text-\[16\.25px\] font-medium leading-\[1\.5625rem\];/, "求解信息与业务指标标题应以高亮色代替粗体");
    assert.match(source, /\.result-section-toolbar\s*\{\s*min-height: 3\.75rem;\s*@apply py-\[0\.625rem\];/, "基本信息、求解曲线与 Gantt 标题栏应统一为 60px");
    assert.match(source, /--dfst-brand-purple-highlight: #7569cc;/, "结果标题高亮色应在品牌紫色相上提高明度");
    assert.match(source, /\.result-section-title\s*\{\s*@apply text-\[1\.09375rem\]\/\[1\.5625rem\] font-medium;\s*color: var\(--dfst-brand-purple-highlight\);/, "主分区标题应使用更明亮的品牌紫高亮代替粗体");
    assert.match(source, /\.result-summary-heading-title\s*\{[\s\S]*?color: var\(--dfst-brand-purple-highlight\);/, "摘要标题应使用更明亮的品牌紫高亮");
    assert.match(source, /\.result-summary-icon-brand\s*\{\s*color: var\(--dfst-brand-purple-highlight\);/, "摘要标题图标应与标题使用同一高亮色");
    assert.match(source, /\.result-summary-link-value\s*\{\s*@apply[^;]*text-\[16\.25px\] font-normal/, "约束数量链接不得使用偏大字号或粗体");
    assert.match(source, /\.compact-icon-action\s*\{\s*@apply inline-flex shrink-0[\s\S]*?width: 1\.71875rem;\s*height: 1\.71875rem;/, "Gantt 视区切换按钮应与左侧日期胶囊同高");
    assert.match(source, /\.result-summary-row-solve-time,\s*\.result-summary-row-build-matrix,[\s\S]*?\{\s*@apply border-l-\[1\.25px\] border-slate-200;/, "求解时间和生成矩阵所在列应与右侧业务指标保持相同的左侧分隔线");
    assert.match(source, /\.result-summary-row-draw-route,\s*\.result-summary-row-ton-km-cost\s*\{\s*border-bottom-width: 0;/, "最后一行由面板提供唯一底边，避免单元格边框与面板边框重叠加粗");
    assert.match(source, /\.result-summary-row-score\s*\{\s*grid-template-columns: minmax\(7\.1875rem, 21%\) minmax\(0, 79%\);/, "得分行保留独立的紧凑分段布局");
    assert.doesNotMatch(source, /\.result-summary-row-score,\s*\.result-summary-row-draw-route/, "生成路线不应使用跨列得分行的分栏比例");
    assert.doesNotMatch(source, /\.result-summary-row-draw-route \.result-summary-value/, "生成路线值应沿用普通 Key\/Value 列对齐，不应推到右侧");
    assert.match(source, /\.result-summary-score-hard\s*\{\s*@apply text-rose-500;/, "Hard 得分应使用曲线同色的红色");
    assert.match(source, /\.result-summary-score-medium\s*\{\s*@apply text-amber-500;/, "Medium 得分应使用曲线同色的橙色");
    assert.match(source, /\.result-summary-score-soft\s*\{\s*@apply text-emerald-500;/, "Soft 得分应使用曲线同色的绿色");
  }
});

test("结果操作严格遵循任务状态", async () => {
  const template = await readStaticFile("pages/solver-job-detail.html");
  const pageScript = await readStaticFile("assets/js/pages/solver-job-detail-page.js");

  assert.doesNotMatch(template, /applyJob|canApplyJob|result\.toolbar\.applyToScenario/);
  assert.match(template, /@click="deleteJob\(\)" :disabled="!canDeleteJob\(\)"/);
  assert.doesNotMatch(pageScript, /applyJob\(|canApplyJob\(/);
  assert.match(pageScript, /canDeleteJob\(\)[\s\S]*\["SOLVING_FINISHED", "ERROR"\]\.includes\(this\.job\?\.status\)/);
});

test("基础信息表使用单一外框，与相邻曲线面板保持连续分割", async () => {
  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const source = await readStaticFile(stylesheet);
    const summaryPanelRule = source.match(/\.result-summary-panel\s*\{([^}]*)\}/)?.[1] || "";

    const scorePanelRule = source.match(/\.result-score-panel\s*\{([^}]*)\}/)?.[1] || "";

    assert.match(summaryPanelRule, /@apply overflow-hidden border-\[1\.25px\] border-t-0 border-l-0 border-slate-200 bg-slate-50/);
    assert.match(scorePanelRule, /@apply bg-slate-50/, "顶部基本信息与求解曲线面板应使用同一浅色底");
    assert.doesNotMatch(summaryPanelRule, /rounded-/);
    assert.match(source, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/, "求解信息与业务指标应使用统一的三组 Key\/Value 列宽");
    assert.match(source, /\.result-summary-section\s*\{\s*display: contents;/, "下方信息应进入同一网格，确保左右横线与列宽对齐");
  }
});
