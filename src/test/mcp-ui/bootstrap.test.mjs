import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createViewerBridge } from '../../main/mcp-ui/bridge.mjs';

const payloads = JSON.parse(await readFile(new URL('../../../docs/integrations/gateway/fixtures/mcp-result-view/payloads.json', import.meta.url), 'utf8'));
const fixture = (view = 'map') => structuredClone(payloads.find(({ name }) => name === (view === 'map' ? 'ready' : 'gantt-ready')).message);
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settled = () => new Promise(setImmediate);
const withoutMetadata = (result) => {
  const missing = structuredClone(result);
  delete missing._meta;
  return missing;
};

async function setup({ view = 'map', input, hostContext, capabilities = { serverTools: {} }, handshake } = {}) {
  const initial = fixture(view);
  const data = initial._meta.gateway_ui;
  const originalInput = input ?? { job_id: data.job_id };
  const results = [], errors = [], loading = [], inputs = [];
  let app;
  class TestApp {
    constructor() {
      app = this;
      this.calls = [];
      this.closed = 0;
      this.hostContext = hostContext ?? {
        toolInfo: { tool: { name: data.display_tool_name, inputSchema: { type: 'object' } } },
      };
    }
    removeRequestHandler() {}
    setRequestHandler() {}
    async request() { return { protocolVersion: '2026-01-26' }; }
    async connect() {
      await this.request({ method: 'ui/initialize' });
      if (handshake) await handshake.promise;
    }
    getHostContext() { return this.hostContext; }
    getHostCapabilities() { return capabilities; }
    callServerTool(params, options) {
      const request = deferred();
      this.calls.push({ params, options, ...request });
      return request.promise;
    }
    async close() { this.closed += 1; }
  }
  const bridge = createViewerBridge({
    onInput: (...args) => inputs.push(args),
    onResult: (...args) => results.push(args),
    onError: (error) => errors.push(error),
    onBootstrap: (active) => loading.push(active),
  }, { AppClass: TestApp, viewKind: view });
  const connecting = bridge.connect();
  if (!handshake) assert.equal(await connecting, true);
  return {
    bridge, app, connecting, initial, originalInput, results, errors, loading, inputs,
    input: (args = originalInput) => app.ontoolinput({ arguments: args }),
    result: (value = withoutMetadata(initial)) => app.ontoolresult(value),
  };
}

function changeJob(result, id) {
  const changed = structuredClone(result);
  changed.structuredContent.job_id = id;
  const data = changed._meta.gateway_ui;
  data.job_id = id;
  data.task.job_id = id;
  if (data.engine_view) data.engine_view.solver_job.id = id;
  return changed;
}

for (const view of ['map', 'gantt']) {
  test(`${view} complete initial metadata needs no bootstrap and closes that input's recovery`, async () => {
    const h = await setup({ view });
    try {
      h.input();
      h.result(h.initial);
      h.result();
      await settled();
      assert.equal(h.app.calls.length, 0);
      assert.equal(h.results[0][1].kind, 'notification');
      assert.deepEqual(h.results[0][0], h.initial);
    } finally { await h.bridge.destroy(); }
  });

  test(`${view} missing metadata makes one read of the exact host-bound tool and input`, async () => {
    const h = await setup({ view });
    try {
      h.input();
      h.result();
      await settled();
      assert.equal(h.app.calls.length, 1);
      assert.deepEqual(h.app.calls[0].params, {
        name: h.initial._meta.gateway_ui.display_tool_name, arguments: h.originalInput,
      });
      assert.equal(h.app.calls[0].options.timeout, 10000);
      assert.equal(h.app.calls[0].options.signal.aborted, false);
      assert.deepEqual(h.loading, [true]);
      assert.equal(h.results.length, 0, 'Do not render the incomplete notification before recovery');
      h.result();
      h.result();
      assert.equal(h.app.calls.length, 1, 'Repeated notifications must share the recovery');
      h.app.calls[0].resolve(h.initial);
      await settled();
      assert.deepEqual(h.loading, [true, false]);
      assert.equal(h.results.length, 1);
      assert.deepEqual(h.results[0][0], h.initial);
      assert.equal(h.results[0][1].kind, 'bootstrap');
      assert.equal(h.results[0][1].requestJobId, h.originalInput.job_id);
      h.result();
      await settled();
      assert.equal(h.app.calls.length, 1, 'A completed recovery is not repeated');
    } finally { await h.bridge.destroy(); }
  });
}

test('map bootstrap preserves the validated original engineer selection', async () => {
  const initial = fixture();
  const engineer = initial._meta.gateway_ui.engine_view.solver_job.plan.agents[0].id;
  initial._meta.gateway_ui.engineer_id = engineer;
  initial.structuredContent.engineer_id = engineer;
  const input = { job_id: initial.structuredContent.job_id, engineer_id: engineer };
  const h = await setup({ input });
  try {
    h.input();
    h.result(withoutMetadata(initial));
    await settled();
    assert.equal(h.app.calls.length, 1);
    assert.deepEqual(h.app.calls[0].params.arguments, input);
    h.app.calls[0].resolve(initial);
    await settled();
    assert.equal(h.results[0][1].kind, 'bootstrap');
  } finally { await h.bridge.destroy(); }
});

test('missing metadata received during the handshake waits for a successful connection', async () => {
  const handshake = deferred();
  const h = await setup({ handshake });
  try {
    h.input();
    h.result();
    await settled();
    assert.equal(h.app.calls.length, 0);
    handshake.resolve();
    assert.equal(await h.connecting, true);
    await settled();
    assert.equal(h.app.calls.length, 1);
    h.app.calls[0].resolve(h.initial);
    await settled();
    assert.equal(h.results[0][1].kind, 'bootstrap');
  } finally { handshake.resolve(); await h.bridge.destroy(); }
});

test('bootstrap needs the original validated input and never infers it from summary text', async () => {
  const h = await setup();
  try {
    h.result();
    await settled();
    assert.equal(h.app.calls.length, 0);
    h.input({ job_id: h.originalInput.job_id, unexpected: 'not accepted' });
    h.result();
    await settled();
    assert.equal(h.app.calls.length, 0);
  } finally { await h.bridge.destroy(); }
});

test('bootstrap requires serverTools capability and an exact trusted view/version tool name', async () => {
  const data = fixture()._meta.gateway_ui;
  const cases = [
    { capabilities: {} },
    { capabilities: { serverTools: undefined } },
    { hostContext: {} },
    ...[
      'gateway.solver_jobs.create', `gw_gantt_${data.image_version_id}`,
      `gw_map_${data.image_version_id.slice(1)}`, `gw_map_${data.image_version_id}a`,
      `planly_mcp__${data.display_tool_name}`,
    ].map((name) => ({ hostContext: { toolInfo: { tool: { name } } } })),
  ];
  for (const options of cases) {
    const h = await setup(options);
    try {
      h.input(); h.result();
      await settled();
      assert.equal(h.app.calls.length, 0, JSON.stringify(options));
      assert.deepEqual(h.loading, []);
    } finally { await h.bridge.destroy(); }
  }
});

test('business failures and existing invalid metadata never start or enable a later bootstrap', async () => {
  const initial = fixture();
  const cases = [
    { isError: true, structuredContent: { code: 'FORBIDDEN' } },
    { isError: true, structuredContent: initial.structuredContent },
    { ...withoutMetadata(initial), _meta: { gateway_ui: null } },
    { ...withoutMetadata(initial), _meta: { gateway_ui: [] } },
    { ...withoutMetadata(initial), _meta: { gateway_ui: { job_id: initial.structuredContent.job_id } } },
  ];
  for (const invalid of cases) {
    const h = await setup();
    try {
      h.input(); h.result(invalid); h.result();
      await settled();
      assert.equal(h.app.calls.length, 0);
    } finally { await h.bridge.destroy(); }
  }
});

test('a missing envelope does not excuse mismatched or incomplete summary identity', async () => {
  const changes = [
    (summary) => { summary.job_id = 'different-job'; },
    (summary) => { summary.image_version_id = '3'.repeat(32); },
    (summary) => { summary.view = 'gantt'; },
    (summary) => { summary.contract_version = 'unknown'; },
    (summary) => { summary.ui_available = false; },
    (summary) => { summary.result_summary = {}; },
    (summary) => { summary.engineer_id = 'different-engineer'; },
  ];
  for (const change of changes) {
    const h = await setup();
    try {
      const invalid = withoutMetadata(h.initial);
      change(invalid.structuredContent);
      h.input(); h.result(invalid);
      await settled();
      assert.equal(h.app.calls.length, 0);
    } finally { await h.bridge.destroy(); }
  }
});

test('new input aborts bootstrap and late responses cannot replace the next task', async () => {
  const h = await setup();
  try {
    h.input(); h.result(); await settled();
    assert.equal(h.app.calls.length, 1);
    const next = changeJob(h.initial, 'next-synthetic-job');
    h.input({ job_id: next.structuredContent.job_id });
    assert.equal(h.app.calls[0].options.signal.aborted, true);
    h.app.calls[0].resolve(h.initial);
    await settled();
    assert.equal(h.results.length, 0);
    h.result(withoutMetadata(next)); await settled();
    assert.equal(h.app.calls.length, 2, 'The next input owns its own single attempt');
    assert.deepEqual(h.app.calls[1].params.arguments, { job_id: next.structuredContent.job_id });
    h.app.calls[1].resolve(next); await settled();
    assert.equal(h.results.length, 1);
    assert.equal(h.results[0][0]._meta.gateway_ui.job_id, next.structuredContent.job_id);
  } finally { await h.bridge.destroy(); }
});

test('a late old-job summary does not consume the next input bootstrap or clear its card', async () => {
  const h = await setup();
  try {
    const next = changeJob(h.initial, 'next-synthetic-job');
    h.input();
    h.input({ job_id: next.structuredContent.job_id });
    h.result(withoutMetadata(h.initial));
    await settled();
    assert.equal(h.app.calls.length, 0);
    assert.deepEqual(h.results, []);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.loading, []);
    h.result(withoutMetadata(next));
    await settled();
    assert.equal(h.app.calls.length, 1);
    assert.deepEqual(h.app.calls[0].params.arguments, { job_id: next.structuredContent.job_id });
    h.app.calls[0].resolve(next);
    await settled();
    assert.equal(h.results.length, 1);
    assert.equal(h.results[0][1].kind, 'bootstrap');
    assert.equal(h.results[0][0]._meta.gateway_ui.job_id, next.structuredContent.job_id);
  } finally { await h.bridge.destroy(); }
});

test('a late old-engineer summary does not consume the same-job new selection bootstrap', async () => {
  const h = await setup();
  try {
    const previousInput = { ...h.originalInput, engineer_id: 'engineer-selection-a' };
    const nextInput = { ...h.originalInput, engineer_id: 'engineer-selection-b' };
    const previousSummary = withoutMetadata(h.initial);
    previousSummary.structuredContent.engineer_id = previousInput.engineer_id;
    const nextSummary = withoutMetadata(h.initial);
    nextSummary.structuredContent.engineer_id = nextInput.engineer_id;
    h.input(previousInput);
    h.input(nextInput);
    h.result(previousSummary);
    await settled();
    assert.equal(h.app.calls.length, 0);
    assert.deepEqual(h.results, []);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.loading, []);
    h.result(nextSummary);
    await settled();
    assert.equal(h.app.calls.length, 1);
    assert.deepEqual(h.app.calls[0].params.arguments, nextInput);
    assert.deepEqual(h.loading, [true]);
  } finally { await h.bridge.destroy(); }
});

test('a complete host result wins over an outstanding bootstrap', async () => {
  const h = await setup();
  try {
    h.input(); h.result(); await settled();
    assert.equal(h.app.calls.length, 1);
    h.result(h.initial);
    h.app.calls[0].resolve(h.initial);
    await settled();
    assert.deepEqual(h.results.map(([, meta]) => meta.kind), ['notification']);
    assert.deepEqual(h.loading, [true, false]);
  } finally { await h.bridge.destroy(); }
});

test('a changed host tool binding cancels bootstrap and rejects its late reply', async () => {
  const h = await setup();
  try {
    h.input(); h.result(); await settled();
    assert.equal(h.app.calls.length, 1);
    h.app.onhostcontextchanged({ toolInfo: { tool: { name: fixture('gantt')._meta.gateway_ui.display_tool_name } } });
    assert.equal(h.app.calls[0].options.signal.aborted, true);
    assert.deepEqual(h.loading, [true, false]);
    assert.deepEqual(h.errors, [{ code: 'MCP_UI_IDENTITY_MISMATCH', clearData: true }]);
    h.app.calls[0].resolve(h.initial); await settled();
    assert.deepEqual(h.results, []);
    h.result(); await settled();
    assert.equal(h.app.calls.length, 1);
  } finally { await h.bridge.destroy(); }
});

test('cancel and destroy suppress pending bootstrap completion and retries', async () => {
  for (const stop of ['cancel', 'destroy']) {
    const h = await setup();
    try {
      h.input(); h.result(); await settled();
      assert.equal(h.app.calls.length, 1);
      if (stop === 'cancel') h.app.ontoolcancelled({});
      else await h.bridge.destroy();
      assert.equal(h.app.calls[0].options.signal.aborted, true);
      h.app.calls[0].resolve(h.initial); await settled();
      assert.equal(h.results.length, 0);
      if (stop === 'cancel') { h.result(); await settled(); assert.equal(h.app.calls.length, 1); }
    } finally { await h.bridge.destroy(); }
  }
});

test('map and Gantt cards for one job keep independent bootstrap requests and teardown', async () => {
  const map = await setup();
  const gantt = await setup({ view: 'gantt' });
  try {
    map.input(); map.result();
    gantt.input(); gantt.result();
    await settled();
    assert.equal(map.app.calls.length, 1);
    assert.equal(gantt.app.calls.length, 1);
    assert.notEqual(map.app.calls[0].params.name, gantt.app.calls[0].params.name);
    assert.deepEqual(map.app.calls[0].params.arguments, gantt.app.calls[0].params.arguments);
    await map.bridge.destroy();
    assert.equal(map.app.calls[0].options.signal.aborted, true);
    assert.equal(gantt.app.calls[0].options.signal.aborted, false);
    map.app.calls[0].resolve(map.initial);
    gantt.app.calls[0].resolve(gantt.initial);
    await settled();
    assert.equal(map.results.length, 0);
    assert.equal(gantt.results.length, 1);
    assert.equal(gantt.results[0][1].kind, 'bootstrap');
    assert.equal(gantt.app.closed, 0);
  } finally { await map.bridge.destroy(); await gantt.bridge.destroy(); }
});

test('failed or still incomplete bootstrap is bounded and never leaks SDK error details', async () => {
  for (const failure of ['metadata', 'permission', 'identity', 'timeout']) {
    const h = await setup();
    try {
      h.input(); h.result(); await settled();
      assert.equal(h.app.calls.length, 1);
      if (failure === 'permission') h.app.calls[0].reject(Object.assign(new Error('private SDK stack and credentials'), { data: { code: 'FORBIDDEN', private: 'not exposed' } }));
      else if (failure === 'timeout') h.app.calls[0].reject(Object.assign(new Error('private request detail in SDK timeout'), { code: -32001 }));
      else if (failure === 'identity') h.app.calls[0].resolve(changeJob(h.initial, 'wrong-returned-job'));
      else h.app.calls[0].resolve(withoutMetadata(h.initial));
      await settled();
      h.result(); await settled();
      assert.equal(h.app.calls.length, 1);
      assert.equal(h.results.length, 0);
      assert.deepEqual(h.loading, [true, false]);
      const expected = failure === 'permission' ? 'FORBIDDEN' : failure === 'identity' ? 'MCP_UI_IDENTITY_MISMATCH' : failure === 'timeout' ? 'MCP_UI_REFRESH_FAILED' : 'MCP_UI_META_MISSING';
      assert.deepEqual(h.errors.at(-1), { code: expected, clearData: failure !== 'timeout' });
      assert.equal(JSON.stringify(h.errors).includes('private'), false);
    } finally { await h.bridge.destroy(); }
  }
});
