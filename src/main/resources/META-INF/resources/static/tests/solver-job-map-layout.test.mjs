import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = path.resolve(testDirectory, "..");

async function routePanel(sourceFile) {
  const source = await readFile(path.join(staticRoot, sourceFile), "utf8");
  const start = source.indexOf('x-show="taskSidebarTab === \'route\'"');
  assert.notEqual(start, -1, "应保留路线地图面板");
  const end = source.indexOf("</section>", start);
  assert.notEqual(end, -1, "路线地图面板应完整闭合");
  return source.slice(start, end);
}

test("路线地图去除标题栏，并将路线降级提醒覆盖在地图顶部", async () => {
  const panel = await routePanel("pages/solver-job-detail.html");

  assert.doesNotMatch(panel, /当前选中工程师的地图预览/);
  assert.match(panel, /relative flex-1 min-h-0 overflow-hidden/);
  assert.match(panel, /class="map-canvas-surface absolute inset-x-0 top-0 bottom-\[-1\.25px\] min-h-0" x-ref="previewMap"/, "地图容器应以绝对定位贴住面板底部，避免 HERE 画布留下底部白边");
  assert.match(panel, /x-ref="previewMap"/);
  assert.match(panel, /selectedAgentRouteNotice\(\)/);
  assert.match(panel, /absolute inset-x-\[0\.9375rem\] top-\[0\.9375rem\] z-20/);
  assert.ok(
    panel.indexOf('x-ref="previewMap"') < panel.indexOf("selectedAgentRouteNotice()"),
    "降级提醒应位于地图容器内并覆盖在地图之上"
  );
});

test("绝对定位的路线预览画布由上下边界定高", async () => {
  const stylesheets = await Promise.all([
    readFile(path.join(staticRoot, "assets/css/style.css"), "utf8"),
    readFile(path.join(staticRoot, "assets/css/scenario-business.source.css"), "utf8")
  ]);

  stylesheets.forEach((stylesheet) => {
    assert.match(
      stylesheet,
      /\.map-canvas-surface\.absolute\s*\{\s*position: absolute !important;\s*height: auto;/,
      "AMap 添加 .amap-container 后，业务样式仍应保持绝对定位，避免地图画布高度归零"
    );
  });
});

test("HERE 归属信息默认跟随深色底图并保留显式浅色兼容", async () => {
  const stylesheets = await Promise.all([
    readFile(path.join(staticRoot, "assets/css/style.css"), "utf8"),
    readFile(path.join(staticRoot, "assets/css/scenario-business.source.css"), "utf8")
  ]);

  stylesheets.forEach((stylesheet) => {
    assert.match(stylesheet, /\.map-canvas-surface \.H_copyright\s*\{\s*background: rgba\(15, 23, 42, 0\.82\) !important;\s*color: #f8fafc !important;/);
    assert.match(stylesheet, /\.map-canvas-surface\[data-vrp-map-theme="light"\] \.H_copyright\s*\{\s*background: rgba\(255, 255, 255, 0\.86\) !important;\s*color: #334155 !important;/);
    assert.match(stylesheet, /\.map-canvas-surface \.H_copyright a\s*\{\s*color: inherit !important;/);
  });
});

test("大屏快速切换按钮保持纵向卡片布局", async () => {
  const template = await readFile(path.join(staticRoot, "pages/solver-job-map.html"), "utf8");
  const cardStart = template.indexOf('class="bigscreen-agent-card w-full text-left"');

  assert.notEqual(cardStart, -1, "大屏左侧应保留整行快速切换按钮");
  assert.doesNotMatch(
    template,
    /class="bigscreen-agent-card identifier-trigger/,
    "整行按钮不应套用 inline-flex 标识触发器，否则任务信息会水平溢出"
  );
  assert.match(
    template,
    /class="mt-\[0\.9375rem\] grid w-full min-w-0 gap-\[0\.625rem\] overflow-hidden text-\[0\.9375rem\]\/\[1\.25rem\] text-slate-300"/,
    "按钮内的任务摘要应受左侧面板宽度约束"
  );
});

test("大屏跟随开关紧邻焦点对象并与视角和导航操作分组", async () => {
  const template = await readFile(path.join(staticRoot, "pages/solver-job-map.html"), "utf8");
  const messages = await readFile(path.join(staticRoot, "assets/js/i18n/scenario-component-i18n.js"), "utf8");
  const toolbarStart = template.indexOf('<section class="bigscreen-band">');
  const toolbarEnd = template.indexOf('</section>', toolbarStart);
  const toolbar = template.slice(toolbarStart, toolbarEnd);
  const focusIndex = toolbar.indexOf('agentDisplayName(currentFocusAgent())');
  const followIndex = toolbar.indexOf('toggleFollowFocusedAgent()');
  const showAllIndex = toolbar.indexOf('showAllAgents()');
  const fitViewIndex = toolbar.indexOf('fitView()');
  const backIndex = toolbar.indexOf('backToDetail()');

  assert.ok(toolbarStart >= 0 && toolbarEnd > toolbarStart, "应保留大屏顶栏");
  assert.ok(focusIndex >= 0 && focusIndex < followIndex, "跟随开关应紧随当前焦点对象");
  assert.ok(followIndex < showAllIndex && showAllIndex < fitViewIndex, "焦点操作之后应展示地图视角操作");
  assert.ok(fitViewIndex < backIndex, "页面导航操作应位于地图视角操作之后");
  assert.match(toolbar, /:aria-pressed="String\(followFocusedAgent\)"/, "跟随开关应向辅助技术暴露按下状态");
  assert.equal((toolbar.match(/border-l-\[1\.25px\] border-white\/10 pl-\[0\.625rem\]/g) || []).length, 2, "视角和导航操作应使用分隔线分组");
  assert.match(messages, /"map\.bigScreen\.stopFollowing": "停止跟随"/, "开启状态应使用明确的停止跟随操作文案");
  assert.match(messages, /"map\.bigScreen\.followCurrent": "跟随当前对象"/, "关闭状态应明确说明将跟随当前对象");
});

test("大屏焦点详情的下一个任务可跳转到场景定位工单", async () => {
  const template = await readFile(path.join(staticRoot, "pages/solver-job-map.html"), "utf8");
  const nextTaskCard = template.match(/<div class="bigscreen-stat-card">\s*<div[^>]*map\.nextTask[\s\S]*?<\/div>\s*<\/div>/)?.[0] || "";

  assert.match(nextTaskCard, /x-if="jumpableNextTicketId\(currentFocusAgent\(\)\)"/, "存在下一工单时应渲染可点击入口");
  assert.match(nextTaskCard, /@click="openScenarioTicket\(jumpableNextTicketId\(currentFocusAgent\(\)\)\)"/, "点击下一任务应复用场景工单定位导航");
  assert.match(nextTaskCard, /x-if="!jumpableNextTicketId\(currentFocusAgent\(\)\)"/, "返程等不可定位状态仍应展示普通文本");
});

test("右侧工程师任务值与工程师 ID 使用相同的等宽元信息样式", async () => {
  const template = await readFile(path.join(staticRoot, "pages/solver-job-map.html"), "utf8");
  const agentPanel = template.slice(
    template.indexOf("map.agentPanel.title"),
    template.indexOf('<template x-if="isBigScreenMode">')
  );

  assert.match(agentPanel, /class="identifier-trigger identifier-value monospace-meta[^"]*"[^>]*x-text="agent\.id"/);
  assert.equal((agentPanel.match(/identifier-value monospace-meta mt-\[0\.3125rem\]/g) || []).length, 4, "工程师 ID、当前任务、可跳转下一任务和普通下一任务应复用同一字形");
});

test("播放只强制重绘业务覆盖物并保持深色底图主题", async () => {
  const script = await readFile(path.join(staticRoot, "assets/js/pages/solver-job-map-page.js"), "utf8");

  assert.match(script, /mapTheme: "dark"/);
  assert.match(script, /refreshOverlays: options\.refreshOverlays === true/);
  assert.match(script, /await this\.renderMap\(\{ refreshOverlays: true \}\);/);
});

test("大屏由 Shadow Host 进入全屏以保留所有指针交互", async () => {
  const script = await readFile(path.join(staticRoot, "assets/js/pages/solver-job-map-page.js"), "utf8");

  assert.match(script, /fullscreenTarget\(\)\s*\{[\s\S]*?return root\?\.host \|\| pageRoot;/);
  assert.match(script, /await target\.requestFullscreen\(\);/);
  assert.match(script, /document\.fullscreenElement === this\.fullscreenTarget\(\)/);
});

test("工程师地图操作使用轻量自定义浮框而非浏览器原生标题", async () => {
  const template = await readFile(path.join(staticRoot, "pages/solver-job-map.html"), "utf8");
  const actionKeys = ["hideRoute", "cancelFocusOnly", "show"];

  actionKeys.forEach((actionKey) => {
    const actionPattern = new RegExp(
      `class="compact-icon-action ui-tooltip"[\\s\\S]*?:aria-label="[^"\\n]*map\\.action\\.${actionKey}[^"\\n]*"[\\s\\S]*?:data-tooltip="[^"\\n]*map\\.action\\.${actionKey}[^"\\n]*"`
    );
    assert.match(template, actionPattern, `${actionKey} 操作应复用自定义浮框`);
  });

  assert.doesNotMatch(
    template,
    /:title="t\((?:isRouteVisible|isFocused|visibilityMap)[^"\n]*map\.action\./,
    "地图图标操作不应继续触发带重边框的浏览器原生浮框"
  );
});

test("构建后的 Scenario UI 保留地图内降级提醒布局", async () => {
  const scenario = await readFile(path.join(staticRoot, "scenario.html"), "utf8");

  assert.doesNotMatch(scenario, /当前选中工程师的地图预览/);
  assert.match(scenario, /x-ref="previewMap"/);
  assert.match(scenario, /absolute inset-x-\[0\.9375rem\] top-\[0\.9375rem\] z-20/);
  assert.match(scenario, /DEFAULT_MAP_STYLE = DARK_MAP_STYLE/);
  assert.match(scenario, /mapTheme: "dark"/);
  assert.match(scenario, /refreshOverlays: options\.refreshOverlays === true/);
  assert.match(scenario, /@click="openScenarioTicket\(jumpableNextTicketId\(currentFocusAgent\(\)\)\)"/, "构建产物应保留大屏下一工单定位入口");
});
