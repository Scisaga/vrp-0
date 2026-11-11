import fs from 'node:fs';
import { test, expect, message, strictCsp } from './host-fixture.mjs';

// Model the two independently sized frames in Quick: the host owns a sandbox
// proxy, and that proxy owns the App. A classic scrollbar in the proxy makes
// the App viewport narrower than the outer frame. Echoing that viewport width
// back as an outer-frame pixel width must not create a shrinking feedback loop.
const hostDocument = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0}.card{width:615px}iframe{display:block;border:0;width:100%;height:600px}
</style></head><body><div class="card" id="card"></div><script>
let epoch=0;
window.host={
  serverCalls:[],
  mount(options){
    const container=document.querySelector('#card');container.replaceChildren();
    const frame=document.createElement('iframe');
    const card={...options,frame,epoch:++epoch,wire:[],sizes:[],metrics:[],initialized:false};
    this.card=card;frame.name='sizing-proxy-'+card.epoch;
    frame.setAttribute('sandbox','allow-scripts allow-same-origin');
    frame.onload=()=>frame.contentWindow.postMessage({type:'mcp-test-boot',epoch:card.epoch},'*');
    frame.src='http://mcp-sizing-proxy.test/proxy.html?kind='+options.kind+'&epoch='+card.epoch;
    container.append(frame);return card.epoch;
  },
  resize(width){document.querySelector('#card').style.width=width+'px'},
  stats(){const card=this.card;return {epoch:card.epoch,initialized:card.initialized,
    containerWidth:document.querySelector('#card').getBoundingClientRect().width,
    frameWidth:card.frame.getBoundingClientRect().width,frameHeight:card.frame.getBoundingClientRect().height,
    sizes:card.sizes,metrics:card.metrics}},
};
addEventListener('message',event=>{
  const card=window.host.card;if(!card||event.source!==card.frame.contentWindow)return;
  const data=event.data;
  if(data?.type==='proxy-metrics'){card.metrics.push(data);return}
  if(data?.jsonrpc!=='2.0')return;card.wire.push(data);
  const send=data=>card.frame.contentWindow.postMessage(data,'*');
  if(data.method==='ui/initialize')send({jsonrpc:'2.0',id:data.id,result:{
    protocolVersion:'2026-01-26',hostInfo:{name:'two-layer-sizing-host',version:'1'},
    hostCapabilities:{serverTools:{}},hostContext:{theme:'light',locale:'zh-CN',displayMode:'inline',availableDisplayModes:['inline']}}});
  else if(data.method==='ui/notifications/initialized'){
    card.initialized=true;
    send({jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:card.input}});
    send({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:card.result});
  }else if(data.method==='ui/notifications/size-changed'){
    const {width,height}=data.params;card.sizes.push({width,height});
    // Quick AppFrame applies both optional dimensions to its sandbox iframe;
    // its enclosing card separately clamps only the requested height.
    if(width!==undefined)card.frame.style.width=width+'px';
    if(height!==undefined)card.frame.style.height=Math.max(200,Math.min(6000,height))+'px';
  }else if(data.method==='tools/call')window.host.serverCalls.push(data.params);
});
</script></body></html>`;

const proxyDocument = `<!doctype html><html><head><meta charset="utf-8"><style>
html{height:100%;overflow-y:scroll;scrollbar-gutter:stable}
html::-webkit-scrollbar{width:15px;height:15px}
body{height:100%;margin:0}iframe{display:block;border:0;width:100%;height:100%}
</style></head><body><script>
const params=new URLSearchParams(location.search);let frame;
const metrics=()=>parent.postMessage({type:'proxy-metrics',innerWidth,
  appFrameWidth:frame?.getBoundingClientRect().width},'*');
addEventListener('message',event=>{
  if(event.source===parent){
    if(event.data?.type==='mcp-test-boot'&&!frame){
      frame=document.createElement('iframe');frame.name='sizing-app-'+params.get('epoch');
      frame.setAttribute('sandbox','allow-scripts');
      frame.src='http://mcp-app.test/app.html?kind='+params.get('kind');document.body.append(frame);metrics();
    }else if(event.data?.jsonrpc==='2.0')frame?.contentWindow.postMessage(event.data,'*');
  }else if(frame&&event.source===frame.contentWindow&&event.data?.jsonrpc==='2.0')parent.postMessage(event.data,'*');
});
addEventListener('resize',metrics);
</script></body></html>`;

async function openSizingHost(page, kind) {
  const errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://mcp-sizing-host.test') return route.fulfill({ contentType:'text/html', body:hostDocument });
    if (url.origin === 'http://mcp-sizing-proxy.test') return route.fulfill({ contentType:'text/html', body:proxyDocument });
    if (url.origin === 'http://mcp-app.test') {
      const html = fs.readFileSync(new URL(`../../main/resources/META-INF/resources/static/mcp-${kind}-app.html`, import.meta.url), 'utf8');
      const csp = strictCsp(kind).replace('frame-ancestors http://mcp-host.test',
        'frame-ancestors http://mcp-sizing-host.test http://mcp-sizing-proxy.test');
      return route.fulfill({ contentType:'text/html', body:html, headers:{'content-security-policy':csp} });
    }
    unexpected.push(url.href);return route.abort();
  });
  await page.goto('http://mcp-sizing-host.test/');
  const result = message(kind === 'gantt' ? 'gantt-ready' : 'ready');
  return {
    async mount() {
      const epoch = await page.evaluate(options => window.host.mount(options),
        { kind, result, input:{job_id:result._meta.gateway_ui.job_id} });
      await expect.poll(() => page.evaluate(() => window.host.card.initialized)).toBe(true);
      const frame = page.frame({name:`sizing-app-${epoch}`});
      // Prove a real successful result reached this specific App instance.
      await expect(frame.locator('#app')).toHaveAttribute('aria-busy', 'false');
      await expect(frame.locator('#notice')).toBeHidden();
      await expect.poll(() => frame.locator(kind === 'gantt' ? '#engineer option' : '#engineer-options [role=option]').count()).toBeGreaterThan(1);
      if (kind === 'gantt') await expect.poll(() => frame.locator('.gantt-bar').count()).toBeGreaterThan(0);
      else { await expect(frame.locator('#engineer')).toContainText('1'); await expect(frame.locator('#map-legend')).toHaveCount(0); }
      return frame;
    },
    stats:() => page.evaluate(() => window.host.stats()),
    resize:width => page.evaluate(width => window.host.resize(width), width),
    async assertHealthy() {
      expect(errors).toEqual([]);expect(unexpected).toEqual([]);
      expect(await page.evaluate(() => window.host.serverCalls)).toEqual([]);
    },
  };
}

async function settleFrames(page) {
  await page.evaluate(() => new Promise(resolve => {
    let remaining = 30;
    const next = () => --remaining ? requestAnimationFrame(next) : resolve();
    requestAnimationFrame(next);
  }));
}

async function expectRendered(frame, kind) {
  if (kind === 'map') {
    await expect(frame.locator('#map-canvas')).toHaveAttribute('data-svg-map', 'ready');
    await expect(frame.locator('.snapshot-svg')).toBeVisible();
  } else await expect(frame.locator('.gantt-bar').first()).toBeVisible();
  await expect(frame.locator('#notice')).toBeHidden();
}

for (const kind of ['map', 'gantt']) {
  test(`${kind} keeps its host width across two-layer scrollbar sizing, resize and remount`, async ({page}) => {
    const host = await openSizingHost(page, kind);
    let frame = await host.mount();
    await settleFrames(page);
    let stats = await host.stats();
    expect(stats.metrics.some(item => item.innerWidth > item.appFrameWidth),
      'The proxy must reserve a real vertical scrollbar gutter for this regression').toBe(true);
    expect(stats.sizes.length).toBeGreaterThan(0);
    expect(stats.frameWidth, `Viewport widths must not be written back into the outer frame: ${JSON.stringify(stats.sizes)}`).toBe(615);
    expect(stats.sizes.every(size => size.width === undefined)).toBe(true);
    expect(await frame.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(580);
    await expectRendered(frame, kind);

    await host.resize(480);
    await settleFrames(page);
    stats = await host.stats();
    expect(stats.frameWidth).toBe(480);
    expect(await frame.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(445);
    await expectRendered(frame, kind);

    frame = await host.mount();
    await settleFrames(page);
    stats = await host.stats();
    expect(stats.frameWidth).toBe(480);
    expect(stats.sizes.every(size => size.width === undefined)).toBe(true);
    expect(await frame.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(445);
    await expectRendered(frame, kind);
    await host.assertHealthy();
  });
}
