import { test, expect, openHost, mapReady, fullscreen, message, AGENT, JOB, VERSION , chooseEngineer} from './host-fixture.mjs';
async function layout(frame) {return frame.evaluate(()=>{const box=selector=>{const {width,height,top,bottom}=document.querySelector(selector).getBoundingClientRect();return {width,height,top,bottom};};return {canvas:box('#map-canvas'),app:box('#app'),switch:box('.app-switch'),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};});}
async function expectToolbarRow(frame) {
 const data=await frame.evaluate(()=>{
  const controls=['.engineer-filter','#sidebar-toggle','.map-fit-control','.header-actions']
   .map(selector=>document.querySelector('.toolbar '+selector)).filter(el=>el&&!el.hidden)
   .map(el=>{const {left,right,top,height}=el.getBoundingClientRect();return {left,right,center:top+height/2};});
  return {controls,width:document.documentElement.clientWidth,selectWidth:document.getElementById('engineer').getBoundingClientRect().width};
 });
 expect(data.selectWidth).toBeGreaterThanOrEqual(64);
 for(const [index,control]of data.controls.entries()){
  expect(Math.abs(control.center-data.controls[0].center)).toBeLessThan(1);
  expect(control.left).toBeGreaterThanOrEqual(0);expect(control.right).toBeLessThanOrEqual(data.width);
  if(index)expect(control.left).toBeGreaterThanOrEqual(data.controls[index-1].right);
 }
}
for(const width of[920,760,701,700,672,444,375,320])for(const locale of['zh-CN','en-US']){
 test(`SVG map at ${width}px in ${locale} keeps 3:2 canvas and one toolbar row without network`,async({page})=>{
  const host=await openHost(page),frame=await host.add({width,autoSize:true,context:{locale}});await mapReady(frame);
  await expect(frame.locator('.toolbar #fullscreen')).toBeVisible();await expect(frame.locator('#map-legend')).toHaveCount(0);
  await expect.poll(async()=>{const data=await layout(frame);return data.canvas.width/data.canvas.height;}).toBeCloseTo(1.5,2);
  await expectToolbarRow(frame);
  const data=await layout(frame);expect(data.canvas.width).toBe(width);expect(data.overflow).toBe(false);
  expect(data.switch.top-data.canvas.bottom).toBeLessThan(1);
  await expect.poll(async()=>await page.locator('#card').evaluate(el=>el.clientHeight)-Math.ceil((await layout(frame)).app.height)).toBe(0);
  await expect(frame.locator('.snapshot-attribution')).toBeVisible();await expect(frame.locator('footer,#footer,.app-footer')).toHaveCount(0);
  expect(frame.childFrames()).toHaveLength(0);expect(host.requests.every(url=>/^http:\/\/mcp-(?:host|app)\.test\//.test(url))).toBe(true);await host.assertHealthy();
 });
}
for(const locale of['zh-CN','en-US'])test(`long engineer names keep the ${locale} toolbar usable at 320px in both modes`,async({page})=>{
 const result=message(),name='Alexandra Montgomery-Wellington · 长姓名工程师';
 result._meta.gateway_ui.engine_view.solver_job.plan.agents[0].name=name;
 const host=await openHost(page),frame=await host.add({result,width:320,height:900,autoSize:true,context:{locale}});await mapReady(frame);
 await chooseEngineer(frame,AGENT);
 await expect(frame.locator('#engineer-value')).toContainText(name);
 for(const mode of['inline','fullscreen','inline']){
  if(mode!==(await frame.locator('#app').getAttribute('data-mode')))await frame.locator('#fullscreen').click();
  await expect(frame.locator('#app')).toHaveAttribute('data-mode',mode);
  await expectToolbarRow(frame);
  await expect(frame.locator('#engineer')).toHaveAccessibleName(locale==='zh-CN'?'工程师':'Engineer');
  await frame.locator('#fit-map').focus();await expect(frame.locator('#fit-map-tip')).toBeVisible();
  const bounds=await frame.locator('#fit-map-tip').evaluate(el=>{const {left,right}=el.getBoundingClientRect();return {left,right,width:document.documentElement.clientWidth};});
  expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(bounds.width);
  await expect(frame.locator('#engineer')).toHaveJSProperty('value',AGENT);
  expect((await layout(frame)).overflow).toBe(false);
 }
 await host.assertHealthy();
});
for(const provider of ['AMAP','HERE'])test(`${provider} SVG fit and local zoom preserve whole existing route geometry`,async({page})=>{
 const result=message();result._meta.gateway_ui.task.map_provider=provider;result._meta.gateway_ui.map_context.provider=provider;
 const host=await openHost(page),frame=await host.add({result,width:444,autoSize:true});await mapReady(frame);
 const viewport=()=>frame.locator('.snapshot-svg').getAttribute('viewBox');await chooseEngineer(frame,AGENT);const fit=await viewport();
 await frame.getByRole('button',{name:'放大地图',exact:true}).click();expect(await viewport()).not.toBe(fit);
 await frame.locator('#fit-map').click();expect(await viewport()).toBe(fit);
 await expect(frame.locator('.snapshot-attribution')).toBeVisible();expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
});
test('resizing and fullscreen preserve selection, SVG instance and viewport',async({page})=>{
 const host=await openHost(page),frame=await host.add({width:920,height:900,autoSize:true});await mapReady(frame);
 await chooseEngineer(frame,AGENT);await frame.getByRole('button',{name:'放大地图',exact:true}).click();
 const camera=()=>frame.locator('.snapshot-svg').evaluate(el=>{const [x,y,width,height]=el.getAttribute('viewBox').split(/\s+/).map(Number);return {x:x+width/2,y:y+height/2,scale:el.getBoundingClientRect().width/width};});
 const view=await camera();await frame.locator('.snapshot-svg').evaluate(el=>el.dataset.instanceProbe='kept');
 await fullscreen(frame);await expect(frame.locator('#sidebar')).toBeVisible();await expect.poll(async()=>(await layout(frame)).app.height).toBe(900);
 await frame.locator('#fullscreen').click();await page.locator('#card').evaluate(el=>el.style.width='375px');await expect.poll(async()=>(await layout(frame)).canvas.height).toBe(250);
 await expect(frame.locator('#engineer')).toHaveJSProperty('value',AGENT);await expect(frame.locator('.snapshot-svg')).toHaveAttribute('data-instance-probe','kept');
 const resized=await camera();expect(resized.x).toBeCloseTo(view.x,4);expect(resized.y).toBeCloseTo(view.y,4);expect(resized.scale).toBeCloseTo(view.scale,4);await host.assertHealthy();
});
test('theme and locale keep replay and Gantt intent while attribution remains fixed',async({page})=>{
 const host=await openHost(page),frame=await host.add({width:920,height:900,autoSize:true});await mapReady(frame);await chooseEngineer(frame,AGENT);
 await host.context('card',{locale:'en-US',theme:'dark'});await mapReady(frame);await fullscreen(frame);
 await expect(frame.locator('#playback-label')).toHaveText('Planned replay · Not live tracking');await expect(frame.locator('.snapshot-attribution')).toBeVisible();
 await host.context('card',{locale:'zh-CN',theme:'light'});await mapReady(frame);await frame.locator('#fullscreen').click();
 await expect(frame.locator('#open-gantt')).toHaveText('查看 Gantt 排程');await expect(frame.locator('footer,#footer,.app-footer')).toHaveCount(0);
 await frame.locator('#open-gantt').click();await expect.poll(async()=>(await host.messages('card')).length).toBe(1);
 expect(await host.messages('card')).toEqual([{role:'user',content:[{type:'text',text:JSON.stringify({intent:'show_job_gantt',job_id:JOB,image_version_id:VERSION})}]}]);await host.assertHealthy();
});

test('fixed map extent supports local wheel, drag and keyboard pan without MCP calls',async({page})=>{
 const host=await openHost(page),frame=await host.add({width:920});await mapReady(frame);const svg=frame.locator('.snapshot-svg'),view=()=>svg.getAttribute('viewBox');
 await frame.getByRole('button',{name:'放大地图',exact:true}).click();await frame.getByRole('button',{name:'放大地图',exact:true}).click();const before=await view(),box=await svg.boundingBox();
 await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width*.4+60,box.y+box.height*.4+30,{steps:4});await page.mouse.up();expect(await view()).not.toBe(before);
 await svg.focus();const dragged=await view();await svg.press('ArrowRight');expect(await view()).not.toBe(dragged);
 await expect(frame.locator('.snapshot-attribution')).toBeVisible();expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
});
