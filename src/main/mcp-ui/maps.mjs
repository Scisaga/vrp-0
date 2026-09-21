import { connectDomains, resourceDomains } from 'mcp-network-policy';
export { buildMapScene, colorFor } from './map-scene.mjs';
export function mapError(code) { return Object.assign(new Error(code), { code }); }
function allowedURL(value, origins) {
  if (typeof value !== 'string') throw mapError('MAP_CONFIG');
  let url; try { url = new URL(value); } catch { throw mapError('MAP_CONFIG'); }
  if (url.protocol !== 'https:' || url.username || url.password || !origins.includes(url.origin)) throw mapError('MAP_CONFIG');
  return url;
}
export function validateMapContext(context, provider, policy = { connectDomains, resourceDomains }) {
  if (!context || context.enabled !== true) throw mapError('MAP_DISABLED');
  if (!['AMAP','HERE'].includes(context.provider) || context.provider !== provider) throw mapError('MAP_PROVIDER_MISMATCH');
  if (typeof context.browser_key !== 'string' || !context.browser_key.trim()) throw mapError('MAP_CONFIG');
  const js = allowedURL(context.js_url, policy.resourceDomains);
  if (context.provider === 'AMAP' && (js.origin !== 'https://webapi.amap.com' || js.pathname !== '/maps')) throw mapError('MAP_CONFIG');
  // HERE officially supports both rolling 3.1/3.2 and pinned four-part versions.
  if (context.provider === 'HERE' && (js.origin !== 'https://js.api.here.com' || !/^\/v3\/3\.[12](?:\.[0-9]+\.[0-9]+)?\/mapsjs-core\.js$/.test(js.pathname))) throw mapError('MAP_CONFIG');
  if (context.css_url !== null && context.css_url !== undefined) {
    const css = allowedURL(context.css_url, policy.resourceDomains);
    if (context.provider !== 'HERE' || css.origin !== js.origin || css.pathname !== new URL('mapsjs-ui.css', js).pathname) throw mapError('MAP_CONFIG');
  }
  return { ...context, js_url:js.href };
}
function loadScript(url, signal) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let done = false, failedTimer;
    const finish = error => {
      if (done) return; done = true; clearTimeout(timer); clearTimeout(failedTimer);
      signal.removeEventListener('abort', abort); script.onload = script.onerror = null;
      if (error) { script.remove(); reject(error); } else resolve(script);
    };
    const abort = () => finish(mapError(signal.reason?.code || 'MAP_ABORTED'));
    const timer = setTimeout(() => finish(mapError('MAP_TIMEOUT')), 20000);
    script.src = url; script.async = true; script.referrerPolicy = 'strict-origin-when-cross-origin';
    script.onload = () => finish();
    // Let the browser deliver its CSP event before reducing a script error to
    // an unknown loading failure. Never include URLs/keys in the error text.
    script.onerror = () => { failedTimer = setTimeout(() => finish(mapError('MAP_LOAD_FAILED')), 0); };
    signal.addEventListener('abort', abort, { once:true });
    if (signal.aborted) abort(); else document.head.append(script);
  });
}
function markerDOM(item, onSelect) {
  const element = document.createElement('button');
  element.type = 'button'; element.className = 'mcp-marker';
  element.style.setProperty('--agent-color', item.color); element.dataset.kind = item.kind;
  element.dataset.selected = String(Boolean(item.selected)); element.textContent = item.label;
  element.setAttribute('aria-label', item.title || item.label);
  element.addEventListener('click', event => { event.stopPropagation(); onSelect(item); });
  return element;
}
function arrowPoints(positions) {
  // Direction glyphs use existing geometry; never manufacture a stop connector.
  if (positions.length < 2) return null;
  const index = Math.max(1, Math.floor(positions.length / 2));
  const a = positions[index - 1], b = positions[index];
  if (a[0] === b[0] && a[1] === b[1]) return null;
  let dx = b[0] - a[0]; if (dx > 180) dx -= 360; if (dx < -180) dx += 360;
  return { position:b, angle:Math.atan2(dx * Math.cos(b[1] * Math.PI / 180), b[1] - a[1]) * 180 / Math.PI };
}
export class MapView {
  constructor(container, { onSelect, onFailure }) {
    this.container = container; this.onSelect = onSelect; this.onFailure = onFailure;
    this.map = null; this.markers = new Map(); this.objects = []; this.scripts = [];
    this.sdkCleanup = []; this.failureCode = null; this.resizeFrame = null; this.lastSize = null;
    this.abort = new AbortController(); this.disposed = false; this.viewport = null; this.kind = null; this.scene = null;
    this.violation = event => {
      if (this.disposed) return;
      if (event.disposition === 'report') return;
      // eval may be essential SDK module execution, not a harmless probe.
      // Worker violations are not guaranteed to reach this document.
      if (/^(script-src|connect-src|img-src|worker-src|child-src|style-src|font-src|object-src|default-src)(?:-|$)/.test(event.effectiveDirective || '')) this.fail('MAP_CSP_BLOCKED');
    };
    document.addEventListener('securitypolicyviolation', this.violation);
  }
  fail(code) {
    if (this.disposed || this.failureCode) return;
    this.failureCode = code;
    this.abort.abort(mapError(code));
    this.onFailure(mapError(code));
  }
  replaceAmapResizeSensor() {
    const container = this.container;
    const descriptor = Object.getOwnPropertyDescriptor(container, 'appendChild');
    const append = container.appendChild;
    // AMap 1.4 installs this sensor even with resizeEnable:false. Its onload
    // dereferences contentDocument.defaultView in an opaque-origin sandbox.
    // Intercept ONLY the inert full-size sensor on this map container; do not
    // patch document/Node prototypes, open object-src or touch SDK internals.
    const guardedAppend = function(child) {
      if (child.tagName === 'OBJECT' && child.type === 'text/html'
        && (!child.data || child.data === 'about:blank')
        && child.style.position === 'absolute' && child.style.pointerEvents === 'none'
        && child.style.width === '100%' && child.style.height === '100%' && child.style.zIndex === '-1') {
        child.onload = null;
        return child;
      }
      return append.call(this, child);
    };
    Object.defineProperty(container, 'appendChild', {configurable:true, writable:true, value:guardedAppend});
    this.sdkCleanup.push(() => {
      if (container.appendChild !== guardedAppend) return;
      if (descriptor) Object.defineProperty(container, 'appendChild', descriptor);
      else delete container.appendChild;
    });
  }
  waitForAmapComplete() {
    const map = this.map, signal = this.abort.signal;
    if (typeof map?.on !== 'function' || typeof map?.off !== 'function') return Promise.reject(mapError('MAP_LOAD_FAILED'));
    // AMap documents `complete` as initial map-tile loading completion, not a
    // general authentication/error event. Absence means timeout, not bad keys.
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = error => {
        if (finished) return; finished = true;
        clearTimeout(timer); map.off('complete', complete);
        signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const complete = () => finish();
      const abort = () => finish(mapError(this.failureCode || 'MAP_ABORTED'));
      const timer = setTimeout(() => finish(mapError('MAP_TIMEOUT')), 20000);
      signal.addEventListener('abort', abort, {once:true});
      try { map.on('complete', complete); } catch { finish(mapError('MAP_LOAD_FAILED')); }
      if (signal.aborted) abort();
    });
  }
  observeHereStyle(layer) {
    const style = layer.getProvider?.()?.getStyle?.();
    if (typeof style?.addEventListener !== 'function' || typeof style?.removeEventListener !== 'function') return;
    const errorState = this.api?.map?.render?.Style?.State?.ERROR;
    const failed = () => errorState !== undefined && style.getState?.() === errorState;
    if (failed()) throw mapError('MAP_LOAD_FAILED');
    // These are documented Style events. Providers and H.Map do not expose a
    // universal tile-error event; do not pretend this catches every HTTP error.
    const onError = () => this.fail('MAP_LOAD_FAILED');
    const onChange = () => { if (failed()) onError(); };
    style.addEventListener('error', onError);
    style.addEventListener('change', onChange);
    this.sdkCleanup.push(() => {
      style.removeEventListener('error', onError);
      style.removeEventListener('change', onChange);
    });
  }
  async mount(context, taskProvider, scene, locale) {
    this.context = validateMapContext(context, taskProvider); this.kind = context.provider;
    this.scene = scene;
    const center = scene.markers[0]?.position || scene.lines[0]?.positions[0];
    if (!center) throw mapError('MAP_NO_POINTS');
    let ready = null;
    if (this.kind === 'AMAP') {
      const url = new URL(this.context.js_url); url.searchParams.set('key', this.context.browser_key);
      this.scripts.push(await loadScript(url.href, this.abort.signal));
      if (this.disposed) return;
      if (!window.AMap?.Map) throw mapError('MAP_LOAD_FAILED');
      this.api = window.AMap;
      this.replaceAmapResizeSensor();
      this.map = new this.api.Map(this.container, { center, zoom:12, mapStyle:'amap://styles/darkblue', lang:locale === 'en-US' ? 'en' : 'zh_cn', resizeEnable:false });
      if (typeof this.map.triggerResize !== 'function') throw mapError('MAP_RESIZE_FAILED');
      // Attach a rejection handler immediately: a synchronous overlay/resize
      // failure below may otherwise leave the aborted readiness promise unhandled.
      ready = this.waitForAmapComplete().then(() => null, error => error);
    } else {
      const core = new URL(this.context.js_url);
      for (const name of ['mapsjs-core.js','mapsjs-service.js','mapsjs-mapevents.js']) {
        const url = new URL(name, core); allowedURL(url.href, resourceDomains);
        this.scripts.push(await loadScript(url.href, this.abort.signal));
      }
      if (this.disposed) return;
      if (!window.H?.Map || !window.H?.service?.Platform) throw mapError('MAP_LOAD_FAILED');
      this.api = window.H;
      this.platform = new this.api.service.Platform({ apikey:this.context.browser_key });
      const layers = this.platform.createDefaultLayers({ lg:locale === 'en-US' ? 'en' : 'zh' });
      const layer = layers.vector?.normal?.mapnight || layers.raster?.normal?.mapnight;
      if (!layer) throw mapError('MAP_LOAD_FAILED');
      this.observeHereStyle(layer);
      this.map = new this.api.Map(this.container, layer, { center:{lng:center[0],lat:center[1]}, zoom:12, pixelRatio:window.devicePixelRatio || 1 });
      if (this.disposed) { this.map.dispose?.(); this.map = null; return; }
      this.events = new this.api.mapevents.MapEvents(this.map);
      this.behavior = new this.api.mapevents.Behavior(this.events);
    }
    this.update(scene); this.fit();
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(this.container);
    if (ready) { const error = await ready; if (error) throw error; }
    this.lastSize = null; this.resize();
  }
  resize() {
    if (this.disposed || !this.map || this.failureCode || this.resizeFrame !== null) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      if (this.disposed || !this.map || this.failureCode) return;
      const width = this.container.clientWidth, height = this.container.clientHeight;
      // Hidden tabs have no usable viewport. Resize when visible again.
      if (width <= 0 || height <= 0 || this.lastSize?.width === width && this.lastSize?.height === height) return;
      try {
        const viewport = this.getViewport();
        if (this.kind === 'AMAP') this.map.triggerResize();
        else this.map.getViewPort().resize();
        this.setViewport(viewport);
        this.lastSize = {width, height};
      } catch { this.fail('MAP_RESIZE_FAILED'); }
    });
  }
  getViewport() {
    if (!this.map) return this.viewport;
    const center = this.map.getCenter();
    const lng = typeof center.getLng === 'function' ? center.getLng() : center.lng;
    const lat = typeof center.getLat === 'function' ? center.getLat() : center.lat;
    return { center:[lng,lat], zoom:this.map.getZoom() };
  }
  setViewport(value) {
    if (!value || !this.map) return;
    this.viewport = value;
    if (this.kind === 'AMAP') this.map.setZoomAndCenter(value.zoom, value.center, true);
    else { this.map.setCenter({lng:value.center[0],lat:value.center[1]}); this.map.setZoom(value.zoom); }
  }
  update(scene) {
    this.scene = scene; if (!this.map || this.disposed) return;
    const viewport = this.getViewport();
    if (this.kind === 'AMAP') { if (this.objects.length) this.map.remove(this.objects); }
    else if (this.objects.length) this.map.removeObjects(this.objects);
    this.objects = []; this.markers.clear();
    for (const line of scene.lines) {
      let shape;
      if (this.kind === 'AMAP') shape = new this.api.Polyline({ path:line.positions, strokeColor:line.color, strokeWeight:4, strokeOpacity:line.returnLeg ? .55 : .85, strokeStyle:line.returnLeg ? 'dashed' : 'solid', showDir:true });
      else {
        const points = new this.api.geo.LineString(); for (const [lng,lat] of line.positions) points.pushLatLngAlt(lat,lng,0);
        shape = new this.api.map.Polyline(points, { style:{ strokeColor:line.color,lineWidth:4,lineDash:line.returnLeg ? [5,4] : undefined } });
      }
      this.objects.push(shape);
      if (this.kind === 'HERE') {
        const arrow = arrowPoints(line.positions);
        if (arrow) {
          const element = document.createElement('span'); element.textContent = '↑';
          element.style.cssText = `display:block;color:${line.color};font-size:25px;font-weight:bold;transform:rotate(${arrow.angle}deg)`;
          element.setAttribute('aria-hidden','true');
          this.objects.push(new this.api.map.DomMarker({lng:arrow.position[0],lat:arrow.position[1]}, {icon:new this.api.map.DomIcon(element)}));
        }
      }
    }
    for (const item of scene.markers) {
      const content = markerDOM(item, this.onSelect);
      let marker;
      if (this.kind === 'AMAP') marker = new this.api.Marker({ position:item.position, content, anchor:'center', zIndex:item.kind === 'agent' ? 150 : 100 });
      else marker = new this.api.map.DomMarker({ lng:item.position[0],lat:item.position[1] }, { icon:new this.api.map.DomIcon(content, {onAttach:element => {
        // HERE clones DOM icons, so bind on the attached clone rather than HTML.
        element.onclick = event => { event.stopPropagation(); this.onSelect(item); };
      }}), zIndex:item.kind === 'agent' ? 150 : 100 });
      this.objects.push(marker); this.markers.set(item.key, marker);
    }
    if (this.kind === 'AMAP') this.map.add(this.objects); else this.map.addObjects(this.objects);
    this.setViewport(viewport);
  }
  fit() {
    if (!this.map || !this.objects.length) return;
    if (this.kind === 'AMAP') this.map.setFitView(this.objects, true, [35,35,35,35]);
    else {
      const group = new this.api.map.Group();
      // Bounds from supplied coordinates only; group ownership must not move overlays.
      for (const item of this.scene.markers) group.addObject(new this.api.map.Marker({lng:item.position[0],lat:item.position[1]}));
      for (const line of this.scene.lines) for (const point of line.positions) group.addObject(new this.api.map.Marker({lng:point[0],lat:point[1]}));
      const bounds = group.getBoundingBox(); if (bounds) this.map.getViewModel().setLookAtData({bounds});
      group.dispose?.();
    }
  }
  focus(position) { if (!position || !this.map) return; this.map.setCenter(this.kind === 'AMAP' ? position : {lng:position[0],lat:position[1]}); }
  moveAgents(states) {
    if (!this.map || this.disposed) return;
    for (const state of states) {
      const marker = this.markers.get(`agent:${state.id}`); if (!marker) continue;
      if (this.kind === 'AMAP') marker.setPosition(state.position);
      else marker.setGeometry({lng:state.position[0],lat:state.position[1]});
    }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.abort.abort(mapError(this.failureCode || 'MAP_ABORTED'));
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = null;
    document.removeEventListener('securitypolicyviolation', this.violation); this.resizeObserver?.disconnect();
    for (const cleanup of this.sdkCleanup.splice(0)) cleanup();
    this.behavior?.dispose?.(); this.events?.dispose?.();
    if (this.kind === 'AMAP') this.map?.destroy?.(); else this.map?.dispose?.();
    for (const script of this.scripts) script.remove();
    this.objects = []; this.markers.clear(); this.map = null; this.context = null;
  }
}
