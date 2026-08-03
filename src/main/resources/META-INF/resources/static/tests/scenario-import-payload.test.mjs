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
