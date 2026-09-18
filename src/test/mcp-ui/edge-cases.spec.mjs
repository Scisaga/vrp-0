import {test,expect,openHost,message,mapReady,fullscreen,AGENT} from './host-fixture.mjs';
import {contractCases} from './model-fixtures.mjs';
import {mapSdkFixture} from './map-sdk-fixture.mjs';
const vectors=contractCases();
function vector(name){const result=message();result._meta.gateway_ui.engine_view=structuredClone(vectors.find(item=>item.name===name).view);return result;}

test('partial replay includes only eligible engineers; missing references keep original visit numbers',async({page})=>{
  const host=await openHost(page);const partial=vector('partly-playable-engineers');
  const frame=await host.add({result:partial});await mapReady(frame);await fullscreen(frame);
  await expect(frame.locator('#playback-scope')).toHaveText('可播放排程: 1 / 2');
  await expect(frame.locator('#play')).toBeEnabled();
  const invalid=partial._meta.gateway_ui.engine_view.solver_job.plan.agents[1].id;
  await frame.locator('#engineer').selectOption(invalid);await expect(frame.locator('#play')).toBeDisabled();
  await expect(frame.locator('#side-detail')).toContainText('路线序列未知');
  const missing=await host.add({id:'missing',result:vector('missing-ticket-reference-keeps-sequence')});await mapReady(missing);
  await missing.locator('#engineer').selectOption(AGENT);
  const rows=missing.locator('#ordered-tickets .ticket-row');await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.number')).toHaveText('1');await expect(rows.nth(1).locator('.number')).toHaveText('2');
  await expect(rows.nth(0)).toContainText('引用对象缺失');await expect(rows.nth(1)).toContainText('ticket-a');await rows.nth(0).click();
  await expect(missing.locator('#inline-detail')).toContainText('引用对象缺失');await host.assertHealthy();
});

test('zero-duration services remain focusable and valid zero-distance legs stay stationary',async({page})=>{
  const host=await openHost(page);const frame=await host.add({result:vector('zero-service-duration')});await mapReady(frame);
  await frame.locator('#tab-gantt').click();const mark=frame.locator('.gantt-bar[data-phase="service"][data-zero="true"]');
  await expect(mark).toHaveCount(1);await mark.focus();await expect(mark).toBeFocused();await mark.press('Enter');
  await expect(frame.locator('#inline-detail')).toContainText('PT0S');
  const zero=await host.add({id:'zero',result:vector('zero-distance-stationary-leg')});await mapReady(zero);await fullscreen(zero);
  await expect(zero.locator('#play')).toBeEnabled();await zero.locator('#cursor').fill('10');
  expect(await zero.evaluate(()=>window.__mapStats.moves.at(-1).position)).toEqual([120,30]);await host.assertHealthy();
});

test('same-task refresh retains selection, viewport and replay cursor; Gantt scroll survives tab switches',async({page})=>{
  const host=await openHost(page);const frame=await host.add();await mapReady(frame);await fullscreen(frame);
  await frame.locator('#engineer').selectOption(AGENT);await frame.locator('#cursor').fill('500');
  const time=await frame.locator('#playback-time').textContent();
  await frame.evaluate(()=>window.__mapStats.maps.at(-1).setZoomAndCenter(15,[121,31]));
  await frame.locator('#refresh').click();await expect.poll(async()=>(await host.pending('card')).length).toBe(1);
  await host.respond('card',0,message());await expect(frame.locator('#refresh')).toBeEnabled();
  await expect(frame.locator('#engineer')).toHaveValue(AGENT);await expect(frame.locator('#playback-time')).toHaveText(time);
  expect(await frame.evaluate(()=>({center:window.__mapStats.maps.at(-1).getCenter(),zoom:window.__mapStats.maps.at(-1).getZoom()}))).toEqual({center:{lng:121,lat:31},zoom:15});
  await frame.locator('#tab-gantt').click();await frame.locator('#gantt-in').click();await frame.locator('#gantt-in').click();
  await frame.locator('#gantt-scroll').evaluate(element=>{element.scrollLeft=200;element.dispatchEvent(new Event('scroll'))});
  await frame.locator('#tab-map').click();await frame.locator('#tab-gantt').click();
  expect(await frame.locator('#gantt-scroll').evaluate(element=>element.scrollLeft)).toBe(200);
  await host.assertHealthy();
});

test('wall-clock labels are identical in distant browser timezones, including a DST gap',async({browser})=>{
  const texts=[];
  for(const timezoneId of ['America/New_York','Pacific/Auckland']){
    const context=await browser.newContext({timezoneId,serviceWorkers:'block'});
    try{
      const page=await context.newPage();const host=await openHost(page);const frame=await host.add({result:vector('business-clock-dst-gap-is-not-browser-time')});
      await mapReady(frame);await fullscreen(frame);await frame.locator('#cursor').fill('500');
      await frame.locator('#tab-gantt').click();texts.push(await frame.locator('#gantt-chart').textContent());await host.assertHealthy();
    }finally{await context.close();}
  }
  expect(texts[0]).toBe(texts[1]);expect(texts[0]).toContain('03-08');
});

test('network map failure has an explicit manual retry, never automatic polling',async({page})=>{
  const host=await openHost(page,{mapFailure:true});const frame=await host.add();
  await expect(frame.locator('#map-message')).toContainText('地图加载失败');await expect(frame.locator('#map-retry')).toBeVisible();
  await page.route('https://webapi.amap.com/**',route=>route.fulfill({contentType:'text/javascript',body:mapSdkFixture}));
  await frame.locator('#map-retry').click();await mapReady(frame);
  // Cross two event loop turns and a host round trip; nothing requests a tool until explicit refresh.
  await host.context('card',{theme:'dark'});await expect(frame.locator('html')).toHaveAttribute('data-theme','dark');
  expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
});

test('missing initial engineer does not fall back to another schedule and narrow panel closes with Escape',async({page})=>{
  const host=await openHost(page);const result=message();result._meta.gateway_ui.engineer_id='no-such-engineer';result._meta.gateway_ui.view='gantt';
  const missing=await host.add({id:'missing',result});await expect(missing.locator('#notice')).toContainText('指定工程师不存在');
  await expect(missing.locator('.gantt-bar')).toHaveCount(0);
  const frame=await host.add({id:'narrow',width:375,height:820,context:{displayMode:'fullscreen'}});await mapReady(frame);
  expect(await frame.evaluate(()=>{const filter=document.querySelector('.engineer-filter').getBoundingClientRect(),tabs=document.querySelector('.view-tabs').getBoundingClientRect();return filter.top>=tabs.bottom})).toBe(true);
  await frame.locator('#sidebar-toggle').click();await expect(frame.locator('#search')).toBeFocused();
  await frame.locator('#search').press('Escape');await expect(frame.locator('#sidebar')).toBeHidden();await expect(frame.locator('#sidebar-toggle')).toBeFocused();await host.assertHealthy();
});
