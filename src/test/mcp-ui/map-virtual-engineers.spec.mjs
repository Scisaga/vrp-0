import {test,expect,openHost,message,mapReady,fullscreen,chooseEngineer,AGENT,JOB} from './host-fixture.mjs';
import {withSnapshot} from './snapshot-fixture.mjs';

function mixedResult(){
  const result=message(),plan=result._meta.gateway_ui.engine_view.solver_job.plan,original=plan.agents[0];
  plan.agents.push({...structuredClone(original),id:'virtual-person',name:'Hidden virtual person',virtual:true,tickets:['virtual-ticket'],routes:[]},
    {...structuredClone(original),id:'unknown-person',name:'Visible unknown type',virtual:null,tickets:[],routes:[]});
  plan.tickets.push({...structuredClone(plan.tickets[0]),id:'virtual-ticket',agent:'virtual-person'});
  return withSnapshot(result);
}
const options=frame=>frame.locator('#engineer-options [role="option"]');
const rows=frame=>frame.locator('#side-list .ticket-row');
async function expectHiddenVirtual(frame,count=2){
  await expect(frame.locator('#engineer')).toContainText(` · ${count}`);
  await expect(frame.locator('#engineer-options [data-engineer-id="virtual-person"]')).toHaveCount(0);
  await expect(frame.locator('.snapshot-svg [data-id="virtual-person"]')).toHaveCount(0);
  await expect(frame.locator('#app')).not.toContainText('Hidden virtual person');
}

for(const locale of ['zh-CN','en-US'])test(`map hides virtual engineers from counts, choices and fullscreen while retaining unassigned tickets (${locale})`,async({page})=>{
  const host=await openHost(page),frame=await host.add({result:mixedResult(),width:920,height:900,autoSize:true,context:{locale}});await mapReady(frame);await expectHiddenVirtual(frame);
  await frame.locator('#engineer').click();await expect(options(frame)).toHaveCount(3);await expect(options(frame)).toContainText(['','合成工程师 A','Visible unknown type']);await frame.locator('#engineer').press('Escape');
  await expect(frame.locator('.snapshot-svg [data-kind="ticket"]')).toHaveCount(3);
  const unassigned=frame.locator('.snapshot-svg [data-kind="ticket"][data-id="virtual-ticket"]');await expect(unassigned.locator('text')).toHaveText('?');await expect(unassigned.locator('.snapshot-ticket-face')).toHaveAttribute('fill','#475569');
  await fullscreen(frame);await expect(rows(frame)).toHaveCount(2);await expect(frame.locator('#side-list')).toContainText('Visible unknown type');await expect(frame.locator('#side-list')).not.toContainText('Hidden virtual person');await expectHiddenVirtual(frame);
  await frame.locator('#side-tickets').click();await expect(rows(frame)).toHaveCount(3);await rows(frame).filter({hasText:'virtual-ticket'}).click();
  await expect(frame.locator('#side-detail')).toContainText(locale==='zh-CN'?'未安排':'Unassigned');await expect(frame.locator('#side-detail')).not.toContainText('Hidden virtual person');await expect(frame.locator('#engineer')).toHaveJSProperty('value','');
  expect(await host.pending('card')).toHaveLength(0);await host.assertHealthy();
});

test('an initial virtual engineer selection falls back to the complete visible map',async({page})=>{
  const result=mixedResult();result._meta.gateway_ui.engineer_id='virtual-person';
  const host=await openHost(page),frame=await host.add({result,input:{job_id:JOB,engineer_id:'virtual-person'},width:320,height:900,autoSize:true});await mapReady(frame);
  await expectHiddenVirtual(frame);await expect(frame.locator('#engineer')).toHaveJSProperty('value','');await expect(frame.locator('.snapshot-svg [data-kind="ticket"][display="inline"]')).toHaveCount(3);await expect(frame.locator('#notice')).toBeHidden();
  await fullscreen(frame);await frame.locator('#sidebar-toggle').click();await expect(rows(frame)).toHaveCount(2);await expect(frame.locator('#side-list')).not.toContainText('Hidden virtual person');await host.assertHealthy();
});

test('a selected engineer becoming virtual clears selection and details without hiding their unassigned tickets',async({page})=>{
  const result=mixedResult(),host=await openHost(page),frame=await host.add({result,width:920,height:900,autoSize:true});await mapReady(frame);await fullscreen(frame);
  await chooseEngineer(frame,AGENT);await frame.locator('#side-tickets').click();await rows(frame).first().click();await expect(frame.locator('#engineer')).toHaveJSProperty('value',AGENT);await expect(frame.locator('#side-detail')).toContainText('ticket-b');
  const updated=structuredClone(result);updated._meta.gateway_ui.engine_view.solver_job.plan.agents[0].virtual=true;await host.result('card',withSnapshot(updated));await mapReady(frame);
  await expectHiddenVirtual(frame,1);await expect(frame.locator('#engineer')).toHaveJSProperty('value','');await expect(frame.locator('#side-detail .detail-grid')).toHaveCount(0);await expect(frame.locator('.snapshot-svg [data-id="'+AGENT+'"]')).toHaveCount(0);
  await expect(frame.locator('.snapshot-svg [data-kind="ticket"][display="inline"]')).toHaveCount(3);await frame.locator('#side-agents').click();await expect(rows(frame)).toHaveCount(1);await expect(rows(frame)).toContainText('Visible unknown type');await host.assertHealthy();
});

test('all-virtual agents show zero visible engineers while unknown collections remain unknown',async({page})=>{
  const result=mixedResult();for(const agent of result._meta.gateway_ui.engine_view.solver_job.plan.agents)agent.virtual=true;
  const host=await openHost(page),frame=await host.add({result:withSnapshot(result),width:920,height:900,autoSize:true});await mapReady(frame);await expectHiddenVirtual(frame,0);
  await frame.locator('#engineer').click();await expect(options(frame)).toHaveCount(1);await frame.locator('#engineer').press('Escape');await expect(frame.locator('.snapshot-engineer,.snapshot-engineer-cluster')).toHaveCount(0);await expect(frame.locator('.snapshot-svg [data-kind="ticket"]')).toHaveCount(3);
  await fullscreen(frame);await expect(rows(frame)).toHaveCount(0);await expect(frame.locator('#side-list')).toContainText('当前计划为空');
  const unknown=mixedResult();unknown._meta.gateway_ui.engine_view.solver_job.plan.agents=null;await host.result('card',withSnapshot(unknown));await mapReady(frame);
  await expect(frame.locator('#engineer')).toBeDisabled();await expect(frame.locator('#engineer')).not.toContainText(' · 0');await expect(frame.locator('#side-list')).toContainText('部分集合未知');await host.assertHealthy();
});
