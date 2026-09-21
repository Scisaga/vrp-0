/** Opt-in live acceptance. Never imported by the offline test suite.
 * Uses a caller-provided local preview host + its private PAT config, real
 * Gateway read-only data and unmodified external SDK. Replaces ONLY the local
 * host's engine resource with this checkout's verified artifact and manifest.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readEnvelope } from '../../main/mcp-ui/bridge.mjs';

assert.equal(process.env.MCP_REAL_SDK, '1', 'Explicit MCP_REAL_SDK=1 is required for live network tests');
for (const name of ['MCP_PREVIEW_DIR','MCP_REAL_JOB_ID','MCP_DIAGNOSTIC_POLICY']) assert.ok(process.env[name], `${name} is required`);
const require = createRequire(new URL('../../main/resources/META-INF/resources/static/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const { buildMcpApp, readNetworkPolicy, outputFile } = require('./scripts/build-mcp-app.cjs');
const hostModule = file => import(pathToFileURL(path.resolve(process.env.MCP_PREVIEW_DIR, file)).href);
const { createPreviewServer } = await hostModule('server.mjs');
const { createGatewayClient } = await hostModule('transport.mjs');
const { readPreviewConfig } = await hostModule('config.mjs');
const cfg = await readPreviewConfig();
assert.ok(cfg.pat, 'Configured preview PAT is required');
const html = await readFile(outputFile, 'utf8');
assert.equal(html, (await buildMcpApp()).html, 'Build the current artifact before live acceptance');
const hash = value => createHash('sha256').update(value).digest('hex');
const policy = readNetworkPolicy();
const diagnostic = JSON.parse(await readFile(process.env.MCP_DIAGNOSTIC_POLICY, 'utf8'));
assert.equal(diagnostic.disableLegacyResize ?? false, false, 'Do not patch HTML in the diagnostic host');
for (const [key, domains] of [['extraResourceDomains',policy.resourceDomains],['extraConnectDomains',policy.connectDomains]]) {
  assert.ok((diagnostic[key] || []).every(domain => domains.includes(domain)), 'Diagnostics may not add undeclared origins');
}
assert.equal(diagnostic.allowEval, true); assert.equal(diagnostic.allowBlobWorkers, true);
const out = process.env.MCP_REAL_REPORT_DIR || '/tmp/vrp0-mcp-real-sdk';
await mkdir(out, {recursive:true, mode:0o700});
const report = {at:new Date().toISOString(), scope:'Local simulated host + real Gateway task + real AMAP; NOT desktop/client certification',
  artifact_sha256:hash(html), declared_csp:policy, checks:{}};
let key = '', server, browser, context, client;
const clean = value => String(value).replaceAll(cfg.pat,'[REDACTED]').replaceAll(key || '__NO_KEY__','[REDACTED]')
  .replace(/https?:\/\/[^\s"'<>]+/g, value => {try {const u = new URL(value); return u.origin+u.pathname;} catch {return '[URL]';}}).slice(0,600);
try {
  client = createGatewayClient({endpoint:cfg.endpoint,token:cfg.pat});
  await client.initialize(); const {tools} = await client.listTools();
  const job = process.env.MCP_REAL_JOB_ID;
  const detail = await client.callTool('gateway.solver_jobs.get_detail',{job_id:job});
  const tool = tools.find(item => item.name === detail._meta?.gateway_ui?.display_tool_name);
  assert.ok(tool, 'Task display tool must be available');
  const result = await client.callTool(tool.name,{job_id:job});
  assert.notEqual(result.isError, true); assert.equal(result._meta.gateway_ui.map_context.provider,'AMAP');
  const version = result._meta.gateway_ui.image_version_id;
  const ganttToolName = `gateway.ui.gantt_result_${version}`;
  const ganttTool = tools.find(item => item.name === ganttToolName);
  assert.ok(ganttTool, 'Version-bound Gantt display tool must be available');
  const ganttResult = await client.callTool(ganttToolName,{job_id:job});
  assert.notEqual(ganttResult.isError, true);
  const ganttEnvelope = readEnvelope(ganttResult, {
    viewKind:'gantt', expectedJobId:job, expectedVersionId:version, expectedToolName:ganttToolName,
  });
  assert.deepEqual(ganttEnvelope.map_context, {
    enabled:false, provider:result._meta.gateway_ui.task.map_provider,
    browser_key:'', js_url:'', css_url:null, locale:ganttEnvelope.map_context.locale,
  });
  report.gateway_gantt_empty_key_contract = true;
  key = result._meta.gateway_ui.map_context.browser_key;
  assert.ok(key, 'Use Gateway browser_key, never substitute a local key');
  const uri = tool._meta.ui.resourceUri;
  const resource = await client.readResource(uri);
  report.gateway_artifact_sha256 = hash(resource.contents.find(item => item.uri === uri).text);
  report.local_artifact_override = true;
  const cdp = execFileSync('agent-browser',['--session',process.env.MCP_BROWSER_SESSION || 'vrp0-map-check','get','cdp-url'],{encoding:'utf8'}).trim();
  browser = await chromium.connectOverCDP(cdp);
  for (const mode of ['strict','compatible']) {
    const data = report.checks[mode] = {host_execution_policy:mode==='strict'?'unchanged strict host':'diagnostic ONLY: unsafe-eval + blob Worker',
      page_errors:[], csp:[], failed_requests:[], requests:[], map_responses:[], workers:0, response_sha256:[], checks:{}};
    server = await createPreviewServer({endpoint:cfg.endpoint,getConfiguredPat:async()=>cfg.pat,
      clientFactory:options=>{
        const real = createGatewayClient(options);
        return {...real,readResource:async requested=>{
          const response = await real.readResource(requested);
          if(requested!==uri)return response;
          return {...response,contents:response.contents.map(content=>content.uri!==uri?content:{...content,text:html,
            _meta:{...content._meta,ui:{...content._meta?.ui,csp:policy}}})};
        }};
      }});
    if(mode==='compatible')server.prependListener('request',(req,res)=>{
      if(!req.url.startsWith('/frame/'))return;
      const set=res.setHeader.bind(res);
      res.setHeader=(name,value)=>set(name,String(name).toLowerCase()!=='content-security-policy'?value:
        String(value).replace("script-src 'unsafe-inline'", "script-src 'unsafe-inline' 'unsafe-eval'").replace("worker-src 'none'",'worker-src blob:'));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    context = await browser.newContext({viewport:{width:1400,height:2200},deviceScaleFactor:1});
    // Observational constructor wrapper. All SDK methods, network and drawing
    // remain real; no fixture responses, injected complete or synthetic tiles.
    await context.addInitScript(()=>{
      window.__liveMaps=[]; window.__liveCsp=[];
      document.addEventListener('securitypolicyviolation',e=>window.__liveCsp.push({directive:e.effectiveDirective,blocked:e.blockedURI,disposition:e.disposition}));
      let api; const wrappers=new WeakMap();
      Object.defineProperty(window,'AMap',{configurable:true,get:()=>api,set:value=>{
        api=new Proxy(value,{get(target,name,receiver){
          const member=Reflect.get(target,name,receiver);
          if(name!=='Map'||typeof member!=='function')return member;
          if(!wrappers.has(member))wrappers.set(member,new Proxy(member,{construct(target,args,newTarget){
            const map=Reflect.construct(target,args,newTarget);window.__liveMaps.push(map);return map;
          }}));
          return wrappers.get(member);
        }});
      }});
    });
    const page = await context.newPage(); await page.bringToFront();
    const pending=[];
    page.on('worker',()=>{data.workers++;});
    page.on('pageerror',error=>data.page_errors.push(clean(error.message)));
    // Context-level request events include dedicated Worker fetches.
    context.on('request',request=>{if(request.url().startsWith('https:'))data.requests.push(clean(request.url()));});
    context.on('requestfailed',request=>data.failed_requests.push({url:clean(request.url()),error:clean(request.failure()?.errorText)}));
    context.on('response',response=>{
      if(response.url().startsWith('https://vdata.amap.com/tiles')||response.url().startsWith('https://restapi.amap.com/v3/log/init'))
        data.map_responses.push({url:clean(response.url()),status:response.status()});
    });
    page.on('response',response=>{if(response.url().startsWith(origin+'/frame/'))pending.push(response.body().then(body=>data.response_sha256.push(hash(body))));});
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await expect(page.locator('#connection-status')).toHaveText('已连接',{timeout:30000});
    await page.locator('#tool').selectOption(tool.name); await page.locator('#task-id').fill(job); await page.locator('#view').selectOption('map');
    await page.locator('#open-app').click();
    await expect(page.locator('#flow [data-step="result"]')).toHaveAttribute('data-state','complete',{timeout:45000});
    const frame = page.frames().find(f=>f.url().startsWith(origin+'/frame/'));
    assert.ok(frame);
    await Promise.all(pending); assert.deepEqual(data.response_sha256,[report.artifact_sha256]);
    await expect.poll(()=>frame.locator('#fit-map').isEnabled().then(async ready=>ready||await frame.locator('#map-retry').isVisible()),{timeout:35000}).toBe(true);
    if(mode==='strict') {
      await expect(frame.locator('#map-state')).toBeVisible();
      data.checks.message = await frame.locator('#map-message').textContent();
      assert.match(data.checks.message,/安全策略|security policy/);
      await expect(frame.locator('#open-gantt')).toBeVisible();
      data.checks.gantt_handoff_available = true;
    } else {
      await expect(frame.locator('#map-state')).toBeHidden({timeout:30000});
      assert.ok(await frame.locator('.mcp-marker').count()>0); data.checks.real_map_ready=true;
      const size = () => frame.locator('#map-canvas').evaluate(el=>({width:el.clientWidth,height:el.clientHeight,
        objects:el.querySelectorAll('object').length,canvas:[...el.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight}))}));
      const sized = async name => {
        // First canvas is the real map renderer in this SDK. Do not let an
        // offscreen tile/overlay of a coincidental size satisfy this check.
        await expect.poll(async()=>{const s=await size();return s.width>0&&s.height>0&&s.objects===0&&s.canvas.length>0&&s.canvas[0].cssWidth===s.width&&s.canvas[0].cssHeight===s.height&&s.canvas[0].width===s.width&&s.canvas[0].height===s.height;},{timeout:10000}).toBe(true);
        data.checks[name]=await size();
      };
      const viewport=()=>frame.evaluate(()=>{const m=window.__liveMaps.at(-1),c=m.getCenter();return {center:[c.getLng(),c.getLat()],zoom:m.getZoom(),instances:window.__liveMaps.length};});
      await sized('inline_size');
      const initialViewport = await viewport();
      await frame.locator('#fullscreen').click(); await expect(page.locator('#display-mode')).toHaveValue('fullscreen');
      await sized('fullscreen_size'); assert.deepEqual(await viewport(),initialViewport);
      await frame.locator('#cursor').fill('450');
      const time=await frame.locator('#playback-time').textContent();
      const markers=()=>frame.locator('.mcp-marker[data-kind="agent"]').evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y];}));
      await frame.locator('#speed').selectOption('300'); await frame.locator('#play').click();
      await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','true');
      await expect.poll(()=>frame.locator('#playback-time').textContent()).not.toBe(time);
      const before=await markers(); await expect.poll(()=>markers()).not.toEqual(before);
      await frame.locator('#play').click();data.checks.playback_time_and_marker_movement=true;
      const selected=await frame.locator('#engineer option').evaluateAll(options=>options.find(o=>o.value)?.value);
      assert.ok(selected); await frame.locator('#engineer').selectOption(selected);
      await expect(frame.locator('.mcp-marker[data-kind="agent"]')).toHaveCount(1);
      await expect(frame.locator('#play')).toBeEnabled();
      await frame.locator('#cursor').fill('450');
      const cursor=await frame.locator('#cursor').inputValue(), selectedViewport=await viewport();
      // Actual iframe/container resize, without changing display mode.
      await page.setViewportSize({width:1200,height:1800}); await sized('container_resize');
      assert.deepEqual(await viewport(),selectedViewport);assert.equal(await frame.locator('#cursor').inputValue(),cursor);
      await frame.locator('#fullscreen').click(); await expect(page.locator('#display-mode')).toHaveValue('inline');
      await sized('exit_fullscreen_size');
      assert.deepEqual(await viewport(),selectedViewport);assert.equal(await frame.locator('#engineer').inputValue(),selected);
      assert.equal(await frame.locator('#cursor').inputValue(),cursor);
      await frame.locator('#fullscreen').click();await expect(page.locator('#display-mode')).toHaveValue('fullscreen');
      await sized('reenter_fullscreen_size'); await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','false');
      assert.equal(await frame.locator('#cursor').inputValue(),cursor);
      await expect(frame.locator('#refresh')).toBeHidden();await frame.locator('#refresh').evaluate(el=>el.click());await expect(frame.locator('#map-state')).toBeHidden();
      assert.equal(await frame.locator('#engineer').inputValue(),selected);assert.equal(await frame.locator('#cursor').inputValue(),cursor);
      await frame.locator('#engineer').selectOption('');await frame.locator('#cursor').fill('990');await frame.locator('#play').click();
      await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','false',{timeout:10000});assert.equal(await frame.locator('#cursor').inputValue(),'1000');
      data.checks.selection_viewport_cursor_retained=true; data.checks.refresh_and_auto_stop=true;
      assert.ok(data.requests.some(url=>url.startsWith('https://vdata.amap.com/tiles')),'Observe real Worker tile requests');
      assert.ok(data.requests.some(url=>url.startsWith('https://restapi.amap.com/v3/log/init')),'Observe real SDK initialization');
      assert.ok(data.requests.some(url=>url.startsWith('https://webapi.amap.com/maps/modules')),'Observe real SDK module loading');
      assert.ok(data.workers>0,'Observe a real map Worker');
      assert.ok(data.map_responses.some(r=>r.url.startsWith('https://vdata.amap.com/tiles')&&r.status===200),'Observe a successful tile response');
      assert.ok(data.map_responses.some(r=>r.url.startsWith('https://restapi.amap.com/v3/log/init')&&r.status===200),'Observe successful SDK initialization');
      assert.deepEqual(data.failed_requests,[]);
      assert.deepEqual(data.page_errors,[]);
      await frame.locator('#app').screenshot({path:path.join(out,`${mode}.png`)});
    }
    data.csp=(await frame.evaluate(()=>window.__liveCsp)).map(event=>({...event,blocked:clean(event.blocked)}));
    if(mode==='compatible')assert.deepEqual(data.csp.filter(e=>e.disposition!=='report'),[]);
    await page.locator('#close-app').click();await expect(page.locator('#frame-container iframe')).toHaveCount(0);data.checks.teardown=true;
    data.requests=[...new Set(data.requests)];
    data.map_responses=[...new Map(data.map_responses.map(r=>[JSON.stringify(r),r])).values()];
    await context.close();context=null;
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=null;
  }
  report.passed=true;
} catch(error) {
  report.passed=false; report.failure=clean(error.message);process.exitCode=1;
} finally {
  await context?.close();await browser?.close();client?.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({passed:report.passed,artifact_sha256:report.artifact_sha256,report:path.join(out,'report.json'),failure:report.failure}));
}
