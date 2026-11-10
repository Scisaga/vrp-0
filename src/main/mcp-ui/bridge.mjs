import { validSnapshotContext } from './svg-snapshot.mjs';
/** MCP Apps boundary. No REST, chat messages, credentials, or shared View state. */
const CONTRACT = 'gateway_mcp_result_v1';
const APP_PROTOCOL = '2026-01-26'; // Negotiated MCP Apps protocol of the pinned official SDK 2.0.
const VERSION_ID = /^[0-9a-f]{32}$/;
const RESULT_STATES = new Set(['ready', 'running', 'not_ready', 'failed', 'canceled', 'timed_out', 'archive_failed']);
const AUTH_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'INVALID_TOKEN', 'INVALID_PAT', 'INSUFFICIENT_SCOPE', 'USER_DISABLED']);
const GATEWAY_CODES = new Set([
  ...AUTH_CODES, 'MCP_UI_TOOL_MISMATCH', 'MCP_UI_UNAVAILABLE', 'MCP_UI_VIEW_UNSUPPORTED',
  'MCP_UI_RESOURCE_STALE', 'REQUEST_SCHEMA_INVALID', 'SOLVER_JOB_NOT_FOUND', 'MCP_RATE_LIMITED', 'MCP_UI_RESULT_TOO_LARGE',
]);
const CLEAR_CODES = new Set([
  ...AUTH_CODES, 'MCP_UI_TOOL_MISMATCH', 'MCP_UI_UNAVAILABLE', 'MCP_UI_RESOURCE_STALE',
  'SOLVER_JOB_NOT_FOUND', 'MCP_UI_META_MISSING', 'MCP_UI_ENVELOPE_INVALID',
  'MCP_UI_IDENTITY_MISMATCH', 'MCP_UI_MODEL_INVALID', 'MCP_UI_INPUT_INVALID',
  'MCP_UI_PROTOCOL_UNSUPPORTED',
]);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value) => typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
const VIEW_CONFIG = Object.freeze({
  map: { tool: /^gw_map_([0-9a-f]{32})$/, input: new Set(['job_id', 'engineer_id']) },
  gantt: { tool: /^gw_gantt_([0-9a-f]{32})$/, input: new Set(['job_id']) },
});

function viewConfig(viewKind) {
  const config = VIEW_CONFIG[viewKind];
  if (!config) throw new ViewerBridgeError('MCP_UI_VIEW_UNSUPPORTED');
  return config;
}

/** UI-local safe error: never retains the server message, details, or payload. */
export class ViewerBridgeError extends Error {
  constructor(code, clearData = CLEAR_CODES.has(code)) {
    super(code);
    this.name = 'ViewerBridgeError';
    this.code = code;
    this.clearData = clearData;
  }
}

function gatewayError(value, fallback = 'MCP_UI_TOOL_FAILED') {
  const code = record(value) && GATEWAY_CODES.has(value.code) ? value.code : fallback;
  return new ViewerBridgeError(code);
}

function safeError(error, fallback = 'MCP_UI_BRIDGE_FAILED') {
  if (error instanceof ViewerBridgeError) return error;
  // SDK McpError and JSON-RPC error objects expose the business code in data.
  if (record(error?.data)) return gatewayError(error.data, fallback);
  if (record(error?.error?.data)) return gatewayError(error.error.data, fallback);
  if (GATEWAY_CODES.has(error?.code)) return gatewayError(error, fallback);
  return new ViewerBridgeError(fallback);
}

/**
 * Check only the existing Gateway envelope's security-critical boundary.
 * `validateView` is the compiled, canonical engine_view Schema validator; no
 * parallel Gateway JSON Schema or inferred task state machine is introduced.
 * Missing UI metadata is an explicit fallback, never parsed from model text.
 */
export function readEnvelope(result, {
  viewKind, expectedJobId, expectedVersionId, expectedToolName, validateView,
} = {}) {
  const config = viewConfig(viewKind);
  if (!record(result)) throw new ViewerBridgeError('MCP_UI_ENVELOPE_INVALID');
  if (record(result.error)) throw gatewayError(result.error.data);
  if (result.isError === true) throw gatewayError(result.structuredContent);
  const envelope = result._meta?.gateway_ui;
  if (!record(envelope)) throw new ViewerBridgeError('MCP_UI_META_MISSING');
  if (envelope.contract_version !== CONTRACT || !identity(envelope.job_id)
      || !VERSION_ID.test(envelope.image_version_id)
      || !RESULT_STATES.has(envelope.result_state) || envelope.view !== viewKind
      || !(envelope.engineer_id === null || identity(envelope.engineer_id))
      || envelope.platform_timezone !== '+08:00' || !record(envelope.task)
      || envelope.result_summary !== null || !own(envelope, 'engine_view') || !record(envelope.map_context)) {
    throw new ViewerBridgeError('MCP_UI_ENVELOPE_INVALID');
  }
  if ((viewKind === 'gantt' && envelope.engineer_id !== null)
      || (viewKind === 'map' && envelope.engineer_id !== null && [...envelope.engineer_id].length > 128)) {
    throw new ViewerBridgeError('MCP_UI_ENVELOPE_INVALID');
  }
  const mapContext = envelope.map_context;
  if (!['AMAP', 'HERE'].includes(mapContext.provider) || mapContext.provider !== envelope.task.map_provider
      || !identity(mapContext.locale) || typeof mapContext.browser_key !== 'string'
      || typeof mapContext.js_url !== 'string' || !(mapContext.css_url === null || typeof mapContext.css_url === 'string')
      || typeof mapContext.renderer_url !== 'string' || typeof mapContext.renderer_origin !== 'string'
      || typeof mapContext.enabled !== 'boolean') {
    throw new ViewerBridgeError('MCP_UI_ENVELOPE_INVALID');
  }
  if (viewKind === 'gantt' && (own(mapContext, 'render_mode') || own(mapContext, 'snapshot') || own(mapContext, 'error_code')
      || mapContext.enabled !== false
      || mapContext.browser_key !== '' || mapContext.js_url !== '' || mapContext.css_url !== null
      || mapContext.renderer_url !== '' || mapContext.renderer_origin !== '')) {
    throw new ViewerBridgeError('MCP_UI_ENVELOPE_INVALID');
  }
  if (viewKind === 'map' && mapContext.render_mode !== undefined && !validSnapshotContext(mapContext)) {
    throw new ViewerBridgeError('MCP_UI_ENVELOPE_INVALID');
  }
  if (viewKind === 'map' && mapContext.render_mode === undefined && (mapContext.enabled
      ? (!mapContext.browser_key.trim() || !mapContext.js_url.trim() || !mapContext.renderer_url.trim()
          || !mapContext.renderer_origin.trim() || (mapContext.css_url !== null && !mapContext.css_url.trim()))
      : (mapContext.browser_key !== '' || mapContext.js_url !== '' || mapContext.css_url !== null
          || mapContext.renderer_url !== '' || mapContext.renderer_origin !== ''))) {
    throw new ViewerBridgeError('MCP_UI_ENVELOPE_INVALID');
  }
  const toolMatch = typeof envelope.display_tool_name === 'string'
    ? config.tool.exec(envelope.display_tool_name) : null;
  if (!toolMatch || toolMatch[1] !== envelope.image_version_id
      || envelope.task.job_id !== envelope.job_id
      || envelope.task.image_version_id !== envelope.image_version_id
      || (expectedJobId !== undefined && envelope.job_id !== expectedJobId)
      || (expectedVersionId !== undefined && envelope.image_version_id !== expectedVersionId)
      || (expectedToolName !== undefined && envelope.display_tool_name !== expectedToolName)) {
    throw new ViewerBridgeError('MCP_UI_IDENTITY_MISMATCH');
  }
  const model = envelope.engine_view;
  if (model === null) {
    if (envelope.result_state === 'ready' || envelope.engineer_id !== null) throw new ViewerBridgeError('MCP_UI_MODEL_INVALID');
  } else {
    if (envelope.result_state !== 'ready' || envelope.task.status !== 'succeeded'
        || !record(model) || model.kind !== 'vrp0' || model.schema_version !== 2
        || model.display_model !== 'vrp0_solver_job' || !record(model.solver_job)) {
      throw new ViewerBridgeError('MCP_UI_MODEL_INVALID');
    }
    if (model.solver_job.id !== envelope.job_id) throw new ViewerBridgeError('MCP_UI_IDENTITY_MISMATCH');
    if (viewKind === 'map' && envelope.engineer_id !== null
        && !model.solver_job.plan?.agents?.some((agent) => record(agent) && agent.id === envelope.engineer_id)) {
      throw new ViewerBridgeError('MCP_UI_IDENTITY_MISMATCH');
    }
    if (validateView !== undefined) {
      try {
        if (typeof validateView !== 'function' || validateView(model) !== true) {
          throw new ViewerBridgeError('MCP_UI_MODEL_INVALID');
        }
      } catch {
        throw new ViewerBridgeError('MCP_UI_MODEL_INVALID');
      }
    }
  }
  return envelope;
}

const defaultApp = async () => (await import('./sdk.mjs')).App;

/**
 * Handlers are installed before connect. Each bridge owns its SDK instance,
 * request epoch, cancellation and context; two cards for one job stay separate.
 * Public async operations report safe onError values and resolve null/false on
 * failure. readEnvelope itself deliberately throws so callers can show fallback.
 */
export function createViewerBridge(handlers = {}, options = {}) {
  const viewKind = options.viewKind;
  const config = viewConfig(viewKind);
  let app;
  let connected = false;
  let destroyed = false;
  let connecting;
  let destroying;
  let hostContext = {};
  let jobId;
  let input;
  let bootstrap = { attempted: false, closed: false, pending: undefined };
  let epoch = 0;
  let sequence = 0;
  let notificationRevision = 0;
  let notificationsCancelled = false;
  let flight;
  let displayFlight;
  let messageFlight;
  let closeTimer;
  let teardownCalled = false;

  const notifyError = (error, fallback) => {
    const safe = safeError(error, fallback);
    try { handlers.onError?.({ code: safe.code, clearData: safe.clearData }); } catch { /* No payload logs. */ }
    return safe;
  };
  const invoke = (name, ...args) => {
    try {
      const pending = handlers[name]?.(...args);
      if (pending && typeof pending.catch === 'function') {
        pending.catch((error) => { if (!destroyed) notifyError(error, 'MCP_UI_RENDER_FAILED'); });
      }
      return pending;
    } catch (error) {
      if (!destroyed) notifyError(error, 'MCP_UI_RENDER_FAILED');
      return undefined;
    }
  };
  const invalidate = () => {
    epoch += 1;
    const bootstrapping = flight?.kind === 'bootstrap';
    flight?.controller.abort();
    flight = undefined;
    if (bootstrapping) invoke('onBootstrap', false);
  };
  const hostToolMatches = (toolName, required = false) => hostContext.toolInfo === undefined
    ? !required : record(hostContext.toolInfo?.tool) && hostContext.toolInfo.tool.name === toolName;
  const mergeContext = (context) => {
    if (!record(context) || destroyed) return;
    hostContext = { ...hostContext, ...context };
    invoke('onHostContext', { ...hostContext });
    if (flight?.kind === 'bootstrap' && !hostToolMatches(flight.toolName, flight.hostRequired)) {
      stopBootstrap();
      bootstrap.closed = true;
      notifyError(new ViewerBridgeError('MCP_UI_IDENTITY_MISMATCH'));
    }
  };

  // Only an absent field is recoverable. Null/arrays/invalid envelopes and
  // business errors must keep the ordinary validation/error path.
  const metadataAbsent = (result) => record(result) && !own(result, 'error')
    && (result.isError === undefined || result.isError === false)
    && (result._meta === undefined || (record(result._meta) && !own(result._meta, 'gateway_ui')));
  const recoverySummary = (result) => {
    const summary = result?.structuredContent;
    return record(summary) && summary.contract_version === CONTRACT
      && identity(summary.job_id) && VERSION_ID.test(summary.image_version_id)
      && summary.view === viewKind && summary.ui_available === true && summary.result_summary === null
      && (summary.engineer_id === null || (viewKind === 'map' && identity(summary.engineer_id)))
      ? summary : null;
  };
  const recoveryTool = (summary) => {
    // Gateway emits this explicit route only after authorizing the tool call.
    // Legacy summaries can still use host identity. Never derive a tool name
    // from a version, model text, URL, or a host-specific namespace prefix.
    const hasSummaryTool = own(summary, 'display_tool_name');
    const toolName = hasSummaryTool ? summary.display_tool_name : hostContext.toolInfo?.tool?.name;
    const match = typeof toolName === 'string' ? config.tool.exec(toolName) : null;
    if (!match || match[1] !== summary.image_version_id || !hostToolMatches(toolName, !hasSummaryTool)) return null;
    return { toolName, versionId: match[1], hostRequired: hostContext.toolInfo !== undefined };
  };
  function stopBootstrap() {
    bootstrap.pending = undefined;
    if (flight?.kind !== 'bootstrap') return;
    flight.controller.abort();
    flight = undefined;
    invoke('onBootstrap', false);
  }
  function deliverPending() {
    const pending = bootstrap.pending;
    bootstrap.pending = undefined;
    bootstrap.closed = true;
    if (pending) invoke('onResult', pending, { kind: 'notification', requestJobId: jobId, requestEpoch: epoch });
  }
  function tryBootstrap() {
    if (destroyed || !connected || notificationsCancelled || bootstrap.closed || bootstrap.attempted || !bootstrap.pending) return;
    const summary = recoverySummary(bootstrap.pending);
    const tool = summary && recoveryTool(summary);
    if (!input || !summary || !record(app.getHostCapabilities?.()?.serverTools)
        || !tool
        || summary.job_id !== input.job_id || summary.engineer_id !== (input.engineer_id ?? null)) {
      deliverPending();
      return;
    }
    const { toolName, versionId, hostRequired } = tool;
    // Mark before sending: duplicate missing-meta notifications never create a
    // second request or invalidate this one. No inferred names or model text.
    bootstrap.attempted = true;
    bootstrap.pending = undefined;
    const token = {
      kind: 'bootstrap', epoch, jobId: input.job_id, toolName, hostRequired,
      revision: notificationRevision, controller: new AbortController(),
    };
    const args = { ...input };
    flight = token;
    const current = () => !destroyed && token.epoch === epoch && flight === token
      && token.revision === notificationRevision && jobId === token.jobId
      && hostToolMatches(toolName, hostRequired);
    invoke('onBootstrap', true);
    void (async () => {
      try {
        const result = await app.callServerTool(
          { name: toolName, arguments: args }, { signal: token.controller.signal, timeout: 10000 },
        );
        if (!current()) return;
        const checked = readEnvelope(result, {
          viewKind, expectedJobId: token.jobId, expectedVersionId: versionId, expectedToolName: toolName,
        });
        if (checked.engineer_id !== (args.engineer_id ?? null)) throw new ViewerBridgeError('MCP_UI_IDENTITY_MISMATCH');
        invoke('onResult', result, { kind: 'bootstrap', requestJobId: token.jobId, requestEpoch: token.epoch });
      } catch (error) {
        if (current()) notifyError(error, 'MCP_UI_REFRESH_FAILED');
      } finally {
        if (flight === token) {
          flight = undefined;
          bootstrap.closed = true;
          invoke('onBootstrap', false);
        }
      }
    })();
  }

  function attach(instance) {
    // App 2.0 validates the handshake shape but not the negotiated version.
    // Wrap only its public request API, leaving encoding, source validation,
    // correlation, timeouts and the standard transport entirely with the SDK.
    const sdkRequest = instance.request.bind(instance);
    instance.request = async (...args) => {
      const response = await sdkRequest(...args);
      if (args[0]?.method === 'ui/initialize' && response?.protocolVersion !== APP_PROTOCOL) {
        throw new ViewerBridgeError('MCP_UI_PROTOCOL_UNSUPPORTED');
      }
      return response;
    };
    // App 2.0's default ping handler logs params. Replace it before connecting.
    instance.removeRequestHandler('ping');
    instance.setRequestHandler('ping', async () => ({}));
    instance.ontoolinput = (params) => {
      if (destroyed) return;
      const args = params?.arguments;
      if (!record(args) || Object.keys(args).some((key) => !config.input.has(key))
          || !identity(args.job_id) || [...args.job_id].length > 128
          || (viewKind === 'map' && args.engineer_id !== undefined
            && (!identity(args.engineer_id) || [...args.engineer_id].length > 128))) {
        invalidate();
        notificationsCancelled = true;
        bootstrap.closed = true;
        bootstrap.pending = undefined;
        notifyError(new ViewerBridgeError('MCP_UI_INPUT_INVALID'));
        return;
      }
      invalidate();
      notificationsCancelled = false;
      jobId = args.job_id;
      input = {
        job_id: args.job_id,
        ...(viewKind === 'map' && args.engineer_id !== undefined ? { engineer_id: args.engineer_id } : {}),
      };
      bootstrap = { attempted: false, closed: false, pending: undefined };
      invoke('onInput', { ...input }, { requestEpoch: epoch });
    };
    instance.ontoolresult = (result) => {
      if (destroyed || notificationsCancelled) return;
      const incomingJob = result?._meta?.gateway_ui?.job_id;
      // A late notification for the previous input must not clear the new card.
      if (jobId !== undefined && identity(incomingJob) && incomingJob !== jobId) return;
      if (metadataAbsent(result)) {
        const summary = recoverySummary(result);
        // Some hosts also deliver late notifications without _meta. Their
        // public task identity must not consume the new input's recovery.
        if (input && summary && (summary.job_id !== input.job_id
            || summary.engineer_id !== (input.engineer_id ?? null))) return;
        if (bootstrap.attempted) return;
        if (!bootstrap.closed && summary) {
          bootstrap.pending = result;
          tryBootstrap();
          return;
        }
      }
      stopBootstrap();
      bootstrap.closed = true;
      notificationRevision += 1;
      invoke('onResult', result, { kind: 'notification', requestJobId: jobId, requestEpoch: epoch });
    };
    instance.ontoolcancelled = () => {
      if (destroyed) return;
      invalidate();
      notificationsCancelled = true;
      bootstrap.closed = true;
      bootstrap.pending = undefined;
      notifyError(new ViewerBridgeError('MCP_UI_TOOL_CANCELLED'));
    };
    instance.onhostcontextchanged = (context) => mergeContext(context);
    instance.onteardown = async () => {
      await release(false);
      // Keep the transport open until the SDK sends its teardown acknowledgement.
      closeTimer = setTimeout(() => { closeTimer = undefined; void closeSdk(); }, 0);
      return {};
    };
    instance.onerror = (error) => {
      if (destroyed) return;
      // SDK 2.0 reports an uncorrelated late response after AbortSignal removed
      // its request handler. It cannot belong to a live operation and must not
      // mark the new input stale. Never parse or expose its embedded payload.
      if (error instanceof Error && error.message.startsWith('Received a response for an unknown message ID: ')) return;
      notifyError(error);
    };
    instance.onclose = () => {
      if (destroyed || !connected) return;
      connected = false;
      invalidate();
      bootstrap.closed = true;
      bootstrap.pending = undefined;
      notifyError(new ViewerBridgeError('MCP_UI_CONNECTION_CLOSED'));
    };
  }

  async function closeSdk() {
    try { await app?.close(); } catch { /* Closing cannot expose transport details. */ }
  }

  async function release(close) {
    if (!destroyed) {
      destroyed = true;
      connected = false;
      invalidate();
      notificationsCancelled = true;
      if (app) {
        app.ontoolinput = undefined;
        app.ontoolresult = undefined;
        app.ontoolcancelled = undefined;
        app.onhostcontextchanged = undefined;
        app.onteardown = undefined;
        app.onerror = undefined;
        app.onclose = undefined;
      }
      hostContext = {};
      jobId = undefined;
      input = undefined;
      bootstrap.pending = undefined;
      if (!teardownCalled) {
        teardownCalled = true;
        try { await handlers.onTeardown?.(); } catch { /* Dispose all remaining bridge state regardless. */ }
      }
    }
    if (close) {
      if (closeTimer !== undefined) { clearTimeout(closeTimer); closeTimer = undefined; }
      await closeSdk();
    }
  }

  function connect() {
    if (destroyed) return Promise.resolve(false);
    if (connected) return Promise.resolve(true);
    if (connecting) return connecting;
    connecting = (async () => {
      try {
        const AppClass = options.AppClass ?? await defaultApp();
        if (destroyed) return false;
        app = new AppClass(
          options.appInfo ?? { name: 'vrp0-result-view', version: '1.0.0' },
          { availableDisplayModes: ['inline', 'fullscreen'] },
          { allowUnsafeEval: false, strict: true, autoResize: false },
        );
        attach(app);
        // The official default transport checks event.source === window.parent.
        await app.connect(undefined, { timeout: 10000 });
        if (destroyed) { await closeSdk(); return false; }
        connected = true;
        mergeContext(app.getHostContext?.() ?? {});
        tryBootstrap();
        return true;
      } catch (error) {
        connected = false;
        if (!destroyed) notifyError(error);
        await closeSdk();
        return false;
      } finally { connecting = undefined; }
    })();
    return connecting;
  }

  async function refresh(envelope, { engineerId } = {}) {
    if (destroyed) return null;
    if (!connected) { notifyError(new ViewerBridgeError('MCP_UI_NOT_CONNECTED')); return null; }
    if (flight) { notifyError(new ViewerBridgeError('MCP_UI_REFRESH_BUSY')); return null; }
    let checked;
    try {
      checked = readEnvelope({ _meta: { gateway_ui: envelope } }, { viewKind, expectedJobId: jobId });
      if (viewKind === 'gantt' && engineerId !== undefined && engineerId !== null) {
        throw new ViewerBridgeError('MCP_UI_INPUT_INVALID');
      }
      if (viewKind === 'map' && engineerId !== undefined && engineerId !== null && !identity(engineerId)) {
        throw new ViewerBridgeError('MCP_UI_INPUT_INVALID');
      }
    } catch (error) { notifyError(error); return null; }
    jobId ??= checked.job_id;
    const token = {
      epoch, sequence: ++sequence, jobId: checked.job_id, revision: notificationRevision,
      controller: new AbortController(),
    };
    flight = token;
    const args = { job_id: checked.job_id };
    // Long IDs remain intact in local UI state; the optional input is omitted.
    if (viewKind === 'map' && identity(engineerId) && [...engineerId].length <= 128) args.engineer_id = engineerId;
    const current = () => !destroyed && token.epoch === epoch
      && token.revision === notificationRevision && flight === token && jobId === token.jobId;
    try {
      const result = await app.callServerTool(
        { name: checked.display_tool_name, arguments: args }, { signal: token.controller.signal },
      );
      if (!current()) return null;
      readEnvelope(result, {
        viewKind, expectedJobId: checked.job_id, expectedVersionId: checked.image_version_id,
        expectedToolName: checked.display_tool_name,
      });
      invoke('onResult', result, { kind: 'refresh', requestJobId: token.jobId, requestEpoch: token.epoch });
      return result;
    } catch (error) {
      if (current()) notifyError(error, 'MCP_UI_REFRESH_FAILED');
      return null;
    } finally { if (flight === token) flight = undefined; }
  }

  async function sendGanttIntent(envelope, { timeout = 10000 } = {}) {
    const fallback = { sent: false, status: 'failed', text: '' };
    if (viewKind !== 'map' || destroyed || !connected || messageFlight) return fallback;
    let checked;
    try {
      checked = readEnvelope({ _meta: { gateway_ui: envelope } }, { viewKind: 'map', expectedJobId: jobId });
    } catch (error) {
      notifyError(error);
      return fallback;
    }
    const text = JSON.stringify({
      intent: 'show_job_gantt', job_id: checked.job_id, image_version_id: checked.image_version_id,
    });
    messageFlight = (async () => {
      try {
        const result = await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] }, { timeout });
        if (destroyed) return { sent: false, status: 'failed', text };
        return result?.isError === true
          ? { sent: false, status: 'rejected', text }
          : { sent: true, status: 'sent', text };
      } catch {
        return { sent: false, status: 'unknown', text };
      } finally { messageFlight = undefined; }
    })();
    return messageFlight;
  }

  async function requestDisplayMode(mode) {
    if (destroyed) return null;
    if (!connected) { notifyError(new ViewerBridgeError('MCP_UI_NOT_CONNECTED')); return null; }
    if (mode !== 'inline' && mode !== 'fullscreen') {
      notifyError(new ViewerBridgeError('MCP_UI_DISPLAY_MODE_INVALID'));
      return null;
    }
    if (displayFlight) return displayFlight;
    displayFlight = (async () => {
      try {
        const response = await app.requestDisplayMode({ mode });
        if (destroyed) return null;
        if (!record(response) || !['inline', 'fullscreen'].includes(response.mode)) {
          throw new ViewerBridgeError('MCP_UI_FULLSCREEN_UNAVAILABLE');
        }
        mergeContext({ displayMode: response.mode });
        if (response.mode !== mode) notifyError(new ViewerBridgeError('MCP_UI_FULLSCREEN_UNAVAILABLE'));
        return { mode: response.mode };
      } catch (error) {
        if (!destroyed) notifyError(error, 'MCP_UI_FULLSCREEN_UNAVAILABLE');
        return null;
      } finally { displayFlight = undefined; }
    })();
    return displayFlight;
  }

  async function reportSize(size) {
    if (!connected || destroyed || !record(size)) return false;
    const dimensions = {};
    for (const key of ['width', 'height']) {
      if (typeof size[key] === 'number' && Number.isFinite(size[key]) && size[key] > 0) {
        dimensions[key] = Math.ceil(size[key]);
      }
    }
    if (Object.keys(dimensions).length === 0) return false;
    try { await app.sendSizeChanged(dimensions); return !destroyed; }
    catch { return false; }
  }

  return {
    connect, refresh, sendGanttIntent, requestDisplayMode, reportSize,
    getHostContext: () => ({ ...hostContext }),
    destroy() { destroying ??= release(true); return destroying; },
  };
}
