import {contractCases} from './model-fixtures.mjs';
import {withSnapshot} from './snapshot-fixture.mjs';
import {test,expect,openHost,mapReady,message,fullscreen,AGENT} from './host-fixture.mjs';
for(const code of ['MAP_SNAPSHOT_NOT_CONFIGURED','MAP_SNAPSHOT_NO_GEOMETRY','MAP_SNAPSHOT_INVALID_GEOMETRY','MAP_SNAPSHOT_UPSTREAM_ERROR','MAP_SNAPSHOT_TOO_LARGE'])test(`${code} preserves safe model and retries through the existing MCP tool`,async({page})=>{
 const result=message();Object.assign(result._meta.gateway_ui.map_context,{enabled:false,snapshot:null,error_code:code});
 const host=await openHost(page),frame=await host.add({result});await expect(frame.locator('#map-message')).toContainText(code);await expect(frame.locator('.snapshot-svg')).toHaveCount(0);
 await expect(frame.locator('#engineer')).toBeEnabled();await expect(frame.locator('#open-gantt')).toBeVisible();await frame.locator('#map-retry').click();
 await expect.poll(async()=>(await host.pending('card')).length).toBe(1);expect((await host.pending('card'))[0].params.arguments).toEqual({job_id:result._meta.gateway_ui.job_id});
 await host.respond('card',0,message());await mapReady(frame);await host.assertHealthy();
});
for(const [name,attack]of[
 ['script','<script>window.__xss=true</script>'],['foreignObject','<foreignObject><div>attack</div></foreignObject>'],
 ['event','<circle r="2" onload="window.__xss=true"/>'],['external image','<image href="https://evil.invalid/map.png"/>'],
 ['data SVG image','<image href="data:image/svg+xml;base64,PHN2Zy8+"/>'],['style','<style>@import "https://evil.invalid/x";</style>'],
 ['external paint','<path d="M0 0L1 1" fill="url(https://evil.invalid/x)"/>'],
])test(`SVG whitelist rejects ${name} before mounting`,async({page})=>{
 const result=message(),snapshot=result._meta.gateway_ui.map_context.snapshot;snapshot.svg=snapshot.svg.replace('</svg>',attack+'</svg>');
 const host=await openHost(page),frame=await host.add({result});await expect(frame.locator('#map-message')).toContainText('MAP_SNAPSHOT_INVALID_GEOMETRY');
 await expect(frame.locator('.snapshot-svg')).toHaveCount(0);expect(await frame.evaluate(()=>window.__xss===true)).toBe(false);expect(host.requests.some(url=>url.includes('evil.invalid'))).toBe(false);await host.assertHealthy();
});
test('multiple cards isolate SVG ids, clicks, playback projection and teardown',async({page})=>{
 const host=await openHost(page),a=await host.add({id:'a'}),b=await host.add({id:'b'});await mapReady(a);await mapReady(b);
 const aId=await a.locator('.snapshot-point').first().getAttribute('id'),bId=await b.locator('.snapshot-point').first().getAttribute('id');expect(aId).not.toBe(bId);
 await a.locator('.snapshot-point[data-kind="ticket"]').first().click();await fullscreen(a);await expect(a.locator('#side-detail')).toContainText('ticket-b');
 await a.locator('#engineer').selectOption(AGENT);await a.locator('#cursor').fill('500');
 const moving=a.locator('.snapshot-playback');await expect(moving).toHaveAttribute('display','inline');await expect(moving).not.toHaveAttribute('visibility','hidden');
 expect(await moving.getAttribute('transform')).not.toBe('translate(0 0)');await expect(b.locator('#engineer')).toHaveValue('');
 await page.evaluate(()=>window.host.request('a','ui/resource-teardown',{}));await expect(a.locator('.snapshot-svg')).toHaveCount(0);await expect(b.locator('.snapshot-svg')).toBeVisible();await host.assertHealthy();
});

test('virtual engineer tickets remain neutral while real ownership mismatches are rejected',async({page})=>{
 const result=message(),plan=result._meta.gateway_ui.engine_view.solver_job.plan;plan.agents[0].virtual=true;
 const neutral=withSnapshot(result);expect(neutral._meta.gateway_ui.map_context.snapshot.elements.tickets.every(item=>item.engineer_id===null)).toBe(true);
 const host=await openHost(page),frame=await host.add({result:neutral});await mapReady(frame);
 await expect(frame.locator('.snapshot-point[data-kind="ticket"]')).toHaveCount(2);await expect(frame.locator('.snapshot-point[data-kind="agent"]')).toHaveCount(0);
 const mismatch=message();mismatch._meta.gateway_ui.map_context.snapshot.elements.tickets[0].engineer_id=null;
 const invalid=await host.add({id:'invalid-owner',result:mismatch});await expect(invalid.locator('#map-message')).toContainText('MAP_SNAPSHOT_INVALID_GEOMETRY');
 await expect(invalid.locator('.snapshot-svg')).toHaveCount(0);await host.assertHealthy();
});

for(const name of ['unknown-owner-is-not-unassigned','invalid-assignment-list-is-not-compacted'])test(`partial Map golden ${name} preserves its visual group without changing business ownership`,async({page})=>{
 const golden=contractCases().find(item=>item.name===name),result=message();expect(golden).toBeTruthy();result._meta.gateway_ui.engine_view=golden.view;
 const host=await openHost(page),frame=await host.add({result:withSnapshot(result)});await mapReady(frame);
 await expect(frame.locator('#map-legend')).toBeVisible();expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
});

test('host blocking embedded images fails visibly without showing a basemap-free route fallback',async({page})=>{
 const host=await openHost(page,{blockImages:true}),frame=await host.add();await expect(frame.locator('#map-message')).toContainText(/MAP_(?:CSP_BLOCKED|LOAD_FAILED)/);
 await expect(frame.locator('.snapshot-svg')).toHaveCount(0);await expect(frame.locator('#open-gantt')).toBeVisible();await expect(frame.locator('#map-retry')).toBeVisible();await host.assertHealthy();
});
test('201 engineers and 1001 tickets remain renderable rather than treating fixture size as a cap',async({page})=>{
 const result=message(),plan=result._meta.gateway_ui.engine_view.solver_job.plan,agent=plan.agents[0],ticket=plan.tickets[0];
 for(let index=1;index<=200;index++)plan.agents.push({...structuredClone(agent),id:`extra-agent-${index}`,tickets:[],routes:[null]});
 for(let index=2;index<=1000;index++)plan.tickets.push({...structuredClone(ticket),id:`extra-ticket-${index}`,agent:null});
 const host=await openHost(page),frame=await host.add({result:withSnapshot(result)});await mapReady(frame);
 await expect(frame.locator('.snapshot-point[data-kind="ticket"]')).toHaveCount(1001);await expect(frame.locator('#map-legend button')).toHaveCount(201);await host.assertHealthy();
});

test('special-character business IDs remain safe opaque mappings and clickable DOM values',async({page})=>{
 const result=message(),plan=result._meta.gateway_ui.engine_view.solver_job.plan,old=plan.agents[0].id,special='engineer\n\u007f\u0001';
 plan.agents[0].id=special;for(const ticket of plan.tickets)if(ticket.agent===old)ticket.agent=special;
 const host=await openHost(page),frame=await host.add({result:withSnapshot(result)});await mapReady(frame);
 await frame.locator('#engineer').selectOption(special);await expect(frame.locator('#engineer')).toHaveValue(special);await expect(frame.locator('.snapshot-point[data-kind="ticket"]')).toHaveCount(2);await host.assertHealthy();
});
