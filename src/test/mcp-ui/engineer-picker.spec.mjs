import { test, expect, openHost, mapReady, fullscreen, chooseEngineer, message, AGENT } from './host-fixture.mjs';
import { withSnapshot } from './snapshot-fixture.mjs';

function pickerResult() {
  const result=message(),plan=result._meta.gateway_ui.engine_view.solver_job.plan,original=structuredClone(plan.agents[0]);
  const names=['James Carter','James Carter','Aisha Rahman','Oliver Hughes','Priya Shah','Daniel Okafor','Emily Clarke','Nadia Hussain'];
  plan.agents=names.map((name,index)=>{
    const agent={...structuredClone(original),id:index?`picker-engineer-${index}`:AGENT,name};
    if(index){agent.tickets=[];agent.routes=[];}
    if(index===1){agent.date='2026-09-18';for(const key of['shift_start_time','shift_off_time','tickets_done_time'])if(agent[key])agent[key]=agent[key].replace(original.date,agent.date);}
    return agent;
  });
  return withSnapshot(result);
}
const option=(frame,id)=>frame.locator(`#engineer-options [role=option][data-engineer-id=${JSON.stringify(id)}]`);
const height=frame=>frame.locator('#app').evaluate(el=>el.getBoundingClientRect().height);

test('picker merges route colors, complete names and business dates without a bottom legend or extra requests',async({page})=>{
  const result=pickerResult(),host=await openHost(page),frame=await host.add({result,width:672,autoSize:true});await mapReady(frame);
  const control=frame.locator('#engineer'),panel=frame.locator('#engineer-options');
  await expect(control).toHaveAccessibleName('工程师');await expect(control).toContainText('全部工程师 · 8');
  await expect(frame.locator('#map-legend')).toHaveCount(0);
  await control.click();await expect(panel).toBeVisible();await expect(panel.locator('[role=option]')).toHaveCount(9);
  await expect(option(frame,AGENT)).toHaveAccessibleName('James Carter · 2026-09-17');
  await expect(option(frame,'picker-engineer-1')).toHaveAccessibleName('James Carter · 2026-09-18');
  const dot=await option(frame,AGENT).locator('.swatch').evaluate(el=>getComputedStyle(el).backgroundColor);
  expect(await frame.locator('.snapshot-route-shape').first().evaluate(el=>getComputedStyle(el).stroke)).toBe(dot);
  await option(frame,'picker-engineer-1').click();await expect(panel).toBeHidden();await expect(control).toContainText('James Carter · 2026-09-18');
  await expect(control).toBeFocused();expect(await control.locator('.swatch').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await option(frame,'picker-engineer-1').locator('.swatch').evaluate(el=>getComputedStyle(el).backgroundColor));
  await chooseEngineer(frame,'');await expect(control).toContainText('全部工程师 · 8');
  expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
});

for(const width of[320,672,920])for(const locale of['zh-CN','en-US'])test(`${width}px ${locale} picker stays inside inline and fullscreen without changing content height`,async({page})=>{
  const host=await openHost(page),frame=await host.add({result:pickerResult(),width,height:900,autoSize:true,context:{locale,theme:locale==='en-US'?'dark':'light'}});await mapReady(frame);
  for(const mode of['inline','fullscreen']){
    if(mode==='fullscreen')await fullscreen(frame);
    const before=await height(frame);await frame.locator('#engineer').click();await expect(frame.locator('#engineer-options')).toBeVisible();
    const bounds=await frame.locator('#engineer-options').evaluate(el=>{
      const rect=el.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:document.documentElement.clientWidth,height:innerHeight,columns:el.dataset.columns,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    expect(bounds.top).toBeGreaterThanOrEqual(0);expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
    expect(bounds.columns).toBe(width===320?'1':'2');expect(bounds.overflow).toBe(false);expect(await height(frame)).toBe(before);
    await frame.locator('#engineer').press('End');
    const active=await frame.locator('#engineer').getAttribute('aria-activedescendant');
    const visibility=await frame.locator(`#${active}`).evaluate(el=>{const rect=el.getBoundingClientRect(),outer=el.parentElement.getBoundingClientRect();return rect.bottom<=outer.bottom&&rect.top>=outer.top;});
    expect(visibility).toBe(true);
    await frame.locator('#engineer').press('Escape');await expect(frame.locator('#engineer-options')).toBeHidden();
  }
  await host.assertHealthy();
});

test('keyboard navigation previews, cancels, commits, searches by name and continues with Tab',async({page})=>{
  const host=await openHost(page),frame=await host.add({result:pickerResult(),width:672,autoSize:true});await mapReady(frame);
  const control=frame.locator('#engineer'),panel=frame.locator('#engineer-options');
  await control.press('ArrowDown');await expect(panel).toBeVisible();await control.press('End');
  await expect(control).toHaveJSProperty('value','');await control.press('Escape');await expect(panel).toBeHidden();await expect(control).toHaveJSProperty('value','');
  await control.press('Home');await control.press('PageDown');await control.press('Enter');
  await expect(control).toContainText('Nadia Hussain');await expect(control).toBeFocused();
  await control.press('Home');await control.press(' ');await expect(control).toHaveJSProperty('value','');
  await control.press('n');await control.press('Enter');await expect(control).toContainText('Nadia Hussain');
  await control.press('ArrowDown');await control.press('Home');await control.press('Tab');
  await expect(control).toHaveJSProperty('value','');await expect(panel).toBeHidden();await expect(frame.locator('#fit-map')).toBeFocused();
  expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
});

test('outside clicks, mode changes and hidden pages close the popup while preserving the filter',async({page})=>{
  const host=await openHost(page),frame=await host.add({result:pickerResult(),width:672,autoSize:true});await mapReady(frame);
  const control=frame.locator('#engineer'),panel=frame.locator('#engineer-options');
  await control.click();await control.press('End');await frame.locator('#fit-map').click();await expect(panel).toBeHidden();await expect(control).toHaveJSProperty('value','');
  await control.click();await page.locator('body').click({position:{x:1100,y:10}});await expect(panel).toBeHidden();
  await control.click();await fullscreen(frame);await expect(panel).toBeHidden();
  await control.click();await frame.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(panel).toBeHidden();await expect(control).toHaveJSProperty('value','');await host.assertHealthy();
});

test('long and malicious labels remain complete text and virtual/unknown options retain their existing scope',async({page})=>{
  const result=pickerResult(),agents=result._meta.gateway_ui.engine_view.solver_job.plan.agents;
  agents[1].name='<img src="https://evil.invalid/x" onerror="window.__xss=true"> 长姓名';agents[6].virtual=null;agents[7].virtual=true;
  const host=await openHost(page),frame=await host.add({result:withSnapshot(result),width:320,autoSize:true});await mapReady(frame);
  await frame.locator('#engineer').click();await expect(frame.locator('#engineer-options [role=option]')).toHaveCount(9);
  await expect(option(frame,agents[1].id)).toContainText(agents[1].name);await expect(option(frame,agents[6].id)).toContainText(agents[6].name);await expect(option(frame,agents[7].id)).toContainText(agents[7].name);
  await option(frame,agents[1].id).click();await expect(frame.locator('#engineer')).toContainText(agents[1].name);
  await expect(frame.locator('img')).toHaveCount(0);expect(await frame.evaluate(()=>window.__xss===true)).toBe(false);
  expect(await frame.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);await host.assertHealthy();
});

test('open options follow result and language updates, then clear on authorization failure',async({page})=>{
  const result=pickerResult(),host=await openHost(page),frame=await host.add({result,width:672,autoSize:true});await mapReady(frame);
  await frame.locator('#engineer').click();await host.context('card',{locale:'en-US',theme:'dark'});
  await expect(frame.locator('#engineer-options')).toBeVisible();await expect(option(frame,'')).toContainText('All engineers · 8');
  const updated=structuredClone(result);updated._meta.gateway_ui.engine_view.solver_job.plan.agents[1].name='Updated engineer';
  await host.result('card',updated);await expect(option(frame,'picker-engineer-1')).toContainText('Updated engineer');
  await expect(frame.locator('#engineer-options')).toBeVisible();
  await host.result('card',message('forbidden'));
  await expect(frame.locator('#engineer-options')).toBeHidden();await expect(frame.locator('#engineer-options [role=option]')).toHaveCount(0);
  await expect(frame.locator('#engineer')).toBeDisabled();await expect(frame.locator('#map-warnings')).toBeHidden();await expect(frame.locator('.snapshot-svg')).toHaveCount(0);
  await host.assertHealthy();
});

test('map warnings survive the legend removal and teardown stays local to its own card',async({page})=>{
  const result=pickerResult();result._meta.gateway_ui.engine_view.solver_job.plan.agents[0].routes[0].route_source='ESTIMATED';
  const host=await openHost(page),a=await host.add({id:'a',result:withSnapshot(result)}),b=await host.add({id:'b',result:pickerResult()});await mapReady(a);await mapReady(b);
  await expect(a.locator('#map-warnings')).toContainText('估算');await expect(a.locator('#map-legend')).toHaveCount(0);
  await a.locator('#engineer').click();await b.locator('#engineer').click();
  await expect(b.locator('#engineer-options')).toBeVisible();
  await page.evaluate(()=>window.host.request('a','ui/resource-teardown',{}));await expect(a.locator('#engineer,#engineer-options,#map-warnings')).toHaveCount(0);
  await expect(b.locator('#engineer-options')).toBeVisible();await page.locator('#b').scrollIntoViewIfNeeded();await chooseEngineer(b,'picker-engineer-7');await expect(b.locator('#engineer')).toContainText('Nadia Hussain');
  await host.assertHealthy();
});
