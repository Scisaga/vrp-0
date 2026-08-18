import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = path.resolve(testDirectory, "..");

async function source(relativePath) {
  return readFile(path.join(staticRoot, relativePath), "utf8");
}

async function loadUiTooltipModule() {
  const result = await build({
    entryPoints: [path.join(staticRoot, "assets/js/utils/ui-tooltip.js")],
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

async function loadScenarioDetailModule() {
  const result = await build({
    entryPoints: [path.join(staticRoot, "assets/js/pages/scenario-detail-page.js")],
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

function adaptiveColumnSpecs(template, tableName) {
  const table = template.match(new RegExp(`<table\\b[^>]*data-adaptive-table="${tableName}"[\\s\\S]*?<colgroup>([\\s\\S]*?)<\\/colgroup>`));
  assert.ok(table, `未找到 ${tableName} 表格列宽声明`);
  return [...table[1].matchAll(/<col\b([^>]*)>/g)].map(([, attributes]) => {
    return Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
  });
}

test("Host 与 Scenario Shadow DOM 共用紧凑字号、控件和连续表格线", async () => {
  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const css = await source(stylesheet);

    assert.match(css, /font-size: 16\.25px;\s*line-height: 1\.45;/);
    assert.doesNotMatch(css, /(?:html|:root|:host)\s*\{[^}]*font-size\s*:/s, "不得通过根字号间接放大界面");
    assert.doesNotMatch(css, /\bzoom\s*:/, "不得通过 CSS zoom 放大界面");
    assert.match(css, /@media \(min-width: 1600px\)/, "桌面工作区断点应直接迁移到 1600px");
    assert.match(css, /@media \(max-width: 1599px\)/, "1600px 以下工作区应连续覆盖，不得留下 1599px 断点空档");
    assert.match(css, /@media \(max-width: 959px\)/, "960px 以下导航断点应连续覆盖，不得留下 959px 断点空档");
    assert.match(css, /\.field-input\s*\{\s*@apply block h-\[37\.5px\] /);
    assert.match(css, /\.field-label\s*\{\s*@apply block text-\[0\.9375rem\]\/\[1\.25rem\] font-medium leading-\[1\.25rem\] /);
    assert.match(css, /\.field-input-enum\s*\{\s*@apply w-auto min-w-\[7\.5rem\] max-w-full;/);
    assert.match(css, /\.field-input-number\s*\{\s*@apply w-\[8\.75rem\] max-w-full;/);
    assert.match(css, /\.action-primary\s*\{\s*@apply inline-flex h-\[2\.1875rem\] items-center justify-center gap-\[0\.3125rem\] /);
    assert.match(css, /\.status-pill\s*\{\s*@apply inline-flex items-center gap-\[0\.3125rem\] rounded-\[12498\.75px\] /);
    assert.match(css, /\.responsive-workspace > \.panel-shell\s*\{\s*border-top-width: 0;/);
    assert.match(css, /\.responsive-workspace > \.panel-shell:first-child\s*\{\s*border-left-width: 0;/);
    assert.doesNotMatch(css, /\.responsive-workspace > \.panel-shell \+ \.panel-shell\s*\{\s*border-top-width: 1\.25px;/);
    assert.match(css, /\.result-summary-panel\s*\{\s*@apply overflow-hidden border-\[1\.25px\] border-t-0 border-l-0 /);
    assert.match(css, /\.scenario-main-grid > \.responsive-workspace-main\s*\{\s*border-right: 1\.25px solid rgb\(226 232 240\);/);
    assert.match(css, /\.scenario-main-grid > \.scenario-sidebar-panel,\s*\.scenario-main-grid > \.scenario-sidebar-column > \.scenario-sidebar-panel\s*\{\s*border-left-width: 0;/);
    assert.match(css, /\.scenario-main-grid \.data-table th:last-child,\s*\.scenario-main-grid \.data-table td:last-child\s*\{\s*border-right-width: 0;/);
    assert.match(css, /\.scenario-main-grid \.data-table\s*\{\s*border-width: 0;/, "场景分区应负责表格外围分隔线，避免表格外框与相邻边线重叠");
    assert.match(css, /\.data-table\s*\{\s*@apply min-w-full border-collapse border-\[1\.25px\] /);
    assert.match(css, /\.data-table-adaptive\s*\{\s*min-width: 0;\s*width: max-content;\s*table-layout: auto;/, "预览态应先按内容自动计算列宽");
    assert.match(css, /\.data-table-adaptive\[data-columns-fitted="true"\]\s*\{\s*table-layout: fixed;/, "测量完成后应锁定列宽，避免编辑态重排");
    assert.match(css, /\.data-table td\s*\{\s*@apply h-\[2\.8125rem\] whitespace-nowrap border-b-\[1\.25px\] border-r-\[1\.25px\] /);
    assert.match(css, /\.data-table tbody tr:nth-child\(odd\)\s*\{\s*background: rgba\(255, 255, 255, 0\.96\);/);
    const evenRowBackground = stylesheet.includes("scenario-business")
      ? "248, 250, 252"
      : "241, 245, 249";
    assert.match(css, new RegExp(`\\.data-table tbody tr:nth-child\\(even\\)\\s*\\{\\s*background: rgb\\(${evenRowBackground}\\);`));
    assert.match(css, /\.table-cell-button\s*\{\s*@apply inline-flex min-h-\[2\.5rem\] w-auto min-w-0 max-w-full items-center px-0 py-\[0\.3125rem\] /);
    assert.match(css, /\.table-cell-editor-shell\s*\{\s*@apply flex min-h-\[2\.8125rem\] /);
    assert.match(css, /\.table-cell-button\.identifier-trigger\s*\{\s*@apply inline-flex w-auto px-0;/);
    assert.match(css, /\.table-cell-button\.city-trigger\s*\{\s*@apply inline-flex w-auto px-0;/);
    assert.match(css, /\.map-canvas-panel\s*\{\s*@apply flex h-full min-w-0 flex-col overflow-hidden bg-white;/);
    assert.match(css, /\.bigscreen-stat-card\s*\{\s*@apply border-b-\[1\.25px\] border-white\/10 bg-transparent p-\[0\.625rem\];/);
  }

  const scenarioCss = await source("assets/css/scenario-business.source.css");
  assert.match(scenarioCss, /\.table-coordinate-cell\s*\{\s*@apply flex min-h-\[2\.8125rem\] w-full min-w-0 items-center gap-\[0\.46875rem\] px-\[0\.78125rem\] py-\[0\.15625rem\];/);
  assert.match(scenarioCss, /\.data-table td:has\(\.table-coordinate-cell\)\s*\{\s*@apply p-0;/);
  assert.match(scenarioCss, /\.table-coordinate-editor\s*\{\s*@apply w-full;/);
  assert.match(scenarioCss, /\.table-coordinate-editor \.cell-input\s*\{\s*@apply min-w-0 flex-1 text-\[13\.75px\] leading-\[1\.5625rem\] text-emerald-700;/);

  const [scenario, scenarioScript] = await Promise.all([
    source("pages/scenario-detail.html"),
    source("assets/js/pages/scenario-detail-page.js")
  ]);
  assert.equal((scenario.match(/data-adaptive-table="(?:depos|agents|tickets|skus|constraints)"/g) || []).length, 5);
  assert.equal((scenario.match(/x-init="\$nextTick\(\(\) => fitAdaptiveTableColumns\('(?:depos|agents|tickets|skus|constraints)'\)\)"/g) || []).length, 5, "条件渲染表格重新挂载时必须立即恢复列宽约束，且不能被其他标签的调度取消");
  assert.ok((scenario.match(/data-column-grow="[^"]+"/g) || []).length >= 10, "剩余空间应按语义权重分配给可扩展数据列");
  assert.doesNotMatch(scenario, /data-column-fill|table-filler-cell/);
  assert.ok((scenario.match(/data-column-min="[^"]+" data-column-max="[^"]+"/g) || []).length >= 10, "每个业务列应声明自己的最小和最大宽度");
  assert.doesNotMatch(scenario, /type="date" class="cell-input" style="min-width: 10rem;"/, "日期编辑器不应反向撑宽定长列");
  assert.match(scenarioScript, /fitAdaptiveTableColumns\(tab = this\.configTab\)/);
  assert.match(scenarioScript, /table\.dataset\.columnsFitted = "true";/);
  assert.match(scenarioScript, /remainingWidth \* \(item\.weight \/ totalWeight\)/);
  assert.match(scenarioScript, /const request = \+\+this\.adaptiveTableFitRequest;/, "快速切换标签时只允许最新列宽计算请求生效");

  const index = await source("index.html");
  assert.match(index, /min-\[960px\]:w-\[12\.5rem\]/, "导航宽度应直接声明迁移后的尺寸");
  assert.doesNotMatch(index, /\bmd:w-40\b/, "不得依赖原 Tailwind 尺寸与根字号联动放大");
});

test("车辆和工单定长列按最长文本与编辑控件紧凑限宽", async () => {
  const scenario = await source("pages/scenario-detail.html");
  const agentColumns = adaptiveColumnSpecs(scenario, "agents");
  const ticketColumns = adaptiveColumnSpecs(scenario, "tickets");

  assert.equal(agentColumns.length, 18);
  assert.equal(ticketColumns.length, 16);

  for (const [index, width] of [
    [1, "8.75rem"],
    [3, "12.5rem"],
    [9, "7.5rem"],
    [10, "7.5rem"],
    [12, "6.5625rem"],
    [14, "11.5625rem"],
    [15, "11.5625rem"],
    [17, "4.375rem"]
  ]) {
    assert.equal(agentColumns[index]["data-column-min"], width);
    assert.equal(agentColumns[index]["data-column-max"], width);
    assert.equal(agentColumns[index]["data-column-grow"], undefined, `agents 第 ${index + 1} 列不应扩展`);
  }

  for (const [index, width] of [
    [1, "7.1875rem"],
    [2, "12.5rem"],
    [10, "11.5625rem"],
    [11, "11.5625rem"],
    [14, "11.5625rem"],
    [15, "4.375rem"]
  ]) {
    assert.equal(ticketColumns[index]["data-column-min"], width);
    assert.equal(ticketColumns[index]["data-column-max"], width);
    assert.equal(ticketColumns[index]["data-column-grow"], undefined, `tickets 第 ${index + 1} 列不应扩展`);
  }

  assert.deepEqual(
    agentColumns.slice(7, 14).map((column) => [column["data-column-min"], column["data-column-max"]]),
    [["5.625rem", "7.5rem"], ["5.625rem", "9.375rem"], ["7.5rem", "7.5rem"], ["7.5rem", "7.5rem"], ["5.9375rem", "10rem"], ["6.5625rem", "6.5625rem"], ["6.5625rem", "10rem"]],
    "车辆数值与枚举列应从短内容起步，并以最长可见文本为上限"
  );
  assert.deepEqual(
    ticketColumns.slice(8, 13).map((column) => [column["data-column-min"], column["data-column-max"]]),
    [["5.625rem", "7.5rem"], ["5.625rem", "7.5rem"], ["11.5625rem", "11.5625rem"], ["11.5625rem", "11.5625rem"], ["5.625rem", "9.375rem"]],
    "工单数值、日期时间和服务时长列应使用内容相称的宽度"
  );
  assert.doesNotMatch(scenario, /type="number" class="cell-input" style="(?:width|min-width):/, "数值编辑器不应反向撑宽自适应列");

  const scenarioScript = await source("assets/js/pages/scenario-detail-page.js");
  assert.match(scenarioScript, /onLocaleChanged\(\)\s*\{\s*this\.scheduleAdaptiveTableFit\(this\.configTab\);/, "中英文切换后应按当前表头文本重新计算列宽");

  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const css = await source(stylesheet);
    assert.match(css, /\.data-table-adaptive \.table-cell-editor-shell \.datetime24-input \.datetime24-value\s*\{\s*font-size: 13\.75px;/, "表格日期时间编辑器应在紧凑列内完整显示");
  }
});

test("场景表格以稳定淡色和紧凑边界表达位置、技能、工单关系与约束", async () => {
  const [scenario, scenarioCss, scenarioScript, scenarioModule] = await Promise.all([
    source("pages/scenario-detail.html"),
    source("assets/css/scenario-business.source.css"),
    source("assets/js/pages/scenario-detail-page.js"),
    loadScenarioDetailModule()
  ]);

  assert.match(scenarioCss, /\.table-location-coordinate:not\(\.table-cell-empty\)\s*\{\s*@apply text-emerald-700;/, "坐标预览应使用绿色系文字");
  assert.match(scenarioCss, /\.table-location-address:not\(\.table-cell-empty\),\s*\.table-location-cell > \.cell-input\s*\{\s*@apply text-slate-500;/, "地址应使用浅 Slate 文字并保持可读对比度");
  assert.match(scenarioCss, /\.data-table tbody tr:nth-child\(even\)\s*\{\s*background: rgb\(248, 250, 252\);/, "列表间隔行应使用更浅的 Slate 背景");

  assert.equal((scenario.match(/class="table-cell-chip table-skill-chip [^"]+" :class="skillTagToneClass\(tag\)"/g) || []).length, 2, "车辆/工程师与工单技能应共用稳定色彩映射");
  const firstTone = scenarioModule.skillTagToneClass(" Skill-A ");
  assert.equal(firstTone, scenarioModule.skillTagToneClass("skill-a"), "相同技能文本应稳定映射为同一颜色");
  assert.match(firstTone, /^border-\S+ bg-\S+ text-\S+$/, "技能颜色应同时提供淡色边框、背景和深色文字");
  assert.ok(new Set(["skill-a", "skill-b", "skill-c", "skill-d"].map(scenarioModule.skillTagToneClass)).size > 1, "不同技能应分布到多个淡色类别");

  assert.equal((scenario.match(/class="table-ticket-relation-link" @click="jumpToTicket\(ticketId\)"/g) || []).length, 2, "上一级和下一级工单标识都应可点击定位");
  assert.equal((scenario.match(/t\('scenario\.editTicketRelations'\)/g) || []).length, 4, "关联工单链接旁应保留可访问的独立编辑操作");
  assert.match(scenarioScript, /async jumpToTicket\(ticketId\)[\s\S]*?this\.highlightedTicketId = value;[\s\S]*?await this\.revealTicketRow\(value\);/, "关联工单点击后应选中并滚动到对应行");
  assert.match(scenarioScript, /prefers-reduced-motion: reduce/, "工单定位滚动应尊重减少动态效果偏好");
  assert.match(scenarioCss, /\.data-table tbody tr\.table-ticket-row-selected\s*\{\s*background: rgb\(236, 253, 245\);[\s\S]*?box-shadow: inset/, "选定工单行应有明确的淡色高亮和内描边");

  assert.equal((scenario.match(/class="constraint-weight-cell"/g) || []).length, 3);
  assert.equal((scenario.match(/cell-input constraint-weight-input/g) || []).length, 3);
  assert.match(scenarioCss, /\.data-table td\.constraint-weight-cell\s*\{\s*@apply p-0;/, "约束输入区域应贴满单元格");
  assert.match(scenarioCss, /\.constraint-weight-input\s*\{\s*@apply h-\[2\.8125rem\] w-full rounded-none border-0 bg-transparent/, "约束输入框不应保留圆角或独立边框");

  for (const tableName of ["depos", "agents", "tickets", "skus"]) {
    const columns = adaptiveColumnSpecs(scenario, tableName);
    assert.equal(columns.at(-1)["data-column-min"], "4.375rem");
    assert.equal(columns.at(-1)["data-column-max"], "4.375rem");
  }
  assert.equal((scenario.match(/class="table-action-cell"/g) || []).length, 8, "操作表头和单元格应共用紧凑内边距");
  assert.match(scenarioCss, /\.data-table \.table-action-cell\s*\{\s*@apply px-\[0\.46875rem\] text-center;/, "操作按钮应居中，左右到单元格边线的间隔保持相同");
});

test("ID 使用容器省略和单一可复制提示，而非固定字符截断", async () => {
  const [list, detail, map, scenario] = await Promise.all([
    source("pages/solver-job-list.html"),
    source("pages/solver-job-detail.html"),
    source("pages/solver-job-map.html"),
    source("pages/scenario-detail.html")
  ]);
  const templates = `${list}\n${detail}\n${map}\n${scenario}`;

  assert.doesNotMatch(templates, /shortIdentifier\(|shortJobId\(/);
  assert.doesNotMatch(list, /x-text="job\.id"/);
  assert.match(list, /x-text="job\.name \|\| '--'"/);
  assert.match(detail, /x-text="ticket\.id"/);
  assert.match(map, /x-text="agent\.id"/);
  assert.match(scenario, /x-text="row\.id"/);
  assert.doesNotMatch(templates, /:title="[^"\n]*"[^>]*@mouseenter="show(?:Business|Job)IdTooltip/);
  assert.doesNotMatch(templates, /class="table-cell-button identifier-trigger" style="min-width:/);
  assert.doesNotMatch(templates, /class="table-cell-button city-trigger" style="min-width:/);
  assert.doesNotMatch(scenario, /class="table-cell-button" style="min-width: (?:11rem|8rem);"[^>]*beginCellEdit\('tickets', index, '(?:min_start_time_input|max_end_time_input|agent)'\)/);
});

test("悬浮提示只用于图标说明、补充帮助和实际截断内容", async () => {
  const { shouldShowTooltip, shouldShowFullValueTooltip, tooltipPosition } = await loadUiTooltipModule();
  const files = [
    "index.html",
    "pages/quota.html",
    "pages/scenario-component.html",
    "pages/scenario-detail.html",
    "pages/solver-job-detail.html",
    "pages/solver-job-list.html",
    "pages/solver-job-map.html"
  ];
  const templates = (await Promise.all(files.map(source))).join("\n");

  assert.doesNotMatch(templates, /\s(?::)?title="/, "业务界面不应继续使用无法控制样式的浏览器原生 tooltip");
  assert.match(templates, /data-tooltip-overflow="self"/, "单行截断值应仅在真实溢出时显示提示");
  assert.match(templates, /data-tooltip-overflow="\.table-cell-main"/, "表格文本应仅在真实截断时显示完整值");
  assert.match(templates, /class="compact-icon-action ui-tooltip"/, "无文字图标操作应保留可见说明");
  assert.doesNotMatch(
    await source("pages/solver-job-map.html"),
    /map\.toolbar\.(?:backToDetailTitle|bigScreenTitle|pausePlaybackTitle|playPlaybackTitle|playbackSpeedTitle|resetTimeTitle|fitViewTitle|showAllTitle)/,
    "已有完整文字标签的地图工具栏操作不应重复配置 tooltip"
  );
  const [amap, here, tooltipSource] = await Promise.all([
    source("assets/js/utils/amap.js"),
    source("assets/js/utils/here.js"),
    source("assets/js/utils/ui-tooltip.js")
  ]);
  assert.doesNotMatch(amap, /\btitle:\s*/, "地图标记不应交给地图 SDK 生成浏览器原生 tooltip");
  assert.doesNotMatch(here, /\.title\s*=/, "HERE 兼容层不应写入浏览器原生 tooltip");
  assert.match(amap, /data-tooltip=/, "真正被压缩的地图标签应使用统一的可控提示");
  assert.match(tooltipSource, /trigger\.closest\?\.\("dialog\[open\]"\)/, "弹窗内提示应挂载到当前顶层弹窗中");

  const plain = {
    dataset: { tooltip: "完整值" },
    hasAttribute: () => false
  };
  assert.equal(shouldShowTooltip(plain), true, "图标说明和补充帮助可直接显示");

  const fitting = {
    dataset: { tooltip: "完整值" },
    hasAttribute: (name) => name === "data-tooltip-overflow",
    getAttribute: () => "self",
    scrollWidth: 100,
    clientWidth: 100,
    scrollHeight: 20,
    clientHeight: 20
  };
  assert.equal(shouldShowTooltip(fitting), false, "完整可见的文本不应显示重复提示");
  assert.equal(shouldShowTooltip({ ...fitting, scrollWidth: 140 }), true, "真实截断的文本应允许查看完整值");

  const completeShortId = {
    matches: () => false,
    querySelector: () => null,
    textContent: "depo-1",
    scrollWidth: 56,
    clientWidth: 56,
    scrollHeight: 20,
    clientHeight: 20
  };
  assert.equal(shouldShowFullValueTooltip(completeShortId, "depo-1"), false, "完整展示的短 ID 不应再出现同内容提示");
  assert.equal(shouldShowFullValueTooltip({ ...completeShortId, scrollWidth: 88 }, "depo-1"), true, "被截断的 ID 应保留完整值提示");
  assert.equal(shouldShowFullValueTooltip({ ...completeShortId, textContent: "工程师甲" }, "agent-1"), true, "界面未直接展示的补充 ID 可以保留提示");

  assert.deepEqual(
    tooltipPosition(
      { left: 2, top: 40, bottom: 60, width: 20 },
      { width: 180, height: 40 },
      { width: 320, height: 180 }
    ),
    { left: 15, top: 67.5 },
    "悬浮提示应限制在视口内，并优先显示在触发元素下方"
  );
});

test("任务筛选仅保留靠右且与 37.5px 表单控件等高的查询操作", async () => {
  const list = await source("pages/solver-job-list.html");
  const css = await source("assets/css/style.css");

  assert.match(list, /class="action-primary job-list-filter-action"/);
  assert.doesNotMatch(list, /class="action-secondary job-list-filter-action"/);
  assert.doesNotMatch(list, /class="compact-icon-action job-list-filter-icon-action"/);
  assert.match(list, /<div class="job-list-filter-actions">/);
  assert.equal((list.match(/field-input-enum job-list-filter-enum/g) || []).length, 4);
  assert.equal((list.match(/<label class="job-list-filter-field/g) || []).length, 6);
  assert.equal((list.match(/<option value="" x-text="t\('common\.all'\)"><\/option>/g) || []).length, 4);
  assert.doesNotMatch(list, /job-list-filter-clear|<option value="" disabled hidden>/);
  assert.match(css, /\.job-list-filter-enum\s*\{\s*@apply min-w-\[5\.625rem\];/);
  assert.match(css, /\.job-list-filter-matrix-mode\s*\{\s*width: 7\.5rem;/);
  assert.match(css, /\.job-list-filter-form\s*\{[\s\S]*?column-gap: 1\.25rem;[\s\S]*?row-gap: 0\.625rem;/);
  assert.match(css, /\.job-list-filter-field\s*\{[\s\S]*?column-gap: 0\.46875rem;/);
  assert.match(css, /\.job-list-filter-field > \.field-label\s*\{\s*@apply shrink-0 whitespace-nowrap text-\[16\.25px\];/);
  assert.doesNotMatch(css, /\.job-list-filter-(?:select|clear)/);
  assert.match(css, /\.job-list-filter-action\s*\{\s*@apply h-\[37\.5px\];/);
  assert.doesNotMatch(css, /\.job-list-filter-icon-action/);
  assert.match(css, /\.datetime24-input\s*\{[\s\S]*?width: calc\(16ch \+ 2\.96875rem\);/);
  assert.match(css, /\.datetime24-input\[seconds\]\s*\{\s*width: calc\(19ch \+ 2\.96875rem\);/);
  assert.match(css, /\.datetime24-value\s*\{\s*@apply [^;]* flex-none [^;]* pl-\[0\.625rem\] pr-0 [^;]*;\s*width: calc\(16ch \+ 0\.625rem\);/);
  assert.match(css, /\.datetime24-input\[seconds\] \.datetime24-value\s*\{\s*width: calc\(19ch \+ 0\.625rem\);/);
  assert.match(css, /\.datetime24-calendar-trigger\s*\{\s*@apply absolute inset-y-0 right-0 z-10 flex h-full w-\[2\.1875rem\] [^;]* justify-end [^;]* pr-\[0\.625rem\] /);
  assert.match(css, /\.datetime24-picker-body\s*\{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) 14\.375rem;/);
  assert.match(css, /\.datetime24-picker-time-list\s*\{\s*height: 16\.875rem;\s*overflow-y: auto;/);
});

test("场景编辑页标签行使用紧凑的上下留白", async () => {
  const scenario = await source("pages/scenario-detail.html");

  assert.match(scenario, /class="scenario-config-tabs pl-\[0\.9375rem\] pr-\[1\.25rem\] py-\[0\.3125rem\]"/);
  assert.match(scenario, /class="scenario-config-tab"/);
  assert.match(scenario, /scenario-config-tab-active/);
  assert.equal((scenario.match(/,'(?:warehouse|engineering|assignment|inventory_2|payments|rule)'\]/g) || []).length, 6);
  assert.doesNotMatch(scenario, /class="tab-button"[\s\S]*?setConfigTab/);

  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const css = await source(stylesheet);
    assert.match(css, /\.scenario-config-tab \{\s*@apply [^;]* border-0 bg-transparent [^;]*;/);
    assert.match(css, /\.scenario-config-tab-active \{\s*color: var\(--dfst-brand-purple\);\s*font-weight: 600;/);
    assert.match(css, /\.scenario-config-tab-active::after \{\s*background: var\(--dfst-brand-purple\);/);
  }

  const componentCss = await source("assets/css/scenario-business.source.css");
  assert.match(componentCss, /:root,\s*:host \{\s*color-scheme: light;\s*--dfst-brand-purple: #4d4397;/);
});

test("场景基础表单保留适度上下留白", async () => {
  const scenario = await source("pages/scenario-detail.html");

  assert.match(
    scenario,
    /<div class="p-\[0\.625rem\]">\s*<div class="grid gap-\[0\.625rem\] min-\[800px\]:grid-cols-2 min-\[1600px\]:grid-cols-4">/,
    "场景基础表单四周应统一保留 10px 内边距"
  );
  assert.doesNotMatch(
    scenario,
    /<div class="(?:py-\[0\.625rem\]|px-\[1\.25rem\] py-\[(?:0\.3125|0\.46875|0\.625)rem\])">\s*<div class="grid gap-\[0\.625rem\] min-\[800px\]:grid-cols-2 min-\[1600px\]:grid-cols-4">/,
    "场景基础表单不应缺少左右内边距，也不应使左右内边距大于上下内边距"
  );
});

test("场景开始与结束时间占满各自表单列", async () => {
  const scenario = await source("pages/scenario-detail.html");

  assert.equal((scenario.match(/datetime24-input scenario-schedule-input field-input/g) || []).length, 2);
  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const css = await source(stylesheet);
    assert.match(css, /\.scenario-schedule-input\s*\{\s*width: 100%;/);
  }
});

test("成本参数以紧凑的标签和值行展示", async () => {
  const scenario = await source("pages/scenario-detail.html");
  const model = await source("assets/js/utils/vrp-model.js");

  assert.match(scenario, /configTab === 'cost_parameter'[\s\S]*?class="scenario-cost-parameters"/, "成本参数应使用独立的双列容器");
  assert.match(scenario, /<label class="scenario-cost-parameter-field">[\s\S]*?<span class="field-label"[\s\S]*?scenario-cost-parameter-control[\s\S]*?field-input field-input-number/, "字段标签和带单位的数值输入控件应位于同一行");
  assert.match(scenario, /<template x-if="unit">[\s\S]*?<span class="scenario-cost-parameter-unit" :id="'cost-parameter-unit-' \+ key" x-text="t\(unit\)"><\/span>/, "存在单位时应渲染为不参与编辑的文本后缀");
  assert.match(scenario, /:aria-describedby="unit \? 'cost-parameter-unit-' \+ key : null"/, "数值输入应按需关联对应单位说明");
  assert.match(model, /\["start_price", "cost\.start_price", "cost\.unit\.per_trip"\]/, "成本字段配置应声明计费口径文案键");
  assert.match(model, /\["guaranteed_income", "cost\.guaranteed_income", "cost\.unit\.yuan_per_trip"\]/, "保底费应显示元/车次的计费单位");
  assert.match(model, /\["gas_92_price", "cost\.gas_92_price", "cost\.unit\.per_liter"\]/, "能源价格字段应声明计量单位");
  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const css = await source(stylesheet);
    assert.match(css, /\.scenario-cost-parameters\s*\{\s*@apply grid gap-0 min-\[960px\]:grid-cols-2 min-\[960px\]:divide-x-\[1\.25px\] min-\[960px\]:divide-slate-200;/, "成本参数应保持两列栅格");
    assert.match(css, /\.scenario-cost-parameter-field\s*\{\s*@apply flex min-h-\[3\.125rem\] items-center justify-between gap-\[0\.9375rem\] border-b-\[1\.25px\] border-slate-200 px-\[1\.25rem\] py-\[0\.3125rem\];/, "成本字段应以紧凑的横向键值行对齐");
    assert.match(css, /\.scenario-cost-parameter-control\s*\{\s*@apply flex h-\[37\.5px\] w-\[15rem\][\s\S]*?focus-within:ring-\[2\.5px\]/, "数值和单位应共用一个可见焦点外框");
    assert.match(css, /\.scenario-cost-parameter-unit\s*\{\s*@apply pointer-events-none[\s\S]*?border-l-\[1\.25px\][\s\S]*?bg-slate-50/, "单位后缀应不可交互并与输入区视觉分隔");
    assert.match(css, /\.scenario-cost-parameter-field:nth-last-child\(-n \+ 2\)\s*\{\s*border-bottom-width: 0;/, "桌面端最后一行不应重复绘制底边");
  }
});

test("场景右侧栏折叠后不保留空白轨道", async () => {
  const componentCss = await source("assets/css/scenario-component.css");

  assert.match(componentCss, /\.scenario-main-grid--sidebar-collapsed\s*\{\s*grid-template-columns: minmax\(0, 1fr\) 0;/);
  assert.match(componentCss, /\.scenario-sidebar-column--collapsed \.scenario-sidebar-toggle\s*\{\s*transform: translate\(-100%, -50%\);/);
});

test("场景右侧栏模块标题明确区分展开与收起状态", async () => {
  const scenario = await source("pages/scenario-detail.html");

  assert.equal((scenario.match(/class="scenario-sidebar-section-trigger"/g) || []).length, 3);
  assert.equal((scenario.match(/class="scenario-sidebar-section-chevron material-symbols-rounded text-\[22\.5px\]"/g) || []).length, 3);
  assert.doesNotMatch(scenario, /isSidebarPanelOpen\('[^']+'\) \? 'rotate-90'/);
  assert.equal((scenario.match(/:aria-expanded="isSidebarPanelOpen\('[^']+'\)"/g) || []).length, 3);

  for (const stylesheet of [
    "assets/css/style.css",
    "assets/css/scenario-business.source.css"
  ]) {
    const css = await source(stylesheet);
    assert.match(css, /\.scenario-sidebar-section-trigger\[aria-expanded="true"\]\s*\{\s*background: var\(--dfst-brand-purple-soft\);\s*color: var\(--dfst-brand-purple\);/);
    assert.match(css, /\.scenario-sidebar-section-trigger\[aria-expanded="true"\] \.field-label\s*\{\s*font-weight: 600;/);
    assert.match(css, /\.scenario-sidebar-section-trigger\[aria-expanded="true"\] \.scenario-sidebar-section-chevron\s*\{\s*color: var\(--dfst-brand-purple\);\s*transform: rotate\(90deg\);/);
    assert.match(css, /\.scenario-sidebar-section-trigger:focus-visible\s*\{\s*outline: 2\.5px solid var\(--dfst-brand-purple\);/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.scenario-sidebar-section-trigger,\s*\.scenario-sidebar-section-chevron\s*\{\s*transition: none;/);
  }
});

test("地图画布贴满内容区，工作区不以外边距制造多层面板", async () => {
  const map = await source("pages/solver-job-map.html");
  const mapScript = await source("assets/js/pages/solver-job-map-page.js");
  const quota = await source("pages/quota.html");
  const mcp = await source("pages/mcp.html");

  assert.match(map, /class="map-page-body flex-1 min-h-0 overflow-hidden"/);
  assert.match(map, /class="map-default-layout grid flex-1 min-h-0 gap-0 /);
  assert.match(map, /class="map-canvas-panel min-h-0"/);
  assert.match(map, /class="map-canvas-surface" x-ref="defaultMapCanvas"/);
  assert.match(map, /class="map-canvas-surface" x-ref="bigscreenMapCanvas"/);
  assert.match(map, /class="map-agent-panel panel-shell min-h-0"/);
  assert.match(mapScript, /new ResizeObserver\(/);
  assert.match(mapScript, /container\._vrpMap\?\.resize\?\.\(\)/);
  assert.match(quota, /field-input field-input-number/);
  assert.match(quota, /field-input field-input-enum/);
  assert.match(quota, /min-\[1600px\]:grid-cols-\[minmax\(0,1fr\)_360px\]/);
  assert.match(quota, /t\('quota\.section\.address'\)/);
  assert.match(quota, /t\('quota\.section\.authentication'\)/);
  assert.match(quota, /t\('quota\.section\.limits'\)/);
  assert.ok(quota.indexOf("t('quota.section.limits')") < quota.indexOf("t('quota.save')"), "保存操作应位于全部表单分区之后");
  assert.ok(quota.indexOf("t('quota.save')") < quota.indexOf("t('quota.preview')"), "保存操作应保留在主表单底部");
  assert.doesNotMatch(quota, /min-\[1600px\]:flex-1/);
  assert.doesNotMatch(quota, /flex min-h-full flex-col gap-4/);
  assert.doesNotMatch(mcp, /responsive-workspace grid flex-1 min-h-0 gap-4/);
});
