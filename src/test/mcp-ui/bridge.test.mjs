import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createViewerBridge, readEnvelope as readEnvelopeRaw, ViewerBridgeError } from '../../main/mcp-ui/bridge.mjs';

const payloads = JSON.parse(await readFile(new URL('../../../docs/integrations/gateway/fixtures/mcp-result-view/payloads.json', import.meta.url), 'utf8'));
const sample = (name = 'ready') => structuredClone(payloads.find((item) => item.name === name).message);
const readEnvelope = (result, options = {}) => readEnvelopeRaw(result, { viewKind: result?._meta?.gateway_ui?.view ?? 'map', ...options });
const envelope = () => readEnvelope(sample());
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

class FakeApp {
  static instances = [];
  constructor(info, capabilities, options) {
    Object.assign(this, { info, capabilities, options, calls: [], displayCalls: [], sizes: [], requests: new Map(), removed: [], closed: 0 });
    this.hostContext = { theme: 'light', locale: 'zh-CN', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] };
    FakeApp.instances.push(this);
  }
  removeRequestHandler(method) { this.removed.push(method); }
  setRequestHandler(method, handler) { this.requests.set(method, handler); }
  async request(request) {
    assert.ok(this instanceof FakeApp, 'SDK request must retain its receiver');
    return request.method === 'ui/initialize' ? { protocolVersion: '2026-01-26' } : { echoed: request };
  }
  async connect(transport, options) {
    this.connectArgs = [transport, options];
    for (const name of ['ontoolinput', 'ontoolresult', 'ontoolcancelled', 'onhostcontextchanged', 'onteardown']) {
      assert.equal(typeof this[name], 'function', `${name} must be registered before connect`);
    }
    assert.ok(this.requests.has('ping'));
    await this.request({ method: 'ui/initialize' });
  }
  getHostContext() { return this.hostContext; }
  callServerTool(params, options) {
    const request = deferred();
    this.calls.push({ params, options, ...request });
    return request.promise;
  }
  requestDisplayMode(params) {
    this.displayCalls.push(params);
    return Promise.resolve(this.nextDisplayResult ?? { mode: params.mode });
  }
  async sendSizeChanged(size) { this.sizes.push(size); }
  async sendMessage(message, options) { this.messages ??= []; this.messages.push({ message, options }); return this.nextMessageResult ?? {}; }
  async close() { this.closed += 1; this.onclose?.(); }
}

async function setup(extraHandlers = {}) {
  const inputs = []; const results = []; const contexts = []; const errors = []; let teardowns = 0;
  const bridge = createViewerBridge({
    onInput: (...value) => inputs.push(value), onResult: (...value) => results.push(value),
    onHostContext: (value) => contexts.push(value), onError: (value) => errors.push(value),
    onTeardown: () => { teardowns += 1; }, ...extraHandlers,
  }, { AppClass: FakeApp, viewKind: 'map' });
  assert.equal(await bridge.connect(), true);
  return { bridge, app: FakeApp.instances.at(-1), inputs, results, contexts, errors, teardownCount: () => teardowns };
}

function throwsCode(callback, code, clearData = undefined) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof ViewerBridgeError);
    assert.equal(error.code, code);
    assert.equal(error.message, code, 'Raw server details cannot escape');
    if (clearData !== undefined) assert.equal(error.clearData, clearData);
    return true;
  });
}

test('reads every existing success envelope without inventing a state mapping', () => {
  for (const { category, message } of payloads) {
    if (category !== 'tool-result') continue;
    let checked = 0;
    const original = structuredClone(message);
    const data = readEnvelope(message, { validateView: () => { checked += 1; return true; } });
    assert.equal(data, message._meta.gateway_ui);
    assert.equal(checked, data.engine_view === null ? 0 : 1);
    assert.deepEqual(message, original);
  }
});

test('accepts the frozen Gateway Gantt empty browser key and rejects null or non-empty variants', () => {
  const gatewayResult = sample('gantt-ready');
  assert.equal(gatewayResult._meta.gateway_ui.map_context.browser_key, '');
  assert.equal(gatewayResult._meta.gateway_ui.map_context.renderer_url, '');
  assert.equal(gatewayResult._meta.gateway_ui.map_context.renderer_origin, '');
  assert.equal(readEnvelope(gatewayResult).map_context.browser_key, '');
  for (const browserKey of [null, 'synthetic-public-browser-key']) {
    const invalid = sample('gantt-ready');
    invalid._meta.gateway_ui.map_context.browser_key = browserKey;
    throwsCode(() => readEnvelope(invalid), 'MCP_UI_ENVELOPE_INVALID', true);
  }
  for (const field of ['renderer_url', 'renderer_origin']) {
    for (const value of [null, 'https://renderer.example.invalid']) {
      const invalid = sample('gantt-ready');
      invalid._meta.gateway_ui.map_context[field] = value;
      throwsCode(() => readEnvelope(invalid), 'MCP_UI_ENVELOPE_INVALID', true);
    }
  }
});

test('metadata is never guessed from model text or another query shape', () => {
  throwsCode(() => readEnvelope(null), 'MCP_UI_ENVELOPE_INVALID', true);
  throwsCode(() => readEnvelope({ content: [{ type: 'text', text: JSON.stringify(sample()) }] }), 'MCP_UI_META_MISSING', true);
  throwsCode(() => readEnvelope({ _meta: { gateway_ui: { display_tool_name: envelope().display_tool_name } } }), 'MCP_UI_ENVELOPE_INVALID', true);
});

test('validates fixed identities, version tool binding and model constants', () => {
  const cases = [
    [(data) => { data.contract_version = 'other'; }, 'MCP_UI_ENVELOPE_INVALID'],
    [(data) => { data.result_state = 'made-up'; }, 'MCP_UI_ENVELOPE_INVALID'],
    [(data) => { data.image_version_id = 'other'; }, 'MCP_UI_ENVELOPE_INVALID'],
    [(data) => { data.task.job_id = 'another-job'; }, 'MCP_UI_IDENTITY_MISMATCH'],
    [(data) => { data.task.image_version_id = '3'.repeat(32); }, 'MCP_UI_IDENTITY_MISMATCH'],
    [(data) => { data.display_tool_name = 'gateway.solver_jobs.create'; }, 'MCP_UI_IDENTITY_MISMATCH'],
    [(data) => { data.map_context.renderer_url = ''; }, 'MCP_UI_ENVELOPE_INVALID'],
    [(data) => { data.map_context.renderer_origin = ''; }, 'MCP_UI_ENVELOPE_INVALID'],
    [(data) => { data.map_context.provider = data.map_context.provider === 'AMAP' ? 'HERE' : 'AMAP'; }, 'MCP_UI_ENVELOPE_INVALID'],
    [(data) => { data.display_tool_name = `gateway.ui.result_${'3'.repeat(32)}`; }, 'MCP_UI_IDENTITY_MISMATCH'],
    [(data) => { data.engine_view.solver_job.id = 'internal-engine-job'; }, 'MCP_UI_IDENTITY_MISMATCH'],
    [(data) => { data.engine_view.kind = 'another-engine'; }, 'MCP_UI_MODEL_INVALID'],
    [(data) => { data.engine_view.schema_version = 3; }, 'MCP_UI_MODEL_INVALID'],
    [(data) => { data.engine_view.display_model = 'raw'; }, 'MCP_UI_MODEL_INVALID'],
    [(data) => { data.engine_view = null; }, 'MCP_UI_MODEL_INVALID'],
  ];
  for (const [change, code] of cases) {
    const result = sample(); change(result._meta.gateway_ui);
    throwsCode(() => readEnvelope(result), code, true);
  }
  for (const expected of [{ expectedJobId: 'other' }, { expectedVersionId: '3'.repeat(32) }, { expectedToolName: 'gateway.solver_jobs.create' }]) {
    throwsCode(() => readEnvelope(sample(), expected), 'MCP_UI_IDENTITY_MISMATCH', true);
  }
});

test('canonical model validation is injected and failures reveal no Schema/payload internals', () => {
  throwsCode(() => readEnvelope(sample(), { validateView: () => false }), 'MCP_UI_MODEL_INVALID', true);
  throwsCode(() => readEnvelope(sample(), { validateView: () => { throw new Error('secret payload/key'); } }), 'MCP_UI_MODEL_INVALID', true);
});

test('classifies existing error wrappers without forwarding unknown details or messages', () => {
  for (const item of payloads) {
    if (item.category === 'tool-result') continue;
    throwsCode(() => readEnvelope(item.message), item.expectation.error_code);
  }
  throwsCode(() => readEnvelope({ isError: true, structuredContent: {
    code: 'secret invented code', message: 'private server message', details: { raw_payload: 'secret' },
  } }), 'MCP_UI_TOOL_FAILED', false);
  throwsCode(() => readEnvelope(sample('forbidden')), 'FORBIDDEN', true);
  throwsCode(() => readEnvelope(sample('expired-authentication')), 'INVALID_TOKEN', true);
});

test('uses strict SDK defaults, removes logging ping, installs handlers before handshake', async () => {
  const { bridge, app, contexts } = await setup();
  assert.deepEqual(app.options, { allowUnsafeEval: false, strict: true, autoResize: false });
  assert.deepEqual(app.capabilities, { availableDisplayModes: ['inline', 'fullscreen'] });
  assert.deepEqual(app.removed, ['ping']);
  assert.deepEqual(await app.requests.get('ping')({ secret: 'never logged' }), {});
  assert.equal(app.connectArgs[0], undefined, 'Use official parent-window transport');
  assert.deepEqual(contexts.at(-1), app.hostContext);
  assert.equal(await bridge.connect(), true);
  await bridge.destroy();
});

test('normalizes only standard tool arguments and suppresses old-task notifications', async () => {
  const { bridge, app, inputs, results } = await setup();
  const data = envelope();
  app.ontoolinput({ arguments: { job_id: data.job_id, ignored: 'never consumed' } });
  assert.deepEqual(inputs, []);
  app.ontoolinput({ arguments: { job_id: data.job_id } });
  assert.deepEqual(inputs[0][0], { job_id: data.job_id });
  app.ontoolresult(sample());
  assert.equal(results.length, 1);
  assert.deepEqual(results[0][1], { kind: 'notification', requestJobId: data.job_id, requestEpoch: 2 });
  app.ontoolinput({ arguments: { job_id: 'new-task' } });
  app.ontoolresult(sample());
  assert.equal(results.length, 1);
  await bridge.destroy();
});

test('refreshes using supplied verified tool only; long engineer IDs are omitted, never truncated', async () => {
  const { bridge, app, results } = await setup();
  const data = envelope();
  const pending = bridge.refresh(data, { engineerId: 'engineer-'.repeat(30) });
  assert.deepEqual(app.calls[0].params, { name: data.display_tool_name, arguments: { job_id: data.job_id } });
  app.calls[0].resolve(sample());
  assert.ok(await pending);
  assert.equal(results[0][1].kind, 'refresh');
  const short = bridge.refresh(data, { engineerId: 'engineer-a-260917' });
  assert.equal(app.calls[1].params.arguments.engineer_id, 'engineer-a-260917');
  app.calls[1].resolve(sample());
  await short;
  await bridge.destroy();
});

test('map sends one exact user text intent while Gantt has no message or engineer extension', async () => {
  const { bridge, app } = await setup();
  const data = envelope();
  const sent = await bridge.sendGanttIntent(data);
  const text = JSON.stringify({ intent:'show_job_gantt', job_id:data.job_id, image_version_id:data.image_version_id });
  assert.deepEqual(sent, { sent:true, status:'sent', text });
  assert.deepEqual(app.messages, [{ message:{ role:'user', content:[{ type:'text', text }] }, options:{ timeout:10000 } }]);
  await bridge.destroy();

  const inputs=[];
  const gantt=createViewerBridge({onInput:value=>inputs.push(value)}, {AppClass:FakeApp,viewKind:'gantt'});
  assert.equal(await gantt.connect(),true);
  const ganttApp=FakeApp.instances.at(-1),ganttResult=sample('gantt-ready'),ganttEnvelope=readEnvelope(ganttResult);
  ganttApp.ontoolinput({arguments:{job_id:ganttEnvelope.job_id,engineer_id:'forbidden'}});
  assert.deepEqual(inputs,[]);
  assert.deepEqual(await gantt.sendGanttIntent(ganttEnvelope),{sent:false,status:'failed',text:''});
  const pending=gantt.refresh(ganttEnvelope);assert.deepEqual(ganttApp.calls[0].params.arguments,{job_id:ganttEnvelope.job_id});
  ganttApp.calls[0].resolve(ganttResult);assert.ok(await pending);await gantt.destroy();
});

test('refuses tool guessing or in-place mutation to a write tool', async () => {
  const { bridge, app, errors } = await setup();
  const data = envelope(); data.display_tool_name = 'gateway.solver_jobs.create';
  assert.equal(await bridge.refresh(data), null);
  assert.equal(app.calls.length, 0);
  assert.deepEqual(errors.at(-1), { code: 'MCP_UI_IDENTITY_MISMATCH', clearData: true });
  await bridge.destroy();
});

test('same-instance refresh is single-flight and a new input invalidates its response', async () => {
  const { bridge, app, results, errors } = await setup();
  const pending = bridge.refresh(envelope());
  assert.equal(await bridge.refresh(envelope()), null);
  assert.equal(app.calls.length, 1);
  assert.equal(errors.at(-1).code, 'MCP_UI_REFRESH_BUSY');
  app.ontoolinput({ arguments: { job_id: 'next-job' } });
  assert.equal(app.calls[0].options.signal.aborted, true);
  app.calls[0].resolve(sample());
  assert.equal(await pending, null);
  assert.equal(results.length, 0);
  await bridge.destroy();
});

test('two cards for the same job have separate SDK, refresh and teardown state', async () => {
  const a = await setup(); const b = await setup();
  assert.notEqual(a.app, b.app);
  const first = a.bridge.refresh(envelope()); const second = b.bridge.refresh(envelope());
  await a.bridge.destroy();
  a.app.calls[0].resolve(sample()); b.app.calls[0].resolve(sample());
  assert.equal(await first, null); assert.ok(await second);
  assert.equal(a.results.length, 0); assert.equal(b.results.length, 1);
  assert.equal(b.app.closed, 0);
  await b.bridge.destroy();
});

test('cancellation stops in-flight work and late notifications until the next input', async () => {
  const { bridge, app, results, errors } = await setup();
  const pending = bridge.refresh(envelope());
  app.ontoolcancelled({ reason: 'private host detail' });
  assert.equal(app.calls[0].options.signal.aborted, true);
  app.calls[0].resolve(sample());
  assert.equal(await pending, null);
  app.ontoolresult(sample());
  assert.equal(results.length, 0);
  assert.deepEqual(errors.at(-1), { code: 'MCP_UI_TOOL_CANCELLED', clearData: false });
  app.ontoolinput({ arguments: { job_id: envelope().job_id } });
  app.ontoolresult(sample());
  assert.equal(results.length, 1);
  await bridge.destroy();
});

test('a newer host notification prevents an earlier refresh replacing its result', async () => {
  const { bridge, app, results } = await setup();
  const pending = bridge.refresh(envelope());
  app.ontoolresult(sample());
  app.calls[0].resolve(sample());
  assert.equal(await pending, null);
  assert.deepEqual(results.map((item) => item[1].kind), ['notification']);
  await bridge.destroy();
});

test('refresh validates returned identity and sends safe permission errors', async () => {
  const { bridge, app, errors, results } = await setup();
  let pending = bridge.refresh(envelope());
  const wrong = sample(); wrong._meta.gateway_ui.task.job_id = 'wrong';
  app.calls[0].resolve(wrong); assert.equal(await pending, null);
  assert.equal(errors.at(-1).code, 'MCP_UI_IDENTITY_MISMATCH');
  pending = bridge.refresh(envelope());
  app.calls[1].reject(Object.assign(new Error('private stack/path/key'), { data: { code: 'INVALID_TOKEN', secret: 'hidden' } }));
  assert.equal(await pending, null);
  assert.deepEqual(errors.at(-1), { code: 'INVALID_TOKEN', clearData: true });
  assert.equal(results.length, 0);
  await bridge.destroy();
});

test('display mode follows actual host response, including refused fullscreen', async () => {
  const { bridge, app, contexts, errors } = await setup();
  assert.deepEqual(await bridge.requestDisplayMode('fullscreen'), { mode: 'fullscreen' });
  assert.equal(contexts.at(-1).displayMode, 'fullscreen');
  app.onhostcontextchanged({ locale: 'en-US', theme: 'dark' });
  assert.equal(bridge.getHostContext().displayMode, 'fullscreen');
  app.nextDisplayResult = { mode: 'inline' };
  assert.deepEqual(await bridge.requestDisplayMode('fullscreen'), { mode: 'inline' });
  assert.equal(bridge.getHostContext().displayMode, 'inline');
  assert.equal(errors.at(-1).code, 'MCP_UI_FULLSCREEN_UNAVAILABLE');
  await bridge.destroy();
});

test('manual size reports contain only finite dimensions and stop after destroy', async () => {
  const { bridge, app } = await setup();
  assert.equal(await bridge.reportSize({ width: 320.2, height: 400, key: 'never sent' }), true);
  assert.deepEqual(app.sizes, [{ width: 321, height: 400 }]);
  assert.equal(await bridge.reportSize({ width: Infinity, height: -1 }), false);
  await bridge.destroy();
  assert.equal(await bridge.reportSize({ width: 500, height: 500 }), false);
  assert.equal(app.sizes.length, 1);
});

test('host teardown acknowledges before transport close and cleans handlers once', async () => {
  const { bridge, app, teardownCount } = await setup();
  const closeBefore = app.closed;
  assert.deepEqual(await app.onteardown({}), {});
  assert.equal(teardownCount(), 1);
  assert.equal(app.closed, closeBefore);
  assert.equal(app.ontoolinput, undefined);
  assert.equal(app.ontoolresult, undefined);
  await tick();
  assert.ok(app.closed > closeBefore);
  await bridge.destroy();
  assert.equal(teardownCount(), 1);
  assert.equal(await bridge.connect(), false);
});

test('connection errors and callback failures never report private payloads', async () => {
  const errors = [];
  class RejectingApp extends FakeApp { async connect() { throw new Error('secret credentials in SDK error'); } }
  const rejected = createViewerBridge({ onError: (error) => errors.push(error) }, { AppClass: RejectingApp, viewKind: 'map' });
  assert.equal(await rejected.connect(), false);
  assert.deepEqual(errors, [{ code: 'MCP_UI_BRIDGE_FAILED', clearData: false }]);
  await rejected.destroy();
  const active = await setup({ onResult: () => { throw new Error('private result in render error'); } });
  active.app.ontoolresult(sample());
  assert.deepEqual(active.errors.at(-1), { code: 'MCP_UI_RENDER_FAILED', clearData: false });
  await active.bridge.destroy();
});

test('concurrent connect shares one handshake and destroy suppresses its late completion', async () => {
  const handshake = deferred();
  const contexts = []; const errors = [];
  class PendingApp extends FakeApp {
    async connect(...args) { await super.connect(...args); await handshake.promise; }
  }
  const before = FakeApp.instances.length;
  const bridge = createViewerBridge({
    onHostContext: (value) => contexts.push(value), onError: (value) => errors.push(value),
  }, { AppClass: PendingApp, viewKind: 'map' });
  const first = bridge.connect(); const second = bridge.connect();
  assert.equal(first, second);
  assert.equal(FakeApp.instances.length, before + 1);
  await bridge.destroy();
  handshake.resolve();
  assert.equal(await first, false);
  assert.deepEqual(contexts, []);
  assert.deepEqual(errors, []);
});

test('unsupported handshake protocol fails closed while other SDK requests are transparent', async () => {
  const errors = [];
  class UnsupportedApp extends FakeApp {
    async request() { return { protocolVersion: 'unsupported-protocol' }; }
  }
  const bridge = createViewerBridge({ onError: error => errors.push(error) }, { AppClass: UnsupportedApp, viewKind: 'map' });
  assert.equal(await bridge.connect(), false);
  assert.deepEqual(errors, [{ code: 'MCP_UI_PROTOCOL_UNSUPPORTED', clearData: true }]);
  await bridge.destroy();
  const active = await setup();
  const request = { method: 'unchanged-sdk-request', params: { data: 1 } };
  assert.deepEqual(await active.app.request(request), { echoed: request });
  await active.bridge.destroy();
});

test('invalid input aborts refresh and blocks late notifications without exposing arguments', async () => {
  const { bridge, app, errors, results, inputs } = await setup();
  const pending = bridge.refresh(envelope());
  app.ontoolinput({ arguments: { job_id: envelope().job_id, engineer_id: '', key: 'private-value' } });
  assert.equal(app.calls[0].options.signal.aborted, true);
  assert.deepEqual(errors, [{ code: 'MCP_UI_INPUT_INVALID', clearData: true }]);
  app.calls[0].resolve(sample());
  assert.equal(await pending, null);
  app.ontoolresult(sample());
  assert.deepEqual(results, []);
  assert.deepEqual(inputs, []);
  // JSON Schema string length is measured in Unicode code points, not UTF-16 units.
  app.ontoolinput({ arguments: { job_id: envelope().job_id, engineer_id: '🚚'.repeat(128) } });
  assert.equal([...inputs[0][0].engineer_id].length, 128);
  app.ontoolresult(sample());
  assert.equal(results.length, 1);
  await bridge.destroy();
});

test('an old refresh permission rejection cannot clear the newly selected task', async () => {
  const { bridge, app, errors } = await setup();
  const pending = bridge.refresh(envelope());
  app.ontoolinput({ arguments: { job_id: 'next-task' } });
  app.calls[0].reject(Object.assign(new Error('private permission detail'), { data: { code: 'FORBIDDEN' } }));
  assert.equal(await pending, null);
  assert.deepEqual(errors, []);
  await bridge.destroy();
});

test('SDK uncorrelated responses after abort do not mark current data stale', async () => {
  const { bridge, app, errors } = await setup();
  app.onerror(new Error('Received a response for an unknown message ID: {"private":"payload"}'));
  assert.deepEqual(errors, []);
  app.onerror(new Error('Other malformed protocol error with private details'));
  assert.deepEqual(errors, [{ code: 'MCP_UI_BRIDGE_FAILED', clearData: false }]);
  await bridge.destroy();
});

test('pending fullscreen is single-flight and cannot change context after teardown', async () => {
  const { bridge, app, contexts, errors } = await setup();
  const response = deferred();
  app.requestDisplayMode = (params) => { app.displayCalls.push(params); return response.promise; };
  const first = bridge.requestDisplayMode('fullscreen');
  const second = bridge.requestDisplayMode('fullscreen');
  assert.equal(app.displayCalls.length, 1);
  const before = contexts.length;
  await bridge.destroy();
  response.resolve({ mode: 'fullscreen' });
  assert.equal(await first, null); assert.equal(await second, null);
  assert.equal(contexts.length, before);
  assert.deepEqual(bridge.getHostContext(), {});
  assert.deepEqual(errors, []);
});
