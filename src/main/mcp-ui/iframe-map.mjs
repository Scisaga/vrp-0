const PROTOCOL = 'planly-map-renderer-v1';
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
const RENDERER_PATH = /^\/mcp-apps\/renderers\/([0-9a-f]{32})\/[0-9a-f]{64}\.html$/;

export function mapError(code) { return Object.assign(new Error(code), { code }); }

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
  constructor(container, { onSelect, onFailure }) {
    this.container = container;
    this.onSelect = onSelect;
    this.onFailure = onFailure;
    this.pending = new Map();
    this.sequence = 0;
    this.viewport = null;
    this.disposed = false;
    this.failed = false;
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
      const timer = setTimeout(() => reject(mapError('MAP_TIMEOUT')), 20000);
      iframe.addEventListener('error', () => { clearTimeout(timer); reject(mapError('MAP_LOAD_FAILED')); }, { once:true });
      iframe.addEventListener('load', () => {
        if (this.disposed) { clearTimeout(timer); reject(mapError('MAP_ABORTED')); return; }
        const channel = new MessageChannel();
        this.port = channel.port1;
        this.port.onmessage = event => {
          const message = event.data;
          if (!message || message.protocol !== PROTOCOL || message.nonce !== this.nonce) return;
          if (message.type === 'connected') { clearTimeout(timer); resolve(); return; }
          this.receive(message);
        };
        this.port.start();
        // MCP hosts commonly give the App an opaque origin. That inherited
        // sandbox flag also makes this nested document opaque even though its
        // URL is HTTPS, so browsers reject an exact targetOrigin here. The
        // iframe URL itself is strictly pinned above; this one-time message
        // contains no business data and transfers a nonce-bound private port.
        iframe.contentWindow.postMessage({ protocol:PROTOCOL, type:'connect', nonce:this.nonce }, '*', [channel.port2]);
      }, { once:true });
      iframe.src = url.href;
      // Set the final URL and load listener before insertion. Appending an
      // unconfigured iframe can emit an initial about:blank load and make the
      // bridge send its MessagePort to the wrong document.
      this.container.replaceChildren(iframe);
    });
    await this.request('mount', { context:childContext(context), provider, scene, locale });
    if (!this.disposed) this.container.dataset.rendererMap = 'ready';
  }

  receive(message) {
    if (message.type === 'failure') { this.fail(message.code); return; }
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
    if (message.ok === true) pending.resolve();
    else pending.reject(mapError(typeof message.code === 'string' ? message.code : 'MAP_LOAD_FAILED'));
  }

  request(command, payload = {}) {
    if (this.disposed || !this.port) return Promise.reject(mapError('MAP_ABORTED'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(mapError('MAP_TIMEOUT'));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.port.postMessage({ protocol:PROTOCOL, type:'command', nonce:this.nonce, id, command, payload });
    });
  }

  send(command, payload = {}) {
    if (this.disposed || !this.port) return;
    this.port.postMessage({ protocol:PROTOCOL, type:'command', nonce:this.nonce, id:0, command, payload });
  }

  fail(code) {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.onFailure(mapError(typeof code === 'string' ? code : 'MAP_LOAD_FAILED'));
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
