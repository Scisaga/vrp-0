import {test,expect,openHost,message,mapReady,fullscreen,AGENT} from './host-fixture.mjs';
import {withSnapshot} from './snapshot-fixture.mjs';

const selected=frame=>frame.locator('.snapshot-route[data-selected="true"]');
const routes=frame=>frame.locator('.snapshot-route[display="inline"]');
const view=frame=>frame.locator('.snapshot-svg').evaluate(svg=>{
  const [x,y,width,height]=svg.getAttribute('viewBox').split(/\s+/).map(Number),rect=svg.getBoundingClientRect();
  return {x,y,width,height,cssWidth:rect.width,cssHeight:rect.height};
});
async function assertBounded(frame){
  const v=await view(frame);expect(v.x).toBeGreaterThanOrEqual(-1e-6);expect(v.y).toBeGreaterThanOrEqual(-1e-6);
  expect(v.x+v.width).toBeLessThanOrEqual(1024+1e-6);expect(v.y+v.height).toBeLessThanOrEqual(768+1e-6);
  expect(v.width/v.height).toBeCloseTo(v.cssWidth/v.cssHeight,4); // CSS layout rounds to 1/64 px.
}
async function routeClick(page,frame,index,offset=0){
  const route=routes(frame).nth(index),local=await route.evaluate((node,offset)=>{
    const path=node.querySelector('.snapshot-route-hit'),length=path.getTotalLength(),matrix=path.getScreenCTM();
    for(const fraction of [.2,.35,.5,.65,.8]){
      const point=path.getPointAtLength(length*fraction),next=path.getPointAtLength(Math.min(length,length*fraction+1));
      const a=new DOMPoint(point.x,point.y).matrixTransform(matrix),b=new DOMPoint(next.x,next.y).matrixTransform(matrix);
      const span=Math.hypot(b.x-a.x,b.y-a.y)||1,x=a.x-(b.y-a.y)/span*offset,y=a.y+(b.x-a.x)/span*offset;
      if(document.elementFromPoint(x,y)?.closest('.snapshot-route')===node)return {x,y};
    }
    throw new Error('No unobscured test point on requested route');
  },offset);
  const box=await(await frame.frameElement()).boundingBox();await page.mouse.click(box.x+local.x,box.y+local.y);
}

for(const dpr of [1,2])test.describe(`SVG DPR ${dpr}`,()=>{
  test.use({deviceScaleFactor:dpr});
  for(const density of [1,2])test(`native ${density}× raster is decoded and magnification is bounded`,async({page})=>{
    const host=await openHost(page),frame=await host.add({result:withSnapshot(message(),{density}),width:760,autoSize:true});
    await mapReady(frame);await expect(frame.locator('.snapshot-frame')).toHaveAttribute('data-raster-scale',String(density));
    const plus=frame.getByRole('button',{name:'放大地图',exact:true}),minus=frame.getByRole('button',{name:'缩小地图',exact:true});
    for(let i=0;i<30&&await plus.isEnabled();i++)await plus.click();
    await expect(plus).toBeDisabled();const limited=await view(frame);
    expect(limited.cssWidth*dpr/(limited.width*density)).toBeLessThanOrEqual(2+1e-6);
    const svg=frame.locator('.snapshot-svg');await svg.focus();await svg.press('+');expect(await view(frame)).toEqual(limited);
    await svg.dispatchEvent('wheel',{deltaY:-100,clientX:200,clientY:200});expect(await view(frame)).toEqual(limited);
    for(let i=0;i<30&&await minus.isEnabled();i++)await minus.click();await expect(minus).toBeDisabled();await assertBounded(frame);
    const wide=await view(frame);await svg.press('-');expect(await view(frame)).toEqual(wide);
    expect(await host.pending('card')).toHaveLength(0);expect(frame.childFrames()).toHaveLength(0);await host.assertHealthy();
  });
});

test('mouse hit area selects only a route, leaves filter/view unchanged, and has no popup',async({page})=>{
  const result=message(),plan=result._meta.gateway_ui.engine_view.solver_job.plan;
  // The golden routes intentionally retrace the same road. Give this hit-test
  // case distinct synthetic bends so an outbound path is not covered by return.
  plan.agents[0].routes[0].polyline[1]={lat:120.001,lon:30.009};
  plan.agents[0].routes[1].polyline[1]={lat:120.019,lon:30.012};
  plan.agents.push({...structuredClone(plan.agents[0]),id:'second-synthetic-engineer',name:'Second synthetic engineer',tickets:[],routes:[]});
  const host=await openHost(page),frame=await host.add({result:withSnapshot(result,{density:2}),width:920,autoSize:true});await mapReady(frame);
  const before=await view(frame);await routeClick(page,frame,0,4.5);
  await expect(selected(frame)).toHaveCount(1);await expect(selected(frame)).toHaveAttribute('data-route-index','0');
  await expect(frame.locator('#engineer')).toHaveValue('');await expect(frame.locator('#map-legend button')).toHaveCount(2);
  expect(await view(frame)).toEqual(before);await expect(frame.locator('#inline-detail,.route-popup,.route-detail')).toHaveCount(0);
  await expect(frame.locator('.snapshot-status')).toBeHidden();expect(await host.pending('card')).toHaveLength(0);
  await routeClick(page,frame,1);await expect(selected(frame)).toHaveCount(1);await expect(selected(frame)).toHaveAttribute('data-route-index','1');
  await host.assertHealthy();
});

test('keyboard selection, return dashes, clear actions and card isolation preserve existing semantics',async({page})=>{
  const host=await openHost(page),result=withSnapshot(message(),{density:2});
  const a=await host.add({id:'a',result,width:760}),b=await host.add({id:'b',result,width:760});await mapReady(a);await mapReady(b);
  const count=await routes(a).count(),last=routes(a).nth(count-1),dash=await last.locator('.snapshot-route-shape').getAttribute('stroke-dasharray');
  await last.focus();await last.press('Enter');await expect(selected(a)).toHaveCount(1);await expect(selected(b)).toHaveCount(0);
  expect(await last.locator('.snapshot-route-shape').getAttribute('stroke-dasharray')).toBe(dash);expect(dash).toBeTruthy();
  await expect(last).toHaveAttribute('aria-pressed','true');await last.press('Escape');await expect(selected(a)).toHaveCount(0);
  await last.press(' ');await expect(selected(a)).toHaveCount(1);await a.locator('#engineer').selectOption(AGENT);await expect(selected(a)).toHaveCount(0);
  await routes(a).first().focus();await routes(a).first().press('Enter');await expect(selected(a)).toHaveCount(1);
  await a.locator('.snapshot-point[data-kind="ticket"][display="inline"]').first().click();await expect(selected(a)).toHaveCount(0);
  await a.locator('#fit-map').click();await routes(a).first().focus();await routes(a).first().press('Enter');
  const box=await a.locator('.snapshot-svg').boundingBox();await page.mouse.click(box.x+8,box.y+box.height-30);await expect(selected(a)).toHaveCount(0);
  expect(await host.pending('a')).toHaveLength(0);expect(await host.pending('b')).toHaveLength(0);await host.assertHealthy();
});

test('route highlighting and clearing do not pause an active replay',async({page})=>{
  const host=await openHost(page),frame=await host.add({result:withSnapshot(message(),{density:2}),width:920,height:900});await mapReady(frame);await fullscreen(frame);
  const play=frame.locator('#play');await play.click();await expect(play).toHaveAttribute('aria-pressed','true');
  const route=routes(frame).first();await route.focus();await route.press('Enter');await expect(selected(frame)).toHaveCount(1);
  await expect(play).toHaveAttribute('aria-pressed','true');await route.press('Escape');await expect(selected(frame)).toHaveCount(0);
  await expect(play).toHaveAttribute('aria-pressed','true');expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
});

for(const theme of ['light','dark'])test(`route selection and keyboard focus emphasize the polyline, never its bounding rectangle (${theme})`,async({page})=>{
  const host=await openHost(page),frame=await host.add({result:withSnapshot(message(),{density:2}),width:920,height:900,context:{theme}});await mapReady(frame);
  const route=routes(frame).last(),shape=route.locator('.snapshot-route-shape'),halo=route.locator('.snapshot-route-halo');
  await routeClick(page,frame,await routes(frame).count()-1);
  await expect(selected(frame)).toHaveCount(1);
  expect(await route.evaluate(node=>getComputedStyle(node).outlineStyle)).toBe('none');
  await expect(shape).toHaveCSS('stroke-width','6px');await expect(halo).toHaveCSS('display','inline');await expect(halo).toHaveCSS('stroke','rgb(255, 255, 255)');
  expect(await halo.getAttribute('d')).toEqual(await shape.getAttribute('d'));
  const stroke=await shape.getAttribute('stroke');
  await frame.locator('#engineer').focus();await route.focus();await route.press('Escape');
  await expect(selected(frame)).toHaveCount(0);expect(await route.evaluate(node=>node.matches(':focus-visible'))).toBe(true);
  expect(await route.evaluate(node=>getComputedStyle(node).outlineStyle)).toBe('none');
  await expect(shape).toHaveCSS('stroke-width','6px');await expect(halo).toHaveCSS('display','inline');
  expect(await shape.getAttribute('stroke')).toBe(stroke);
  const svg=frame.locator('.snapshot-svg'),box=await svg.boundingBox();await page.mouse.click(box.x+4,box.y+4);
  expect(await svg.evaluate(node=>getComputedStyle(node).outlineStyle)).toBe('none');
  await svg.focus();await svg.press('ArrowRight');await expect(svg).toHaveCSS('outline-style','solid');
  expect(frame.childFrames()).toHaveLength(0);await host.assertHealthy();
});

for(const locale of ['zh-CN','en-US'])test(`zoom and edge notices guide fullscreen only in inline mode (${locale})`,async({page})=>{
  const host=await openHost(page),frame=await host.add({result:withSnapshot(message(),{density:2}),width:760,height:900,context:{locale},autoSize:true});await mapReady(frame);
  const svg=frame.locator('.snapshot-svg'),status=frame.locator('.snapshot-status'),fullscreenText=locale==='zh-CN'?'全屏查看':'Expand';
  const notices=locale==='zh-CN'?{
    zoom:'已到当前视图的清晰缩放上限。需要放大查看，请点击“全屏查看”。',
    zoomFullscreen:'已到当前底图的清晰缩放上限。',
    edge:'已到快照边界，请点击“全屏查看”，在更大空间内查看。',
    edgeFullscreen:'已到快照边界，可点击“显示完整路线”重新取景。',
  }:{
    zoom:'This view has reached its image-resolution zoom limit. Choose “Expand” for more viewing space.',
    zoomFullscreen:'The image resolution limit has been reached.',
    edge:'Snapshot edge reached. Choose “Expand” for more viewing space.',
    edgeFullscreen:'Snapshot edge reached. Choose “Show full routes” to refit.',
  };
  await svg.focus();for(let i=0;i<20;i++)await svg.press('+');
  await expect(status).toHaveText(notices.zoom);await expect(status).toContainText(fullscreenText);
  await frame.evaluate(()=>{window.unchangedLimitMessages=0;new MutationObserver(records=>{window.unchangedLimitMessages+=records.filter(record=>record.type==='childList').length;}).observe(document.querySelector('.snapshot-status'),{childList:true});});
  await host.context('card',{displayMode:'inline'});expect(await frame.evaluate(()=>window.unchangedLimitMessages)).toBe(0);
  // No pointer/key gesture should be needed to correct a still-visible notice after a mode change.
  await fullscreen(frame);await expect(status).toHaveText(notices.zoomFullscreen);await expect(status).not.toContainText(fullscreenText);await expect(status).toBeVisible();
  await svg.focus();for(let i=0;i<100;i++)await svg.press('ArrowLeft');
  await expect(status).toHaveText(notices.edgeFullscreen);await expect(status).toContainText(locale==='zh-CN'?'显示完整路线':'Show full routes');await expect(status).not.toContainText(fullscreenText);
  await frame.locator('#fullscreen').click();await expect(status).toHaveText(notices.edge);await expect(status).toContainText(fullscreenText);
  expect(await host.pending('card')).toHaveLength(0);await assertBounded(frame);await host.assertHealthy();
});

test('route selection survives resize/fullscreen, never adds route details, and clears on new task',async({page})=>{
  const host=await openHost(page),frame=await host.add({result:withSnapshot(message(),{density:2}),width:920,height:900,autoSize:true});await mapReady(frame);
  await routes(frame).first().focus();await routes(frame).first().press('Enter');await fullscreen(frame);
  await expect(selected(frame)).toHaveCount(1);await expect(frame.locator('.route-detail,.route-popup')).toHaveCount(0);
  await frame.locator('.snapshot-svg').evaluate(el=>el.dataset.instanceProbe='retained');
  await page.locator('#card').evaluate(el=>el.style.width='375px');await expect(selected(frame)).toHaveCount(1);
  await expect(frame.locator('.snapshot-svg')).toHaveAttribute('data-instance-probe','retained');await assertBounded(frame);
  await frame.locator('#fullscreen').click();await expect(selected(frame)).toHaveCount(1);
  await host.notify('card','ui/notifications/tool-input',{arguments:{job_id:'new-synthetic-job'}});await expect(frame.locator('.snapshot-svg')).toHaveCount(0);
  await host.assertHealthy();
});

for(const size of [{width:2000,height:500},{width:375,height:1400}])test(`extreme ${size.width}×${size.height} keeps whole routes inside a real map rectangle`,async({page})=>{
  const host=await openHost(page),frame=await host.add({...size,result:withSnapshot(message(),{density:2})});await mapReady(frame);await fullscreen(frame);await frame.locator('#fit-map').click();
  await expect.poll(()=>frame.locator('.snapshot-svg').evaluate(svg=>{
    const rect=svg.getBoundingClientRect(),inside=point=>point.x>=rect.left-.5&&point.x<=rect.right+.5&&point.y>=rect.top-.5&&point.y<=rect.bottom+.5;
    return [...svg.querySelectorAll('.snapshot-route[display="inline"] .snapshot-route-shape')].every(path=>{
      const box=path.getBBox(),matrix=path.getScreenCTM();
      return [[box.x,box.y],[box.x+box.width,box.y+box.height]].every(([x,y])=>inside(new DOMPoint(x,y).matrixTransform(matrix)));
    });
  })).toBe(true);
  await assertBounded(frame);await expect(frame.locator('.snapshot-attribution')).toBeVisible();await host.assertHealthy();
});

test('pan/keyboard/follow stay inside the image; one edge notice per drag and no accidental route click',async({page})=>{
  const host=await openHost(page),frame=await host.add({result:withSnapshot(message(),{density:2}),width:920,height:900});await mapReady(frame);
  const svg=frame.locator('.snapshot-svg');await svg.focus();
  for(const key of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown']){for(let i=0;i<20;i++)await svg.press(key);await assertBounded(frame);}
  for(let i=0;i<30;i++)await svg.press('ArrowLeft');
  await frame.evaluate(()=>{window.edgeChanges=0;const status=document.querySelector('.snapshot-status');new MutationObserver(records=>{window.edgeChanges+=records.filter(record=>record.type==='childList').length;}).observe(status,{childList:true});});
  const box=await svg.boundingBox();await page.mouse.move(box.x+box.width*.2,box.y+box.height*.5);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.8,box.y+box.height*.5,{steps:6});await page.mouse.up();
  await expect.poll(()=>frame.evaluate(()=>window.edgeChanges)).toBe(1);await expect(frame.locator('.snapshot-status')).toContainText('快照边界');
  await expect(selected(frame)).toHaveCount(0);await assertBounded(frame);
  await frame.locator('#engineer').selectOption(AGENT);await fullscreen(frame);await frame.locator('#follow').click();await frame.locator('#cursor').fill('900');await assertBounded(frame);
  await host.context('card',{locale:'en-US'});await mapReady(frame);await frame.locator('.snapshot-svg').focus();
  for(let i=0;i<30;i++)await frame.locator('.snapshot-svg').press('ArrowLeft');await expect(frame.locator('.snapshot-status')).toContainText('Snapshot edge');
  expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
});
