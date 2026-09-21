import { MapView, mapError } from './maps.mjs';

const PROTOCOL = 'planly-map-renderer-v1';
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
let port = null, view = null, nonce = null, disposed = false;

function coordinate(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

function scene(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.markers)
      || !Array.isArray(value.lines) || !Array.isArray(value.warnings)) throw mapError('MAP_CONFIG');
  for (const marker of value.markers) {
    if (!marker || !['agent','ticket'].includes(marker.kind) || typeof marker.id !== 'string'
        || typeof marker.key !== 'string' || typeof marker.color !== 'string'
        || typeof marker.label !== 'string' || !coordinate(marker.position)) throw mapError('MAP_CONFIG');
  }
  for (const line of value.lines) {
    if (!line || typeof line.key !== 'string' || typeof line.agentId !== 'string'
        || typeof line.color !== 'string' || !Array.isArray(line.positions)
        || line.positions.length < 2 || !line.positions.every(coordinate)) throw mapError('MAP_CONFIG');
  }
  return value;
}

function send(message) {
  if (!disposed) port?.postMessage({ protocol:PROTOCOL, nonce, ...message });
}

function viewport() {
  try { send({ type:'viewport', viewport:view?.getViewport() ?? null }); } catch { /* best effort */ }
}

async function command(message) {
  if (!message || message.protocol !== PROTOCOL || message.nonce !== nonce || message.type !== 'command'
      || !Number.isSafeInteger(message.id) || typeof message.command !== 'string') return;
  const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
  try {
    if (message.command === 'mount') {
      if (view) throw mapError('MAP_CONFIG');
      view = new MapView(document.getElementById('map'), {
        onSelect:item => send({type:'select',item:{kind:item.kind,id:item.id}}),
        onFailure:error => send({type:'failure',code:error.code || 'MAP_LOAD_FAILED'})
      });
      await view.mount(payload.context, payload.provider, scene(payload.scene), payload.locale === 'en-US' ? 'en-US' : 'zh-CN');
    } else if (!view) throw mapError('MAP_LOAD_FAILED');
    else if (message.command === 'update') view.update(scene(payload.scene));
    else if (message.command === 'fit') view.fit();
    else if (message.command === 'focus') { if (!coordinate(payload.position)) throw mapError('MAP_CONFIG'); view.focus(payload.position); }
    else if (message.command === 'resize') view.resize();
    else if (message.command === 'moveAgents') {
      if (!Array.isArray(payload.states) || payload.states.some(item => !item || typeof item.id !== 'string' || !coordinate(item.position))) throw mapError('MAP_CONFIG');
      view.moveAgents(payload.states);
    } else if (message.command === 'setViewport') {
      if (!payload.viewport || !coordinate(payload.viewport.center) || !Number.isFinite(payload.viewport.zoom)) throw mapError('MAP_CONFIG');
      view.setViewport(payload.viewport);
    } else if (message.command === 'dispose') { cleanup(); }
    else throw mapError('MAP_CONFIG');
    if (message.id > 0) send({type:'response',id:message.id,ok:true});
    if (!disposed) viewport();
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'MAP_LOAD_FAILED';
    if (message.id > 0) send({type:'response',id:message.id,ok:false,code});
    else send({type:'failure',code});
  }
}

function cleanup() {
  if (disposed) return;
  view?.dispose();
  view = null;
  disposed = true;
  port?.close();
  port = null;
  window.removeEventListener('message', connect);
}

function connect(event) {
  const message = event.data;
  if (port || event.source !== window.parent || !message || message.protocol !== PROTOCOL
      || message.type !== 'connect' || message.nonce !== nonce || event.ports.length !== 1) return;
  port = event.ports[0];
  port.onmessage = incoming => { void command(incoming.data); };
  port.start();
  send({type:'connected'});
}

const fragment = new URLSearchParams(location.hash.slice(1));
nonce = fragment.get('planly');
if (NONCE.test(nonce || '')) {
  history.replaceState(null, '', location.pathname + location.search);
  window.addEventListener('message', connect);
  window.addEventListener('pagehide', cleanup, {once:true});
}
