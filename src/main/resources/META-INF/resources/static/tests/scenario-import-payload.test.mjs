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

test("normalization does not invent optional vehicle costs", async () => {
  const { normalizeScenarioForView, buildScenarioPayload } = await loadVrpModel();
  const scenarioPage = await readFile(path.join(staticRoot, "pages/scenario-detail.html"), "utf8");
  const raw = {
    name: "assistant draft",
    planning_date: "2026-08-18",
    start_time: "2026-08-18 08:00:00",
    end_time: "2026-08-18 20:00:00",
    plan: {
      pois: [],
      agents: [{ id: "agent-cost-empty", name: "小王", start_loc: { address: "北京市东城区", location: "116.4,39.9" } }]
    }
  };

  const view = normalizeScenarioForView(raw);
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

test("normalization preserves explicit zero vehicle costs", async () => {
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
  assert.equal(payload.plan.agents[0].fuel_type, "ELEC");
  assert.equal(payload.plan.agents[0].fuel_consumption, 0);
  assert.equal(payload.plan.agents[0].fix_cost_daily, 0);
});
