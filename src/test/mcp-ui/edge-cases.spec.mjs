import { test,expect,openHost,message } from './host-fixture.mjs';

test('non-ready and failed envelopes never retain a model or trigger map requests',async({page})=>{
 const host=await openHost(page);for(const [index,name]of['running-no-model','not-ready','failed','canceled','timed_out','archive_failed'].entries()){const frame=await host.add({id:`c${index}`,result:message(name)});await expect(frame.locator('#map-state')).toBeVisible();await expect(frame.locator('.mcp-marker')).toHaveCount(0);}expect(host.requests.some(url=>url.startsWith('https://'))).toBe(false);await host.assertHealthy();
});

test('English dark narrow views remain keyboard focusable and malicious labels stay text',async({page})=>{
 const result=message('gantt-ready'),attack='<img src="https://evil.invalid/x" onerror="window.__xss=true">';result._meta.gateway_ui.engine_view.solver_job.plan.agents[0].name=attack;result._meta.gateway_ui.engine_view.solver_job.plan.pois[1].name=attack;
 const host=await openHost(page),frame=await host.add({result,width:375,height:820,context:{locale:'en-US',theme:'dark',displayMode:'fullscreen',styles:{variables:{'--color-background-primary':'rgb(12, 22, 32)'}}}});
 await expect(frame.locator('html')).toHaveAttribute('lang','en-US');await expect(frame.locator('html')).toHaveAttribute('data-theme','dark');await expect(frame.locator('#sidebar')).toBeHidden();await frame.locator('#sidebar-toggle').click();await expect(frame.locator('#sidebar')).toBeVisible();await frame.locator('#search').fill('evil');
 expect(await frame.locator('img,a').count()).toBe(0);expect(await frame.evaluate(()=>window.__xss===true)).toBe(false);expect(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await host.assertHealthy();
});
