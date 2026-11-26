import {test,expect,openHost,message,mapReady,fullscreen,chooseEngineer,AGENT} from './host-fixture.mjs';
import {withSnapshot} from './snapshot-fixture.mjs';

const compositions=frame=>frame.locator('.snapshot-point-composition');
const origin=frame=>frame.locator('.snapshot-engineer:not(.snapshot-playback)[display="inline"]');
const cluster=frame=>frame.locator('.snapshot-engineer-cluster[display="inline"]');

// The real producer paints all static engineers before all workorders, then replay.
// The older interleaved fixture did not reproduce workorders covering engineers.
function productionOrder(result){
  const value=withSnapshot(result,{density:1.5}),snapshot=value._meta.gateway_ui.map_context.snapshot,{agents,tickets,routes}=snapshot.elements,groups=new Map();
  snapshot.svg=snapshot.svg.replace(/<g id="(s-[rmp]\d+)"[^>]*>.*?<\/g>/g,(source,id)=>{groups.set(id,source);return '';});
  const collect=entries=>entries.map(entry=>groups.get(entry.element_id)).join('');
  snapshot.svg=snapshot.svg.replace('</svg>',`<g id="s-routes">${collect(routes)}</g><g id="s-points">${collect(agents)}${collect(tickets)}</g><g id="s-playback">${agents.map(entry=>groups.get(entry.playback_element_id)).join('')}</g></svg>`);
  return value;
}
function coincident({shared=1,foreign=false,multiple=false,nearby=false}={}){
  const result=message(),plan=result._meta.gateway_ui.engine_view.solver_job.plan;
  plan.agents[0].start_loc=plan.tickets[0].loc;
  if(nearby){plan.pois.push({id:'nearby',name:'Near but distinct',address:null,location:'120.010001,30.01'});plan.agents[0].start_loc='nearby';}
  for(let index=1;index<shared;index++)plan.agents.push({...structuredClone(plan.agents[0]),id:`shared-${index}`,name:`Shared person ${index}`,tickets:[],routes:[]});
  if(foreign){
    const owner={...structuredClone(plan.agents[0]),id:'other-owner',name:'Other owner',start_loc:'poi-home'};
    plan.agents[0].tickets=[];plan.agents[0].routes=[];plan.agents.push(owner);for(const ticket of plan.tickets)ticket.agent=owner.id;
  }
  if(multiple)plan.tickets[1].loc=plan.tickets[0].loc;
  return productionOrder(result);
}
async function geometry(frame){
  return compositions(frame).first().evaluate(group=>{
    const svg=group.ownerSVGElement,ticket=group.querySelector('[data-kind="ticket"]'),person=group.querySelector('[data-kind="agent"],[data-kind="engineer-cluster"]');
    const box=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2};};
    const hit=node=>{const r=box(node.querySelector('.snapshot-ticket-hit,.snapshot-engineer-hit')),top=document.elementFromPoint(r.cx,r.cy)?.closest('[data-kind]');return {...r,kind:top?.dataset.kind,id:top?.dataset.id};};
    const [x,y]=ticket.getAttribute('transform').match(/translate\(([^)]+)\)/)[1].split(/[ ,]+/).map(Number),anchor=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM()),base=group.querySelector('.snapshot-composition-base'),matrix=base.getScreenCTM(),stroke=parseFloat(getComputedStyle(base).strokeWidth)*Math.hypot(matrix.a,matrix.b);
    const dot=box(group.querySelector('.snapshot-composition-dot'));
    return {ticket:hit(ticket),person:hit(person),anchor:{x:anchor.x,y:anchor.y},base:box(base),dot,stroke,
      side:group.dataset.side,frame:box(group.closest('.snapshot-frame')),
      personTransform:person.getAttribute('transform'),ticketTransform:ticket.getAttribute('transform')};
  });
}
async function expectPair(frame,width=66){
  const g=await geometry(frame);expect(g.base.width+g.stroke).toBeCloseTo(width,1);expect(g.base.height+g.stroke).toBeCloseTo(34,1);
  expect(g.ticket.width).toBeCloseTo(32,1);expect(g.person.width).toBeCloseTo(width-34,1);
  expect(g.dot.width).toBeCloseTo(8,1);
  expect(g.dot.cx).toBeCloseTo(g.anchor.x,1);expect(g.dot.cy).toBeCloseTo(g.anchor.y,1);
  const dx=Math.max(0,g.base.x-g.anchor.x,g.anchor.x-g.base.x-g.base.width);
  const dy=Math.max(0,g.base.y-g.anchor.y,g.anchor.y-g.base.y-g.base.height);
  expect(Math.hypot(dx,dy)).toBeGreaterThan(8);expect(Math.hypot(dx,dy)).toBeLessThan(13);
  for(const hit of [g.ticket,g.person]){
    expect(hit.cx).toBeGreaterThan(g.base.x);expect(hit.cx).toBeLessThan(g.base.x+g.base.width);
    expect(hit.cy).toBeCloseTo(g.base.cy,1);
  }
  expect(g.ticket.cx-g.person.cx-(g.person.width+g.ticket.width)/2).toBeCloseTo(0,1);
  expect(g.person.x-g.base.x+g.stroke/2).toBeCloseTo(1,1);
  expect(g.base.x+g.base.width+g.stroke/2-g.ticket.x-g.ticket.width).toBeCloseTo(1,1);
  expect(g.ticket.kind).toBe('ticket');expect(g.person.kind).toBe(width===66?'agent':'engineer-cluster');return g;
}

for(const dpr of [1,2])test.describe(`same-point compositions DPR ${dpr}`,()=>{
  test.use({deviceScaleFactor:dpr});
  for(const width of [320,672,920])test(`${width}px independent people and workorders keep anchors through zoom, resize and fullscreen`,async({page})=>{
    const result=coincident(),snapshot=result._meta.gateway_ui.map_context.snapshot,point=snapshot.elements.tickets[0],host=await openHost(page),frame=await host.add({result,width,height:900,autoSize:true,context:{theme:width===320?'dark':'light',locale:dpr===2?'en-US':'zh-CN'}});await mapReady(frame);
    await expect(compositions(frame)).toHaveCount(1);const initial=await expectPair(frame);expect(initial.ticketTransform).toBe(`translate(${point.x} ${point.y})`);expect(initial.personTransform).toBe(initial.ticketTransform);
    await expect(compositions(frame).locator('.snapshot-composition-dot')).toHaveCount(1);
    await expect(compositions(frame).locator('line')).toHaveCount(0);
    await origin(frame).hover();await expect(frame.locator('.snapshot-engineer-name')).toBeVisible();await expectPair(frame);await page.mouse.move(0,0);
    const plus=frame.locator('.snapshot-controls button').first(),minus=frame.locator('.snapshot-controls button').last();if(await plus.isDisabled())await minus.click();await plus.click();await expectPair(frame);
    await origin(frame).click();await expect(frame.locator('#engineer')).toHaveJSProperty('value',AGENT);await expectPair(frame);
    await chooseEngineer(frame,'');await origin(frame).focus();await origin(frame).press('Enter');await expect(frame.locator('#engineer')).toHaveJSProperty('value',AGENT);await expectPair(frame);
    await frame.locator('#fit-map').click();const fitted=await frame.locator('.snapshot-svg').getAttribute('viewBox');await frame.locator('#fit-map').click();expect(await frame.locator('.snapshot-svg').getAttribute('viewBox')).toBe(fitted);
    await fullscreen(frame);await expectPair(frame);await frame.locator('#fullscreen').click();await expectPair(frame);
    const resized=width===320?760:375;
    await page.locator('#card').evaluate((node,width)=>node.style.width=width+'px',resized);
    await expect.poll(()=>frame.locator('#map-canvas').evaluate(node=>node.getBoundingClientRect().width)).toBe(resized-2);await expectPair(frame);
    const ticket=compositions(frame).locator('[data-kind="ticket"]').first();await ticket.click();await expect(ticket).toHaveAttribute('data-selected','true');await ticket.focus();await ticket.press('Enter');await expectPair(frame);
    expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
  });
});

test('shared-start capsule preserves the workorder stack and offers independent keyboard selection',async({page})=>{
  const result=coincident({shared:3,multiple:true});result._meta.gateway_ui.map_context.snapshot.elements.tickets.reverse();
  const host=await openHost(page),frame=await host.add({result,width:672,autoSize:true});await mapReady(frame);
  await expectPair(frame,75);await expect(cluster(frame).locator('text')).toHaveText('3');
  const ids=await compositions(frame).locator('[data-kind="ticket"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.id));expect(ids).toEqual(['ticket-b','ticket-a']);
  await cluster(frame).focus();await cluster(frame).press('Enter');await expect(frame.locator('.snapshot-engineer-choice')).toHaveCount(3);
  await frame.locator('.snapshot-engineer-choice').first().press('Escape');await expect(cluster(frame)).toBeFocused();await cluster(frame).press(' ');
  await frame.locator('.snapshot-engineer-choice').first().click();await expect(origin(frame)).toBeFocused();await expectPair(frame);
  await chooseEngineer(frame,'');await expectPair(frame,75);await expect(cluster(frame).locator('text')).toHaveText('3');await host.assertHealthy();
});

test('filtering a coincident workorder owned by another engineer restores original layer order and anchor',async({page})=>{
  const result=coincident({foreign:true}),host=await openHost(page),frame=await host.add({result,width:672,autoSize:true});await mapReady(frame);await expectPair(frame);
  await chooseEngineer(frame,AGENT);await expect(compositions(frame)).toHaveCount(0);await expect(origin(frame)).toHaveCount(1);
  expect(await origin(frame).evaluate(node=>node.parentElement.id.endsWith('s-points')&&!node.querySelector('.snapshot-point-offset'))).toBe(true);
  await chooseEngineer(frame,'other-owner');await expect(compositions(frame)).toHaveCount(0);
  await chooseEngineer(frame,'');await expectPair(frame);await host.assertHealthy();
});

test('planned replay composes at a workorder and splits again on leaving, without showing its static origin',async({page})=>{
  const host=await openHost(page),frame=await host.add({result:productionOrder(message()),width:920,height:900,autoSize:true});await mapReady(frame);await expect(compositions(frame)).toHaveCount(0);
  await fullscreen(frame);await frame.locator('#cursor').fill('400');await expect(compositions(frame)).toHaveCount(1);await expectPair(frame);
  await expect(frame.locator('.snapshot-engineer:not(.snapshot-playback)')).toHaveAttribute('display','none');await expect(compositions(frame).locator('.snapshot-playback')).toHaveCount(1);
  await frame.locator('#cursor').fill('0');await expect(compositions(frame)).toHaveCount(0);await frame.locator('#fullscreen').click();await expect(origin(frame)).toHaveCount(1);await host.assertHealthy();
});

test('nearby but different coordinates are not combined',async({page})=>{
  const host=await openHost(page),frame=await host.add({result:coincident({nearby:true}),width:672,autoSize:true});await mapReady(frame);await expect(compositions(frame)).toHaveCount(0);await host.assertHealthy();
});

test('callout stays inside the viewport at the edge and retains its workorder anchor',async({page})=>{
  const result=coincident(),plan=result._meta.gateway_ui.engine_view.solver_job.plan;plan.pois.find(poi=>poi.id==='poi-b').location='120.2,30.05';
  const host=await openHost(page),frame=await host.add({result:productionOrder(result),width:320,autoSize:true});await mapReady(frame);
  const initial=await expectPair(frame);
  await page.locator('#card').evaluate(node=>node.style.width='920px');await expect.poll(()=>frame.locator('#map-canvas').evaluate(node=>node.getBoundingClientRect().width)).toBe(918);
  for(const {base,frame:bounds}of [initial,await expectPair(frame)]){
    expect(base.x).toBeGreaterThanOrEqual(bounds.x);expect(base.y).toBeGreaterThanOrEqual(bounds.y);
    expect(base.x+base.width).toBeLessThanOrEqual(bounds.x+bounds.width);
    expect(base.y+base.height).toBeLessThanOrEqual(bounds.y+bounds.height);
  }
  const svg=frame.locator('.snapshot-svg');await svg.focus();await svg.press('ArrowLeft');await expectPair(frame);
  // Restore the fitted view, then zoom toward the paired point through the real wheel handler.
  await frame.locator('#fit-map').click();const hit=await compositions(frame).locator('.snapshot-ticket-hit').first().boundingBox();await page.mouse.move(hit.x+hit.width/2,hit.y+hit.height/2);await page.mouse.wheel(0,-500);
  await expectPair(frame);expect(initial.ticketTransform).toBe((await geometry(frame)).ticketTransform);await host.assertHealthy();
});

test('callout moves off a visible route crossing its preferred side',async({page})=>{
  const result=message(),plan=result._meta.gateway_ui.engine_view.solver_job.plan,agent=plan.agents[0];
  agent.start_loc=plan.tickets[0].loc;
  agent.routes[0].polyline=[{lat:119.97,lon:30.01},{lat:120.01,lon:30.01}];
  const host=await openHost(page),frame=await host.add({result:productionOrder(result),width:920,autoSize:true});await mapReady(frame);
  const {anchor,base,side}=await expectPair(frame);
  const route=await frame.locator('[data-route-index="0"] .snapshot-route-shape').evaluate(node=>{
    const {x,y,width}=node.getBoundingClientRect();return {left:x,right:x+width,y};
  });
  expect(route.y).toBeCloseTo(anchor.y,1);
  expect(route.left).toBeLessThan(anchor.x-8);expect(route.right).toBeGreaterThan(anchor.x-8-base.width);
  expect(side).not.toBe('left');
  const crosses=route.y>=base.y&&route.y<=base.y+base.height
    &&route.left<=base.x+base.width&&route.right>=base.x;
  expect(crosses).toBe(false);
  await host.assertHealthy();
});

for(const locale of ['zh-CN','en-US'])test(`200-person count and long names leave capsule targets free at 320px (${locale})`,async({page})=>{
  const result=coincident({shared:200}),plan=result._meta.gateway_ui.engine_view.solver_job.plan;plan.agents[0].name='超长姓名 Alexandra '.repeat(35);
  const host=await openHost(page),frame=await host.add({result,width:320,autoSize:true,context:{locale,theme:'dark'}});await mapReady(frame);await expectPair(frame,89);
  const height=await frame.locator('#app').evaluate(node=>node.getBoundingClientRect().height);await cluster(frame).click();await expectPair(frame,89);
  const popup=frame.locator('.snapshot-engineer-popup');await expect(popup.locator('.snapshot-engineer-choice')).toHaveCount(200);
  await popup.locator('.snapshot-engineer-choice').first().click({position:{x:18,y:8}});await expectPair(frame);await expect(frame.locator('.snapshot-engineer-name')).toHaveText(plan.agents[0].name);
  expect(await frame.locator('#app').evaluate(node=>node.getBoundingClientRect().height)).toBe(height);await host.assertHealthy();
});

test('result replacement, permission loss and card disposal remove compositions without affecting a second card',async({page})=>{
  const host=await openHost(page),a=await host.add({id:'a',result:coincident({shared:2}),width:320,autoSize:true}),b=await host.add({id:'b',result:coincident(),width:320,autoSize:true});await mapReady(a);await mapReady(b);
  await expect(compositions(a)).toHaveCount(1);await expect(compositions(b)).toHaveCount(1);
  await host.result('a',productionOrder(message()));await mapReady(a);await expect(compositions(a)).toHaveCount(0);await expect(compositions(b)).toHaveCount(1);
  await host.result('a',message('forbidden'));await expect(a.locator('.snapshot-svg,.snapshot-point-composition,.snapshot-engineer-popup')).toHaveCount(0);
  await page.evaluate(()=>window.host.request('b','ui/resource-teardown',{}));await expect(b.locator('.snapshot-svg,.snapshot-point-composition')).toHaveCount(0);await host.assertHealthy();
});
