import {test,expect,openHost,message,mapReady,fullscreen,chooseEngineer,AGENT} from './host-fixture.mjs';
import {withSnapshot} from './snapshot-fixture.mjs';

const tickets=frame=>frame.locator('.snapshot-point[data-kind="ticket"][display="inline"]');
async function geometry(marker,point){
  return marker.evaluate((node,point)=>{
    const face=node.querySelector('.snapshot-ticket-face'),hit=node.querySelector('.snapshot-ticket-hit');
    const label=node.querySelector('text'),box=face.getBoundingClientRect(),text=label.getBoundingClientRect();
    const matrix=face.getScreenCTM(),scale=Math.hypot(matrix.a,matrix.b),stroke=parseFloat(getComputedStyle(face).strokeWidth)*scale;
    const anchor=new DOMPoint(point.x,point.y).matrixTransform(node.ownerSVGElement.getScreenCTM());
    return {diameter:box.width+stroke,height:box.height+stroke,stroke,hit:hit.getBoundingClientRect().width,
      font:parseFloat(getComputedStyle(label).fontSize)*scale,textWidth:text.width,faceWidth:box.width,
      dx:box.x+box.width/2-anchor.x,dy:box.y+box.height/2-anchor.y,
      textDx:text.x+text.width/2-(box.x+box.width/2),textDy:text.y+text.height/2-(box.y+box.height/2),
      color:face.getAttribute('fill'),label:label.textContent,transform:node.getAttribute('transform')};
  },point);
}
async function expectSize(marker,point,diameter=22){
  const data=await geometry(marker,point);
  expect(data.diameter).toBeCloseTo(diameter,1);expect(data.height).toBeCloseTo(diameter,1);
  expect(data.stroke).toBeCloseTo(1.5,2);expect(data.hit).toBeCloseTo(32,1);
  expect(Math.abs(data.dx)).toBeLessThan(.05);expect(Math.abs(data.dy)).toBeLessThan(.05);
  // Glyph ink bounds can differ fractionally from the centered text advance.
  expect(Math.abs(data.textDx)).toBeLessThan(.25);expect(Math.abs(data.textDy)).toBeLessThan(2);
  return data;
}

for(const dpr of [1,2])test.describe(`ticket markers DPR ${dpr}`,()=>{
  test.use({deviceScaleFactor:dpr});
  for(const width of [320,672,920])test(`${width}px markers keep screen size and coordinates across map controls and modes`,async({page})=>{
    const result=withSnapshot(message(),{density:1.5}),point=result._meta.gateway_ui.map_context.snapshot.elements.tickets[0];
    const host=await openHost(page),frame=await host.add({result,width,height:900,autoSize:true,context:{theme:width===320?'dark':'light',locale:dpr===2?'en-US':'zh-CN'}});
    await mapReady(frame);await chooseEngineer(frame,AGENT);
    const marker=tickets(frame).first(),initial=await expectSize(marker,point);
    expect(initial.font).toBeCloseTo(11,2);
    const svg=frame.locator('.snapshot-svg'),plus=frame.locator('.snapshot-controls button').first(),minus=frame.locator('.snapshot-controls button').last();
    if(await plus.isDisabled())await minus.click();
    const before=await svg.getAttribute('viewBox');await plus.click();
    expect(await svg.getAttribute('viewBox')).not.toBe(before);await expectSize(marker,point);
    await minus.click();await expectSize(marker,point);
    await svg.focus();await svg.press('ArrowRight');await expectSize(marker,point);
    await frame.locator('#fit-map').click();const fitted=await svg.getAttribute('viewBox');
    for(let i=0;i<3;i++){await frame.locator('#fit-map').click();expect(await svg.getAttribute('viewBox')).toBe(fitted);await expectSize(marker,point);}
    await marker.focus();await marker.press('Enter');await expect(marker).toHaveAttribute('data-selected','true');
    await expectSize(marker,point,26);await fullscreen(frame);await expectSize(marker,point,26);
    await expect(frame.locator('#side-detail')).toContainText(point.ticket_id);
    await frame.locator('#fullscreen').click();const resized=width===320?760:375;
    await page.locator('#card').evaluate((el,width)=>el.style.width=width+'px',resized);
    await expect.poll(()=>frame.locator('#map-canvas').evaluate(el=>el.getBoundingClientRect().width)).toBe(resized);
    const after=await expectSize(marker,point,26);
    expect(after.color).toBe(initial.color);expect(after.label).toBe(initial.label);expect(after.transform).toBe(initial.transform);expect(after.font).toBeCloseTo(11,2);
    await chooseEngineer(frame,'');await expect(marker).toHaveAttribute('data-selected','false');await expectSize(marker,point);
    expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
  });
});

test('transparent ticket target selects outside the visible circle and stays isolated on teardown',async({page})=>{
  const result=withSnapshot(message(),{density:1.5}),point=result._meta.gateway_ui.map_context.snapshot.elements.tickets[0];
  const host=await openHost(page),a=await host.add({id:'a',result,width:672,height:900,autoSize:true}),b=await host.add({id:'b',result,width:320,autoSize:true});
  await mapReady(a);await mapReady(b);await chooseEngineer(a,AGENT);await fullscreen(a);
  const marker=tickets(a).first();await expectSize(marker,point);
  // 14px from center is beyond the 11px visible radius and inside the 16px target.
  await marker.locator('.snapshot-ticket-hit').click({position:{x:30,y:16}});
  await expect(marker).toHaveAttribute('data-selected','true');await expectSize(marker,point,26);
  await expect(a.locator('#side-detail')).toContainText(point.ticket_id);await expectSize(tickets(b).first(),point);
  await expect(tickets(b).first()).toHaveAttribute('data-selected','false');
  await page.evaluate(()=>window.host.request('a','ui/resource-teardown',{}));
  await expect(a.locator('.snapshot-svg')).toHaveCount(0);await expectSize(tickets(b).first(),point);
  expect(await host.pending('a')).toHaveLength(0);expect(await host.pending('b')).toHaveLength(0);await host.assertHealthy();
});

test('long ticket numbers remain complete and centered inside the compact symbol',async({page})=>{
  const result=withSnapshot(message()),snapshot=result._meta.gateway_ui.map_context.snapshot,point=snapshot.elements.tickets[0];
  snapshot.svg=snapshot.svg.replace(new RegExp(`(<g id="${point.element_id}"[^>]*>[\\s\\S]*?<text[^>]*>)[^<]*(</text>)`),(_,before,after)=>before+'1234'+after);
  const host=await openHost(page),frame=await host.add({result,width:672,autoSize:true});await mapReady(frame);
  const marker=tickets(frame).first(),data=await expectSize(marker,point);
  expect(data.label).toBe('1234');expect(data.textWidth).toBeLessThanOrEqual(data.faceWidth);
  expect(data.font).toBeGreaterThan(0);expect(data.font).toBeLessThan(11);
  await marker.focus();await marker.press(' ');await expectSize(marker,point,26);
  await expect(marker).toHaveAttribute('aria-label',point.ticket_id);await host.assertHealthy();
});
