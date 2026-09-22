import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildViewModel } from '../../main/mcp-ui/model.mjs';

const staticRoot = new URL('../../main/resources/META-INF/resources/static/', import.meta.url);
const require = createRequire(new URL('package.json', staticRoot));
const { build } = require('esbuild');
const { readNetworkPolicy } = require('./scripts/build-mcp-app.cjs');
const policy = readNetworkPolicy();
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../../main/mcp-ui/maps.mjs', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm', target: ['es2020'],
  plugins: [{ name: 'test-manifest-network-policy', setup(builder) {
    builder.onResolve({ filter: /^mcp-network-policy$/ }, () => ({ path: 'policy', namespace: 'test-policy' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-policy' }, () => ({
      contents: `export const connectDomains=${JSON.stringify(policy.connectDomains)};export const resourceDomains=${JSON.stringify(policy.resourceDomains)};`,
      loader: 'js'
    }));
  } }]
});
const { buildMapScene, validateMapContext, colorFor, MapView } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const base = JSON.parse(fs.readFileSync(new URL('../../../docs/integrations/gateway/fixtures/mcp-result-view/base-expected.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(base);
const agentOf = view => view.solver_job.plan.agents[0];
const sceneOf = (view, selection) => buildMapScene(buildViewModel(view), selection);
const context = (provider = 'AMAP') => ({
  enabled: true, provider, browser_key: 'synthetic-public-browser-key', locale: 'zh-CN', css_url: null,
  js_url: provider === 'AMAP' ? 'https://webapi.amap.com/maps?v=1.4.15' : 'https://js.api.here.com/v3/3.2/mapsjs-core.js'
});
const errorCode = (fn, code) => assert.throws(fn, error => error.code === code && error.message === code);

test('map scene preserves solver order, legacy axes, geometry, route identity and return slot', () => {
  const view = fresh(), before = structuredClone(view), agent = agentOf(view);
  const scene = sceneOf(view, { agentId: agent.id, ticketId: 'ticket-a' });
  assert.deepEqual(scene.lines.map(line => line.key), [`${agent.id}:0`, `${agent.id}:1`, `${agent.id}:2`]);
  assert.deepEqual(scene.lines.map(line => line.returnLeg), [false, false, true]);
  assert.deepEqual(scene.lines[0].positions, [[120, 30], [120.005, 30.005], [120.01, 30.01]]);
  assert.deepEqual(scene.markers.map(marker => [marker.kind, marker.id, marker.label]), [
    ['agent', agent.id, agent.name], ['ticket', 'ticket-b', '1'], ['ticket', 'ticket-a', '2']
  ]);
  assert.equal(scene.markers.find(marker => marker.id === 'ticket-a').selected, true);
  assert.equal(scene.markers[0].selected, true);
  assert.deepEqual(scene.warnings, []);
  assert.deepEqual(view, before);
  assert.equal(colorFor(agent.id), scene.lines[0].color);
});

test('null route holes keep later original segment keys; missing geometry is never connected', () => {
  const view = fresh(), agent = agentOf(view);
  agent.routes[1] = null;
  const scene = sceneOf(view);
  assert.deepEqual(scene.lines.map(line => line.key), [`${agent.id}:0`, `${agent.id}:2`]);
  assert.deepEqual(scene.lines.map(line => line.returnLeg), [false, true]);
  assert.ok(scene.warnings.includes('unavailableRoute'));
  assert.deepEqual(scene.lines[1].positions, agent.routes[2].polyline.map(point => [point.lat, point.lon]));
  agent.routes = null;
  assert.deepEqual(sceneOf(view).lines, []);
  assert.ok(sceneOf(view).warnings.includes('partialMap'));
  agent.routes = [];
  assert.deepEqual(sceneOf(view).lines, []);
  assert.equal(sceneOf(view).markers.length, 3, 'known stops remain visible without fabricated route geometry');
});

test('a route count mismatch cannot guess which remaining geometry is the return leg', () => {
  for (const change of [agent => agent.routes.pop(), agent => agent.routes.push(structuredClone(agent.routes[0])),
    agent => { agent.tickets = null; }]) {
    const view = fresh(), agent = agentOf(view); change(agent);
    assert.ok(sceneOf(view).lines.every(line => line.returnLeg === false));
  }
});

test('estimated, unknown and zero-distance segments are not silently drawn as real roads', () => {
  const view = fresh(), agent = agentOf(view);
  agent.routes[0].route_source = 'ESTIMATED';
  agent.routes[1].route_source = null;
  agent.routes[2].route_source = 'ZERO_DISTANCE';
  const scene = sceneOf(view);
  assert.deepEqual(scene.lines, []);
  assert.ok(scene.warnings.includes('estimated'));
  assert.ok(scene.warnings.includes('unknownSource'));
  agent.routes[0].route_source = 'CAR_FALLBACK';
  assert.equal(sceneOf(view).lines.length, 1);
  assert.ok(sceneOf(view).warnings.includes('fallback'));
});

test('invalid interior polyline points invalidate a complete segment instead of being filtered out', () => {
  for (const polyline of [null, [], [{lat: 120, lon: 30}],
    [{lat:120,lon:30}, null, {lat:120.01,lon:30.01}],
    [{lat:120,lon:30}, {lat:Infinity,lon:30}, {lat:120.01,lon:30.01}],
    [{lat:120,lon:30}, {lat:'120.005',lon:30.005}, {lat:120.01,lon:30.01}]]) {
    const view = fresh(), agent = agentOf(view);
    agent.routes[0].polyline = polyline;
    const scene = sceneOf(view);
    assert.deepEqual(scene.lines.map(line => line.key), [`${agent.id}:1`, `${agent.id}:2`]);
    assert.ok(scene.warnings.includes('unavailableRoute'));
  }
});

test('road-snapped polyline endpoints are displayed exactly, not replaced with POI connectors', () => {
  const view = fresh(), agent = agentOf(view);
  agent.routes[0].polyline = [{lat:120.0002,lon:30.0003}, {lat:120.003,lon:30.08}, {lat:120.0102,lon:30.0103}];
  const scene = sceneOf(view);
  assert.deepEqual(scene.lines[0].positions, [[120.0002,30.0003], [120.003,30.08], [120.0102,30.0103]]);
  assert.deepEqual(scene.markers[0].position, [120,30]);
  assert.deepEqual(scene.markers[1].position, [120.01,30.01]);
});

test('missing POIs and references produce partial diagnostics without default or guessed coordinates', () => {
  const view = fresh();
  view.solver_job.plan.pois = null;
  assert.deepEqual(sceneOf(view).markers, []);
  assert.ok(sceneOf(view).warnings.includes('partialMap'));
  assert.equal(sceneOf(view).lines.length, 3, 'independent known road geometry remains displayable');
  const missing = fresh();
  agentOf(missing).tickets = ['missing-ticket', 'ticket-a'];
  const selected = sceneOf(missing, {agentId:agentOf(missing).id});
  assert.ok(selected.warnings.includes('partialMap'));
  assert.equal(selected.markers.find(marker => marker.id === 'ticket-a').label, '2');
  agentOf(missing).tickets = null;
  assert.ok(sceneOf(missing).warnings.includes('unknownAssignment'));
});

test('malicious business labels stay plain text and marker construction never consumes them as HTML', () => {
  const payload = '<img src=x onerror="globalThis.__pwned=1"><svg/onload=alert(1)>';
  const view = fresh(); agentOf(view).name = payload;
  const scene = sceneOf(view);
  assert.equal(scene.markers[0].label, payload);
  assert.ok(scene.markers[1].title.includes(payload));
  assert.ok(scene.markers.every(marker => !Object.hasOwn(marker, 'html') && !Object.hasOwn(marker, 'content')));

  // A small DOM boundary double rejects HTML sinks rather than claiming to
  // replace the separate browser/sandbox tests of the real SDK adapter.
  const previous = globalThis.document, created = [];
  globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    createElement(tag) {
      const item = { tag, dataset: {}, style: { setProperty() {} }, attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, addEventListener() {} };
      Object.defineProperty(item, 'innerHTML', { set() { assert.fail('business labels must never become HTML'); } });
      created.push(item); return item;
    }
  };
  try {
    const adapter = new MapView({}, {onSelect() {}, onFailure(error) { throw error; }});
    adapter.kind = 'AMAP';
    adapter.map = { getCenter: () => ({lng:120,lat:30}), getZoom: () => 12, setZoomAndCenter() {}, add() {}, remove() {}, destroy() {} };
    adapter.api = { Polyline: class { constructor(options) { this.options = options; } }, Marker: class { constructor(options) { this.options = options; } } };
    adapter.update(scene);
    assert.equal(created[0].textContent, payload);
    assert.equal(created[0].attrs['aria-label'], payload);
    assert.equal(adapter.markers.get(`agent:${agentOf(view).id}`).options.content, created[0]);
    adapter.dispose();
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});

test('HERE omits lineDash for solid routes and sets it only for dashed return legs', () => {
  const previous = globalThis.document, styles = [];
  globalThis.document = {
    addEventListener() {}, removeEventListener() {},
    createElement() { return {style:{},setAttribute() {},addEventListener() {}}; }
  };
  class LineString { constructor() { this.points = []; } pushLatLngAlt(lat,lng) { this.points.push([lng,lat]); } }
  class Polyline { constructor(points,{style}) { this.points = points; styles.push(style); } }
  class DomIcon { constructor(element) { this.element = element; } }
  class DomMarker { constructor(position,options) { this.position = position; this.options = options; } }
  const adapter = new MapView({}, {onSelect() {},onFailure(error) { throw error; }});
  try {
    adapter.kind = 'HERE';
    adapter.map = {
      getCenter:() => ({lng:120,lat:30}), getZoom:() => 12,
      removeObjects() {}, addObjects() {}, setCenter() {}, setZoom() {}, dispose() {}
    };
    adapter.api = {geo:{LineString},map:{Polyline,DomIcon,DomMarker}};
    adapter.update({markers:[],lines:[
      {key:'solid',agentId:'agent',positions:[[120,30],[120.1,30.1]],color:'#123456',returnLeg:false},
      {key:'return',agentId:'agent',positions:[[120.1,30.1],[120,30]],color:'#654321',returnLeg:true}
    ],warnings:[]});
    assert.deepEqual(styles, [
      {strokeColor:'#123456',lineWidth:4},
      {strokeColor:'#654321',lineWidth:4,lineDash:[5,4]}
    ]);
    assert.equal(Object.hasOwn(styles[0], 'lineDash'), false);
  } finally {
    adapter.dispose();
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});

test('map context accepts only enabled matching providers and nonblank public browser credentials', () => {
  for (const provider of ['AMAP','HERE']) {
    const value = Object.freeze(context(provider));
    assert.notEqual(validateMapContext(value, provider), value);
    assert.equal(validateMapContext(value, provider).js_url, value.js_url);
  }
  for (const value of [null, undefined, {}, {...context(),enabled:false}, {...context(),enabled:'true'}]) {
    errorCode(() => validateMapContext(value, 'AMAP'), 'MAP_DISABLED');
  }
  for (const provider of ['HERE', 'none', null, 'amap']) {
    errorCode(() => validateMapContext({...context(),provider}, 'AMAP'), 'MAP_PROVIDER_MISMATCH');
  }
  for (const key of [null, undefined, '', ' \t\n', 123, {}]) {
    errorCode(() => validateMapContext({...context(),browser_key:key}, 'AMAP'), 'MAP_CONFIG');
  }
});

test('map SDK URLs reject credentials, non-HTTPS schemes and unapproved origins without leaking values', () => {
  for (const js_url of [null, undefined, 5, {}, '', '/maps', 'javascript:alert(1)', 'data:text/javascript,alert(1)',
    'http://webapi.amap.com/maps', 'https://evil.invalid/maps', 'https://webapi.amap.com.evil.invalid/maps',
    'https://user:secret@webapi.amap.com/maps', 'https://user@webapi.amap.com/maps',
    'https://webapi.amap.com@evil.invalid/maps', 'https://webapi.amap.com:8443/maps']) {
    errorCode(() => validateMapContext({...context(),js_url}, 'AMAP'), 'MAP_CONFIG');
  }
  errorCode(() => validateMapContext(context(), 'AMAP', {connectDomains:[],resourceDomains:[]}), 'MAP_CONFIG');
  errorCode(() => validateMapContext({...context('HERE'),js_url:'https://js.api.here.com/v3/3.2/not-core.js'}, 'HERE'), 'MAP_CONFIG');
  for (const css_url of ['http://js.api.here.com/style.css','https://evil.invalid/style.css', 'https://user:secret@js.api.here.com/style.css']) {
    errorCode(() => validateMapContext({...context('HERE'),css_url}, 'HERE'), 'MAP_CONFIG');
  }
});

test('a declared provider cannot load the other vendor or an unrelated SDK entry path', () => {
  for (const [provider, js_url] of [
    ['AMAP','https://js.api.here.com/maps'],
    ['AMAP','https://webapi.amap.com/other.js'],
    ['AMAP','https://webapi.amap.com/maps/unrelated.js'],
    ['HERE','https://webapi.amap.com/v3/3.2/mapsjs-core.js'],
    ['HERE','https://maps.hereapi.com/v3/3.2/mapsjs-core.js'],
    ['HERE','https://js.api.here.com/v3/3.2/mapsjs-service.js'],
    ['HERE','https://js.api.here.com/other/mapsjs-core.js'],
    ['HERE','https://js.api.here.com/v3/3.3/mapsjs-core.js']
  ]) errorCode(() => validateMapContext({...context(provider),js_url}, provider), 'MAP_CONFIG');
  for (const css_url of ['https://js.api.here.com/v3/3.1/mapsjs-ui.css',
    'https://js.api.here.com/v3/3.2/unrelated.css', 'https://webapi.amap.com/maps']) {
    errorCode(() => validateMapContext({...context('HERE'),css_url}, 'HERE'), 'MAP_CONFIG');
  }
  errorCode(() => validateMapContext({...context(),css_url:'https://js.api.here.com/v3/3.2/mapsjs-ui.css'}, 'AMAP'), 'MAP_CONFIG');
  assert.equal(validateMapContext({...context('HERE'),css_url:'https://js.api.here.com/v3/3.2/mapsjs-ui.css'}, 'HERE').provider, 'HERE');
});

test('HERE supports official pinned four-part versions without opening arbitrary version paths', () => {
  for (const version of ['3.1','3.2','3.1.38.0','3.2.0.0','3.2.8.0']) {
    const js_url = `https://js.api.here.com/v3/${version}/mapsjs-core.js`;
    const css_url = `https://js.api.here.com/v3/${version}/mapsjs-ui.css`;
    assert.equal(validateMapContext({...context('HERE'),js_url,css_url}, 'HERE').js_url, js_url);
  }
  for (const version of ['3.2.0','3.2.0.0.1','3.2.-1.0','3.3.0.0','4.0.0.0','3.2.x.y']) {
    errorCode(() => validateMapContext({...context('HERE'),js_url:`https://js.api.here.com/v3/${version}/mapsjs-core.js`}, 'HERE'), 'MAP_CONFIG');
  }
});

function isolatedAdapter(onFailure = () => {}) {
  const previous = globalThis.document;
  globalThis.document = {addEventListener() {}, removeEventListener() {}};
  const view = new MapView({}, {onSelect() {},onFailure});
  return {view, restore() {
    view.dispose();
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }};
}

function amapEvents() {
  const listeners = new Map();
  return {listeners, on(name, listener) {listeners.set(name, listener);},
    off(name, listener) {if (listeners.get(name) === listener) listeners.delete(name);}};
}

test('AMAP readiness resolves only on documented complete and removes its listener', async () => {
  const {view, restore} = isolatedAdapter();
  try {
    view.map = amapEvents(); view.kind = 'AMAP';
    let resolved = false;
    const ready = view.waitForAmapComplete().then(() => {resolved = true;});
    await Promise.resolve(); assert.equal(resolved, false);
    view.map.listeners.get('complete')();
    await ready; assert.equal(resolved, true);
    assert.equal(view.map.listeners.size, 0);
  } finally {restore();}
});

test('AMAP missing complete reports the safe ready phase without inventing an authentication diagnosis', async t => {
  t.mock.timers.enable(['setTimeout']);
  const {view, restore} = isolatedAdapter();
  try {
    view.map = amapEvents(); view.kind = 'AMAP';
    view.lastSuccessfulStage = 'amap_map_created';
    const expected = assert.rejects(view.waitForAmapComplete(), error => error.code === 'AMAP_READY_FAILED'
      && error.message === 'AMAP_READY_FAILED' && error.lastSuccessfulStage === 'amap_map_created'
      && error.failureStage === 'amap_ready');
    t.mock.timers.tick(20000);
    await expected;
    assert.equal(view.map.listeners.size, 0);
  } finally {restore();}
});

test('AMAP abort removes pending readiness and retains the original CSP failure code', async () => {
  for (const failed of [false,true]) {
    const errors = [], {view, restore} = isolatedAdapter(error => errors.push(error));
    try {
      view.map = amapEvents(); view.kind = 'AMAP';
      const map = view.map;
      const expected = assert.rejects(view.waitForAmapComplete(), error => error.code === (failed ? 'MAP_CSP_BLOCKED' : 'MAP_ABORTED'));
      const lateComplete = map.listeners.get('complete');
      if (failed) view.fail('MAP_CSP_BLOCKED');
      view.dispose(); await expected; lateComplete();
      assert.equal(map.listeners.size, 0);
      assert.equal(errors.length, failed ? 1 : 0);
    } finally {restore();}
  }
});

test('HERE listens only to documented Style failures, sanitizes details and releases handlers', () => {
  const errors = [], {view, restore} = isolatedAdapter(error => errors.push(error));
  const listeners = new Map();
  let state = 2;
  const style = {getState:() => state,
    addEventListener(name, listener) {listeners.set(name, listener);},
    removeEventListener(name, listener) {if (listeners.get(name) === listener) listeners.delete(name);}};
  view.api = {map:{render:{Style:{State:{ERROR:-1,READY:2}}}}};
  const layer = {getProvider:() => ({getStyle:() => style})};
  try {
    view.observeHereStyle(layer);
    assert.deepEqual([...listeners.keys()].sort(), ['change','error']);
    listeners.get('change')(); assert.equal(errors.length, 0);
    const lateError = listeners.get('error');
    lateError({message:'https://maps.hereapi.com/?apikey=synthetic-secret',detail:{token:'not-for-the-ui'}});
    assert.deepEqual(errors.map(error => ({code:error.code,message:error.message})), [{code:'MAP_LOAD_FAILED',message:'MAP_LOAD_FAILED'}]);
    state = -1; listeners.get('change')(); assert.equal(errors.length, 1, 'one failure does not create an error storm');
    view.dispose(); assert.equal(listeners.size, 0);
    lateError({message:'late'}); assert.equal(errors.length, 1);
  } finally {restore();}
  const next = isolatedAdapter();
  try {
    next.view.api = {map:{render:{Style:{State:{ERROR:-1}}}}};
    errorCode(() => next.view.observeHereStyle(layer), 'MAP_LOAD_FAILED');
    assert.equal(listeners.size, 0, 'an already failed style is rejected before attaching listeners');
  } finally {next.restore();}
});

test('enforced map CSP violations are evidence until an essential stage actually fails', () => {
  for (const [directive,blocked] of [['script-src','eval'],['script-src-elem','https://restapi.amap.com'],
    ['worker-src','blob'],['connect-src','https://vdata.amap.com'],['style-src-elem','inline'],
    ['font-src','https://js.api.here.com'],['img-src','https://webapi.amap.com'],['object-src','about:blank']]) {
    const errors=[],{view,restore}=isolatedAdapter(error=>errors.push(error));
    try {
      view.violation({effectiveDirective:directive,blockedURI:blocked,disposition:'report'});
      assert.equal(view.cspViolationObserved,false);
      view.violation({effectiveDirective:directive,blockedURI:blocked,disposition:'enforce'});
      assert.equal(view.cspViolationObserved,true);
      assert.deepEqual(errors,[]);
      assert.equal(view.abort.signal.aborted,false);
      assert.equal(view.diagnosticError({code:'AMAP_READY_FAILED'},'AMAP_READY_FAILED','amap_ready').code,'MAP_CSP_BLOCKED');
      view.violation({effectiveDirective:directive,blockedURI:blocked});
      assert.deepEqual(errors,[]);
    } finally {restore();}
  }
});

test('AMAP sensor guard is container-local, exact and restores the original DOM method', () => {
  for (const own of [false,true]) {
    const {view,restore}=isolatedAdapter(),added=[];
    const appendChild=function(child){added.push(child);return child;};
    const parent={appendChild};view.container=Object.create(parent);
    if(own)Object.defineProperty(view.container,'appendChild',{value:appendChild,configurable:true});
    const descriptor=Object.getOwnPropertyDescriptor(view.container,'appendChild');
    const sensor=()=>({tagName:'OBJECT',type:'text/html',data:'about:blank',onload:()=>assert.fail('legacy sensor executed'),
      style:{position:'absolute',pointerEvents:'none',width:'100%',height:'100%',zIndex:'-1'}});
    try {
      view.replaceAmapResizeSensor();
      const child=sensor();assert.equal(view.container.appendChild(child),child);assert.equal(child.onload,null);assert.equal(added.length,0);
      for(const change of [c=>{c.tagName='DIV';},c=>{c.type='image/svg+xml';},c=>{c.data='https://example.com';},
        c=>{c.style.width='50%';},c=>{c.style.zIndex='0';},c=>{c.style.pointerEvents='auto';}]) {
        const normal=sensor();change(normal);view.container.appendChild(normal);assert.equal(added.at(-1),normal);
      }
      assert.equal(parent.appendChild,appendChild,'never alter DOM prototypes');
      view.dispose();assert.deepEqual(Object.getOwnPropertyDescriptor(view.container,'appendChild'),descriptor);
      assert.equal(view.container.appendChild,appendChild);
    } finally {restore();}
  }
});

test('resizing coalesces frames, ignores zero size and preserves the live map and scene', () => {
  const previous={requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  const frames=new Map();let next=0;
  globalThis.requestAnimationFrame=callback=>{frames.set(++next,callback);return next;};
  globalThis.cancelAnimationFrame=id=>frames.delete(id);
  const flush=()=>{for(const [id,callback]of [...frames]){frames.delete(id);callback();}};
  try {
    for(const kind of ['AMAP','HERE']) {
      const errors=[],{view,restore}=isolatedAdapter(error=>errors.push(error));
      let calls=0;
      try {
        view.kind=kind;view.container={clientWidth:640,clientHeight:300};
        const map=view.map={triggerResize(){calls++;},getViewPort:()=>({resize(){calls++;}}),
          getCenter:()=>({lng:120,lat:30}),getZoom:()=>12,setZoomAndCenter(){},setCenter(){},setZoom(){}};
        const scene=view.scene={markers:[]},positions=view.markers;
        view.resize();view.resize();assert.equal(frames.size,1);flush();assert.equal(calls,1);
        view.resize();flush();assert.equal(calls,1,'unchanged size does not trigger SDK work');
        view.container.clientWidth=0;view.resize();flush();assert.equal(calls,1);
        view.container.clientWidth=900;view.container.clientHeight=700;view.resize();flush();assert.equal(calls,2);
        assert.equal(view.map,map);assert.equal(view.scene,scene);assert.equal(view.markers,positions);
        view.resize();view.dispose();assert.equal(frames.size,0);assert.deepEqual(errors,[]);
      } finally {restore();}
    }
    const errors=[],{view,restore}=isolatedAdapter(error=>errors.push(error));
    try {
      view.kind='AMAP';view.container={clientWidth:600,clientHeight:400};view.map={};
      view.resize();flush();assert.deepEqual(errors.map(e=>e.code),['MAP_RESIZE_FAILED']);
      view.resize();assert.equal(frames.size,0);
    } finally {restore();}
  } finally {
    for(const [name,value]of Object.entries(previous))if(value===undefined)delete globalThis[name];else globalThis[name]=value;
  }
});
