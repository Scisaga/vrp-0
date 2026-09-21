import { test,expect,openHost,message,mapReady } from './host-fixture.mjs';

test('fullscreen refusal, auth clearing, teardown and two-card refresh stay instance-local',async({page})=>{
 const host=await openHost(page),a=await host.add({id:'a',refuseFullscreen:true}),b=await host.add({id:'b'});await mapReady(a);await mapReady(b);
 await a.locator('#fullscreen').click();await expect(a.locator('#app')).toHaveAttribute('data-mode','inline');await expect(a.locator('#notice')).toContainText('精简视图');
 await expect(b.locator('#refresh')).toBeHidden();await b.locator('#refresh').evaluate(el=>el.click());await expect.poll(async()=>(await host.pending('b')).length).toBe(1);const updated=message();updated._meta.gateway_ui.engine_view.solver_job.plan.agents[0].name='第二张卡更新';await host.respond('b',0,updated);await expect(b.locator('#engineer')).toContainText('第二张卡更新');
 await host.notify('a','ui/notifications/tool-cancelled',{});await expect(a.locator('#notice')).toContainText('取消');await expect(b.locator('#notice')).toBeHidden();
 await page.evaluate(()=>window.host.request('a','ui/resource-teardown',{}));await expect.poll(async()=> (await host.wire('a')).some(x=>x.id&&x.result)).toBe(true);await host.assertHealthy();
});

test('strict CSP and parser monitoring observe zero dynamic compilation attempts',async({page})=>{
 const host=await openHost(page,{monitorDynamicCode:true});await host.add({inspectFrame:false});
 // Do not inspect the App or nested renderer with a Playwright locator before
 // reading the parent monitor. DevTools' cross-frame selector machinery itself
 // calls window.eval in the inspected parent realm and is a false positive.
 // The intercepted SDK request proves the parent completed its nonce/port
 // handshake and issued the renderer mount command.
 await expect.poll(()=>host.requests.some(url=>url.startsWith('https://webapi.amap.com/'))).toBe(true);
 await expect.poll(async()=>Boolean(await host.dynamicCodeState('card'))).toBe(true);
 const state=await host.dynamicCodeState('card');
 expect(state,JSON.stringify(state.stacks,null,2)).toMatchObject({attempts:{Function:0,eval:0},violations:[],executed:false});await host.assertHealthy();
});
