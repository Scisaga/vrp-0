import { test, expect, openHost, fullscreen } from './host-fixture.mjs';
import { ganttLayoutResult } from './gantt-layout-fixtures.mjs';

function stageResult() {
  const result=ganttLayoutResult([{id:'one',name:'Engineer One',virtual:false},{id:'two',name:'Engineer Two',virtual:false}]);
  const plan=result._meta.gateway_ui.engine_view.solver_job.plan;
  plan.pois.find(p=>p.id==='poi-a').address='55 Example Rd, Sample District, Example City 0000';
  plan.pois.find(p=>p.id==='poi-b').address='Example Library, 18 Sample St, Example City';
  plan.tickets[0].arrival_time='2026-09-17 08:03:00';
  plan.tickets[1].arrival_time='2026-09-17 09:01:00';
  return result;
}

for (const [locale,theme,width] of [['zh-CN','light',1360],['en-US','dark',375]]) {
  test(`Gantt ${locale}/${theme} shows stage details on selection and restores full annotations when expanded at ${width}px`,async({page})=>{
    const host=await openHost(page),frame=await host.add({result:stageResult(),width,autoSize:true,context:{locale,theme}});
    const row=frame.locator('.gantt-row').first();
    await expect(row.locator('.gantt-location')).toHaveText(['55 Example Rd','Example Library']);
    await expect(row.locator('.gantt-duration,.gantt-travel-label,.gantt-wait-label')).toHaveCount(0);
    await expect(row.locator('.result-sequence-badge')).toHaveCount(0);
    for(const phase of ['service','travel','waiting']) {
      const bar=row.locator(`.gantt-bar[data-phase="${phase}"]`).first();
      await expect(bar).toHaveAttribute('aria-label',/one-ticket-0.*55 Example Rd, Sample District, Example City 0000/);
    }
    const metrics=await row.evaluate(row=>{
      const box=el=>el.getBoundingClientRect(),track=box(row.querySelector('.gantt-track'));
      return [...row.querySelectorAll('.gantt-bar')].map(el=>({
        phase:el.dataset.phase,left:(box(el).left-track.left)/track.width,width:box(el).width/track.width,
        background:getComputedStyle(el,'::after').backgroundImage,
      }));
    });
    // The timeline is 08:00–09:25. Labels must never stretch the 1/3 minute travel lines.
    expect(metrics[0].phase).toBe('travel');expect(metrics[0].width).toBeCloseTo(3/85,4);
    expect(metrics.find(x=>x.phase==='service').width).toBeCloseTo(30/85,4);
    expect(metrics.filter(x=>x.phase==='travel')[1].width).toBeCloseTo(1/85,4);
    expect(metrics.find(x=>x.phase==='waiting').background).toContain('repeating-linear-gradient');
    const travel=row.locator('[data-phase="travel"]').first();
    await travel.click();
    const stage = frame.locator('#inline-detail .gantt-stage-detail');
    await expect(stage).toHaveText(locale==='zh-CN'?'行程 08:00–08:03 · 3 分钟':'Travel 08:00–08:03 · 3 minutes');
    await row.locator('[data-phase="waiting"]').first().click();
    await expect(stage).toHaveText(locale==='zh-CN'?'等待 08:03–08:30 · 27 分钟':'Waiting 08:03–08:30 · 27 minutes');
    await expect(row.locator('.gantt-bar[aria-pressed="true"]')).toHaveAttribute('data-phase','waiting');
    const service=row.locator('[data-phase="service"]').first();
    await service.focus();await service.press('Enter');
    await expect(stage).toHaveText(locale==='zh-CN'?'服务 08:30–09:00 · 30 分钟':'Service 08:30–09:00 · 30 minutes');
    await expect(frame.locator('#inline-detail h2')).toHaveText('55 Example Rd, Sample District, Example City 0000');
    await expect(frame.locator('.gantt-bar[data-phase="service"]').first()).toBeFocused();
    const fields=frame.locator('#inline-detail dl'),toggle=frame.locator('#inline-detail summary');
    await expect(fields).toBeHidden();
    await toggle.focus();await toggle.press('Enter');
    await expect(fields).toBeVisible();
    await expect(fields).toContainText('one-ticket-0');
    await expect(fields).toContainText('2026-09-17 08:30:00');
    await fullscreen(frame);
    await expect(row.locator('.gantt-duration')).toHaveText(locale==='zh-CN'?['30 分钟','15 分钟']:['30 minutes','15 minutes']);
    await expect(row.locator('.gantt-travel-label')).toHaveText(locale==='zh-CN'?['3分','1分']:['3m','1m']);
    await expect(row.locator('.gantt-travel-label svg')).toHaveCount(2);
    await expect(frame.locator('#gantt-heading .gantt-legend')).toBeVisible();
    await travel.hover();
    const decorations=await travel.evaluate(el=>[el,el.querySelector('.gantt-travel-label')].map(el=>{
      const s=getComputedStyle(el);return {background:s.backgroundColor,border:s.borderWidth,shadow:s.boxShadow};
    }));
    expect(decorations).toEqual(Array(2).fill({background:'rgba(0, 0, 0, 0)',border:'0px',shadow:'none'}));
    if(width<=700)await frame.locator('#sidebar-toggle').click();
    await expect(frame.locator('#side-detail')).toContainText('55 Example Rd, Sample District, Example City 0000');
    expect(host.requests.filter(url=>url.startsWith('https://'))).toEqual([]);
    expect(await host.pending('card')).toEqual([]);
    await host.assertHealthy();
  });
}

test('long addresses remain accessible as plain text in hints and fullscreen, and missing times are never estimated',async({page})=>{
  const result=stageResult(),plan=result._meta.gateway_ui.engine_view.solver_job.plan;
  const address='<img src="https://invalid.example/x" onerror="alert(1)"> A very long unrecognized location, Unit 4, full address';
  plan.pois.find(p=>p.id==='poi-a').address=address;
  Object.assign(plan.pois.find(p=>p.id==='poi-b'),{address:null,name:null});
  plan.tickets[2].departure_time=null;
  const host=await openHost(page),frame=await host.add({result,width:920});
  const firstRow = frame.locator('.gantt-row').first();
  const longService = firstRow.locator('[data-phase="service"]').first();
  const hint = frame.locator('#gantt-tooltip');
  await expect(longService).toBeEmpty();
  await longService.focus();
  await expect(hint).toContainText(address);
  await expect(hint).toContainText('08:30–09:00');
  await longService.press('Escape');
  await expect(hint).toBeHidden();
  await longService.hover();
  await expect(hint).toContainText(address);
  await hint.hover();
  await expect(hint).toBeVisible();
  await expect(hint.locator('img')).toHaveCount(0);
  await expect(firstRow.locator('[data-phase="service"]').nth(1)).toHaveText('地点未知');
  await expect(frame.locator('.gantt-row').last().locator('[data-phase="service"]')).toHaveCount(1);
  await expect(frame.locator('#gantt-chart img')).toHaveCount(0);
  await host.context('card',{locale:'en-US'});
  await expect(firstRow.locator('[data-phase="service"]').nth(1)).toHaveText('Unknown location');
  await fullscreen(frame);
  await expect(hint).toBeHidden();
  await expect(hint).toBeEmpty();
  await expect(longService.locator('.gantt-location')).toHaveText(address);
  await expect(longService.locator('.gantt-location')).toHaveCSS('text-overflow','ellipsis');
  expect(host.requests.filter(url=>url.startsWith('https://'))).toEqual([]);
  await host.assertHealthy();
});

test('an unlabelled narrow service remains tappable and exposes the visit number and even a fifteen-second journey', async ({browser}) => {
  const context = await browser.newContext({hasTouch:true, viewport:{width:390, height:780}});
  try {
    const result = stageResult(), ui = result._meta.gateway_ui, plan = ui.engine_view.solver_job.plan;
    ui.display_tool_name = 'gw_gantt';
    ui.scenario_version_id = 'a'.repeat(32);
    ui.task.scenario_version_id = ui.scenario_version_id;
    delete ui.image_version_id;
    delete ui.task.image_version_id;
    result.structuredContent = {
      job_id:ui.job_id,
      rows:plan.agents.map(agent => ({engineer_id:agent.id})),
      work_orders:plan.tickets.map(ticket => ({work_order_id:ticket.id})),
    };
    Object.assign(plan.tickets[1], {arrival_time:'2026-09-17 09:00:15', departure_time:'2026-09-17 09:16:00'});
    const page = await context.newPage(), host = await openHost(page);
    const frame = await host.add({result, width:375, autoSize:true, context:{locale:'en-US'}});
    const row = frame.locator('.gantt-row').first();
    const service = row.locator('[data-phase="service"]').nth(1);
    await expect(service).toBeEmpty();
    await expect(service).toHaveAccessibleName(/2 · one-ticket-1 · Example Library/);
    await service.tap();
    const detail = frame.locator('#inline-detail');
    await expect(detail.locator('.gantt-stage-detail')).toHaveText('Service 09:10–09:16 · 6 minutes');
    await detail.locator('summary').tap();
    await expect(detail.locator('dd').filter({hasText:'09:00–09:00:15 · 15 seconds'})).toBeVisible();
    await expect(detail.locator('dd').filter({hasText:'09:00:15–09:10 · 9 minutes 45 seconds'})).toBeVisible();

    await row.locator('[data-phase="waiting"]').nth(1).tap();
    await expect(detail.locator('.gantt-stage-detail')).toContainText('Waiting');
    const updated = structuredClone(result);
    updated._meta.gateway_ui.engine_view.solver_job.plan.tickets[1].arrival_time = '2026-09-17 09:10:00';
    await host.result('card', updated);
    await expect(detail.locator('.gantt-stage-detail')).toHaveText('Service 09:10–09:16 · 6 minutes');
    await expect(service).toHaveAttribute('aria-pressed', 'true');
    await expect(detail.locator('dl')).toBeVisible();
    await expect(detail.locator('dd').filter({hasText:'15 seconds'})).toHaveCount(0);
    await frame.locator('#engineer').selectOption('');
    await expect(detail).toBeHidden();
    await expect(frame.locator('.gantt-row')).toHaveCount(2);
    expect(await host.pending('card')).toEqual([]);
    await host.assertHealthy();
  } finally {
    await context.close();
  }
});

test('sub-minute travel annotations stay visible without stretching tiny real intervals on a multi-day axis',async({page})=>{
  const result=stageResult(),plan=result._meta.gateway_ui.engine_view.solver_job.plan;
  for(const item of [plan.agents[1],...plan.tickets.filter(t=>t.agent==='two')]){
    for(const [key,value]of Object.entries(item))if(typeof value==='string')item[key]=value.replace('2026-09-17','2026-09-18');
  }
  Object.assign(plan.tickets[0],{arrival_time:'2026-09-17 08:00:30',departure_time:'2026-09-17 08:31:00',duration:null});
  const host=await openHost(page),frame=await host.add({result,width:920});
  const row=frame.locator('.gantt-row').first();
  await expect(row.locator('.gantt-travel-label')).toHaveCount(0);
  await expect(row.locator('[data-phase="service"]').first()).toBeEmpty();
  const ratios=await row.evaluate(row=>{
    const width=row.querySelector('.gantt-track').getBoundingClientRect().width;
    return ['travel','service'].map(phase=>row.querySelector(`[data-phase="${phase}"]`).getBoundingClientRect().width/width);
  });
  expect(ratios[0]).toBeCloseTo(.5/1525,4);
  expect(ratios[1]).toBeCloseTo(1/1525,4);
  await expect(row.locator('[data-phase="travel"]').first()).toHaveAttribute('title',/30 秒.*08:00:00.*08:00:30/);
  await fullscreen(frame);
  await expect(row.locator('.gantt-travel-label').first()).toHaveText('<1分');
  await expect(row.locator('.gantt-travel-label').first()).toBeVisible();
  await expect(row.locator('.gantt-duration').first()).toHaveText('1 分钟');
  await host.assertHealthy();
});
