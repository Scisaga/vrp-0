import { mapDiagnosticError, safeMapDiagnosticStage, safeMapErrorCode } from './map-diagnostics.mjs';

const PROTOCOL = 'planly-map-renderer-v1';
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
const RENDERER_PATH = /^\/mcp-apps\/renderers\/([0-9a-f]{32})\/[0-9a-f]{64}\.html$/;

export function mapError(code, lastSuccessfulStage = null, failureStage = null) {
  return mapDiagnosticError(code, lastSuccessfulStage, failureStage);
}

function rendererTarget(context, provider, imageVersionId) {
  if (!context || context.enabled !== true) throw mapError('MAP_DISABLED');
  if (!['AMAP','HERE'].includes(context.provider) || context.provider !== provider) throw mapError('MAP_PROVIDER_MISMATCH');
  if (typeof context.browser_key !== 'string' || !context.browser_key.trim()) throw mapError('MAP_CONFIG');
  let url, declaredOrigin;
  try {
    url = new URL(context.renderer_url);
    declaredOrigin = new URL(context.renderer_origin);
  } catch { throw mapError('MAP_CONFIG'); }
  const match = RENDERER_PATH.exec(url.pathname);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !match || match[1] !== imageVersionId || declaredOrigin.origin !== context.renderer_origin
      || declaredOrigin.pathname !== '/' || declaredOrigin.search || declaredOrigin.hash
      || url.origin !== declaredOrigin.origin) throw mapError('MAP_CONFIG');
  return url;
}

function nonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}

function childContext(context) {
  return {
    enabled:true,
    provider:context.provider,
    browser_key:context.browser_key,
    js_url:context.js_url,
    css_url:context.css_url ?? null,
    locale:context.locale === 'en-US' ? 'en-US' : 'zh-CN'
  };
}

/** Strict MCP App side of the map renderer bridge. Vendor code never runs here. */
export class IframeMapView {
  constructor(container, { onSelect, onFailure, onDiagnostic = () => {} }) {
    this.container = container;
    this.onSelect = onSelect;
    this.onFailure = onFailure;
    this.onDiagnostic = onDiagnostic;
    this.pending = new Map();
    this.sequence = 0;
    this.viewport = null;
    this.disposed = false;
    this.failed = false;
    this.lastSuccessfulStage = null;
  }

  advanceStage(value) {
    const stage = safeMapDiagnosticStage(value);
    if (!stage) return;
    const order = ['renderer_iframe_created','renderer_document_loaded','renderer_channel_connected',
      'amap_script_loaded','amap_sdk_ready','amap_map_created','amap_ready','amap_overlays_added','amap_fit_complete','amap_resize'];
    if (order.indexOf(stage) <= order.indexOf(this.lastSuccessfulStage)) return;
    this.lastSuccessfulStage = stage;
    this.onDiagnostic({ lastSuccessfulStage:stage, errorCode:null });
  }

  async mount(context, provider, scene, locale, imageVersionId) {
    const url = rendererTarget(context, provider, imageVersionId);
    this.origin = url.origin;
    this.nonce = nonce();
    if (!NONCE.test(this.nonce)) throw mapError('MAP_CONFIG');
    url.hash = `planly=${this.nonce}`;
    const iframe = document.createElement('iframe');
    iframe.className = 'map-renderer-frame';
    iframe.title = locale === 'en-US' ? 'Route map renderer' : '路线地图渲染器';
    iframe.referrerPolicy = 'no-referrer';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.setAttribute('allow', '');
    this.iframe = iframe;

    await new Promise((resolve, reject) => {
      let documentLoaded = false, settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => finish(mapError(
        documentLoaded ? 'RENDERER_CHANNEL_FAILED' : 'RENDERER_IFRAME_LOAD_FAILED',
        this.lastSuccessfulStage,
        documentLoaded ? 'renderer_channel_connected' : 'renderer_document_loaded'
      )), 20000);
      iframe.addEventListener('error', () => finish(mapError(
        'RENDERER_IFRAME_LOAD_FAILED', this.lastSuccessfulStage, 'renderer_document_loaded'
      )), { once:true });
      iframe.addEventListener('load', () => {
        documentLoaded = true;
        this.advanceStage('renderer_document_loaded');
        if (this.disposed) { finish(mapError('MAP_ABORTED', this.lastSuccessfulStage)); return; }
        const channel = new MessageChannel();
        this.port = channel.port1;
        this.port.onmessage = event => {
          const message = event.data;
          if (!message || message.protocol !== PROTOCOL || message.nonce !== this.nonce) return;
          if (message.type === 'connected') {
            this.advanceStage('renderer_channel_connected');
            finish();
            return;
          }
          this.receive(message);
        };
        this.port.onmessageerror = () => this.fail('RENDERER_CHANNEL_FAILED', 'renderer_channel_connected');
        this.port.start();
        // MCP hosts commonly give the App an opaque origin. That inherited
        // sandbox flag also makes this nested document opaque even though its
        // URL is HTTPS, so browsers reject an exact targetOrigin here. The
        // iframe URL itself is strictly pinned above; this one-time message
        // contains no business data and transfers a nonce-bound private port.
        try {
          iframe.contentWindow.postMessage({ protocol:PROTOCOL, type:'connect', nonce:this.nonce }, '*', [channel.port2]);
        } catch {
          finish(mapError('RENDERER_CHANNEL_FAILED', this.lastSuccessfulStage, 'renderer_channel_connected'));
        }
      }, { once:true });
      iframe.src = url.href;
      // Set the final URL and load listener before insertion. Appending an
      // unconfigured iframe can emit an initial about:blank load and make the
      // bridge send its MessagePort to the wrong document.
      this.container.replaceChildren(iframe);
      this.advanceStage('renderer_iframe_created');
    });
    await this.request('mount', { context:childContext(context), provider, scene, locale });
    if (!this.disposed) this.container.dataset.rendererMap = 'ready';
  }

  receive(message) {
    if (message.type === 'progress') { this.advanceStage(message.stage); return; }
    if (message.type === 'failure') {
      this.advanceStage(message.lastSuccessfulStage);
      this.fail(message.code, message.failureStage);
      return;
    }
    if (message.type === 'select' && message.item && ['agent','ticket'].includes(message.item.kind)
        && typeof message.item.id === 'string') {
      this.onSelect({ kind:message.item.kind, id:message.item.id });
      return;
    }
    if (message.type === 'viewport') { this.viewport = message.viewport || this.viewport; return; }
    if (message.type !== 'response' || !Number.isSafeInteger(message.id)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    this.advanceStage(message.lastSuccessfulStage);
    if (message.ok === true) pending.resolve();
    else pending.reject(mapError(
      safeMapErrorCode(message.code), this.lastSuccessfulStage, safeMapDiagnosticStage(message.failureStage)
    ));
  }

  request(command, payload = {}) {
    if (this.disposed || !this.port) return Promise.reject(mapError('MAP_ABORTED'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(mapError(command === 'mount' ? 'RENDERER_CHANNEL_FAILED' : 'MAP_TIMEOUT',
          this.lastSuccessfulStage, 'renderer_channel_connected'));
      }, command === 'mount' ? 25000 : 20000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.port.postMessage({ protocol:PROTOCOL, type:'command', nonce:this.nonce, id, command, payload });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(mapError('RENDERER_CHANNEL_FAILED', this.lastSuccessfulStage, 'renderer_channel_connected'));
      }
    });
  }

  send(command, payload = {}) {
    if (this.disposed || !this.port) return;
    this.port.postMessage({ protocol:PROTOCOL, type:'command', nonce:this.nonce, id:0, command, payload });
  }

  fail(code, failureStage = null) {
    if (this.disposed || this.failed) return;
    this.failed = true;
    const error = mapError(safeMapErrorCode(code), this.lastSuccessfulStage, failureStage);
    this.onDiagnostic({ lastSuccessfulStage:error.lastSuccessfulStage, errorCode:error.code });
    this.onFailure(error);
  }

  update(scene) { this.send('update', { scene }); }
  fit() { this.send('fit'); }
  focus(position) { this.send('focus', { position }); }
  resize() { this.send('resize'); }
  moveAgents(states) { this.send('moveAgents', { states }); }
  getViewport() { return this.viewport; }
  setViewport(viewport) { this.viewport = viewport; this.send('setViewport', { viewport }); }

  dispose() {
    if (this.disposed) return;
    this.send('dispose');
    this.disposed = true;
    delete this.container.dataset.rendererMap;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(mapError('MAP_ABORTED'));
    }
    this.pending.clear();
    this.port?.close();
    this.port = null;
    this.iframe?.remove();
    this.iframe = null;
  }
}
