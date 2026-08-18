import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const staticRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const largeHereSolveRequest = fs.readFileSync(
  path.resolve(staticRoot, "../../../../../../scenarios/public-demo/here-nz-auckland-complex.json"),
  "utf8"
);
let server;
let baseUrl;
let lastQuotaPayload = null;

const quotaFixture = {
  key: "fixture-secret-key",
  qps: 10,
  quota: 10000,
  interval: "PT24H",
  wait_timeout: "PT10S",
  geocode_provider: "ADDR_RESOLVER",
  address_resolver_url: "http://127.0.0.1:5000/api/resolve",
  address_resolver_fallback_to_amap: false
};

const scenario = {
  id: "english-fixture",
  name: "English fixture",
  desc: "A descriptive fixture for the Scenario UI.",
  planning_date: "2026-07-14",
  start_time: "2026-07-14 08:00:00",
  end_time: "2026-07-14 20:00:00",
  map_provider: "AMAP",
  options: { matrix_mode: "ROUTING", build_transit_matrix: true, draw_route: false },
  plan: { depos: [], agents: [], tickets: [], skus: [], constraint_configuration: {}, cost_parameter: {} }
};

const resultJob = {
  id: "english-result-job",
  name: "260714-080000",
  status: "SOLVING_FINISHED",
  create_time: "2026-07-14 08:00:00",
  update_time: "2026-07-14 08:01:00",
  solve_time: "PT30S",
  score: "0hard/0medium/0soft",
  matrix_mode: "ROUTING",
  build_transit_matrix: true,
  draw_route: true,
  metrics: {
    distance_total: 378800,
    duration_total: 3600,
    cost_total: 21.25,
    cost_per_ton_per_km: 0.016
  },
  plan: { agents: [], tickets: [], depos: [], skus: [], constraint_configuration: {}, cost_parameter: {} }
};

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function serveStatic(request, response) {
  const pathname = new URL(request.url, "http://fixture").pathname;
  if (pathname === "/map_context") return sendJson(response, { enabled: false, provider: "none", locale: "zh-CN" });
  if (pathname === "/scenario") return sendJson(response, scenario);
  if (pathname === "/quota" && request.method === "PUT") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      lastQuotaPayload = JSON.parse(body);
      sendJson(response, lastQuotaPayload);
    });
    return undefined;
  }
  if (pathname === "/quota") return sendJson(response, quotaFixture);
  if (pathname === "/solver_job/list") return sendJson(response, [resultJob]);
  if (pathname.startsWith("/solver_job")) {
    const requestedId = pathname.split("/").filter(Boolean)[1] || resultJob.id;
    if (requestedId === "missing-result-job") return sendJson(response, { error_code: "not_found" }, 404);
    if (requestedId === "running-result-job") return sendJson(response, { ...resultJob, id: requestedId, status: "SOLVING_ACTIVE", metrics: {} });
    if (requestedId === "failed-result-job") return sendJson(response, { ...resultJob, id: requestedId, status: "ERROR", metrics: {} });
    return sendJson(response, resultJob);
  }
  if (pathname === "/mcp/meta") return sendJson(response, {
    enabled: true,
    path: "/mcp",
    allowed_origins: [],
    tools: ["get_current_scenario"],
    transport: "Streamable HTTP",
    auth_mode: "Bearer Token"
  });
  if (pathname === "/scenario/available_agents") return sendJson(response, [{ start_time: "2026-07-14 08:00:00", end_time: "2026-07-14 10:00:00", available_agents: 3 }]);
  const relative = pathname.replace(/^\/static\//, "").replace(/^\//, "") || "index.html";
  const filename = path.resolve(staticRoot, relative);
  if (!filename.startsWith(staticRoot) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
    response.writeHead(404);
    response.end("not found");
    return undefined;
  }
  const extension = path.extname(filename);
  response.writeHead(200, {
    "content-type": extension === ".html"
      ? "text/html"
      : extension === ".js" || extension === ".mjs"
        ? "text/javascript"
        : extension === ".css"
          ? "text/css"
          : extension === ".svg"
            ? "image/svg+xml"
            : "text/plain"
  });
  fs.createReadStream(filename).pipe(response);
  return undefined;
}

test.beforeAll(async () => {
  server = http.createServer(serveStatic);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("English locale renders semantic Host and Scenario UI copy without rebuilding the component", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vrp0.engine.locale", "en-US"));
  await page.goto(`${baseUrl}/static/index.html`);

  await expect(page.getByText("Language", { exact: true })).toBeVisible();
  const desktopNavigation = page.locator("aside").first();
  await expect(desktopNavigation.getByRole("button", { name: "Jobs" })).toBeVisible();
  await expect(desktopNavigation.getByRole("button", { name: "Map Api" })).toBeVisible();
  await expect(desktopNavigation.getByRole("button", { name: "Mcp Api" })).toBeVisible();
  const hostPlanAndSolveButton = page.locator(".scenario-console-toolbar").getByRole("button", { name: "play_arrow Plan and solve" });
  await expect(hostPlanAndSolveButton).toBeVisible();
  const component = page.locator("vrp-scenario-ui-vrp0");
  await expect(component).toHaveCount(1);
  const tabHelpButton = component.getByRole("button", { name: "Tickets", exact: true });
  await tabHelpButton.click();
  const tabHelpTooltip = component.getByRole("tooltip");
  await expect(tabHelpButton).toBeVisible();
  await tabHelpButton.focus();
  await expect(tabHelpTooltip).toHaveText("Maintain tickets, time windows, dependencies, and manual assignments.");
  await tabHelpButton.press("Escape");
  await expect(tabHelpTooltip).toBeHidden();
  await page.mouse.move(0, 0);
  await tabHelpButton.hover();
  await expect(tabHelpTooltip).toHaveText("Maintain tickets, time windows, dependencies, and manual assignments.");
  await page.mouse.move(0, 0);
  await expect(component.getByRole("columnheader", { name: "Weight (t)", exact: true })).toBeVisible();
  await expect(component.getByRole("columnheader", { name: "Volume (m³)", exact: true })).toBeVisible();
  await component.getByRole("button", { name: "Vehicles / technicians", exact: true }).click();
  await expect(component.getByRole("columnheader", { name: "Load weight (t)", exact: true })).toBeVisible();
  await expect(component.getByRole("columnheader", { name: "Volume capacity (m³)", exact: true })).toBeVisible();
  await component.getByRole("button", { name: "SKU", exact: true }).click();
  await expect(component.getByRole("columnheader", { name: "Weight (t)", exact: true })).toBeVisible();
  await expect(component.getByRole("columnheader", { name: "Volume (m³)", exact: true })).toBeVisible();
  await component.getByRole("button", { name: /Available vehicle trend/ }).click();
  await expect(component.getByText("Available technicians", { exact: true })).toBeVisible();
  await hostPlanAndSolveButton.click();
  await expect(component.getByText("Create solver job", { exact: true })).toBeVisible();
  await expect(component.getByText("Current scenario", { exact: true })).toBeVisible();
  await expect(component.getByText("Solve duration", { exact: true })).toBeVisible();
  await expect(component.getByText("Build matrix", { exact: true })).toBeVisible();
  const solveDurationUnits = await component.evaluate((element) => [...element.shadowRoot
    .querySelector('select[x-model="solveTimeUnit"]')
    .options]
    .map((option) => option.textContent.trim()));
  expect(solveDurationUnits).toEqual(["s", "min", "h"]);

  const before = await component.evaluate((element) => {
    element.dataset.i18nTestIdentity ||= crypto.randomUUID();
    return element.dataset.i18nTestIdentity;
  });
  await page.selectOption("#engine-locale", "zh-CN");
  await page.selectOption("#engine-locale", "en-US");
  await expect(hostPlanAndSolveButton).toBeVisible();
  const after = await component.evaluate((element) => element.dataset.i18nTestIdentity);
  expect(after).toBe(before);

  const leaked = await page.evaluate(() => {
    const values = [];
    const visit = (root) => {
      root.querySelectorAll("[x-text]").forEach((element) => {
        const text = element.textContent.trim();
        if (text && /[\u3400-\u9fff]/.test(text)) values.push(text);
      });
      root.querySelectorAll("*").forEach((element) => {
        if (element.shadowRoot) visit(element.shadowRoot);
      });
    };
    visit(document);
    return values;
  });
  expect(leaked).toEqual([]);
});

test("scenario toolbar orders workflow actions and keeps descriptions subdued", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vrp0.engine.locale", "en-US"));
  await page.goto(`${baseUrl}/static/index.html#/scenario`);

  const toolbar = page.locator(".scenario-console-toolbar");
  await expect(toolbar).toBeVisible();
  const actionLabels = await toolbar.evaluate((element) => [...element.querySelectorAll("[data-scenario-toolbar-group]")].flatMap((group) => [...group.querySelectorAll(":scope > button, :scope > [data-scenario-toolbar-section] > button")]
    .map((button) => {
      return [...button.children]
        .find((node) => !node.classList.contains("material-symbols-rounded"))
        ?.textContent.trim() || null;
    })
    .filter(Boolean)));
  expect(actionLabels).toEqual(["Build transit matrix", "Plan and solve", "Save scenario", "Import", "Export", "Delete"]);
  const actionGroups = await toolbar.evaluate((element) => [...element.querySelectorAll("[data-scenario-toolbar-group]")].map((group) => [...group.querySelectorAll(":scope > button, :scope > [data-scenario-toolbar-section] > button")]
    .map((button) => {
      return [...button.children]
        .find((node) => !node.classList.contains("material-symbols-rounded"))
        ?.textContent.trim() || null;
    })
    .filter(Boolean)));
  expect(actionGroups).toEqual([
    ["Build transit matrix", "Plan and solve"],
    ["Save scenario", "Import", "Export", "Delete"]
  ]);
  const managementSections = await toolbar.locator('[data-scenario-toolbar-group="scenario-management"] [data-scenario-toolbar-section]').evaluateAll((sections) => sections.map((section) => section.getAttribute("data-scenario-toolbar-section")));
  expect(managementSections).toEqual(["save", "import-export", "danger"]);

  const component = page.locator("vrp-scenario-ui-vrp0");
  const descriptionColor = await component.evaluate((element) => getComputedStyle(
    element.shadowRoot.querySelector(".scenario-description-preview-text")
  ).color);
  expect(descriptionColor).toBe("oklch(0.554 0.046 257.417)");
});

test("scenario tab help follows hover without requiring the tab to be selected", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vrp0.engine.locale", "en-US"));
  await page.goto(`${baseUrl}/static/index.html#/scenario`);

  const component = page.locator("vrp-scenario-ui-vrp0");
  const depotsTab = component.getByRole("button", { name: "Depots", exact: true });
  const ticketsTab = component.getByRole("button", { name: "Tickets", exact: true });
  const ticketsHelp = component.getByRole("tooltip").filter({ hasText: "Maintain tickets, time windows, dependencies, and manual assignments." });

  await expect(depotsTab).toHaveClass(/scenario-config-tab-active/);
  await expect(ticketsTab).not.toHaveClass(/scenario-config-tab-active/);
  await ticketsTab.hover();
  await expect(ticketsHelp).toBeVisible();
  await expect(ticketsTab).not.toHaveClass(/scenario-config-tab-active/);

  await page.mouse.move(0, 0);
  await expect(ticketsHelp).toBeHidden();
});

test("large pasted request JSON remains responsive without a legacy DOM translation observer", async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem("vrp0.engine.locale", "zh-CN"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  await page.goto(`${baseUrl}/static/index.html`);

  const toolbar = page.locator(".scenario-console-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "导入" }).click();

  const dialog = page.locator("dialog[open]");
  const editor = dialog.locator(".cm-content");
  await expect(editor).toBeVisible();
  await expect(dialog.getByRole("button", { name: "格式化", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "全部折叠", exact: true })).toHaveCount(0);
  await page.evaluate((text) => navigator.clipboard.writeText(text), largeHereSolveRequest);
  await editor.click();
  await page.keyboard.press("Control+V");

  // Pasting schedules a JSON format pass.  The dialog must stay interactive
  // while that pass completes; a global MutationObserver used to loop here.
  await expect.poll(() => page.locator('[x-data="scenarioComponentPage"]').evaluate(
    (root) => !window.Alpine.$data(root).getImportRequestEditorText().includes('"weight": 18.0')
  ), { timeout: 5000 }).toBe(true);
  await expect(dialog.getByRole("button", { name: "取消" })).toBeEnabled({ timeout: 5000 });
  await expect(dialog.getByRole("button", { name: "导入" })).toBeEnabled({ timeout: 5000 });
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0, { timeout: 3000 });
});

test("Host jobs and map-settings pages switch locale through semantic keys", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vrp0.engine.locale", "en-US"));
  await page.goto(`${baseUrl}/static/index.html#/solver-jobs`);
  await expect(page.getByText("Job status", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search" })).toBeVisible();
  await expect(page.getByText("30 s", { exact: true })).toBeVisible();
  await page.selectOption("#engine-locale", "zh-CN");
  await expect(page.getByText("任务状态", { exact: true })).toBeVisible();
  await page.selectOption("#engine-locale", "en-US");
  await expect(page.getByText("Job status", { exact: true })).toBeVisible();

  await page.goto(`${baseUrl}/static/index.html#/quota`);
  await expect(page.getByText("Geocoding provider", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save configuration" })).toBeVisible();
  await page.selectOption("#engine-locale", "zh-CN");
  await expect(page.getByText("地理解析提供方", { exact: true }).first()).toBeVisible();
  await page.selectOption("#engine-locale", "en-US");
  await expect(page.getByText("Geocoding provider", { exact: true }).first()).toBeVisible();
});

test("desktop sidebar is toggled by the logo and uses the compact DFST-purple active state", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${baseUrl}/static/index.html`);

  const sidebar = page.locator("aside").first();
  const activeItem = sidebar.locator(".frame-nav-item-active");
  await expect(sidebar.getByRole("button", { name: "收起导航栏" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "任务列表" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "地图接口" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "MCP接入" })).toBeVisible();
  await expect(page.getByText("场景求解工作台", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("当前场景配置、约束维护与求解入口", { exact: true })).toHaveCount(0);

  await sidebar.getByRole("button", { name: "收起导航栏" }).click();
  const navigationTooltip = page.locator("body > .global-ui-tooltip");
  const expandNavigation = sidebar.getByRole("button", { name: "展开导航栏" });
  await expect(expandNavigation).toBeVisible();
  await expect(activeItem).toHaveClass(/h-\[2\.8125rem\]/);
  await expect(activeItem).toHaveClass(/w-\[2\.8125rem\]/);
  await expect(activeItem).toHaveClass(/rounded-\[0\.3125rem\]/);
  await expect(sidebar.locator("nav span[x-show]").first()).toBeHidden();
  await page.mouse.move(640, 400);
  await expandNavigation.hover();
  await expect(navigationTooltip).toBeVisible();
  await page.mouse.move(640, 400);
  await expect(navigationTooltip).toBeHidden();
});

test("English MCP page translates workflow, client snippets, and usage notes", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vrp0.engine.locale", "en-US"));
  await page.goto(`${baseUrl}/static/index.html#/mcp`);

  await expect(page.getByText("MCP integration summary", { exact: true })).toBeVisible();
  await expect(page.getByText("Typical agent workflow", { exact: true })).toBeVisible();
  await expect(page.getByText("write the current scenario", { exact: true })).toBeVisible();
  await expect(page.getByText("Usage notes", { exact: true })).toBeVisible();
  await expect(page.locator("pre").filter({ hasText: "your Bearer Token" })).toBeVisible();

  await page.selectOption("#engine-locale", "zh-CN");
  await expect(page.getByText("典型智能体流程", { exact: true })).toBeVisible();
  await page.selectOption("#engine-locale", "en-US");
  await expect(page.getByText("Typical agent workflow", { exact: true })).toBeVisible();

  const leaked = await page.locator("#page-outlet").evaluate((root) => [...root.querySelectorAll("*")]
    .flatMap((node) => [...node.childNodes])
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent.trim())
    .filter((text) => /[\u3400-\u9fff]/.test(text)));
  expect(leaked).toEqual([]);
});

test("English result view localizes toolbar, dynamic summary, units, and chart labels", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("vrp0.engine.locale", "en-US"));
  await page.goto(`${baseUrl}/static/index.html#/solver-job?id=english-result-job`);

  const component = page.locator("vrp-scenario-ui-vrp0");
  await expect(component).toHaveCount(1);
  await expect(component.getByRole("button", { name: /Refresh$/ })).toHaveCount(0);
  await expect(component.getByRole("button", { name: /Open map view$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply to scenario", exact: true })).toHaveCount(0);
  await expect(component.getByText("Task ID", { exact: true })).toBeVisible();
  await expect(component.getByText("Basic information", { exact: true })).toBeVisible();
  await expect(component.getByText("Result status", { exact: true })).toHaveCount(0);
  await expect(component.getByText("Solver details", { exact: true })).toBeVisible();
  await expect(component.getByText("Business metrics", { exact: true })).toBeVisible();
  await expect(component.getByText("Matrix", { exact: true })).toBeVisible();
  await expect(component.getByText("Build matrix", { exact: true })).toBeVisible();
  await expect(component.getByText("Draw routes", { exact: true })).toBeVisible();
  await expect(component.getByText("Solve duration (seconds)", { exact: true })).toBeVisible();
  await expect(component.getByText("30 s", { exact: true })).toBeVisible();
  await expect(component.getByText("21.25 CNY", { exact: true })).toBeVisible();
  await expect(component.getByText("0.016 CNY/t·km", { exact: true })).toBeVisible();

  const summaryLayout = await component.evaluate((element) => {
    const root = element.shadowRoot;
    const panel = root.querySelector(".result-summary-panel");
    const fullValueNodes = [...root.querySelectorAll(".result-summary-value:not(.result-summary-value-id)")];
    const scoreSegments = [...root.querySelectorAll(".result-summary-score-segment")];
    const metricRows = [...root.querySelectorAll(".result-summary-grid-single .result-summary-row")];
    const solverDetailsHeading = [...root.querySelectorAll(".result-summary-heading")]
      .find((heading) => heading.querySelector(".result-summary-heading-title")?.textContent.trim() === "Solver details");
    const basicHeader = root.querySelector(".result-summary-panel-header");
    const statusTitle = basicHeader?.querySelector(".result-section-title");
    const statusBadge = basicHeader?.querySelector(".result-summary-status");
    const resultStatusSection = solverDetailsHeading?.closest(".result-summary-section");
    const businessSection = [...root.querySelectorAll(".result-summary-section")]
      .find((section) => section.querySelector(".result-summary-heading-title")?.textContent.trim() === "Business metrics");
    const businessHeading = businessSection?.querySelector(".result-summary-heading");
    const completedTaskMeta = [...root.querySelectorAll(".result-summary-task-meta-item")]
      .find((item) => item.querySelector(".result-summary-task-meta-label")?.textContent.trim() === "Completed");
    const businessRows = [...(businessSection?.querySelectorAll(".result-summary-row") || [])];
    const technicalLabels = ["Matrix", "Build matrix", "Draw routes"];
    const technicalRows = [...(resultStatusSection?.querySelectorAll(".result-summary-row") || [])]
      .filter((row) => technicalLabels.includes(row.querySelector(".result-summary-label")?.textContent.trim()));
    const statusRowByLabel = (label) => [...(resultStatusSection?.querySelectorAll(".result-summary-row") || [])]
      .find((row) => row.querySelector(".result-summary-label")?.textContent.trim() === label);
    const scoreRow = resultStatusSection?.querySelector(".result-summary-row-score");
    const alignedMetricRows = [
      statusRowByLabel("Constraints"),
      statusRowByLabel("Solve duration"),
      businessRows[1]
    ];
    const isAligned = (left, right) => {
      if (!left || !right) return false;
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return Math.abs(leftRect.top - rightRect.top) <= 1 && Math.abs(leftRect.bottom - rightRect.bottom) <= 1;
    };
    const scorePanel = root.querySelector(".result-score-panel");
    const scoreHeader = scorePanel?.querySelector(".result-section-toolbar");
    const scoreChart = root.querySelector('[x-ref="scoreChartShell"]');
    const ganttHeader = root.querySelector('[x-text="t(\'result.gantt.title\')"]')?.closest(".result-section-toolbar");
    const ganttPanel = ganttHeader?.closest("section");
    return {
      panelOverflows: panel.scrollWidth > panel.clientWidth + 1,
      nonIdUsesEllipsis: fullValueNodes.some((node) => getComputedStyle(node).textOverflow === "ellipsis"),
      metricRows: metricRows.length,
      metricValuesRightOfLabels: metricRows.every((row) => {
        const label = row.querySelector(".result-summary-label").getBoundingClientRect();
        const value = row.querySelector(".result-summary-value").getBoundingClientRect();
        return value.left >= label.right;
      }),
      scoreLabels: scoreSegments.map((node) => node.querySelector(".result-summary-score-label").textContent.trim()),
      scoreColors: scoreSegments.map((node) => getComputedStyle(node).color),
      scoreClasses: scoreSegments.map((node) => [...node.classList].find((className) => className.startsWith("result-summary-score-") && className !== "result-summary-score-segment")),
      statusBadgeRightOfTitle: Boolean(statusTitle && statusBadge && statusBadge.getBoundingClientRect().left >= statusTitle.getBoundingClientRect().right),
      technicalPairCount: technicalRows.length,
      technicalRowsInStatus: resultStatusSection?.querySelector(".result-summary-heading-title")?.textContent.trim(),
      technicalRowsUseSharedStyle: technicalRows.every((row) => row.classList.contains("result-summary-row") && row.querySelector(".result-summary-label") && row.querySelector(".result-summary-value")),
      technicalRowsUseTwoColumns: technicalRows.length === 3
        && technicalRows[0].getBoundingClientRect().top === technicalRows[1].getBoundingClientRect().top
        && technicalRows[0].getBoundingClientRect().left < technicalRows[1].getBoundingClientRect().left
        && technicalRows[2].getBoundingClientRect().top > technicalRows[0].getBoundingClientRect().top,
      technicalLastRowStaysInFirstStatusColumn: technicalRows.length === 3
        && Boolean(businessHeading)
        && Math.abs(technicalRows[2].getBoundingClientRect().left - technicalRows[0].getBoundingClientRect().left) <= 1
        && technicalRows[2].getBoundingClientRect().right < businessHeading.getBoundingClientRect().left - 1,
      technicalLastValueStaysInFirstStatusColumn: technicalRows.length === 3
        && Boolean(businessHeading)
        && technicalRows[2].querySelector(".result-summary-value").getBoundingClientRect().right < businessHeading.getBoundingClientRect().left - 1,
      summaryRowLinesAligned: [
        [solverDetailsHeading, businessHeading],
        [scoreRow, businessRows[0]],
        [statusRowByLabel("Constraints"), businessRows[1]],
        [statusRowByLabel("Matrix"), businessRows[2]],
        [statusRowByLabel("Draw routes"), businessRows[3]]
      ].every(([left, right]) => isAligned(left, right)),
      alignedMetricPairsShareGeometry: alignedMetricRows.every(Boolean)
        && alignedMetricRows.every((row) => Math.abs(row.getBoundingClientRect().top - alignedMetricRows[0].getBoundingClientRect().top) <= 1)
        && alignedMetricRows.every((row) => Math.abs(row.querySelector(".result-summary-label").getBoundingClientRect().width - alignedMetricRows[0].querySelector(".result-summary-label").getBoundingClientRect().width) <= 1)
        && alignedMetricRows.every((row) => {
          const label = row.querySelector(".result-summary-label").getBoundingClientRect();
          const firstRow = alignedMetricRows[0].getBoundingClientRect();
          const firstLabel = alignedMetricRows[0].querySelector(".result-summary-label").getBoundingClientRect();
          return Math.abs((row.getBoundingClientRect().width - label.width) - (firstRow.width - firstLabel.width)) <= 1;
        }),
      businessStartsAtCompletedAt: Boolean(completedTaskMeta && businessHeading
        && Math.abs(completedTaskMeta.getBoundingClientRect().left - businessHeading.getBoundingClientRect().left) <= 1),
      basicHeaderHeight: basicHeader?.getBoundingClientRect().height,
      scoreHeaderHeight: scoreHeader?.getBoundingClientRect().height,
      ganttHeaderHeight: ganttHeader?.getBoundingClientRect().height,
      summaryPanelBackground: getComputedStyle(panel).backgroundColor,
      scorePanelBackground: scorePanel ? getComputedStyle(scorePanel).backgroundColor : "",
      ganttPanelBackground: ganttPanel ? getComputedStyle(ganttPanel).backgroundColor : "",
      summaryPanelHeight: panel.getBoundingClientRect().height,
      scorePanelHeight: scorePanel?.getBoundingClientRect().height,
      scoreChartHeight: scoreChart?.getBoundingClientRect().height,
      showsCurrencyHint: root.textContent.includes("The API does not provide a currency")
    };
  });
  expect(summaryLayout.panelOverflows).toBe(false);
  expect(summaryLayout.nonIdUsesEllipsis).toBe(false);
  expect(summaryLayout.metricRows).toBe(4);
  expect(summaryLayout.metricValuesRightOfLabels).toBe(true);
  expect(summaryLayout.scoreLabels).toEqual(["Hard", "Medium", "Soft"]);
  expect(summaryLayout.scoreClasses).toEqual(["result-summary-score-hard", "result-summary-score-medium", "result-summary-score-soft"]);
  expect(new Set(summaryLayout.scoreColors).size).toBe(3);
  expect(summaryLayout.statusBadgeRightOfTitle).toBe(true);
  expect(summaryLayout.technicalPairCount).toBe(3);
  expect(summaryLayout.technicalRowsInStatus).toBe("Solver details");
  expect(summaryLayout.technicalRowsUseSharedStyle).toBe(true);
  expect(summaryLayout.technicalRowsUseTwoColumns).toBe(true);
  expect(summaryLayout.technicalLastRowStaysInFirstStatusColumn).toBe(true);
  expect(summaryLayout.technicalLastValueStaysInFirstStatusColumn).toBe(true);
  expect(summaryLayout.summaryRowLinesAligned).toBe(true);
  expect(summaryLayout.alignedMetricPairsShareGeometry).toBe(true);
  expect(summaryLayout.businessStartsAtCompletedAt).toBe(true);
  expect(summaryLayout.basicHeaderHeight).toBe(60);
  expect(summaryLayout.scoreHeaderHeight).toBe(60);
  expect(summaryLayout.ganttHeaderHeight).toBeGreaterThanOrEqual(60);
  expect(summaryLayout.scorePanelBackground).toBe(summaryLayout.summaryPanelBackground);
  expect(summaryLayout.summaryPanelBackground).not.toBe(summaryLayout.ganttPanelBackground);
  expect(summaryLayout.ganttPanelBackground).toBe("rgb(255, 255, 255)");
  expect(summaryLayout.scoreChartHeight).toBe(200);
  expect(Math.abs(summaryLayout.summaryPanelHeight - summaryLayout.scorePanelHeight)).toBeLessThanOrEqual(0.5);
  expect(summaryLayout.showsCurrencyHint).toBe(false);

  await page.selectOption("#engine-locale", "zh-CN");
  await expect(component.getByText("21.25 元", { exact: true })).toBeVisible();
  await expect(component.getByText("0.016 元/吨·公里", { exact: true })).toBeVisible();
  await page.selectOption("#engine-locale", "en-US");
  await expect(component.getByText("Task ID", { exact: true })).toBeVisible();
  await expect(component.getByText("Solve duration (seconds)", { exact: true })).toBeVisible();

  const leaked = await component.evaluate((element) => {
    const values = [];
    const root = element.shadowRoot;
    root.querySelectorAll("*").forEach((node) => {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || node.closest("[hidden]")) return;
      [node.textContent, node.getAttribute("title"), node.getAttribute("aria-label"), node.getAttribute("placeholder")]
        .filter(Boolean)
        .forEach((value) => {
          if (/[\u3400-\u9fff]/.test(value)) values.push(value.trim());
        });
    });
    return [...new Set(values)];
  });
  expect(leaked).toEqual([]);
});

test("任务详情首次请求期间不闪现无任务空状态", async ({ page }) => {
  let releaseResultRequest;
  const resultRequestGate = new Promise((resolve) => { releaseResultRequest = resolve; });
  await page.route("**/solver_job/delayed-result-job*", async (route) => {
    await resultRequestGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...resultJob, id: "delayed-result-job" })
    });
  });

  await page.goto(`${baseUrl}/static/index.html#/solver-job?id=delayed-result-job`);
  const component = page.locator("vrp-scenario-ui-vrp0");
  await expect(component.getByText("正在加载任务详情", { exact: true })).toBeVisible();
  await expect(component.getByText("当前没有求解任务", { exact: true })).toHaveCount(0);

  releaseResultRequest();
  await expect(component.getByText("基本信息", { exact: true })).toBeVisible();
  await expect(component.getByText("当前没有求解任务", { exact: true })).toHaveCount(0);
});

test("运行态任务详情后台刷新到终态后停止请求", async ({ page }) => {
  let resultRequestCount = 0;
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(
      callback,
      delay === 5000 ? 20 : delay,
      ...args
    );
    window.__resultStates = [];
    window.addEventListener("scenario-result-state-changed", (event) => window.__resultStates.push(event.detail));
  });
  await page.route("**/solver_job/polling-result-job*", async (route) => {
    resultRequestCount += 1;
    const status = resultRequestCount === 1 ? "SOLVING_ACTIVE" : "SOLVING_FINISHED";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...resultJob, id: "polling-result-job", status })
    });
  });

  await page.goto(`${baseUrl}/static/index.html#/solver-job?id=polling-result-job`);
  await expect.poll(() => page.evaluate(() => window.__resultStates.some((state) => state.status === "SOLVING_ACTIVE"))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__resultStates.at(-1))).toEqual({
    job_id: "polling-result-job",
    status: "SOLVING_FINISHED"
  });
  expect(resultRequestCount).toBe(2);

  await page.waitForTimeout(100);
  expect(resultRequestCount).toBe(2);
});

test("quota masks API key in the preview while preserving the save payload", async ({ page }) => {
  lastQuotaPayload = null;
  await page.addInitScript(() => localStorage.setItem("vrp0.engine.locale", "en-US"));
  await page.goto(`${baseUrl}/static/index.html#/quota`);

  const apiKey = page.getByLabel("AMap API key", { exact: true });
  const preview = page.locator("pre");
  await expect(apiKey).toHaveAttribute("type", "password");
  await expect(apiKey).toHaveValue(quotaFixture.key);
  await expect(preview).toContainText("********");
  await expect(preview).not.toContainText(quotaFixture.key);

  await page.getByRole("button", { name: "Show API Key" }).click();
  await expect(apiKey).toHaveAttribute("type", "text");
  await expect(preview).not.toContainText(quotaFixture.key);
  await apiKey.fill("submitted-secret-key");
  await expect(preview).not.toContainText("submitted-secret-key");
  await page.getByRole("button", { name: "Save configuration" }).click();
  await expect.poll(() => lastQuotaPayload?.key).toBe("submitted-secret-key");
  expect(lastQuotaPayload).toMatchObject({
    key: "submitted-secret-key",
    qps: 10,
    quota: 10000,
    interval: "PT86400S",
    wait_timeout: "PT10S"
  });
});

test("Host remaining result actions follow component result-state events", async ({ page }) => {
  await page.addInitScript(() => {
    window.__resultStates = [];
    window.addEventListener("scenario-result-state-changed", (event) => window.__resultStates.push(event.detail));
  });

  const actionState = async () => ({
    stop: await page.getByRole("button", { name: "停止求解" }).isEnabled(),
    remove: await page.getByRole("button", { name: "删除任务" }).isEnabled()
  });

  await page.goto(`${baseUrl}/static/index.html#/solver-job?id=english-result-job`);
  await expect(page.getByRole("button", { name: "应用回场景" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__resultStates.at(-1))).toEqual({ job_id: "english-result-job", status: "SOLVING_FINISHED" });
  expect(await actionState()).toEqual({ stop: false, remove: true });

  await page.goto(`${baseUrl}/static/index.html#/solver-job?id=running-result-job`);
  await expect(page.getByRole("button", { name: "停止求解" })).toBeEnabled();
  expect(await actionState()).toEqual({ stop: true, remove: false });
  await expect.poll(() => page.evaluate(() => window.__resultStates.at(-1))).toEqual({ job_id: "running-result-job", status: "SOLVING_ACTIVE" });

  await page.goto(`${baseUrl}/static/index.html#/solver-job?id=failed-result-job`);
  await expect(page.getByRole("button", { name: "删除任务" })).toBeEnabled();
  expect(await actionState()).toEqual({ stop: false, remove: true });

  await page.goto(`${baseUrl}/static/index.html#/solver-job?id=missing-result-job`);
  await expect(page.getByRole("button", { name: "应用回场景" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__resultStates.at(-1))).toEqual({ job_id: null, status: null });
  expect(await actionState()).toEqual({ stop: false, remove: false });
});

test("core pages remain reachable at mobile, tablet, and desktop breakpoints", async ({ page }) => {
  const viewports = [
    { width: 488, height: 1055 },
    { width: 960, height: 1280 },
    { width: 1600, height: 1000 },
    { width: 1800, height: 1125 }
  ];
  const routes = ["/scenario", "/solver-jobs", "/solver-job?id=english-result-job", "/solver-map?id=english-result-job", "/quota", "/mcp"];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(`${baseUrl}/static/index.html#${route}`);
      const marker = route === "/solver-jobs"
        ? '[x-data="solverJobListPage"]'
        : route === "/quota"
          ? '[x-data="quotaPage"]'
          : route === "/mcp"
            ? '[x-data="mcpPage"]'
            : '[x-data="scenarioComponentPage"]';
      await expect(page.locator(`#page-outlet ${marker}`)).toBeVisible();
      if (route !== "/solver-jobs" && (route.startsWith("/scenario") || route.startsWith("/solver-job") || route.startsWith("/solver-map"))) {
        await expect(page.locator("vrp-scenario-ui-vrp0")).toHaveCount(1);
      }
      const overflow = await page.evaluate(() => {
        const clientWidth = document.documentElement.clientWidth;
        return {
          document: document.documentElement.scrollWidth - clientWidth,
          outlet: document.querySelector("#page-outlet").scrollWidth - document.querySelector("#page-outlet").clientWidth,
          offenders: [...document.querySelectorAll("body *")]
            .filter((node) => node.scrollWidth > node.clientWidth + 1)
            .slice(-10)
            .map((node) => `${node.tagName.toLowerCase()}.${String(node.className || "").replace(/\s+/g, ".")}(${node.clientWidth}/${node.scrollWidth})`)
        };
      });
      expect(overflow.document, `${viewport.width}px ${route} document overflow: ${overflow.offenders.join(", ")}`).toBeLessThanOrEqual(1);
    }
  }

  await page.setViewportSize({ width: 488, height: 1055 });
  await page.goto(`${baseUrl}/static/index.html#/scenario`);
  const scenarioComponent = page.locator("vrp-scenario-ui-vrp0");
  for (const tab of ["仓库", "车辆/工程师", "工单", "SKU", "成本参数", "场景约束"]) {
    await scenarioComponent.getByRole("button", { name: tab, exact: true }).click();
  }
  await scenarioComponent.getByRole("button", { name: "场景约束", exact: true }).click();
  const scenarioTable = await scenarioComponent.evaluate((element) => {
    const region = [...element.shadowRoot.querySelectorAll(".table-scroll-region")].find((node) => getComputedStyle(node).display !== "none");
    const sidebarToggle = element.shadowRoot.querySelector(".scenario-sidebar-toggle");
    return {
      height: region?.getBoundingClientRect().height || 0,
      overflowsHorizontally: region?.scrollWidth > region?.clientWidth + 1,
      sidebarToggleVisible: sidebarToggle ? getComputedStyle(sidebarToggle).display !== "none" : false
    };
  });
  expect(scenarioTable.height).toBeGreaterThanOrEqual(375);
  expect(scenarioTable.sidebarToggleVisible).toBe(false);

  await page.goto(`${baseUrl}/static/index.html#/solver-jobs`);
  await expect(page.locator('article[role="link"]')).toHaveCount(1);
  const listDensity = await page.evaluate(() => {
    const row = document.querySelector('article[role="link"]');
    const header = row?.parentElement?.querySelector(":scope > div");
    return {
      row: row?.getBoundingClientRect().height || 0,
      header: header?.getBoundingClientRect().height || 0,
      rowStyle: row ? `${getComputedStyle(row).height}/${getComputedStyle(row).display}/${getComputedStyle(row).getPropertyValue('--spacing')}` : "missing"
    };
  });
  expect(listDensity.row).toBeGreaterThanOrEqual(50);
  expect(listDensity.row, listDensity.rowStyle).toBeLessThanOrEqual(55);
  expect(listDensity.header).toBeGreaterThanOrEqual(42.5);
  expect(listDensity.header).toBeLessThanOrEqual(45);

  await page.goto(`${baseUrl}/static/index.html#/solver-job?id=english-result-job`);
  await expect(page.locator("vrp-scenario-ui-vrp0").getByText("求解信息", { exact: true })).toBeVisible();
  const resultOrder = await page.locator("vrp-scenario-ui-vrp0").evaluate((element) => {
    const root = element.shadowRoot;
    const box = (node) => node?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
    const pageRoot = root.querySelector(".responsive-page-root");
    const resultScroll = root.querySelector(".result-page-scroll");
    return {
      summary: box(root.querySelector(".result-summary-panel")),
      curve: box(root.querySelector('[x-ref="scoreChartShell"]')),
      gantt: box(root.querySelector('[x-text="t(\'result.gantt.title\')"]')?.closest("section")),
      sidebar: box(root.querySelector('aside[x-show="!isJobSolving()"]')),
      pageCanScroll: pageRoot?.scrollHeight > pageRoot?.clientHeight + 1,
      resultOverflow: resultScroll ? getComputedStyle(resultScroll).overflowY : "missing"
    };
  });
  expect(resultOrder.summary).toBeLessThan(resultOrder.curve);
  expect(resultOrder.curve).toBeLessThan(resultOrder.gantt);
  expect(resultOrder.gantt).toBeLessThan(resultOrder.sidebar);
  expect(resultOrder.pageCanScroll).toBe(true);
  expect(resultOrder.resultOverflow).toBe("visible");

  await page.goto(`${baseUrl}/static/index.html#/solver-map?id=english-result-job`);
  const mapComponent = page.locator("vrp-scenario-ui-vrp0");
  await expect(mapComponent.getByRole("button", { name: /大屏模式/ })).toBeVisible();
  const mapLayout = await mapComponent.evaluate((element) => {
    const root = element.shadowRoot;
    const pageRoot = root.querySelector(".responsive-page-root");
    const pageBody = root.querySelector(".map-page-body");
    const canvas = root.querySelector('[x-ref="defaultMapCanvas"]');
    const timeline = root.querySelector('[x-text="t(\'map.timeline.title\')"]');
    const aside = root.querySelector(".map-default-layout > aside");
    const action = root.querySelector(".map-replay-actions .action-secondary");
    return {
      canvasHeight: canvas?.getBoundingClientRect().height || 0,
      canvasTop: canvas?.getBoundingClientRect().top || 0,
      timelineTop: timeline?.getBoundingClientRect().top || 0,
      asideTop: aside?.getBoundingClientRect().top || 0,
      pageCanScroll: pageRoot?.scrollHeight > pageRoot?.clientHeight + 1,
      asideReachable: aside ? aside.getBoundingClientRect().bottom <= pageRoot.getBoundingClientRect().top + pageRoot.scrollHeight + 1 : false,
      pageBodyOverflow: pageBody ? getComputedStyle(pageBody).overflowY : "missing",
      actionHeight: action?.getBoundingClientRect().height || 0
    };
  });
  expect(mapLayout.canvasHeight).toBeGreaterThanOrEqual(400);
  expect(mapLayout.canvasHeight).toBeLessThanOrEqual(420);
  expect(mapLayout.canvasTop).toBeLessThan(mapLayout.timelineTop);
  expect(mapLayout.timelineTop).toBeLessThan(mapLayout.asideTop);
  expect(mapLayout.pageCanScroll).toBe(true);
  expect(mapLayout.asideReachable).toBe(true);
  expect(mapLayout.pageBodyOverflow).toBe("visible");
  expect(mapLayout.actionHeight).toBeLessThanOrEqual(55);
  await mapComponent.getByRole("button", { name: /大屏模式/ }).click();
  await expect(mapComponent.locator(".map-bigscreen-layout")).toBeVisible();
  await expect.poll(() => mapComponent.evaluate((element) => ({
    hostIsFullscreen: document.fullscreenElement === element,
    shadowChildIsFullscreen: Boolean(element.shadowRoot.fullscreenElement)
  }))).toEqual({ hostIsFullscreen: true, shadowChildIsFullscreen: false });
  await mapComponent.getByRole("button", { name: /显示全部/ }).click();
  await mapComponent.getByRole("button", { name: /最适缩放/ }).click();
  await mapComponent.getByRole("button", { name: /跟随当前/ }).click();
  await mapComponent.getByRole("button", { name: "2x" }).click();
  await expect.poll(() => mapComponent.evaluate((element) => {
    const pageRoot = element.shadowRoot.querySelector('[x-ref="pageRoot"]');
    const data = pageRoot?._x_dataStack?.[0];
    return { follow: data?.followFocusedAgent, speed: data?.playbackSpeed };
  })).toEqual({ follow: true, speed: 2 });
  const bigScreenLayout = await mapComponent.evaluate((element) => {
    const root = element.shadowRoot;
    const pageRoot = root.querySelector(".responsive-page-root");
    const layout = root.querySelector(".map-bigscreen-layout");
    const mapPanel = layout?.querySelector("section.bigscreen-panel");
    const mapCanvasShell = mapPanel?.firstElementChild;
    const panels = [...(layout?.querySelectorAll(".bigscreen-panel") || [])];
    return {
      overflow: layout ? layout.scrollWidth - layout.clientWidth : 999,
      mapHeight: mapCanvasShell?.getBoundingClientRect().height || 0,
      mapStyle: mapCanvasShell ? `${window.innerWidth}/${mapCanvasShell.matches('.map-bigscreen-layout .bigscreen-map-canvas')}/${getComputedStyle(mapCanvasShell).height}/${getComputedStyle(mapCanvasShell).display}/${getComputedStyle(mapCanvasShell).flex}/${mapCanvasShell.className}` : "missing",
      panels: panels.length,
      pageCanScroll: pageRoot?.scrollHeight > pageRoot?.clientHeight + 1,
      panelsReachable: panels.every((panel) => panel.getBoundingClientRect().bottom <= pageRoot.getBoundingClientRect().top + pageRoot.scrollHeight + 1)
    };
  });
  expect(bigScreenLayout.overflow).toBeLessThanOrEqual(1);
  expect(bigScreenLayout.mapHeight, bigScreenLayout.mapStyle).toBeGreaterThanOrEqual(400);
  expect(bigScreenLayout.panels).toBe(3);
  expect(bigScreenLayout.pageCanScroll).toBe(true);
  expect(bigScreenLayout.panelsReachable).toBe(true);
  await mapComponent.getByRole("button", { name: /退出大屏/ }).click();
  await expect(mapComponent.locator(".map-default-layout")).toBeVisible();
  await expect.poll(() => mapComponent.evaluate((element) => {
    const root = element.shadowRoot;
    return !document.fullscreenElement && !root.fullscreenElement;
  })).toBe(true);

  await page.goto(`${baseUrl}/static/index.html#/quota`);
  await expect(page.getByText("当前配置预览", { exact: true })).toBeVisible();
  const quotaOrder = await page.evaluate(() => {
    const root = document.querySelector('[x-data="quotaPage"]');
    const main = root?.querySelector(".responsive-workspace-main");
    const preview = root?.querySelector("aside section:first-child");
    const notes = root?.querySelector("aside section:last-child");
    return [main, preview, notes].map((node) => node?.getBoundingClientRect().top || 0);
  });
  expect(quotaOrder[0]).toBeLessThan(quotaOrder[1]);
  expect(quotaOrder[1]).toBeLessThan(quotaOrder[2]);

  await page.goto(`${baseUrl}/static/index.html#/mcp`);
  await expect(page.getByText("MCP 接入摘要", { exact: true })).toBeVisible();
  const mcpOrder = await page.evaluate(() => {
    const root = document.querySelector('[x-data="mcpPage"]');
    const summary = root?.querySelector(".responsive-workspace-main section");
    const client = [...(root?.querySelectorAll(".responsive-workspace-main section") || [])].find((node) => node.textContent.includes("客户端配置"));
    const status = root?.querySelector(".responsive-workspace-aside");
    return [summary, client, status].map((node) => node?.getBoundingClientRect().top || 0);
  });
  expect(mcpOrder[0]).toBeLessThan(mcpOrder[1]);
  expect(mcpOrder[1]).toBeLessThan(mcpOrder[2]);
});

test("desktop result panels use one border owner per shared edge", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${baseUrl}/static/index.html#/solver-job?id=english-result-job`);
  const component = page.locator("vrp-scenario-ui-vrp0");
  await expect(component.getByText("求解信息", { exact: true })).toBeVisible();

  const resultSeparators = await component.evaluate((element) => {
    const root = element.shadowRoot;
    const describe = (node) => {
      const rect = node?.getBoundingClientRect();
      const style = node ? getComputedStyle(node) : null;
      return rect && style ? {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        borderTop: Number.parseFloat(style.borderTopWidth),
        borderLeft: Number.parseFloat(style.borderLeftWidth),
        borderRight: Number.parseFloat(style.borderRightWidth),
        borderBottom: Number.parseFloat(style.borderBottomWidth)
      } : null;
    };
    const gantt = root.querySelector('[x-text="t(\'result.gantt.title\')"]')?.closest("section.panel-shell");
    return {
      toolbar: describe(root.querySelector(".solver-detail-toolbar")),
      summary: describe(root.querySelector(".result-summary-panel")),
      score: describe(root.querySelector(".result-score-panel")),
      gantt: describe(gantt),
      sidebar: describe(root.querySelector('aside[x-show="!isJobSolving()"]'))
    };
  });
  const withinTwoPixels = (left, right) => Math.abs(left - right) <= 2;

  // Chromium quantizes a declared 1.25px border to one CSS pixel at DPR 1.
  expect(resultSeparators.toolbar?.borderBottom).toBe(1);
  for (const panel of [resultSeparators.summary, resultSeparators.score, resultSeparators.gantt, resultSeparators.sidebar]) {
    expect(panel?.borderTop).toBe(0);
    expect(panel?.borderLeft).toBe(0);
  }
  expect(withinTwoPixels(resultSeparators.toolbar.bottom, resultSeparators.summary.top)).toBe(true);
  expect(withinTwoPixels(resultSeparators.summary.right, resultSeparators.score.left)).toBe(true);
  expect(withinTwoPixels(resultSeparators.summary.bottom, resultSeparators.score.bottom)).toBe(true);
  expect(withinTwoPixels(resultSeparators.summary.bottom, resultSeparators.gantt.top)).toBe(true);
  expect(withinTwoPixels(resultSeparators.gantt.right, resultSeparators.sidebar.left)).toBe(true);
});

test("visual density keeps controls, identifiers, tables, and map canvas consistent", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`${baseUrl}/static/index.html#/scenario`);

  const scenarioComponent = page.locator("vrp-scenario-ui-vrp0");
  await expect(scenarioComponent.locator('input[x-model="scenario.name"]')).toBeVisible();
  const scenarioDensity = await scenarioComponent.evaluate((element) => {
    const root = element.shadowRoot;
    const input = root.querySelector('input[x-model="scenario.name"]');
    const table = root.querySelector(".data-table");
    const pageTitle = document.querySelector('header [x-text="currentPageTitle"]');
    return {
      bodyFontSize: getComputedStyle(document.body).fontSize,
      pageTitleFontSize: pageTitle ? getComputedStyle(pageTitle).fontSize : "",
      inputHeight: input?.getBoundingClientRect().height || 0,
      inputFontSize: input ? getComputedStyle(input).fontSize : "",
      tableCollapse: table ? getComputedStyle(table).borderCollapse : "",
      tabHeight: (() => {
        const tab = [...root.querySelectorAll(".scenario-config-tab")].find((node) => node.getBoundingClientRect().height > 0);
        return tab?.getBoundingClientRect().height || 0;
      })(),
      labelGap: (() => {
        const label = root.querySelector('input[x-model="scenario.name"]')?.previousElementSibling;
        const control = root.querySelector('input[x-model="scenario.name"]');
        return label && control ? control.getBoundingClientRect().top - label.getBoundingClientRect().bottom : 0;
      })()
    };
  });
  expect(scenarioDensity.bodyFontSize).toBe("16.25px");
  expect(scenarioDensity.pageTitleFontSize).toBe("20px");
  expect(scenarioDensity.inputHeight).toBe(37.5);
  expect(scenarioDensity.inputFontSize).toBe("16.25px");
  expect(scenarioDensity.tableCollapse).toBe("collapse");
  expect(scenarioDensity.tabHeight).toBeGreaterThan(0);
  expect(scenarioDensity.tabHeight).toBeLessThanOrEqual(35);
  expect(scenarioDensity.labelGap).toBe(2.5);

  await page.goto(`${baseUrl}/static/index.html#/solver-jobs`);
  await expect(page.locator('select[x-model="filters.status"]')).toBeVisible();
  const jobsDensity = await page.evaluate(() => {
    const root = document.querySelector('[x-data="solverJobListPage"]');
    const status = root?.querySelector('select[x-model="filters.status"]');
    const jobStatus = root?.querySelector("article .status-pill");
    const taskCell = root?.querySelector("article > div:first-child");
    const tableHeader = root?.querySelector(".panel-scroll > div > div > div");
    const searchAction = root?.querySelector(".job-list-filter-action");
    const filterForm = searchAction?.closest("form");
    const statusField = status?.closest(".job-list-filter-field");
    const statusLabel = statusField?.querySelector(".field-label");
    const scoreSegments = [...(root?.querySelectorAll("article .result-summary-score-hard, article .result-summary-score-medium, article .result-summary-score-soft") || [])];
    const enumWidths = [...(root?.querySelectorAll(".job-list-filter-enum") || [])]
      .map((select) => select.getBoundingClientRect().width);
    return {
      statusWidth: status?.getBoundingClientRect().width || 0,
      statusHeight: status?.getBoundingClientRect().height || 0,
      jobStatusWidth: jobStatus?.getBoundingClientRect().width || 0,
      searchActionHeight: searchAction?.getBoundingClientRect().height || 0,
      searchActionRightGap: filterForm && searchAction
        ? Math.round(filterForm.getBoundingClientRect().right - searchAction.getBoundingClientRect().right)
        : -1,
      filterGroupGap: filterForm ? Number.parseFloat(getComputedStyle(filterForm).columnGap) : 0,
      filterKeyControlGap: statusField ? Number.parseFloat(getComputedStyle(statusField).columnGap) : 0,
      filterKeyFontSize: statusLabel ? getComputedStyle(statusLabel).fontSize : "",
      filterControlFontSize: status ? getComputedStyle(status).fontSize : "",
      filterKeyControlCenterDelta: status && statusLabel
        ? Math.abs(
          status.getBoundingClientRect().top + status.getBoundingClientRect().height / 2
          - statusLabel.getBoundingClientRect().top - statusLabel.getBoundingClientRect().height / 2
        )
        : -1,
      resetActionCount: root?.querySelectorAll("form .action-secondary").length || 0,
      refreshActionCount: root?.querySelectorAll("form .job-list-filter-icon-action").length || 0,
      tableHeaderFontSize: tableHeader ? getComputedStyle(tableHeader).fontSize : "",
      tableRightPadding: tableHeader ? Number.parseFloat(getComputedStyle(tableHeader).paddingRight) : 0,
      taskColumnWidth: tableHeader?.children[0]?.getBoundingClientRect().width || 0,
      scoreColumnWidth: tableHeader?.children[6]?.getBoundingClientRect().width || 0,
      createdColumnWidth: tableHeader?.children[7]?.getBoundingClientRect().width || 0,
      tableClientWidth: tableHeader?.parentElement?.parentElement?.clientWidth || 0,
      tableScrollWidth: tableHeader?.parentElement?.parentElement?.scrollWidth || 0,
      tableHeaders: [...(tableHeader?.children || [])].map((cell) => cell.textContent.trim()),
      scoreSegmentClasses: scoreSegments.slice(0, 3).map((segment) => [...segment.classList]
        .find((className) => className.startsWith("result-summary-score-"))),
      scoreSegmentColors: scoreSegments.slice(0, 3).map((segment) => getComputedStyle(segment).color),
      enumWidths,
      optionalFilterValues: [
        root?.querySelector('select[x-model="filters.buildTransitMatrix"]')?.value,
        root?.querySelector('select[x-model="filters.matrixMode"]')?.value,
        root?.querySelector('select[x-model="filters.drawRoute"]')?.value
      ],
      createTimeFrom: root?.querySelector('vrp-date-time-24[x-model="filters.createTimeFrom"]')?.value,
      createTimeTo: root?.querySelector('vrp-date-time-24[x-model="filters.createTimeTo"]')?.value,
      taskText: taskCell?.textContent.trim(),
      renderedTaskIdCount: [...(root?.querySelectorAll("article *") || [])]
        .filter((element) => element.textContent.trim() === "english-result-job").length,
      taskTextOverflow: taskCell ? getComputedStyle(taskCell).textOverflow : "",
      taskWhiteSpace: taskCell ? getComputedStyle(taskCell).whiteSpace : ""
    };
  });
  expect(jobsDensity.statusHeight).toBe(37.5);
  expect(jobsDensity.searchActionHeight).toBe(jobsDensity.statusHeight);
  expect(jobsDensity.searchActionRightGap).toBe(0);
  expect(jobsDensity.filterKeyControlCenterDelta).toBeLessThanOrEqual(1);
  expect(jobsDensity.filterGroupGap).toBeGreaterThan(jobsDensity.filterKeyControlGap);
  expect(jobsDensity.filterKeyFontSize).toBe("16.25px");
  expect(jobsDensity.filterKeyFontSize).toBe(jobsDensity.filterControlFontSize);
  expect(jobsDensity.resetActionCount).toBe(0);
  expect(jobsDensity.refreshActionCount).toBe(0);
  expect(jobsDensity.tableHeaderFontSize).toBe("16.25px");
  expect(jobsDensity.tableRightPadding).toBe(10);
  expect(jobsDensity.taskColumnWidth).toBeGreaterThanOrEqual(160);
  expect(jobsDensity.taskColumnWidth).toBeLessThanOrEqual(200);
  expect(jobsDensity.taskColumnWidth).toBeLessThanOrEqual(jobsDensity.createdColumnWidth);
  expect(jobsDensity.scoreColumnWidth).toBeGreaterThanOrEqual(240);
  expect(jobsDensity.tableScrollWidth).toBe(jobsDensity.tableClientWidth);
  expect(jobsDensity.tableHeaders).toContain("求解完成时间");
  expect(jobsDensity.tableHeaders).not.toContain("更新时间");
  expect(jobsDensity.scoreSegmentClasses).toEqual([
    "result-summary-score-hard",
    "result-summary-score-medium",
    "result-summary-score-soft"
  ]);
  expect(new Set(jobsDensity.scoreSegmentColors).size).toBe(3);
  expect(jobsDensity.enumWidths).toHaveLength(4);
  expect(jobsDensity.enumWidths[1]).toBeLessThanOrEqual(110);
  expect(jobsDensity.enumWidths[2]).toBeLessThanOrEqual(160);
  expect(jobsDensity.enumWidths[3]).toBeLessThanOrEqual(110);
  expect(jobsDensity.optionalFilterValues).toEqual(["", "", ""]);
  expect(jobsDensity.createTimeFrom).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  expect(jobsDensity.createTimeTo).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  const buildMatrixFilter = page.locator('select[x-model="filters.buildTransitMatrix"]');
  await buildMatrixFilter.selectOption("true");
  await expect(buildMatrixFilter).toHaveValue("true");
  await buildMatrixFilter.selectOption("");
  await expect(buildMatrixFilter).toHaveValue("");
  expect(jobsDensity.statusWidth).toBeLessThanOrEqual(160);
  expect(jobsDensity.jobStatusWidth).toBeLessThanOrEqual(100);
  expect(jobsDensity.taskText).toBe("260714-080000");
  expect(jobsDensity.renderedTaskIdCount).toBe(0);
  expect(jobsDensity.taskTextOverflow).toBe("ellipsis");
  expect(jobsDensity.taskWhiteSpace).toBe("nowrap");

  await page.setViewportSize({ width: 2139, height: 900 });
  const wideJobsDensity = await page.evaluate(() => {
    const root = document.querySelector('[x-data="solverJobListPage"]');
    const scroll = root?.querySelector(".overflow-x-auto");
    const header = scroll?.querySelector(".solver-job-list-grid");
    const cells = [...(header?.children || [])];
    return {
      clientWidth: scroll?.clientWidth || 0,
      scrollWidth: scroll?.scrollWidth || 0,
      taskWidth: cells[0]?.getBoundingClientRect().width || 0,
      scoreWidth: cells[6]?.getBoundingClientRect().width || 0,
      createdWidth: cells[7]?.getBoundingClientRect().width || 0,
      finishedWidth: cells[8]?.getBoundingClientRect().width || 0
    };
  });
  expect(wideJobsDensity.scrollWidth).toBe(wideJobsDensity.clientWidth);
  expect(wideJobsDensity.taskWidth).toBeGreaterThan(220);
  expect(wideJobsDensity.taskWidth).toBeLessThan(240);
  expect(wideJobsDensity.taskWidth).toBeLessThanOrEqual(wideJobsDensity.createdWidth);
  expect(wideJobsDensity.scoreWidth).toBeGreaterThan(325);
  expect(wideJobsDensity.scoreWidth).toBeLessThan(425);
  expect(wideJobsDensity.createdWidth).toBeGreaterThan(187.5);
  expect(wideJobsDensity.createdWidth).toBeLessThan(250);
  expect(Math.abs(wideJobsDensity.createdWidth - wideJobsDensity.finishedWidth)).toBeLessThan(1);
  await page.setViewportSize({ width: 1600, height: 900 });

  await page.goto(`${baseUrl}/static/index.html#/quota`);
  const quotaRoot = page.locator('[x-data="quotaPage"]');
  await expect(quotaRoot.locator("select.field-input-enum")).toBeVisible();
  const quotaDensity = await page.evaluate(() => {
    const root = document.querySelector('[x-data="quotaPage"]');
    const provider = root?.querySelector("select.field-input-enum");
    const number = root?.querySelector('input[type="number"].field-input-number');
    return {
      providerWidth: provider?.getBoundingClientRect().width || 0,
      providerHeight: provider?.getBoundingClientRect().height || 0,
      numberWidth: number?.getBoundingClientRect().width || 0,
      numberHeight: number?.getBoundingClientRect().height || 0
    };
  });
  expect(quotaDensity.providerWidth).toBeLessThanOrEqual(220);
  expect(quotaDensity.providerHeight).toBe(37.5);
  expect(quotaDensity.numberWidth).toBe(140);
  expect(quotaDensity.numberHeight).toBe(37.5);
  const quotaBorder = await page.evaluate(() => {
    const root = document.querySelector('[x-data="quotaPage"]');
    const headerBand = document.querySelector('header .frame-top-band');
    const main = root?.querySelector('.responsive-workspace-main');
    const aside = root?.querySelector('.responsive-workspace-aside');
    return {
      headerBottom: headerBand ? getComputedStyle(headerBand).borderBottomWidth : "",
      mainTop: main ? getComputedStyle(main).borderTopWidth : "",
      mainRight: main ? getComputedStyle(main).borderRightWidth : "",
      asideTop: aside ? getComputedStyle(aside).borderTopWidth : "",
      asideLeft: aside ? getComputedStyle(aside).borderLeftWidth : ""
    };
  });
  expect(quotaBorder.headerBottom).toBe("0px");
  expect(quotaBorder.mainTop).toBe("0px");
  expect(quotaBorder.mainRight).toBe("1px");
  expect(quotaBorder.asideTop).toBe("0px");
  expect(quotaBorder.asideLeft).toBe("0px");

  await page.goto(`${baseUrl}/static/index.html#/solver-map?id=english-result-job`);
  const mapComponent = page.locator("vrp-scenario-ui-vrp0");
  await expect(mapComponent.locator('[x-ref="defaultMapCanvas"]')).toBeVisible();
  const mapDensity = await mapComponent.evaluate((element) => {
    const root = element.shadowRoot;
    const canvas = root.querySelector('[x-ref="defaultMapCanvas"]');
    const panel = root.querySelector(".map-canvas-panel");
    return {
      canvasBorder: canvas ? getComputedStyle(canvas).borderWidth : "",
      canvasPadding: canvas ? getComputedStyle(canvas).padding : "",
      panelBorder: panel ? getComputedStyle(panel).borderWidth : "",
      panelPadding: panel ? getComputedStyle(panel).padding : "",
      canvasHeight: canvas?.getBoundingClientRect().height || 0
    };
  });
  expect(mapDensity.canvasBorder).toBe("0px");
  expect(mapDensity.canvasPadding).toBe("0px");
  expect(mapDensity.panelBorder).toBe("0px");
  expect(mapDensity.panelPadding).toBe("0px");
  expect(mapDensity.canvasHeight).toBeGreaterThan(0);
});

test("成本参数单位作为不可编辑后缀展示并与数值输入关联", async ({ page }) => {
  await page.setViewportSize({ width: 488, height: 1055 });
  await page.goto(`${baseUrl}/static/index.html#/scenario`);

  const component = page.locator("vrp-scenario-ui-vrp0");
  await component.getByRole("button", { name: "成本参数", exact: true }).click();
  const inputs = component.locator(".scenario-cost-parameter-control input[type='number']");
  const units = component.locator(".scenario-cost-parameter-unit");
  await expect(inputs).toHaveCount(10);
  await expect(units).toHaveCount(10);
  await expect(units.first()).toHaveText("/车次");
  await expect(units.nth(2)).toHaveText("倍");
  await expect(units.nth(4)).toHaveText("米");
  await expect(units.nth(6)).toHaveText("元/车次");
  await expect(units.nth(8)).toHaveText("/kWh");
  await expect(units.nth(9)).toHaveText("/L");

  await inputs.first().fill("135");
  await expect(inputs.first()).toHaveValue("135");
  await expect(units.first()).toHaveText("/车次");

  const unitSemantics = await component.evaluate((element) => {
    const root = element.shadowRoot;
    const controls = [...root.querySelectorAll(".scenario-cost-parameter-control")];
    const suffixes = [...root.querySelectorAll(".scenario-cost-parameter-unit")];
    return {
      allSuffixesAreText: suffixes.every((unit) => unit.tagName === "SPAN" && !unit.isContentEditable),
      inputsDescribeUnitsWhenPresent: controls.every((control) => {
        const input = control.querySelector("input");
        const unit = control.querySelector(".scenario-cost-parameter-unit");
        return unit
          ? input?.getAttribute("aria-describedby") === unit.id
          : !input?.hasAttribute("aria-describedby");
      }),
      allControlsHaveMigratedHeight: controls.every((control) => control.getBoundingClientRect().height === 37.5),
      allSuffixesAreSeparated: suffixes.every((unit) => getComputedStyle(unit).borderLeftWidth === "1px"),
      gridFitsViewport: (() => {
        const grid = root.querySelector(".scenario-cost-parameters");
        return grid ? grid.scrollWidth <= grid.clientWidth + 1 : false;
      })()
    };
  });
  expect(unitSemantics).toEqual({
    allSuffixesAreText: true,
    inputsDescribeUnitsWhenPresent: true,
    allControlsHaveMigratedHeight: true,
    allSuffixesAreSeparated: true,
    gridFitsViewport: true
  });
});

test("English map view localizes replay controls and technician-panel copy", async ({ page }) => {
  await page.setViewportSize({ width: 2020, height: 1125 });
  await page.addInitScript(() => localStorage.setItem("vrp0.engine.locale", "en-US"));
  await page.goto(`${baseUrl}/static/index.html#/solver-map?id=english-result-job`);

  const component = page.locator("vrp-scenario-ui-vrp0");
  await expect(component).toHaveCount(1);
  await expect(component.getByRole("button", { name: /Back to job details$/ })).toBeVisible();
  await expect(component.getByRole("button", { name: /Big-screen mode$/ })).toBeVisible();
  await expect(component.getByRole("button", { name: /Auto-play$/ })).toBeVisible();
  await expect(component.getByRole("button", { name: /Back to start$/ })).toBeVisible();
  await expect(component.getByRole("button", { name: /Fit to view$/ })).toBeVisible();
  await expect(component.getByRole("button", { name: /Show all$/ })).toBeVisible();
  await expect(component.getByText("Simulation timeline", { exact: true })).toBeVisible();
  await expect(component.getByText("Technician status panel", { exact: true })).toBeVisible();

  const toolbarRowCenters = await component.evaluate((element) => [...element.shadowRoot
    .querySelectorAll(".map-replay-toolbar > div")]
    .map((node) => {
      const box = node.getBoundingClientRect();
      return box.top + (box.height / 2);
    }));
  expect(toolbarRowCenters).toHaveLength(2);
  expect(Math.abs(toolbarRowCenters[0] - toolbarRowCenters[1])).toBeLessThan(1);

  await page.selectOption("#engine-locale", "zh-CN");
  await page.selectOption("#engine-locale", "en-US");
  await expect(component.getByText("Simulation timeline", { exact: true })).toBeVisible();
  await expect(component.getByText("Technician status panel", { exact: true })).toBeVisible();

  const leaked = await component.evaluate((element) => {
    const root = element.shadowRoot;
    return [...root.querySelectorAll("[x-text]")]
      .map((node) => node.textContent.trim())
      .filter((value) => /[\u3400-\u9fff]/.test(value));
  });
  expect(leaked).toEqual([]);
});
