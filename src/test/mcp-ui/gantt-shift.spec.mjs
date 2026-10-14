import { test, expect, openHost, fullscreen } from './host-fixture.mjs';
import { ganttLayoutResult } from './gantt-layout-fixtures.mjs';

const result = () => ganttLayoutResult([
  {id:'day',name:'日班工程师',virtual:false},
  {id:'night',name:'跨日工程师',virtual:false,shift_off_time:'2026-09-18 02:00:00'},
  {id:'missing',name:'结束时间未提供',virtual:false,shift_off_time:null},
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
    expect(row.height).toBe(52);
    expect(row.metaHeight).toBe(14);
    expect(row.width).toBe(sizes.header);
    expect(row.fits).toBe(true);
    expect(row.overlaps).toBe(false);
  }
}

for (const [width,locale,theme] of [[920,'zh-CN','light'],[375,'zh-CN','dark'],[320,'en-US','dark']]) {
  test(`shift captions fit two compact lines at ${width}px in ${locale}, inline and fullscreen`, async ({page}) => {
    const host=await openHost(page), frame=await host.add({result:result(),width,autoSize:true,context:{locale,theme}});
    await expect(frame.locator('.gantt-shift')).toHaveCount(3);
    expect(await frame.locator('.gantt-meta').allTextContents()).toEqual([
      '2026-09-17 · 08:00–17:00',
      `2026-09-17 · 08:00–${locale==='zh-CN'?'次日':'+1d '}02:00`,
      '2026-09-17 · 08:00–—',
    ]);
    await expect(frame.locator('.gantt-shift').first()).toHaveAttribute('aria-label',/2026-09-17 08:00:00.*2026-09-17 17:00:00/);
    await expect(frame.locator('.gantt-shift').nth(1)).toHaveAttribute('aria-label',/2026-09-18 02:00:00/);
    await expectCompactLabels(frame);
    await fullscreen(frame);
    await expectCompactLabels(frame);
    await frame.locator('#fullscreen').click();
    await frame.locator('#engineer').selectOption('night');
    await expect(frame.locator('.gantt-row')).toHaveCount(1);
    await expect(frame.locator('#inline-detail')).toBeVisible();
    await expectCompactLabels(frame);
    const other=locale==='zh-CN'?'en-US':'zh-CN';
    await host.context('card',{locale:other,theme:theme==='dark'?'light':'dark'});
    await expect(frame.locator('.gantt-shift')).toHaveText(`08:00–${other==='zh-CN'?'次日':'+1d '}02:00`);
    await expectCompactLabels(frame);
    expect(host.requests.some(url=>url.startsWith('https://'))).toBe(false);
    await host.assertHealthy();
  });
}

test('missing shift fields never fall back to tickets or completion, and notifications update the caption', async ({page}) => {
  const input=result();
  const agents=input._meta.gateway_ui.engine_view.solver_job.plan.agents;
  agents[0].shift_start_time=null;
  agents[1].shift_start_time=null;agents[1].shift_off_time=null;
  agents[2].date=null;
  const host=await openHost(page), frame=await host.add({result:input,width:920,autoSize:true});
  await expect(frame.locator('.gantt-shift')).toHaveText(['—–17:00','—–—','08:00–—']);
  await expect(frame.locator('.gantt-date').last()).toHaveText('未提供');
  await expect(frame.locator('.gantt-date').last()).not.toHaveAttribute('datetime',/./);
  const updated=structuredClone(input);
  updated._meta.gateway_ui.engine_view.solver_job.plan.agents[1].shift_off_time='2026-09-19 03:30:00';
  await host.result('card',updated);
  await expect(frame.locator('.gantt-shift').nth(1)).toHaveText('—–2026-09-19 03:30');
  await expectCompactLabels(frame);
  expect(await page.evaluate(()=>window.host.cards.get('card').result._meta.gateway_ui.engine_view.solver_job.plan.agents[0].shift_start_time)).toBeNull();
  await host.assertHealthy();
});

test('captions remain business-clock values in a non-China browser timezone', async ({browser}) => {
  const context=await browser.newContext({timezoneId:'America/Los_Angeles'});
  try {
    const page=await context.newPage(), host=await openHost(page), frame=await host.add({result:result()});
    await expect(frame.locator('.gantt-meta').first()).toHaveText('2026-09-17 · 08:00–17:00');
    await expect(frame.locator('.gantt-shift').nth(1)).toHaveText('08:00–次日02:00');
    await host.assertHealthy();
  } finally { await context.close(); }
});
