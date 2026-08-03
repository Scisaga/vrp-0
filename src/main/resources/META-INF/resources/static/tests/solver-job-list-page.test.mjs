import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.resolve(testDirectory, "../assets/js/pages/solver-job-list-page.js");
const templatePath = path.resolve(testDirectory, "../pages/solver-job-list.html");
const stylePath = path.resolve(testDirectory, "../assets/css/style.css");

async function loadPageModule() {
  const result = await build({
    entryPoints: [pagePath],
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

test("task list date-time filters use the browser-independent 24-hour control", () => {
  const template = readFileSync(templatePath, "utf8");
  const dateTimeInputs = template.match(/<vrp-date-time-24\b[^>]*>/g) || [];
  assert.equal(dateTimeInputs.length, 2);
  dateTimeInputs.forEach((input) => assert.match(input, /\bseconds\b/));
  assert.doesNotMatch(template, /type="datetime-local"/);
});

test("task list keeps only a right-aligned query action and exposes result columns", () => {
  const template = readFileSync(templatePath, "utf8");
  const style = readFileSync(stylePath, "utf8");

  assert.doesNotMatch(template, /x-text="t\('common\.reset'\)"/);
  assert.doesNotMatch(template, /t\('jobs\.refresh'\)/);
  assert.match(template, /<form class="job-list-filter-form"/);
  assert.equal((template.match(/<label class="job-list-filter-field/g) || []).length, 6);
  assert.match(template, /<div class="job-list-filter-actions">/);
  assert.match(style, /\.job-list-filter-form\s*\{[\s\S]*?column-gap: 1\.25rem;[\s\S]*?row-gap: 0\.625rem;/);
  assert.match(style, /\.job-list-filter-field\s*\{[\s\S]*?column-gap: 0\.46875rem;/);
  assert.match(style, /\.job-list-filter-field > \.field-label\s*\{\s*@apply shrink-0 whitespace-nowrap text-\[16\.25px\];/);
  assert.match(style, /\.job-list-filter-field-date > \.datetime24-input\s*\{\s*@apply min-w-0 flex-1 min-\[800px\]:flex-none;/);
  assert.match(style, /\.job-list-filter-actions\s*\{\s*@apply ml-auto flex shrink-0 items-center justify-end;/);
  assert.match(template, /min-w-\[79\.6875rem\]/);
  assert.equal((template.match(/solver-job-list-grid/g) || []).length, 2);
  assert.match(style, /\.solver-job-list-grid\s*\{[\s\S]*?minmax\(10rem, 0\.85fr\)[\s\S]*?minmax\(15rem, 1\.5fr\)[\s\S]*?minmax\(10rem, 0\.9fr\)/);
  assert.match(template, /jobs\.column\.score/);
  assert.match(template, /jobs\.column\.solveFinishedAt/);
  assert.doesNotMatch(template, /jobs\.column\.updatedAt/);
  assert.doesNotMatch(template, /:title="t\('jobs\.column\./, "完整可见的任务列表表头不应重复显示原生 tooltip");
  assert.match(template, /scoreSegments\(job\.score\)/);
  assert.match(template, /displaySolveFinishTime\(job\)/);
  assert.match(template, /x-text="job\.name \|\| '--'"/);
  assert.doesNotMatch(template, /x-text="job\.id"/);
  assert.doesNotMatch(template, /hoveredJobId|copyJobId|identifier-trigger|identifier-value/);
});

test("task list defaults to the latest seven-day local date-time range", async () => {
  const { createDefaultFilters } = await loadPageModule();
  assert.deepEqual(createDefaultFilters(new Date(2026, 7, 3, 19, 33, 30)), {
    status: "",
    createTimeFrom: "2026-07-27T19:33:30",
    createTimeTo: "2026-08-03T19:33:30",
    buildTransitMatrix: "",
    matrixMode: "",
    drawRoute: ""
  });
});

test("task list query only serializes selected server filters", async () => {
  const { buildSolverJobListUrl } = await loadPageModule();
  assert.equal(buildSolverJobListUrl(), "/solver_job/list");
  assert.equal(
    buildSolverJobListUrl({
      status: "SOLVING_ACTIVE",
      createTimeFrom: "2026-07-16T09:00:00",
      createTimeTo: "",
      buildTransitMatrix: "false",
      matrixMode: "MANHATTAN",
      drawRoute: "true"
    }),
    "/solver_job/list?status=SOLVING_ACTIVE&create_time_from=2026-07-16T09%3A00%3A00&build_transit_matrix=false&matrix_mode=MANHATTAN&draw_route=true"
  );
});

test("unknown solver status is preserved instead of being replaced with a guessed label", async () => {
  const { solverJobListPage } = await loadPageModule();
  const page = solverJobListPage();
  assert.equal(page.statusInfo("FUTURE_STATUS").text, "FUTURE_STATUS");
  assert.equal(page.displayScore("0hard/-2medium/-100soft"), "0hard/-2medium/-100soft");
  assert.equal(page.displayScore(null), "--");
  assert.deepEqual(page.scoreSegments("0hard/-2medium/-100soft"), [
    { key: "hard", text: "0hard", colorClass: "result-summary-score-hard", separator: false },
    { key: "medium", text: "-2medium", colorClass: "result-summary-score-medium", separator: true },
    { key: "soft", text: "-100soft", colorClass: "result-summary-score-soft", separator: true }
  ]);
  assert.deepEqual(page.scoreSegments("unknown"), []);
  assert.equal(page.displayDateTime("2026-07-29T12:34:56"), "2026-07-29 12:34:56");
  assert.equal(page.displayDateTime(null), "--");
  assert.equal(page.displaySolveFinishTime({ status: "SOLVING_FINISHED", update_time: "2026-07-29 12:34:56" }), "2026-07-29 12:34:56");
  assert.equal(page.displaySolveFinishTime({ status: "SOLVING_ACTIVE", update_time: "2026-07-29 12:34:56" }), "--");
});

test("task list searches filters, polls running tasks, and keeps detail/map routes", async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const previousCustomEvent = globalThis.CustomEvent;
  const requests = [];
  const timers = [];
  const clearedTimers = [];
  let responseJobs = [{ id: "running-job", status: "SOLVING_ACTIVE" }];

  globalThis.window = {
    location: { hash: "#/solver-jobs" },
    dispatchEvent() {},
    setInterval(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearInterval(timer) {
      clearedTimers.push(timer);
    }
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => responseJobs
    };
  };

  try {
    const { buildSolverJobListUrl, solverJobListPage } = await loadPageModule();
    const page = solverJobListPage();

    assert.equal("shortJobId" in page, false);
    assert.equal("resetFilters" in page, false);

    await page.init();
    assert.deepEqual(requests, [buildSolverJobListUrl(page.filters)]);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 5000);

    page.filters.status = "SOLVING_ACTIVE";
    page.filters.drawRoute = "true";
    await page.search();
    assert.equal(requests.at(-1), buildSolverJobListUrl(page.filters));

    responseJobs = [{ id: "finished-job", status: "SOLVING_FINISHED" }];
    await page.loadJobs({ silent: true });
    assert.deepEqual(clearedTimers, [timers[0]]);

    page.openDetail("detail-job");
    assert.equal(globalThis.window.location.hash, "#/solver-job?id=detail-job");
    page.openMap("map-job");
    assert.equal(globalThis.window.location.hash, "#/solver-map?id=map-job");
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
    globalThis.CustomEvent = previousCustomEvent;
  }
});
