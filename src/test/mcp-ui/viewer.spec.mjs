import { test,expect,openHost,message,mapReady,fullscreen,AGENT } from './host-fixture.mjs';
import { largeView,contractCases } from './model-fixtures.mjs';
import { mapSdkFixture } from './map-sdk-fixture.mjs';

test('AMAP map, ordered visits, Gantt and sidebar share selection',async({page})=>{
  const host=await openHost(page);const frame=await host.add();await mapReady(frame);
  await frame.locator('#engineer').selectOption(AGENT);
  const ordered=frame.locator('#ordered-tickets .ticket-row');await expect(ordered).toHaveCount(2);
  await expect(ordered.nth(0)).toContainText('ticket-b');await expect(ordered.nth(1)).toContainText('ticket-a');
  await ordered.nth(0).click();await expect(frame.locator('#inline-detail')).toContainText('ticket-b');
  await frame.locator('#tab-gantt').click();const bars=frame.locator('.gantt-bar[data-phase="service"]');await expect(bars).toHaveCount(2);
  await bars.nth(1).click();await expect(frame.locator('#inline-detail')).toContainText('ticket-a');
  await fullscreen(frame);await expect(frame.locator('#side-detail')).toContainText('ticket-a');
  await frame.locator('#side-tickets').click();await expect(frame.locator('#side-list .ticket-row')).toHaveCount(2);
  await frame.locator('#search').fill('ticket-b');await expect(frame.locator('#side-list .ticket-row')).toHaveCount(1);
  await frame.locator('#side-list .ticket-row').click();await expect(frame.locator('#side-detail')).toContainText('ticket-b');
  await frame.locator('#tab-map').click();await mapReady(frame);
  await expect(frame.locator('.mcp-marker[data-kind="ticket"][data-selected="true"]')).toHaveAttribute('aria-label',/ticket-b/);
  const fits=await frame.evaluate(()=>window.__mapStats.fits);await frame.locator('#fit-map').click();expect(await frame.evaluate(()=>window.__mapStats.fits)).toBeGreaterThan(fits);
  await host.assertHealthy();
});

test('HERE uses declared scripts, cloned marker events and supplied geometry only',async({page})=>{
  const result=message(),data=result._meta.gateway_ui;data.task.map_provider='HERE';Object.assign(data.map_context,{provider:'HERE',js_url:'https://js.api.here.com/v3/3.1/mapsjs-core.js'});
  const host=await openHost(page);const frame=await host.add({result});await mapReady(frame);
  expect(host.requests.filter(url=>url.startsWith('https://js.api.here.com/')).map(url=>new URL(url).pathname)).toEqual(['/v3/3.1/mapsjs-core.js','/v3/3.1/mapsjs-service.js','/v3/3.1/mapsjs-mapevents.js']);
  await frame.locator('.mcp-marker[data-kind="ticket"]').first().click();await expect(frame.locator('#engineer')).toHaveValue(AGENT);
  await expect(frame.locator('#inline-detail')).toContainText('ticket-b');
  const path=await frame.evaluate(()=>window.__mapStats.lines[0].path);expect(path).toEqual([[120,30],[120.005,30.005],[120.01,30.01]]);
  await fullscreen(frame);await expect(frame.locator('#play')).toBeEnabled();await host.assertHealthy();
});

test('planned playback ends at the last departure, seeks and pauses on tab/fullscreen/visibility changes',async({page})=>{
  const host=await openHost(page);const frame=await host.add();await mapReady(frame);await fullscreen(frame);
  await expect(frame.locator('#play')).toBeEnabled();await expect(frame.locator('#playback-time')).toHaveText('2026-09-17 08:00:00');
  await frame.locator('#cursor').fill('1000');await expect(frame.locator('#playback-time')).toHaveText('2026-09-17 09:25:00');
  await expect(frame.locator('#playback-states')).toContainText('计划完成');
  expect((await frame.evaluate(()=>window.__mapStats.moves.at(-1))).position).toEqual([120.02,30.02]);
  await frame.locator('#cursor').fill('0');
  const beforePlay=await frame.evaluate(()=>({maps:window.__mapStats.maps.length,lines:window.__mapStats.lines.length,moves:window.__mapStats.moves.length}));
  await frame.locator('#play').click();await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>frame.evaluate(()=>window.__mapStats.moves.length)).toBeGreaterThan(beforePlay.moves);
  expect(await frame.evaluate(()=>({maps:window.__mapStats.maps.length,lines:window.__mapStats.lines.length}))).toEqual({maps:beforePlay.maps,lines:beforePlay.lines});
  await frame.locator('#tab-gantt').click();await frame.locator('#tab-map').click();await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','false');
  await frame.locator('#play').click();await host.context('card',{displayMode:'inline'});await expect(frame.locator('#app')).toHaveAttribute('data-mode','inline');
  await fullscreen(frame);await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','false');
  await frame.locator('#play').click();
  await frame.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
  await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','false');await host.assertHealthy();
});

test('map network failure and CSP refusal preserve useful Gantt/detail fallback',async({page})=>{
  const host=await openHost(page,{mapCsp:true});const frame=await host.add();
  await expect(frame.locator('#map-message')).toContainText(/安全策略|地图加载失败/);
  await frame.locator('#tab-gantt').click();await expect(frame.locator('.gantt-bar[data-phase="service"]')).toHaveCount(2);
  await frame.locator('.gantt-bar[data-phase="service"]').first().click();await expect(frame.locator('#inline-detail')).toContainText('ticket-b');
  await fullscreen(frame);await frame.locator('#tab-map').click();await expect(frame.locator('#play')).toBeDisabled();
  expect(await frame.evaluate(()=>window.__violations.some(item=>item.blocked.startsWith('https://webapi.amap.com')))).toBe(true);
  expect(host.requests.some(url=>url.startsWith('https:'))).toBe(false);await host.assertHealthy();
});

test('dark English narrow layout remains keyboard accessible without horizontal page overflow',async({page})=>{
  const host=await openHost(page);const frame=await host.add({width:375,height:820,context:{locale:'en-US',theme:'dark',displayMode:'fullscreen',styles:{variables:{'--color-background-primary':'rgb(12, 22, 32)'}}}});await mapReady(frame);
  await expect(frame.locator('html')).toHaveAttribute('lang','en-US');await expect(frame.locator('html')).toHaveAttribute('data-theme','dark');
  expect(await frame.locator('body').evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgb(12, 22, 32)');
  await expect(frame.locator('#sidebar')).toBeHidden();await frame.locator('#sidebar-toggle').click();await expect(frame.locator('#sidebar')).toBeVisible();
  await frame.locator('#side-agents').focus();await frame.locator('#side-agents').press('ArrowRight');await expect(frame.locator('#side-tickets')).toBeFocused();
  await expect(frame.locator('#side-tickets')).toHaveAttribute('aria-selected','true');await frame.locator('#sidebar-toggle').click();
  await frame.locator('#tab-map').focus();await frame.locator('#tab-map').press('ArrowRight');await expect(frame.locator('#tab-gantt')).toBeFocused();
  await expect(frame.locator('#tab-gantt')).toHaveAttribute('aria-selected','true');
  expect(await frame.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await host.context('card',{locale:'zh-CN',theme:'light'});await expect(frame.locator('#refresh')).toHaveText('刷新');await host.assertHealthy();
});

test('all public labels are text, not executable HTML or navigation',async({page})=>{
  const result=message(),job=result._meta.gateway_ui.engine_view.solver_job;
  const attack='<img src="https://evil.invalid/steal" onerror="window.__xss=true"><script>window.__xss=true</script>';
  job.name=attack;job.plan.agents[0].name=attack;job.plan.pois[1].name=attack;job.plan.pois[1].address=attack;
  const host=await openHost(page);const frame=await host.add({result});await mapReady(frame);
  await expect(frame.locator('#task-title')).toHaveText(attack);await frame.locator('.mcp-marker[data-kind="ticket"]').first().click();
  await expect(frame.locator('#inline-detail')).toContainText(attack);
  expect(await frame.locator('img,a').count()).toBe(0);expect(await frame.evaluate(()=>window.__xss===true)).toBe(false);
  await host.assertHealthy();
});

test('empty, unavailable and unknown collections remain distinct without fabricated counts',async({page})=>{
  const host=await openHost(page);
  const empty=await host.add({id:'empty',result:message('ready-empty')});await expect(empty.locator('#summary')).toContainText('工程师排程数0');
  const running=await host.add({id:'running',result:message('running-no-model')});await expect(running.locator('#map-message')).toContainText('任务尚无可展示模型');await expect(running.locator('#summary')).toContainText('未知');
  const unknown=message();unknown._meta.gateway_ui.engine_view.solver_job.plan.agents=null;
  const partial=await host.add({id:'unknown',result:unknown});await expect(partial.locator('#summary')).toContainText('工程师排程数未知');
  await host.assertHealthy();
});

test('Gateway non-ready and terminal states display explicit labels without fabricating models',async({page})=>{
  const host=await openHost(page);const frame=await host.add({initial:false});
  for(const [name,label]of [['running-no-model','任务执行中'],['not-ready','尚无结果'],['failed','任务失败'],['canceled','任务已取消'],['timed_out','任务已超时'],['archive_failed','归档失败']]){
    await host.result('card',message(name));await expect(frame.locator('#map-message')).toContainText(label);
    await expect(frame.locator('#summary')).toContainText('工程师排程数未知');await expect(frame.locator('.mcp-marker')).toHaveCount(0);
    await expect(frame.locator('#refresh')).toBeEnabled();
  }
  expect(host.requests.some(url=>url.startsWith('https:'))).toBe(false);await host.assertHealthy();
});

test('golden estimated/missing-route schedules stay listed and never claim playable road replay',async({page})=>{
  const candidates=contractCases().filter(item=>item.view&&Object.values(item.requiredReasons).some(reasons=>reasons.includes('unsupported_route_source')));
  expect(candidates.length).toBeGreaterThan(0);const vector=candidates[0];const result=message();result._meta.gateway_ui.engine_view=vector.view;
  const host=await openHost(page);const frame=await host.add({result});await fullscreen(frame);
  await expect(frame.locator('#play')).toBeDisabled();await expect(frame.locator('#side-list')).toContainText('路线来源不可用于道路回放');
  await frame.locator('#tab-gantt').click();await expect(frame.locator('.gantt-bar[data-phase="service"]')).toHaveCount(2);await host.assertHealthy();
});

test('stress fixture retains all 200 schedules, 1000 tickets and 4097-point geometry',async({page})=>{
  test.setTimeout(60000);const large=largeView();const result=message();result._meta.gateway_ui.engine_view=large.view;
  const host=await openHost(page);const frame=await host.add({result});await mapReady(frame);
  await expect(frame.locator('#engineer option')).toHaveCount(201);
  const lengths=await frame.evaluate(()=>window.__mapStats.lines.map(line=>line.path.length));expect(lengths[0]).toBe(4097);
  await fullscreen(frame);await frame.locator('#side-tickets').click();await expect(frame.locator('#side-list .ticket-row')).toHaveCount(1000);
  await frame.locator('#tab-gantt').click();await expect(frame.locator('.gantt-row')).toHaveCount(200);await expect(frame.locator('.gantt-bar[data-phase="service"]')).toHaveCount(1000);
  await host.assertHealthy();
});

test('HERE style failure stops playback, disposes listeners and retains result details',async({page})=>{
  const result=message(),data=result._meta.gateway_ui;data.task.map_provider='HERE';Object.assign(data.map_context,{provider:'HERE',js_url:'https://js.api.here.com/v3/3.1/mapsjs-core.js'});
  const host=await openHost(page);const frame=await host.add({result});await mapReady(frame);await fullscreen(frame);await frame.locator('#play').click();
  await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','true');
  await frame.evaluate(()=>window.__mapStats.style.emit('error'));
  await expect(frame.locator('#map-message')).toContainText('地图加载失败');await expect(frame.locator('#play')).toBeDisabled();await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','false');
  expect(await frame.evaluate(()=>[...window.__mapStats.style.listeners.values()].reduce((sum,list)=>sum+list.size,0))).toBe(0);
  expect(await frame.evaluate(()=>window.__mapStats.destroyed)).toBe(1);
  await frame.locator('#tab-gantt').click();await expect(frame.locator('.gantt-bar[data-phase="service"]')).toHaveCount(2);await host.assertHealthy();
});

test('AMAP missing complete event times out without guessing authentication failure',async({page})=>{
  await page.clock.install();const host=await openHost(page);await page.addInitScript(()=>{window.__disableMapComplete=true});const frame=await host.add();
  await expect.poll(()=>frame.evaluate(()=>Boolean(window.__mapStats?.maps.length))).toBe(true);
  await expect(frame.locator('#map-message')).toContainText('正在加载地图');await page.clock.fastForward(21000);
  await expect(frame.locator('#map-message')).toContainText('地图加载超时');expect(await frame.locator('#map-message').textContent()).not.toContain('认证');
  expect(await frame.evaluate(()=>window.__mapStats.maps[0].listeners.get('complete').size)).toBe(0);
  expect(await frame.evaluate(()=>window.__mapStats.destroyed)).toBe(1);await host.assertHealthy();
});

test('a map script completing after refresh renders the newest scene, not captured old data',async({page})=>{
  const host=await openHost(page);let held;
  await page.route('https://webapi.amap.com/**',route=>{held=route});
  const frame=await host.add();await expect.poll(()=>Boolean(held)).toBe(true);
  await frame.locator('#refresh').click();await expect.poll(async()=>(await host.pending('card')).length).toBe(1);
  const latest=message();latest._meta.gateway_ui.engine_view.solver_job.plan.agents[0].name='加载中更新后的工程师';await host.respond('card',0,latest);
  await expect(frame.locator('#engineer')).toContainText('加载中更新后的工程师');
  await held.fulfill({contentType:'text/javascript',body:mapSdkFixture});await mapReady(frame);
  await expect(frame.locator('.mcp-marker[data-kind="agent"]')).toHaveText('加载中更新后的工程师');await host.assertHealthy();
});

for(const provider of ['AMAP','HERE'])test(`${provider} resizes its drawing buffer while retaining viewport, selection and replay cursor`,async({page})=>{
  const result=message();if(provider==='HERE'){
    result._meta.gateway_ui.task.map_provider='HERE';Object.assign(result._meta.gateway_ui.map_context,{provider,js_url:'https://js.api.here.com/v3/3.2/mapsjs-core.js'});
  }
  const host=await openHost(page),frame=await host.add({result});await mapReady(frame);
  const sized=async()=>{
    await expect.poll(()=>frame.locator('#map-canvas').evaluate(el=>{const c=el.querySelector('canvas');return c?.width===el.clientWidth&&c?.height===el.clientHeight;})).toBe(true);
  };
  await sized();await expect(frame.locator('#map-canvas object')).toHaveCount(0);
  if(provider==='AMAP')expect(await frame.evaluate(()=>window.__mapStats.sensorInserted)).toBe(false);
  await fullscreen(frame);await sized();await frame.locator('#engineer').selectOption(AGENT);await frame.locator('#cursor').fill('450');
  await frame.evaluate(()=>window.__mapStats.maps[0].setZoomAndCenter(15,[121,31]));
  const time=await frame.locator('#playback-time').textContent();
  const viewport=()=>frame.evaluate(()=>({center:window.__mapStats.maps[0].getCenter(),zoom:window.__mapStats.maps[0].getZoom(),maps:window.__mapStats.maps.length}));
  const before=await viewport();
  await page.evaluate(()=>{const f=window.host.cards.get('card').frame;f.style.width='900px';f.style.height='950px'});await sized();expect(await viewport()).toEqual(before);
  await frame.locator('#fullscreen').click();await expect(frame.locator('#app')).toHaveAttribute('data-mode','inline');await sized();
  expect(await frame.locator('#engineer').inputValue()).toBe(AGENT);expect(await frame.locator('#playback-time').textContent()).toBe(time);
  await fullscreen(frame);await sized();await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','false');expect(await viewport()).toEqual(before);
  await frame.locator('#tab-gantt').click();await frame.locator('#tab-map').click();await sized();
  expect(await frame.locator('#playback-time').textContent()).toBe(time);expect(await viewport()).toEqual(before);await host.assertHealthy();
});

test('a caught eval inside the map SDK is reported as CSP blocked, never silently ignored',async({page})=>{
  const host=await openHost(page);
  await page.route('https://webapi.amap.com/**',route=>route.fulfill({contentType:'text/javascript',body:mapSdkFixture+';try{new Function("return 1")}catch{}'}));
  const frame=await host.add();await expect(frame.locator('#map-message')).toContainText('安全策略');
  await expect(frame.locator('#map-retry')).toBeVisible();await expect(frame.locator('#fit-map')).toBeDisabled();
  expect(await frame.evaluate(()=>window.__violations.some(e=>e.blocked==='eval'))).toBe(true);
  await frame.locator('#tab-gantt').click();await expect(frame.locator('.gantt-row').first()).toBeVisible();
});

test('map configuration and unknown loading failures have distinct non-speculative messages',async({page})=>{
  const host=await openHost(page,{mapFailure:true}),result=message();result._meta.gateway_ui.map_context.js_url='https://webapi.amap.com/unsupported';
  const invalid=await host.add({id:'invalid',result});await expect(invalid.locator('#map-message')).toContainText('地图配置缺失或不合法');
  const failed=await host.add({id:'failed'});await expect(failed.locator('#map-message')).toContainText('原因尚未确定');
  expect(await failed.locator('#map-message').textContent()).not.toMatch(/网络|Key|密钥/);
  await host.assertHealthy();
});
