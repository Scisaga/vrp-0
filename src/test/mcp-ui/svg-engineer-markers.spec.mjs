import {test,expect,openHost,message,mapReady,fullscreen,chooseEngineer,AGENT} from './host-fixture.mjs';
import {withSnapshot} from './snapshot-fixture.mjs';

const origins=frame=>frame.locator('.snapshot-engineer:not(.snapshot-playback)');
const cluster=frame=>frame.locator('.snapshot-engineer-cluster[display="inline"]');
const popup=frame=>frame.locator('.snapshot-engineer-popup');
function sharedResult(count=3){
  const result=message(),plan=result._meta.gateway_ui.engine_view.solver_job.plan;
  plan.agents[0].name='Nadia Hussain';
  for(let index=1;index<count;index++)plan.agents.push({...structuredClone(plan.agents[0]),id:`shared-engineer-${index}`,name:index===1?'Aisha Rahman':`Oliver Hughes ${index}`,date:`2026-09-${String(16+index%10).padStart(2,'0')}`,tickets:[],routes:[]});
  return withSnapshot(result,{density:1.5});
}
async function expectSize(marker,diameter=22,point=null){
  const data=await marker.evaluate((node,point)=>{
    const face=node.querySelector('.snapshot-engineer-face'),hit=node.querySelector('.snapshot-engineer-hit'),rect=face.getBoundingClientRect(),matrix=face.getScreenCTM();
    const scale=Math.hypot(matrix.a,matrix.b),stroke=parseFloat(getComputedStyle(face).strokeWidth)*scale;
    if(!point){const [x,y]=node.getAttribute('transform').match(/translate\(([^)]+)\)/)[1].split(/[ ,]+/).map(Number);point={x,y};}
    const center=new DOMPoint(point.x,point.y).matrixTransform(node.ownerSVGElement.getScreenCTM());
    return {width:rect.width+stroke,height:rect.height+stroke,stroke,hit:hit.getBoundingClientRect().width,dx:rect.x+rect.width/2-center.x,dy:rect.y+rect.height/2-center.y,color:face.getAttribute('fill')};
  },point);
  expect(data.width).toBeCloseTo(diameter,1);expect(data.height).toBeCloseTo(diameter,1);expect(data.stroke).toBeCloseTo(1.5,2);expect(data.hit).toBeCloseTo(32,1);
  expect(Math.abs(data.dx)).toBeLessThan(.05);expect(Math.abs(data.dy)).toBeLessThan(.05);return data;
}
async function expectBounded(frame,selector){
  const data=await frame.locator(selector).evaluate(node=>{
    const r=node.getBoundingClientRect(),f=node.closest('.snapshot-frame').getBoundingClientRect();
    return {left:r.left-f.left,right:r.right-f.right,top:r.top-f.top,bottom:r.bottom-f.bottom,scroll:node.scrollWidth-node.clientWidth};
  });
  expect(data.left).toBeGreaterThanOrEqual(0);expect(data.right).toBeLessThanOrEqual(0);expect(data.top).toBeGreaterThanOrEqual(0);expect(data.bottom).toBeLessThanOrEqual(0);expect(data.scroll).toBeLessThanOrEqual(1);
}

for(const dpr of [1,2])test.describe(`engineer markers DPR ${dpr}`,()=>{
  test.use({deviceScaleFactor:dpr});
  for(const width of [320,672,920])test(`${width}px people keep screen size, coordinates, names and replay identity`,async({page})=>{
    const result=withSnapshot(message(),{density:1.5}),point=result._meta.gateway_ui.map_context.snapshot.elements.agents[0],name=result._meta.gateway_ui.engine_view.solver_job.plan.agents[0].name;
    const host=await openHost(page),frame=await host.add({result,width,height:900,autoSize:true,context:{locale:dpr===2?'en-US':'zh-CN',theme:width===320?'dark':'light'}});await mapReady(frame);
    const marker=origins(frame).first(),label=frame.locator('.snapshot-engineer-name');await expectSize(marker,22,point);await expect(label).toBeHidden();
    expect(await marker.locator('text,title').count()).toBe(0);
    const color=(await expectSize(marker,22,point)).color;expect(color).toBe(await frame.locator('.snapshot-route-shape').first().getAttribute('stroke'));
    await marker.hover();await expect(label).toHaveText(name);await expect(label).toHaveCSS('font-size','12px');await expectBounded(frame,'.snapshot-engineer-name');
    await page.mouse.move(0,0);await expect(label).toBeHidden();await marker.focus();await expect(label).toBeVisible();await marker.press('Escape');await expect(label).toBeHidden();
    await frame.locator('#fit-map').focus();await marker.focus();await expect(label).toBeVisible();
    const plus=frame.locator('.snapshot-controls button').first(),minus=frame.locator('.snapshot-controls button').last();
    if(await plus.isDisabled())await minus.click();const before=await frame.locator('.snapshot-svg').getAttribute('viewBox');await plus.click();expect(await frame.locator('.snapshot-svg').getAttribute('viewBox')).not.toBe(before);await expectSize(marker,22,point);
    await marker.focus();await marker.press('Enter');await expect(frame.locator('#engineer')).toHaveJSProperty('value',AGENT);await expectSize(marker,26,point);
    await fullscreen(frame);const moving=frame.locator('.snapshot-playback[display="inline"]');await expectSize(moving,26);await expect(marker).toHaveAttribute('visibility','hidden');
    const start=await moving.getAttribute('transform');await frame.locator('#cursor').fill('500');expect(await moving.getAttribute('transform')).not.toBe(start);await expectSize(moving,26);await expectBounded(frame,'.snapshot-engineer-name');
    expect((await expectSize(moving,26)).color).toBe(color);
    await frame.locator('#fullscreen').click();await expect(marker).not.toHaveAttribute('visibility','hidden');await expectSize(marker,26,point);
    const resized=width===320?760:375;await page.locator('#card').evaluate((el,w)=>el.style.width=w+'px',resized);
    await expect.poll(()=>frame.locator('#map-canvas').evaluate(el=>el.getBoundingClientRect().width)).toBe(resized);await expectSize(marker,26,point);
    await frame.locator('#fit-map').click();const fitted=await frame.locator('.snapshot-svg').getAttribute('viewBox');await frame.locator('#fit-map').click();expect(await frame.locator('.snapshot-svg').getAttribute('viewBox')).toBe(fitted);
    expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
  });
});

test('same-origin people expose an accessible bounded picker and preserve local selection',async({page})=>{
  const result=sharedResult(),host=await openHost(page),frame=await host.add({result,width:672,autoSize:true});await mapReady(frame);
  await expect(cluster(frame)).toHaveCount(1);await expect(cluster(frame).locator('text')).toHaveText('3');
  await expect(origins(frame)).toHaveCount(3);for(const marker of await origins(frame).all()){await expect(marker).toHaveAttribute('visibility','hidden');await expect(marker).toHaveAttribute('tabindex','-1');}
  const height=await frame.locator('#app').evaluate(el=>el.getBoundingClientRect().height);
  await cluster(frame).click();await expect(popup(frame)).toBeVisible();await expectBounded(frame,'.snapshot-engineer-popup');
  const choices=popup(frame).locator('.snapshot-engineer-choice');await expect(choices).toHaveCount(3);await expect(choices.first()).toBeFocused();await expect(choices.nth(1)).toContainText('Aisha Rahman');await expect(choices.nth(1)).toContainText('2026-09-17');
  expect(await frame.locator('#app').evaluate(el=>el.getBoundingClientRect().height)).toBe(height);
  await choices.first().press('End');await expect(choices.last()).toBeFocused();await choices.last().press('Home');await expect(choices.first()).toBeFocused();await choices.first().press('ArrowDown');await choices.nth(1).press('Escape');
  await expect(popup(frame)).toBeHidden();await expect(cluster(frame)).toBeFocused();
  await cluster(frame).press(' ');await popup(frame).locator('.snapshot-engineer-choice').nth(1).press('Enter');await expect(popup(frame)).toBeHidden();
  await expect(frame.locator('#engineer')).toHaveJSProperty('value','shared-engineer-1');await expect(cluster(frame)).toHaveCount(0);
  const selected=origins(frame).filter({has:frame.locator('.snapshot-engineer-face')}).locator('xpath=self::*[@data-selected="true"]');
  await expect(selected).toBeFocused();await expectSize(selected,26);
  await chooseEngineer(frame,'');await expect(cluster(frame).locator('text')).toHaveText('3');expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
});

test('only identical origins merge, while replay people stay separate and recover their origins',async({page})=>{
  const result=sharedResult(),host=await openHost(page),frame=await host.add({result,width:920,height:900,autoSize:true});await mapReady(frame);
  await fullscreen(frame);await expect(cluster(frame).locator('text')).toHaveText('2');
  const moving=frame.locator('.snapshot-playback[display="inline"]');await expectSize(moving);
  expect(await moving.evaluate(node=>{const r=node.querySelector('.snapshot-engineer-face').getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.snapshot-playback')===node;})).toBe(true);
  await frame.locator('#play').click();await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','true');
  await moving.focus();await expect(frame.locator('.snapshot-engineer-name')).toContainText('Nadia Hussain');await expect(frame.locator('#play')).toHaveAttribute('aria-pressed','true');
  await frame.locator('#fullscreen').click();await expect(cluster(frame).locator('text')).toHaveText('3');await expect(frame.locator('.snapshot-playback[display="inline"]')).toHaveCount(0);
  const nearby=sharedResult(),plan=nearby._meta.gateway_ui.engine_view.solver_job.plan;plan.pois.push({id:'nearby-origin',name:'Near but distinct',address:null,location:'120.000001,30'});plan.agents.push({...structuredClone(plan.agents[1]),id:'nearby-engineer',start_loc:'nearby-origin'});
  await host.result('card',withSnapshot(nearby,{density:1.5}));await mapReady(frame);await expect(cluster(frame).locator('text')).toHaveText('3');await expect(origins(frame).locator('xpath=self::*[not(@visibility="hidden") and @display="inline"]')).toHaveCount(1);await host.assertHealthy();
});

for(const locale of ['zh-CN','en-US'])test(`200 shared-origin engineers retain long and same-name choices at 320px (${locale})`,async({page})=>{
  const result=sharedResult(200),plan=result._meta.gateway_ui.engine_view.solver_job.plan,name='<img src="https://evil.invalid/x"> Alexandra Montgomery-Wellington · '+'超长工程师姓名'.repeat(28);
  plan.agents[0].name=name;plan.agents[1].name=name;plan.agents[1].id='engineer\n\u0001特殊';
  const host=await openHost(page),frame=await host.add({result:withSnapshot(result,{density:1.5}),width:320,autoSize:true,context:{locale,theme:'dark'}});await mapReady(frame);
  await expect(cluster(frame).locator('text')).toHaveText('200');await cluster(frame).click();await expectBounded(frame,'.snapshot-engineer-popup');
  const choices=popup(frame).locator('.snapshot-engineer-choice');await expect(choices).toHaveCount(200);await expect(choices.first()).toContainText(name);await expect(popup(frame).locator('img,script')).toHaveCount(0);
  await choices.first().press('End');await expect(choices.last()).toBeInViewport();await choices.last().press('Home');await choices.nth(1).click();
  await expect(frame.locator('#engineer')).toHaveJSProperty('value','engineer\n\u0001特殊');await expect(frame.locator('.snapshot-engineer-name')).toHaveText(name);await expectBounded(frame,'.snapshot-engineer-name');
  expect(host.requests.some(url=>url.includes('evil.invalid'))).toBe(false);await host.assertHealthy();
});

test('engineer popup closes across gestures, outside focus, resize, mode, visibility and result replacement',async({page})=>{
  const host=await openHost(page),frame=await host.add({result:sharedResult(),width:672,height:900,autoSize:true});await mapReady(frame);
  // A manual view is preserved on resize, so refit before locating the origin.
  const open=async()=>{await frame.locator('#fit-map').click();await cluster(frame).click();await expect(popup(frame)).toBeVisible();};
  await open();await frame.locator('#engineer').focus();await expect(popup(frame)).toBeHidden();
  await open();await page.mouse.click(1,1);await expect(popup(frame)).toBeHidden();
  await open();await frame.locator('.snapshot-svg').focus();await frame.locator('.snapshot-svg').press('ArrowRight');await expect(popup(frame)).toBeHidden();
  await open();await page.locator('#card').evaluate(el=>el.style.width='375px');await expect(popup(frame)).toBeHidden();
  await open();await fullscreen(frame);await expect(popup(frame)).toBeHidden();await frame.locator('#fullscreen').click();
  await open();await frame.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(popup(frame)).toBeHidden();
  await frame.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
  await open();const newer=sharedResult();newer._meta.gateway_ui.engine_view.solver_job.plan.agents[1].name='Updated engineer';await host.result('card',withSnapshot(newer,{density:1.5}));await mapReady(frame);await expect(popup(frame)).toBeHidden();
  await open();await expect(popup(frame)).toContainText('Updated engineer');await host.result('card',message('forbidden'));await expect(frame.locator('.snapshot-svg,.snapshot-engineer-popup,.snapshot-engineer-name')).toHaveCount(0);await host.assertHealthy();
});

test('engineer names, popup choices and teardown stay isolated between two cards',async({page})=>{
  const host=await openHost(page),result=sharedResult(),a=await host.add({id:'a',result,width:672,autoSize:true}),b=await host.add({id:'b',result,width:320,autoSize:true});await mapReady(a);await mapReady(b);
  await cluster(a).click();await expect(popup(a)).toBeVisible();await expect(popup(b)).toBeHidden();
  expect(await popup(a).getAttribute('id')).not.toBe(await popup(b).getAttribute('id'));
  await popup(a).locator('.snapshot-engineer-choice').first().click();await expect(a.locator('#engineer')).toHaveJSProperty('value',AGENT);await expect(b.locator('#engineer')).toHaveJSProperty('value','');
  await page.evaluate(()=>window.host.request('a','ui/resource-teardown',{}));await expect(a.locator('.snapshot-svg,.snapshot-engineer-name,.snapshot-engineer-popup')).toHaveCount(0);
  await page.locator('#b').scrollIntoViewIfNeeded();await cluster(b).click();await expect(popup(b)).toBeVisible();await host.assertHealthy();
});
