import { test, expect, openHost, fullscreen } from './host-fixture.mjs';
import { ganttLayoutResult } from './gantt-layout-fixtures.mjs';

const result = () => ganttLayoutResult([
  {id:'day',name:'日班工程师',virtual:false,shift_off_time:'2026-09-17 18:00:00',tickets_done_time:'2026-09-17 10:45:00'},
  {id:'night',name:'跨日工程师',virtual:false,shift_off_time:'2026-09-17 18:00:00',tickets_done_time:'2026-09-18 02:00:00'},
  {id:'missing',name:'完成时间未提供',virtual:false,shift_off_time:'2026-09-17 18:00:00',tickets_done_time:null},
]);

async function expectCompactLabels(frame) {
  const sizes = await frame.evaluate(() => ({
    header:document.querySelector('.gantt-head .gantt-label').getBoundingClientRect().width,
    body:document.documentElement.scrollWidth, available:document.documentElement.clientWidth,
    rows:[...document.querySelectorAll('.gantt-row')].map(row => {
      const caption=row.querySelector('.gantt-label'), meta=row.querySelector('.gantt-meta');
      const box=caption.getBoundingClientRect(), line=meta.getBoundingClientRect();
      return {height:row.getBoundingClientRect().height,width:box.width,metaHeight:line.height,
        fits:line.left>=box.left && line.right<=box.right && line.bottom<=box.bottom,
        overlaps:line.top<row.querySelector('button').getBoundingClientRect().bottom};
    }),
  }));
  expect(sizes.body).toBe(sizes.available);
  for (const row of sizes.rows) {
    expect(row.height).toBe(76);
    expect(row.metaHeight).toBe(14);
    expect(row.width).toBe(sizes.header);
    expect(row.fits).toBe(true);
    expect(row.overlaps).toBe(false);
  }
}

for (const [width,locale,theme] of [[920,'zh-CN','light'],[375,'zh-CN','dark'],[320,'en-US','dark']]) {
  test(`execution captions fit two compact lines at ${width}px in ${locale}, inline and fullscreen`, async ({page}) => {
    const host=await openHost(page), frame=await host.add({result:result(),width,autoSize:true,context:{locale,theme}});
    await expect(frame.locator('.gantt-range')).toHaveCount(3);
    expect(await frame.locator('.gantt-meta').allTextContents()).toEqual([
      '2026-09-17 · 08:00–10:45',
      `2026-09-17 · 08:00–${locale==='zh-CN'?'次日':'+1d '}02:00`,
      '2026-09-17 · 08:00–09:25',
    ]);
    await expect(frame.locator('.gantt-range').first()).toHaveAttribute('aria-label',/2026-09-17 08:00:00.*2026-09-17 10:45:00/);
    await expect(frame.locator('.gantt-range').nth(1)).toHaveAttribute('aria-label',/2026-09-18 02:00:00/);
    await expectCompactLabels(frame);
    await fullscreen(frame);
    await expectCompactLabels(frame);
    await frame.locator('#fullscreen').click();
    await frame.locator('#engineer').selectOption('night');
    await expect(frame.locator('.gantt-row')).toHaveCount(1);
    await expect(frame.locator('#inline-detail')).toBeVisible();
    await expect(frame.locator('#inline-detail')).toContainText(locale==='zh-CN'?'班次结束':'Shift end');
    await expect(frame.locator('#inline-detail')).toContainText('2026-09-17 18:00:00');
    const shiftEnd=frame.locator('#inline-detail dd').filter({hasText:'2026-09-17 18:00:00'});
    await shiftEnd.scrollIntoViewIfNeeded();
    await expect(shiftEnd).toBeVisible();
    await expect(frame.locator('.gantt-visit')).toHaveCount(2);
    await expectCompactLabels(frame);
    await fullscreen(frame);
    if(width<=700)await frame.locator('#sidebar-toggle').click();
    await expect(frame.locator('#side-detail')).toContainText(locale==='zh-CN'?'班次结束':'Shift end');
    await expect(frame.locator('#side-detail')).toContainText('2026-09-17 18:00:00');
    await frame.locator('#fullscreen').click();
    const other=locale==='zh-CN'?'en-US':'zh-CN';
    await host.context('card',{locale:other,theme:theme==='dark'?'light':'dark'});
    await expect(frame.locator('.gantt-range')).toHaveText(`08:00–${other==='zh-CN'?'次日':'+1d '}02:00`);
    await expectCompactLabels(frame);
    expect(host.requests.some(url=>url.startsWith('https://'))).toBe(false);
    await host.assertHealthy();
  });
}

test('no jobs or no real stages show a dash despite complete shift and completion fields', async ({page}) => {
  const input=result(), plan=input._meta.gateway_ui.engine_view.solver_job.plan;
  plan.agents[0].tickets=[];
  plan.tickets=plan.tickets.filter(ticket=>ticket.agent!=='day');
  for(const ticket of plan.tickets.filter(ticket=>ticket.agent==='night')) {
    ticket.arrival_time=null;ticket.start_service_time=null;ticket.departure_time=null;
  }
  plan.agents[2].date=null;
  const host=await openHost(page), frame=await host.add({result:input,width:920,autoSize:true});
  await expect(frame.locator('.gantt-range')).toHaveText(['-','-','08:00–09:25']);
  await expect(frame.locator('.gantt-date').last()).toHaveText('未提供');
  await expect(frame.locator('.gantt-date').last()).not.toHaveAttribute('datetime',/./);
  await expect(frame.locator('.gantt-row').first()).toContainText('该工程师暂无已安排工单');
  const updated=structuredClone(input);
  updated._meta.gateway_ui.engine_view.solver_job.plan.agents[2].tickets_done_time='2026-09-19 03:30:00';
  await host.result('card',updated);
  await expect(frame.locator('.gantt-range').last()).toHaveText('08:00–2026-09-19 03:30');
  await expectCompactLabels(frame);
  expect(await page.evaluate(()=>window.host.cards.get('card').result._meta.gateway_ui.engine_view.solver_job.plan.agents[2].date)).toBeNull();
  await host.assertHealthy();
});

test('captions remain business-clock values in a non-China browser timezone', async ({browser}) => {
  const context=await browser.newContext({timezoneId:'America/Los_Angeles'});
  try {
    const page=await context.newPage(), host=await openHost(page), frame=await host.add({result:result()});
    await expect(frame.locator('.gantt-meta').first()).toHaveText('2026-09-17 · 08:00–10:45');
    await expect(frame.locator('.gantt-range').nth(1)).toHaveText('08:00–次日02:00');
    await host.assertHealthy();
  } finally { await context.close(); }
});
