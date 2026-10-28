import { test, expect, openHost, mapReady, fullscreen, message, AGENT, JOB, VERSION } from './host-fixture.mjs';
async function layout(frame) {return frame.evaluate(()=>{const box=selector=>{const {width,height,top,bottom}=document.querySelector(selector).getBoundingClientRect();return {width,height,top,bottom};};return {canvas:box('#map-canvas'),legend:box('#map-legend'),app:box('#app'),switch:box('.app-switch'),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};});}
for(const {width,ratio}of[{width:920,ratio:1.5},{width:760,ratio:1.5},{width:700,ratio:1},{width:444,ratio:1},{width:375,ratio:1},{width:320,ratio:1}]){
 test(`SVG map at ${width}px preserves canvas ratio and visible attribution without network`,async({page})=>{
  const host=await openHost(page),frame=await host.add({width,autoSize:true});await mapReady(frame);
  await expect(frame.locator('.toolbar #fullscreen')).toBeVisible();await expect(frame.locator('#map-legend button')).toHaveCount(1);
  await expect.poll(async()=>{const data=await layout(frame);return data.canvas.width/data.canvas.height;}).toBeCloseTo(ratio,2);
  const data=await layout(frame);expect(data.canvas.width).toBe(width);expect(data.legend.top).toBeGreaterThanOrEqual(data.canvas.bottom);expect(data.overflow).toBe(false);
  await expect.poll(async()=>await page.locator('#card').evaluate(el=>el.clientHeight)-Math.ceil((await layout(frame)).app.height)).toBe(0);
  await expect(frame.locator('.snapshot-attribution')).toBeVisible();await expect(frame.locator('footer,#footer,.app-footer')).toHaveCount(0);
  expect(frame.childFrames()).toHaveLength(0);expect(host.requests.every(url=>/^http:\/\/mcp-(?:host|app)\.test\//.test(url))).toBe(true);await host.assertHealthy();
 });
}
for(const provider of ['AMAP','HERE'])test(`${provider} SVG fit and local zoom preserve whole existing route geometry`,async({page})=>{
 const result=message();result._meta.gateway_ui.task.map_provider=provider;result._meta.gateway_ui.map_context.provider=provider;
 const host=await openHost(page),frame=await host.add({result,width:444,autoSize:true});await mapReady(frame);
 const viewport=()=>frame.locator('.snapshot-svg').getAttribute('viewBox');await frame.locator('#engineer').selectOption(AGENT);const fit=await viewport();
 await frame.getByRole('button',{name:'放大地图',exact:true}).click();expect(await viewport()).not.toBe(fit);
 await frame.locator('#fit-map').click();expect(await viewport()).toBe(fit);
 await expect(frame.locator('.snapshot-attribution')).toBeVisible();expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
});
test('resizing and fullscreen preserve selection, SVG instance and viewport',async({page})=>{
 const host=await openHost(page),frame=await host.add({width:920,height:900,autoSize:true});await mapReady(frame);
 await frame.locator('#engineer').selectOption(AGENT);await frame.getByRole('button',{name:'放大地图',exact:true}).click();
 const camera=()=>frame.locator('.snapshot-svg').evaluate(el=>{const [x,y,width,height]=el.getAttribute('viewBox').split(/\s+/).map(Number);return {x:x+width/2,y:y+height/2,scale:el.getBoundingClientRect().width/width};});
 const view=await camera();await frame.locator('.snapshot-svg').evaluate(el=>el.dataset.instanceProbe='kept');
 await fullscreen(frame);await expect(frame.locator('#sidebar')).toBeVisible();await expect.poll(async()=>(await layout(frame)).app.height).toBe(900);
 await frame.locator('#fullscreen').click();await page.locator('#card').evaluate(el=>el.style.width='375px');await expect.poll(async()=>(await layout(frame)).canvas.height).toBe(375);
 await expect(frame.locator('#engineer')).toHaveValue(AGENT);await expect(frame.locator('.snapshot-svg')).toHaveAttribute('data-instance-probe','kept');
 const resized=await camera();expect(resized.x).toBeCloseTo(view.x,4);expect(resized.y).toBeCloseTo(view.y,4);expect(resized.scale).toBeCloseTo(view.scale,4);await host.assertHealthy();
});
test('theme and locale keep replay and Gantt intent while attribution remains fixed',async({page})=>{
 const host=await openHost(page),frame=await host.add({width:920,height:900,autoSize:true});await mapReady(frame);await frame.locator('#engineer').selectOption(AGENT);
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
