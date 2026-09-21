import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  analyze, buildGanttViewModel, buildReplay, buildViewModel, formatPlanTime,
  isPlanDuration, parsePlanTime, poiPosition, routePosition, validateGanttSemantics, validateViewSemantics,
} from "../../main/mcp-ui/model.mjs";
import { contractCases, largeView } from "./model-fixtures.mjs";

const cases = contractCases();
const fixture = (name = "ready-amap-single") => structuredClone(cases.find((item) => item.name === name).view);
const time = (clock) => parsePlanTime(`2026-09-17 ${clock}`);
const clone = (value) => structuredClone(value);

test("Gantt model accepts only the geometry-free profile and does not create replay analysis", () => {
  const payloads=JSON.parse(readFileSync(new URL("../../../docs/integrations/gateway/fixtures/mcp-result-view/payloads.json",import.meta.url),"utf8"));
  const gantt=clone(payloads.find(item=>item.name==="gantt-ready").message._meta.gateway_ui.engine_view);
  assert.equal(validateGanttSemantics(gantt),true);
  const model=buildGanttViewModel(gantt);
  assert.equal(Object.hasOwn(model,"analysis"),false);
  assert.ok(model.pois.every(poi=>poi.location===null));
  assert.ok(model.agents[0].routes.every(route=>route===null||[route.origin,route.destination,route.polyline,route.transit].every(value=>value===null)));
  gantt.solver_job.plan.pois[0].location="120,30";
  assert.equal(validateGanttSemantics(gantt),false);
});

function freeze(value) {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function assertSubset(actual, expected, path = "") {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), path);
    assert.equal(actual.length, expected.length, path);
    expected.forEach((value, index) => assertSubset(actual[index], value, `${path}/${index}`));
  } else if (expected !== null && typeof expected === "object") {
    for (const [key, value] of Object.entries(expected)) {
      assert.ok(Object.hasOwn(actual, key), `${path}/${key}`);
      assertSubset(actual[key], value, `${path}/${key}`);
    }
  } else assert.deepEqual(actual, expected, path);
}

function near(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

test("all 59 canonical golden vectors match Python analysis exactly, without mutation", async (t) => {
  assert.equal(cases.length, 59);
  for (const item of cases) await t.test(item.name, () => {
    const original = clone(item.view);
    freeze(item.view);
    const actual = analyze(item.view);
    if (item.view !== null) assert.equal(validateViewSemantics(item.view), true);
    assert.deepEqual(actual, item.reference);
    assertSubset(actual, item.golden);
    for (const [id, reasons] of Object.entries(item.requiredReasons)) {
      const engineer = actual.engineers.find((entry) => entry.id === id);
      for (const reason of reasons) assert.ok(engineer.reasons.includes(reason));
    }
    const model = buildViewModel(item.view);
    assert.deepEqual(model.analysis, actual);
    const replay = buildReplay(model);
    assert.equal(replay.start, parsePlanTime(actual.replay.start));
    assert.equal(replay.end, parsePlanTime(actual.replay.end));
    if (replay.start !== null) {
      for (const when of [replay.start - 1, replay.start, replay.end, replay.end + 1]) {
        const positions = replay.at(when);
        assert.equal(positions.length, actual.engineers.filter((entry) => entry.replay_eligible).length);
        for (const position of positions) {
          assert.equal(position.position.length, 2);
          assert.ok(position.position.every(Number.isFinite));
          assert.ok(Math.abs(position.position[0]) <= 180);
          assert.ok(Math.abs(position.position[1]) <= 90);
        }
      }
    } else assert.deepEqual(replay.at(0), []);
    assert.deepEqual(item.view, original);
  });
});

test("Java Duration scalar validation uses exact long seconds, not JS numeric precision", () => {
  for (const value of ["PT0S", "PT30M", "P1D", "P1DT1H2M3.123456789S", "PT0.000000001S",
    "PT9223372036854775807S", "PT9223372036854775807.999999999S", "PT00000000000000000000001S",
    "PT9007199254740992S", "PT9223372036854775806.999999999S"]) {
    assert.equal(isPlanDuration(value), true, value);
  }
  for (const value of [null, undefined, 0, false, "", "P", "PT", "P1DT", "P1Y", "P1M", "-PT1S", "PT-1S",
    "PT1.0000000000S", "PT.1S", "PT1.S", "P1.1D", "PT1e2S", "PT١S", "P１D", "PT1S\n",
    "PT9223372036854775808S", "PT1M9223372036854775800S", "P9223372036854775807D",
    "PT99999999999999999999999999999999999999999S"]) assert.equal(isPlanDuration(value), false, String(value));
});

test("scalar semantics reject invalid facts, not missing references or unplayable schedules", () => {
  const mutations = [
    (view) => { view.solver_job.start_date_time = "2026-02-30 00:00:00"; },
    (view) => { view.solver_job.end_date_time = "2026-09-17 10:00:00Z"; },
    (view) => { view.solver_job.id = " "; },
    (view) => { view.solver_job.plan.agents[0].date = "2026-02-29"; },
    (view) => { view.solver_job.plan.agents[0].shift_off_time = "not-a-time"; },
    (view) => { view.solver_job.plan.agents[0].tickets_done_time = "2026-01-01 25:00:00"; },
    (view) => { view.solver_job.plan.agents[0].start_loc = "\u0085"; },
    (view) => { view.solver_job.plan.agents[0].tickets[0] = " "; },
    (view) => { view.solver_job.plan.tickets[0].agent = " "; },
    (view) => { view.solver_job.plan.tickets[0].loc = " "; },
    (view) => { view.solver_job.plan.tickets[0].min_start_time = "2026-09-00 00:00:00"; },
    (view) => { view.solver_job.plan.tickets[0].max_end_time = "2026-00-01 00:00:00"; },
    (view) => { view.solver_job.plan.tickets[0].duration = "PT9223372036854775808S"; },
    (view) => { view.solver_job.plan.pois[0].location = "120,91"; },
    (view) => { view.solver_job.plan.pois[0].id = " "; },
    (view) => { view.solver_job.plan.agents[0].routes[0].origin = { lat: "120", lon: 30 }; },
    (view) => { view.solver_job.plan.agents[0].routes[0].polyline[1] = null; },
  ];
  for (const mutate of mutations) {
    const view = fixture();
    mutate(view);
    assert.equal(validateViewSemantics(view), false, String(mutate));
  }
  const duplicate = fixture();
  duplicate.solver_job.plan.pois.push(clone(duplicate.solver_job.plan.pois[0]));
  assert.equal(validateViewSemantics(duplicate), true, "Duplicate handling belongs to model.invalidIdentity");
  assert.equal(buildViewModel(duplicate).invalidIdentity, true);
  for (const name of ["missing-ticket-reference-keeps-sequence", "missing-poi-reference-keeps-id",
    "unknown-owner-is-not-unassigned", "non-monotonic-travel-time", "missing-times-no-made-up-duration",
    "routes-not-provided", "invalid-polyline-never-bridges-gap", "estimated-no-road",
    "missing-collections-are-not-empty", "ready-empty-is-real-zero"]) {
    assert.equal(validateViewSemantics(fixture(name)), true, name);
  }
});

test("business-clock parsing is strict, calendar-aware and round-trips four-digit years", () => {
  for (const value of [
    "0001-01-01 00:00:00", "0099-12-31 23:59:59", "0100-03-01 00:00:00",
    "1900-02-28 23:59:59", "2000-02-29 12:34:56", "2024-02-29 00:00:00",
    "2026-03-08 02:30:00", "2026-11-01 01:30:00", "9999-12-31 23:59:59",
  ]) assert.equal(formatPlanTime(parsePlanTime(value)), value);
  for (const value of [
    null, undefined, false, 0, {}, [], "", "2026-09-17T08:00:00", "2026-09-17 08:00:00Z",
    "2026-09-17 08:00:00+08:00", "2026-09-17 08:00:00.000", "2026-09-17 08:00:00\n",
    " 2026-09-17 08:00:00", "٢٠٢٦-09-17 08:00:00", "２０２６-09-17 08:00:00",
    "0000-01-01 00:00:00", "10000-01-01 00:00:00", "1900-02-29 00:00:00",
    "2100-02-29 00:00:00", "2026-02-30 00:00:00", "2026-09-31 00:00:00",
    "2026-00-10 00:00:00", "2026-13-10 00:00:00", "2026-01-00 00:00:00",
    "2026-01-10 24:00:00", "2026-01-10 01:60:00", "2026-01-10 01:01:60",
  ]) assert.equal(parsePlanTime(value), null, String(value));
  for (const value of [null, undefined, "0", NaN, Infinity, -Infinity, 1e100,
    parsePlanTime("0001-01-01 00:00:00") - 1000, parsePlanTime("9999-12-31 23:59:59") + 1000]) {
    assert.equal(formatPlanTime(value), "");
  }
  assert.equal(parsePlanTime("1970-01-01 00:00:00"), 0);
});

test("business clock, analysis and replay do not depend on browser/system timezone or DST", () => {
  const moduleURL = new URL("../../main/mcp-ui/model.mjs", import.meta.url).href;
  const script = `
    import {parsePlanTime, formatPlanTime, analyze, buildReplay, buildViewModel} from ${JSON.stringify(moduleURL)};
    const input = JSON.parse(process.argv[1]);
    const replay = buildReplay(buildViewModel(input));
    console.log(JSON.stringify({
      time: parsePlanTime('2026-03-08 02:30:00'),
      formatted: formatPlanTime(parsePlanTime('0001-01-01 00:00:00')),
      analysis: analyze(input), positions: replay.at(replay.start + 600000)
    }));
  `;
  const outputs = ["UTC", "Asia/Shanghai", "America/New_York", "Pacific/Auckland"].map((TZ) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script,
      JSON.stringify(fixture("business-clock-dst-gap-is-not-browser-time"))], {
      encoding: "utf8", env: { ...process.env, TZ },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  });
  assert.ok(outputs.every((output) => output === outputs[0]));
});

test("coordinate decoding does not coerce, swap by range, or infer POI fields", () => {
  assert.deepEqual(poiPosition({ location: " +1.2e2 , 3.0E1 " }), [120, 30]);
  assert.deepEqual(poiPosition({ location: "0,0" }), [0, 0]);
  assert.deepEqual(poiPosition({ location: ".5,-.5" }), [0.5, -0.5]);
  assert.deepEqual(poiPosition({ location: "\u0085120\u001c,30\u3000" }), [120, 30]);
  assert.deepEqual(routePosition({ lat: 120, lon: 30 }), [120, 30]);
  for (const value of [null, "120,30", {}, { loc: { lat: 120, lon: 30 } },
    { location: "181,30" }, { location: "120,91" }, { location: "120,30,0" },
    { location: "120," }, { location: "0x78,30" }, { location: "١٢٠,30" },
    { location: "１２０,30" }, { location: "1_20,30" }, { location: "Infinity,30" },
    { location: "1e1000,30" }, { location: "\ufeff120,30" }, { location: [120, 30] },
    { location: null, entr_location: "120,30" }]) assert.equal(poiPosition(value), null);
  for (const value of [null, [120, 30], { lng: 120, lat: 30 }, { lat: 30, lon: 120 },
    { lat: "120", lon: 30 }, { lat: true, lon: 30 }, { lat: 120, lon: null },
    { lat: Infinity, lon: 30 }, { lat: 10 ** 1000, lon: 30 }]) assert.equal(routePosition(value), null);
});

test("model preserves null versus empty and references/order instead of hydrating or sorting", () => {
  const model = buildViewModel(fixture("missing-collections-are-not-empty"));
  assert.equal(model.agents, null);
  assert.equal(model.tickets, null);
  assert.equal(model.pois, null);
  assert.equal(model.indexes.agents.size, 0);
  assert.equal(model.invalidIdentity, false);
  const empty = buildViewModel(fixture("ready-empty-is-real-zero"));
  assert.deepEqual(empty.agents, []);
  assert.deepEqual(empty.tickets, []);
  assert.deepEqual(empty.pois, []);
  const baseline = fixture();
  const ready = buildViewModel(baseline);
  assert.deepEqual(ready.agents[0].tickets, ["ticket-b", "ticket-a"]);
  assert.equal(ready.indexes.agents.get(ready.agents[0].id), ready.agents[0]);
  assert.equal(typeof ready.tickets[0].agent, "string");
  assert.equal(ready.agents, baseline.solver_job.plan.agents);
  assert.equal(ready.tickets, baseline.solver_job.plan.tickets);
  const missing = buildViewModel(fixture("missing-ticket-reference-keeps-sequence"));
  assert.equal(missing.agents[0].tickets.length, 2);
  assert.equal(missing.analysis.engineers[0].replay_eligible, false);
  assert.equal(missing.invalidIdentity, false);
});

test("invalid identities invalidate indexes/counts and opaque prototype-like IDs remain safe", () => {
  for (const name of ["agents", "tickets", "pois"]) {
    const view = fixture();
    const values = view.solver_job.plan[name];
    values.push(clone(values[0]));
    const model = buildViewModel(view);
    assert.equal(model.indexes[name].size, 0);
    assert.equal(model.invalidIdentity, true);
    assert.deepEqual(buildReplay(model).at(0), []);
    if (name !== "pois") assert.equal(model.analysis.counts.assigned_ticket_count, null);
    if (name === "agents") assert.deepEqual(model.analysis.engineers, []);
    else assert.equal(model.analysis.engineers[0].replay_eligible, false);
  }
  for (const id of [null, undefined, true, 1, {}, "", "  ", "\u0085", "\u001c"]) {
    const view = fixture();
    view.solver_job.plan.agents[0].id = id;
    assert.equal(buildViewModel(view).invalidIdentity, true);
  }
  const view = fixture();
  const plan = view.solver_job.plan;
  plan.agents[0].id = "__proto__";
  plan.tickets.forEach((ticket) => { ticket.agent = "__proto__"; });
  plan.tickets[0].id = "constructor";
  plan.agents[0].tickets[0] = "constructor";
  const model = buildViewModel(freeze(view));
  assert.equal(model.invalidIdentity, false);
  assert.equal(model.analysis.counts.assigned_ticket_count, 2);
  assert.equal(model.analysis.engineers[0].replay_eligible, true);
  assert.equal(buildReplay(model).at(time("08:10:00"))[0].ticketId, "constructor");
});

test("replay uses half-open phases, exact solver times and no return/fallback duration", () => {
  const replay = buildReplay(buildViewModel(freeze(fixture())));
  assert.equal(replay.start, time("08:00:00"));
  assert.equal(replay.end, time("09:25:00"));
  const at = (clock) => replay.at(time(clock))[0];
  assert.deepEqual(at("07:59:59"), { id: "engineer-a-260917", position: [120, 30], phase: "not_started", ticketId: null });
  assert.equal(at("08:00:00").phase, "travel");
  assert.equal(at("08:00:00").ticketId, "ticket-b");
  near(at("08:10:00").position[0], 120.005, 0.000001);
  assert.deepEqual(at("08:20:00").position, [120.01, 30.01]);
  assert.equal(at("08:20:00").phase, "waiting");
  assert.equal(at("08:29:59").phase, "waiting");
  assert.equal(at("08:30:00").phase, "service");
  assert.equal(at("08:59:59").phase, "service");
  assert.equal(at("09:00:00").phase, "travel");
  assert.equal(at("09:00:00").ticketId, "ticket-a");
  assert.equal(at("09:10:00").phase, "service");
  assert.deepEqual(at("09:25:00"), { id: "engineer-a-260917", position: [120.02, 30.02], phase: "complete", ticketId: null });
  assert.deepEqual(at("17:00:00"), at("09:25:00"));
  assert.deepEqual(replay.at(NaN), []);
  assert.deepEqual(replay.at(Infinity), []);
  assert.deepEqual(replay.at(null), []);
  assert.deepEqual(replay.at("0"), []);
});

test("selected engineers, partial eligibility and independent daily identity", () => {
  const model = buildViewModel(fixture("multi-day-same-name-shared-pois"));
  const replay = buildReplay(model);
  assert.equal(model.analysis.counts.engineer_schedule_count, 2);
  assert.equal(replay.at(replay.start).length, 2);
  assert.deepEqual(replay.at(replay.start).map((item) => item.phase), ["travel", "not_started"]);
  assert.deepEqual(replay.at(replay.start, []), []);
  assert.deepEqual(replay.at(replay.start, ["missing"]), []);
  assert.equal(replay.at(replay.start, [model.agents[1].id])[0].id, model.agents[1].id);
  assert.equal(replay.at(replay.start, new Set([model.agents[0].id])).length, 1);
  assert.equal(replay.at(replay.end, [model.agents[0].id, model.agents[0].id]).length, 1);
  const partial = buildReplay(buildViewModel(fixture("partly-playable-engineers")));
  assert.equal(partial.at(partial.start).length, 1);
  assert.equal(partial.end, time("09:25:00"));
});

test("snap offsets never acquire invented POI connectors", () => {
  const view = fixture("snapped-road-geometry-is-not-extended");
  const before = clone(view);
  const replay = buildReplay(buildViewModel(freeze(view)));
  assert.deepEqual(replay.at(replay.start)[0].position, [120.0001, 30.0001]);
  const arriving = replay.at(time("08:20:00") - 1)[0].position;
  near(arriving[0], 120.0099, 0.000001);
  near(arriving[1], 30.0099, 0.000001);
  assert.deepEqual(replay.at(time("08:20:00"))[0].position, [120.01, 30.01]);
  assert.deepEqual(view, before);
});

test("ZERO_DISTANCE remains stationary and zero-time legs/services skip without division by zero", () => {
  const zero = buildReplay(buildViewModel(fixture("zero-distance-stationary-leg")));
  for (const clock of ["08:00:00", "08:10:00", "08:20:00", "08:30:00"]) {
    assert.deepEqual(zero.at(time(clock))[0].position, [120, 30]);
  }
  const view = fixture();
  const plan = view.solver_job.plan;
  for (const ticket of plan.tickets) {
    ticket.arrival_time = ticket.start_service_time = ticket.departure_time = "2026-09-17 08:00:00";
  }
  const replay = buildReplay(buildViewModel(view));
  assert.equal(replay.start, replay.end);
  assert.equal(replay.at(replay.start - 1)[0].phase, "not_started");
  assert.equal(replay.at(replay.start)[0].phase, "complete");
  assert.deepEqual(replay.at(replay.start)[0].position, [120.02, 30.02]);
  plan.tickets[1].arrival_time = "2026-09-17 08:10:00";
  plan.tickets[1].start_service_time = "2026-09-17 08:10:00";
  plan.tickets[1].departure_time = "2026-09-17 08:20:00";
  const next = buildReplay(buildViewModel(view));
  assert.equal(next.at(next.start)[0].ticketId, "ticket-a");
  assert.equal(next.at(next.start)[0].phase, "travel");
});

test("route interpolation is length-weighted, tolerates repeated points, and crosses the dateline locally", () => {
  const view = fixture();
  const route = view.solver_job.plan.agents[0].routes[0];
  route.polyline = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, { lat: 1, lon: 0 },
    { lat: 1, lon: 0 }, { lat: 4, lon: 0 }, { lat: 4, lon: 0 }];
  let replay = buildReplay(buildViewModel(view));
  near(replay.at(time("08:10:00"))[0].position[0], 2);
  near(replay.at(time("08:05:00"))[0].position[0], 1);
  route.polyline = [{ lat: 179, lon: 0 }, { lat: -179, lon: 0 }];
  replay = buildReplay(buildViewModel(view));
  near(Math.abs(replay.at(time("08:10:00"))[0].position[0]), 180);
  near(replay.at(time("08:05:00"))[0].position[0], 179.5);
  near(replay.at(time("08:15:00"))[0].position[0], -179.5);
  route.polyline.reverse();
  replay = buildReplay(buildViewModel(view));
  near(replay.at(time("08:05:00"))[0].position[0], -179.5);
  near(replay.at(time("08:15:00"))[0].position[0], 179.5);
});

test("replay snapshots geometry and returns fresh positions, without rescanning raw points per frame", () => {
  const view = fixture();
  const replay = buildReplay(buildViewModel(view));
  const expected = replay.at(time("08:10:00"));
  for (const agent of view.solver_job.plan.agents) {
    for (const route of agent.routes) Object.defineProperty(route, "polyline", {
      get() { throw new Error("Raw geometry accessed after prepare"); },
    });
  }
  const first = replay.at(time("08:10:00"));
  first[0].position[0] = 999;
  first[0].id = "mutated-result";
  assert.deepEqual(replay.at(time("08:10:00")), expected);
});

test("synthetic 200-engineer/1000-ticket/4097-point fixture preserves all data and remains seekable", () => {
  const { view, recipe, reference } = largeView();
  const before = clone(view);
  const model = buildViewModel(freeze(view));
  assert.deepEqual(model.analysis, reference);
  assert.equal(model.agents.length, recipe.engineer_count);
  assert.equal(model.tickets.length, recipe.expected.assigned_ticket_count);
  assert.equal(model.pois.length, recipe.expected.poi_count);
  assert.equal(model.agents[0].routes[0].polyline.length, recipe.dense_polyline_points);
  assert.deepEqual(model.agents[0].tickets, ["synthetic-ticket-000-5", "synthetic-ticket-000-4",
    "synthetic-ticket-000-3", "synthetic-ticket-000-2", "synthetic-ticket-000-1"]);
  const replay = buildReplay(model);
  assert.equal(formatPlanTime(replay.start), recipe.expected.replay_start);
  assert.equal(formatPlanTime(replay.end), recipe.expected.replay_end);
  for (let frame = 0; frame <= 120; frame += 1) {
    const positions = replay.at(replay.start + (replay.end - replay.start) * frame / 120);
    assert.equal(positions.length, recipe.engineer_count);
    assert.ok(positions.every((entry) => entry.position.every(Number.isFinite)));
  }
  assert.deepEqual(view, before);
});
