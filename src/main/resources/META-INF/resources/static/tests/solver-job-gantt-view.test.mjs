import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.resolve(testDirectory, "../assets/js/pages/solver-job-detail-page.js");

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

function ticket(id, arrival, departure, minStart = arrival, maxEnd = departure) {
  return {
    id,
    arrival_time: arrival,
    departure_time: departure,
    min_start_time: minStart,
    max_end_time: maxEnd,
    duration: "PT30M",
    loc: { address: `${id} 地址` }
  };
}

function ganttJob() {
  return {
    start_date_time: "2026-07-16T08:00:00Z",
    end_date_time: "2026-07-16T18:00:00Z",
    plan: {
      agents: [
        {
          id: "engineer-a",
          name: "工程师 A",
          shift_start_time: "2026-07-16T08:00:00Z",
          tickets_done_time: "2026-07-16T11:00:00Z",
          tickets: [
            ticket("ticket-a1", "2026-07-16T08:30:00Z", "2026-07-16T09:30:00Z", "2026-07-16T09:00:00Z"),
            ticket("ticket-a2", "2026-07-16T10:00:00Z", "2026-07-16T10:30:00Z", "2026-07-16T10:00:00Z", "2026-07-16T10:15:00Z")
          ]
        },
        {
          id: "engineer-b",
          name: "工程师 B",
          shift_start_time: "2026-07-16T09:00:00Z",
          tickets_done_time: "2026-07-16T12:00:00Z",
          tickets: [
            ticket("ticket-b1", "2026-07-16T09:45:00Z", "2026-07-16T10:15:00Z")
          ]
        },
        {
          id: "virtual-agent",
          virtual: true,
          shift_start_time: "2026-07-16T08:00:00Z",
          tickets: [ticket("ticket-virtual", "2026-07-16T09:00:00Z", "2026-07-16T09:30:00Z")]
        }
      ]
    }
  };
}

test("Gantt ViewModel 一次构建多工程师、多工单、返程和标签", async () => {
  const { buildSolverJobGanttView } = await loadPageModule();
  const view = buildSolverJobGanttView(ganttJob());

  assert.equal(view.rows.length, 2);
  assert.equal(view.ticks.length, 6);
  assert.equal(view.canToggleMode, true);
  assert.equal(view.rows[0].agent.id, "engineer-a");
  assert.deepEqual(view.rows[0].bars.map((bar) => bar.key), ["engineer-a-ticket-a1", "engineer-a-ticket-a2", "engineer-a-return"]);
  assert.equal(view.rows[0].bars.at(-1).type, "return");
  assert.equal(view.rows[0].bars.at(-1).segments[0].type, "return");
  assert.equal(view.rows[0].bars[1].isOutOfExpectedWindow, true);
  const ticketDetailRows = view.rows[0].bars[0].detailRows;
  const detailRowByLabel = new Map(ticketDetailRows.map((row) => [row.label, row]));
  assert.equal(detailRowByLabel.get("result.gantt.performService")?.dotStyle, "background:rgba(16, 185, 129, 0.26);");
  assert.equal(detailRowByLabel.get("result.gantt.expectedServiceWindow")?.dotStyle, "");
  assert.equal(detailRowByLabel.get("result.gantt.fulfillmentStatus")?.dotStyle, "");
  assert.deepEqual(
    view.rows[0].labels.map((label) => label.key),
    view.rows[0].bars.map((bar) => `${bar.key}-label`)
  );
  assert.match(view.rows[0].trackStyle, /^left:/);
});

test("Gantt ViewModel 根据视口模式和自定义视口重建", async () => {
  const { buildSolverJobGanttView } = await loadPageModule();
  const job = ganttJob();
  const taskView = buildSolverJobGanttView(job, { viewportMode: "tasks" });
  const fullDayView = buildSolverJobGanttView(job, { viewportMode: "full_day" });
  const customStart = Date.parse("2026-07-16T09:00:00Z");
  const customEnd = Date.parse("2026-07-16T10:00:00Z");
  const customView = buildSolverJobGanttView(job, {
    viewportMode: "full_day",
    viewStartTime: customStart,
    viewEndTime: customEnd
  });

  assert.equal(taskView.viewport.start.getTime(), taskView.taskRange.start.getTime());
  assert.equal(fullDayView.viewport.start.getTime(), fullDayView.range.start.getTime());
  assert.equal(fullDayView.viewport.end.getTime(), fullDayView.range.end.getTime());
  assert.equal(customView.viewport.start.getTime(), customStart);
  assert.equal(customView.viewport.end.getTime(), customEnd);
  assert.equal(fullDayView.modeHint, "result.gantt.switchToTasks");
  assert.match(taskView.compactLabel, /^\d{2}\/\d{2} \d{2}:\d{2}–\d{2}:\d{2}$/);
  assert.doesNotMatch(taskView.compactLabel, /result\.gantt\.tasks|\s-\s/);
  assert.match(taskView.fullLabel, /^result\.gantt\.tasks · /);
});

test("Gantt ViewModel 对空数据保持空态", async () => {
  const { buildSolverJobGanttView } = await loadPageModule();
  const view = buildSolverJobGanttView({ plan: { agents: [] } });

  assert.equal(view.range, null);
  assert.equal(view.viewport, null);
  assert.deepEqual(view.ticks, []);
  assert.deepEqual(view.rows, []);
  assert.equal(view.canToggleMode, false);
});

test("Gantt 浮框会监听组件 Shadow DOM 的滚动，并逐帧跟随排程块", async () => {
  const previousWindow = globalThis.window;
  const frameCallbacks = [];
  const scrollListeners = [];
  const removedScrollListeners = [];
  globalThis.window = {
    requestAnimationFrame(callback) {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    },
    cancelAnimationFrame() {}
  };

  try {
    const { solverJobDetailPage } = await loadPageModule();
    const page = solverJobDetailPage();
    const shadowRoot = {
      addEventListener(type, listener, capture) {
        scrollListeners.push({ type, listener, capture });
      },
      removeEventListener(type, listener, capture) {
        removedScrollListeners.push({ type, listener, capture });
      }
    };
    page.$root = { getRootNode: () => shadowRoot };
    page.boundGanttPopoverReposition = page.scheduleGanttPopoverReposition.bind(page);
    page.bindGanttPopoverScrollRoot();

    assert.deepEqual(scrollListeners, [{ type: "scroll", listener: page.boundGanttPopoverReposition, capture: true }]);

    page.activeGanttPopover = { key: "ticket-a1" };
    let positionCalls = 0;
    page.positionGanttPopover = () => { positionCalls += 1; };
    page.scheduleGanttPopoverReposition();
    page.scheduleGanttPopoverReposition();
    assert.equal(frameCallbacks.length, 1, "连续滚动事件应合并为同一帧重定位");

    frameCallbacks.shift()();
    assert.equal(positionCalls, 1);

    page.unbindGanttPopoverScrollRoot();
    assert.deepEqual(removedScrollListeners, [{ type: "scroll", listener: page.boundGanttPopoverReposition, capture: true }]);
  } finally {
    globalThis.window = previousWindow;
  }
});
