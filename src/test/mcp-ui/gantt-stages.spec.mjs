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
  test(`Gantt ${locale}/${theme} renders short locations, durations and unboxed short travel at ${width}px`,async({page})=>{
    const host=await openHost(page),frame=await host.add({result:stageResult(),width,autoSize:true,context:{locale,theme}});
    const row=frame.locator('.gantt-row').first();
    await expect(row.locator('.gantt-location')).toHaveText(['55 Example Rd','Example Library']);
    await expect(row.locator('.gantt-duration')).toHaveText(locale==='zh-CN'?['30 分钟','15 分钟']:['30 minutes','15 minutes']);
    await expect(row.locator('.gantt-travel-label')).toHaveText(locale==='zh-CN'?['3分','1分']:['3m','1m']);
    await expect(row.locator('.gantt-travel-label svg')).toHaveCount(2);
    await expect(row.locator('.result-sequence-badge')).toHaveCount(0);
    for(const phase of ['service','travel','waiting']) {
      const bar=row.locator(`.gantt-bar[data-phase="${phase}"]`).first();
      await expect(bar).toHaveAttribute('aria-label',/one-ticket-0.*55 Example Rd, Sample District, Example City 0000/);
    }
    const metrics=await row.evaluate(row=>{
      const box=el=>el.getBoundingClientRect(),track=box(row.querySelector('.gantt-track'));
      return [...row.querySelectorAll('.gantt-bar')].map(el=>({
        phase:el.dataset.phase,left:(box(el).left-track.left)/track.width,width:box(el).width/track.width,
        background:getComputedStyle(el).backgroundImage,
      }));
    });
    // The timeline is 08:00–09:25. Labels must never stretch the 1/3 minute travel lines.
    expect(metrics[0].phase).toBe('travel');expect(metrics[0].width).toBeCloseTo(3/85,4);
    expect(metrics.find(x=>x.phase==='service').width).toBeCloseTo(30/85,4);
    expect(metrics.filter(x=>x.phase==='travel')[1].width).toBeCloseTo(1/85,4);
    expect(metrics.find(x=>x.phase==='waiting').background).toContain('repeating-linear-gradient');
    const travel=row.locator('[data-phase="travel"]').first();
    await travel.hover();
    const decorations=await travel.evaluate(el=>[el,el.querySelector('.gantt-travel-label')].map(el=>{
      const s=getComputedStyle(el);return {background:s.backgroundColor,border:s.borderWidth,shadow:s.boxShadow};
    }));
    expect(decorations).toEqual(Array(2).fill({background:'rgba(0, 0, 0, 0)',border:'0px',shadow:'none'}));
    const service=row.locator('[data-phase="service"]').first();
    await service.focus();await service.press('Enter');
    await expect(frame.locator('#inline-detail')).toContainText('one-ticket-0');
    await expect(frame.locator('#inline-detail')).toContainText('55 Example Rd, Sample District, Example City 0000');
    await expect(frame.locator('#inline-detail')).toContainText('2026-09-17 08:30:00');
    await expect(frame.locator('.gantt-bar[data-phase="service"]').first()).toBeFocused();
    await fullscreen(frame);
    if(width<=700)await frame.locator('#sidebar-toggle').click();
    await expect(frame.locator('#side-detail')).toContainText('55 Example Rd, Sample District, Example City 0000');
    expect(host.requests.filter(url=>url.startsWith('https://'))).toEqual([]);
    expect(await host.pending('card')).toEqual([]);
    await host.assertHealthy();
  });
}

test('unknown and malicious locations remain plain text, ellipsize without data truncation, and missing times are never estimated',async({page})=>{
  const result=stageResult(),plan=result._meta.gateway_ui.engine_view.solver_job.plan;
  const address='<img src="https://invalid.example/x" onerror="alert(1)"> A very long unrecognized location, Unit 4, full address';
  plan.pois.find(p=>p.id==='poi-a').address=address;
  Object.assign(plan.pois.find(p=>p.id==='poi-b'),{address:null,name:null});
  plan.tickets[2].departure_time=null;
  const host=await openHost(page),frame=await host.add({result,width:920});
  await expect(frame.locator('.gantt-location').first()).toHaveText(address);
  await expect(frame.locator('.gantt-location').nth(1)).toHaveText('地点未知');
  await expect(frame.locator('.gantt-location').first()).toHaveCSS('text-overflow','ellipsis');
  await expect(frame.locator('.gantt-row').last().locator('[data-phase="service"]')).toHaveCount(1);
  await expect(frame.locator('#gantt-chart img')).toHaveCount(0);
  await host.context('card',{locale:'en-US'});
  await expect(frame.locator('.gantt-location').nth(1)).toHaveText('Unknown location');
  expect(host.requests.filter(url=>url.startsWith('https://'))).toEqual([]);
  await host.assertHealthy();
});

test('sub-minute travel annotations stay visible without stretching tiny real intervals on a multi-day axis',async({page})=>{
  const result=stageResult(),plan=result._meta.gateway_ui.engine_view.solver_job.plan;
  for(const item of [plan.agents[1],...plan.tickets.filter(t=>t.agent==='two')]){
    for(const [key,value]of Object.entries(item))if(typeof value==='string')item[key]=value.replace('2026-09-17','2026-09-18');
  }
  Object.assign(plan.tickets[0],{arrival_time:'2026-09-17 08:00:30',departure_time:'2026-09-17 08:31:00',duration:null});
  const host=await openHost(page),frame=await host.add({result,width:920});
  const row=frame.locator('.gantt-row').first();
  await expect(row.locator('.gantt-travel-label').first()).toHaveText('<1分');
  await expect(row.locator('.gantt-travel-label').first()).toBeVisible();
  await expect(row.locator('.gantt-duration').first()).toHaveText('1 分钟');
  const ratios=await row.evaluate(row=>{
    const width=row.querySelector('.gantt-track').getBoundingClientRect().width;
    return ['travel','service'].map(phase=>row.querySelector(`[data-phase="${phase}"]`).getBoundingClientRect().width/width);
  });
  expect(ratios[0]).toBeCloseTo(.5/1525,4);
  expect(ratios[1]).toBeCloseTo(1/1525,4);
  await expect(row.locator('[data-phase="travel"]').first()).toHaveAttribute('title',/30 秒.*08:00:00.*08:00:30/);
  await host.assertHealthy();
});
