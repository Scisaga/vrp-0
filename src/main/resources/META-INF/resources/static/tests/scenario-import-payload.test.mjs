import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const staticRoot = path.resolve(testDirectory, "..");
const modelPath = path.join(staticRoot, "assets/js/utils/vrp-model.js");
const demoPath = path.resolve(staticRoot, "../../../../../../scenarios/public-demo/beijing-score-progress.json");

async function loadVrpModel() {
  const result = await build({
    entryPoints: [modelPath],
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

test("page import envelope keeps demo SKU items and resets ticket status when replacing the local scenario", async () => {
  const request = JSON.parse(await readFile(demoPath, "utf8"));
  const { normalizeScenarioForView, buildScenarioPayload } = await loadVrpModel();

  assert.equal(request.scenario_name, request.scenario.name);
  assert.deepEqual(request.solve_options, {
    solve_time: "PT30S",
    matrix_mode: "MANHATTAN",
    build_transit_matrix: true,
    draw_route: true
  });

  const importedScenario = structuredClone(request.scenario);
  importedScenario.plan.tickets[0].status = "Done";
  const payload = buildScenarioPayload(normalizeScenarioForView(importedScenario));
  assert.equal(payload.plan.agents.length, 15);
  assert.equal(payload.plan.tickets.length, 60);
  assert.equal(payload.plan.skus.length, 10);
  assert.ok(
    Object.keys(payload.plan).indexOf("skus") < Object.keys(payload.plan).indexOf("tickets"),
    "payload must serialize skus before tickets for engine compatibility"
  );

  const sourceTickets = new Map(importedScenario.plan.tickets.map((ticket) => [ticket.id, ticket]));
  payload.plan.tickets.forEach((ticket) => {
    const source = sourceTickets.get(ticket.id);
    assert.ok(source, `missing source ticket: ${ticket.id}`);
    assert.equal(ticket.status, "New", `ticket status was not reset: ${ticket.id}`);
    assert.deepEqual(ticket.items, source.items, `SKU items changed for ${ticket.id}`);
  });
});

test("normalization generates missing business ids and does not invent optional vehicle costs", async () => {
  const { normalizeScenarioForView, buildScenarioPayload } = await loadVrpModel();
  const scenarioPage = await readFile(path.join(staticRoot, "pages/scenario-detail.html"), "utf8");
  const raw = {
    name: "assistant draft",
    planning_date: "2026-08-18",
    start_time: "2026-08-18 08:00:00",
    end_time: "2026-08-18 20:00:00",
    plan: {
      pois: [],
      depos: [{ id: "", name: "仓库", loc: { address: "北京市海淀区", location: "116.3,39.9" } }],
      agents: [{ id: "", name: "小王", start_loc: { address: "北京市东城区", location: "116.4,39.9" } }],
      tickets: [{ id: "", type: "Delv", loc: { address: "北京市朝阳区", location: "116.5,39.9" } }],
      skus: [{ id: "", name: "配件" }]
    }
  };

  const view = normalizeScenarioForView(raw);
  const ids = [view.plan.depos[0].id, view.plan.agents[0].id, view.plan.tickets[0].id, view.plan.skus[0].id];
  assert.equal(new Set(ids).size, 4);
  ids.forEach((id) => assert.match(id, /^(DEPO|AGENT|TICKET|SKU)-[A-Z0-9]{12}$/));
  assert.equal(view.plan.agents[0].fuel_type, "");
  assert.equal(view.plan.agents[0].fuel_consumption, "");
  assert.equal(view.plan.agents[0].fix_cost_daily, "");
  assert.doesNotMatch(scenarioPage, /未填写/);
  assert.match(scenarioPage, /x-text="row\.fuel_type \?\? ''"/);
  assert.match(scenarioPage, /x-text="row\.fuel_consumption \?\? ''"/);
  assert.match(scenarioPage, /x-text="row\.fix_cost_daily \?\? ''"/);

  const payload = buildScenarioPayload(view);
  assert.equal("fuel_type" in payload.plan.agents[0], false);
  assert.equal("fuel_consumption" in payload.plan.agents[0], false);
  assert.equal("fix_cost_daily" in payload.plan.agents[0], false);
});

test("normalization preserves supplied business ids and explicit zero vehicle costs", async () => {
  const { normalizeScenarioForView, buildScenarioPayload } = await loadVrpModel();
  const view = normalizeScenarioForView({
    name: "explicit values",
    plan: {
      agents: [{
        id: "agent-user-1",
        fuel_type: "ELEC",
        fuel_consumption: 0,
        fix_cost_daily: 0
      }]
    }
  });
  const payload = buildScenarioPayload(view);
  assert.equal(view.plan.agents[0].id, "agent-user-1");
  assert.equal(payload.plan.agents[0].fuel_type, "ELEC");
  assert.equal(payload.plan.agents[0].fuel_consumption, 0);
  assert.equal(payload.plan.agents[0].fix_cost_daily, 0);
});

test("gateway location validation requires both address and resolved coordinates", async () => {
  const { gatewayLocationErrors } = await loadVrpModel();
  const errors = gatewayLocationErrors({
    depos: [{ id: "DEPO-1", address: "", loc: { location: "116.3,39.9" } }],
    agents: [{ id: "AGENT-1", start_address: "北京市东城区", start_loc: null }],
    tickets: [{ id: "TICKET-1", address: "北京市朝阳区", loc: { loc: { lon: 116.5, lat: 39.9 } } }]
  });
  assert.deepEqual(errors.map((error) => error.path), [
    "request_payload.plan.depos[0].address",
    "request_payload.plan.agents[0].start_loc"
  ]);
});

test("time-only values are combined with their business date before engine submission", async () => {
  const { normalizeScenarioForView, buildScenarioPayload } = await loadVrpModel();
  const view = normalizeScenarioForView({
    name: "维修调度",
    planning_date: "2026-08-06",
    start_time: "08:00",
    end_time: "20:00:00",
    plan: {
      agents: [{
        id: "agent-1",
        date: "2026-08-07",
        name: "小王",
        start_loc: { address: "北京大学", location: "116.3109,39.9928" },
        shift_start_time: "09:00",
        shift_off_time: "16:00"
      }],
      tickets: [{
        id: "ticket-1",
        loc: { address: "望京南地铁站", location: "116.4819,39.9865" },
        create_time: "07:30",
        min_start_time: "09:00",
        max_end_time: "18:00"
      }]
    }
  });

  assert.equal(view.start_time_input, "2026-08-06T08:00");
  assert.equal(view.end_time_input, "2026-08-06T20:00");
  assert.equal(view.plan.agents[0].shift_start_time_input, "2026-08-07T09:00");
  const payload = buildScenarioPayload(view);
  assert.equal(payload.start_time, "2026-08-06 08:00:00");
  assert.equal(payload.end_time, "2026-08-06 20:00:00");
  assert.equal(payload.plan.agents[0].shift_start_time, "2026-08-07 09:00:00");
  assert.equal(payload.plan.agents[0].shift_off_time, "2026-08-07 16:00:00");
  assert.equal(payload.plan.tickets[0].create_time, "2026-08-06 07:30:00");
  assert.equal(payload.plan.tickets[0].min_start_time, "2026-08-06 09:00:00");
  assert.equal(payload.plan.tickets[0].max_end_time, "2026-08-06 18:00:00");
});
