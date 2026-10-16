import { test, expect, openHost, fullscreen } from './host-fixture.mjs';
import { ganttLayoutResult } from './gantt-layout-fixtures.mjs';

const real = (id, name=id) => ({id,name,virtual:false});
const agentRows = frame => frame.locator('.gantt-row');

async function compactBoxes(frame) {
  return frame.evaluate(() => {
    const box = selector => {
      const {height, top, bottom} = document.querySelector(selector).getBoundingClientRect();
      return {height, top, bottom};
    };
    return {app:box('#app'), chart:box('#gantt-chart'), scroll:box('#gantt-scroll'), detail:box('#inline-detail')};
  });
}

test('Gantt fills the timeline with independent service blocks, time-only ticks and no footer', async ({page}) => {
  const host = await openHost(page);
  const frame = await host.add({result:ganttLayoutResult([real('real-a'),real('real-b')]),width:1100,autoSize:true});
  await expect(agentRows(frame)).toHaveCount(2);
  await expect(frame.locator('#gantt-in,#gantt-out,.gantt-tools,#footer,.app-footer')).toHaveCount(0);
  const sizes = await frame.evaluate(() => ({
    grid:document.querySelector('.gantt-grid').getBoundingClientRect().width,
    available:document.querySelector('#gantt-scroll').clientWidth,
    label:document.querySelector('.gantt-label').getBoundingClientRect().width,
    row:document.querySelector('.gantt-row').getBoundingClientRect().height,
    visit:document.querySelector('.gantt-visit').getBoundingClientRect().height,
    ticks:[...document.querySelectorAll('.gantt-tick')].map(el => ({text:el.textContent,title:el.title,label:el.getAttribute('aria-label')}))
  }));
  expect(sizes.grid).toBeCloseTo(Math.max(sizes.label+896,sizes.available),1);
  expect(sizes.row).toBe(76); expect(sizes.visit).toBe(44);
  for (const tick of sizes.ticks) {
    expect(tick.text).toMatch(/^\d{2}:\d{2}(?::\d{2})?$/);
    expect(tick.title).toMatch(/^2026-09-17 \d{2}:\d{2}:\d{2}$/);
    expect(tick.label).toBe(tick.title);
  }
  await expect(frame.locator('.gantt-date').first()).toHaveText('2026-09-17');
  await expect(frame.locator('.gantt-date').first()).toHaveAttribute('datetime','2026-09-17');
  await expect(frame.locator('#gantt-scroll')).toHaveAttribute('aria-label',/业务计划时间/);
  await expect(frame.locator('#inline-detail')).toBeHidden();
  expect(host.requests.some(url => url.startsWith('https://'))).toBe(false);
  await host.assertHealthy();
});

test('virtual engineers are hidden from rows, filtering and fullscreen lists without dropping unknown types or source data', async ({page}) => {
  const result = ganttLayoutResult([real('real-a','真实工程师'),
    {id:'virtual-a',name:'虚拟工程师',virtual:true,date:'2026-09-16'},
    {id:'unknown-a',name:'类型未提供',virtual:null,date:null}]);
  const host = await openHost(page), frame = await host.add({result,autoSize:true});
  await expect(agentRows(frame)).toHaveCount(2);
  await expect(frame.locator('#engineer option[value="virtual-a"]')).toHaveCount(0);
  await expect(frame.locator('#engineer option[value="unknown-a"]')).toHaveCount(1);
  await expect(frame.locator('.gantt-row')).not.toContainText(['虚拟工程师']);
  await expect(frame.locator('.gantt-tick').first()).toHaveText('08:00');
  await expect(frame.locator('.gantt-date').last()).toHaveText('未提供');
  await expect(frame.locator('.gantt-date').last()).not.toHaveAttribute('datetime',/./);
  expect(await page.evaluate(() => window.host.cards.get('card').result._meta.gateway_ui.engine_view.solver_job.plan.agents.length)).toBe(3);
  await fullscreen(frame);
  await expect(frame.locator('#side-list .ticket-row')).toHaveCount(2);
  await expect(frame.locator('#side-list')).not.toContainText('虚拟工程师');
  await host.assertHealthy();
});

test('selecting an engineer brings details directly below the compact chart and shrinks the host', async ({page}) => {
  const result = ganttLayoutResult(Array.from({length:8},(_,index) => real(`real-${index}`)));
  const host = await openHost(page), frame = await host.add({result,width:920,autoSize:true});
  await expect(agentRows(frame)).toHaveCount(8);
  await expect.poll(async () => (await compactBoxes(frame)).scroll.height).toBe(577);
  const before = (await compactBoxes(frame)).app.height;
  await agentRows(frame).first().locator('.gantt-label button').click();
  await expect(agentRows(frame)).toHaveCount(1);
  await expect(frame.locator('#inline-detail')).toBeVisible();
  await expect(frame.locator('#inline-detail')).toContainText('real-0');
  const boxes = await compactBoxes(frame);
  expect(boxes.scroll.height).toBeCloseTo(boxes.chart.height,1);
  expect(boxes.detail.top - boxes.chart.bottom).toBeLessThanOrEqual(1);
  expect(boxes.detail.top).toBeGreaterThanOrEqual(boxes.chart.bottom);
  expect(boxes.app.height).toBeLessThan(before);
  await expect.poll(() => page.locator('#card').evaluate(el => el.clientHeight)).toBe(Math.ceil(boxes.app.height));
  await frame.locator('#engineer').selectOption('');
  await expect(agentRows(frame)).toHaveCount(8);
  await expect(frame.locator('#inline-detail')).toBeHidden();
  expect((await host.pending('card')).length).toBe(0);
  await host.assertHealthy();
});

test('narrow English dark Gantt keeps dates separate, scrolls only the chart horizontally and restores compact height after fullscreen', async ({page}) => {
  const result = ganttLayoutResult([real('real-a','Engineer A')]);
  const host = await openHost(page), frame = await host.add({result,width:320,height:800,autoSize:true,context:{locale:'en-US',theme:'dark'}});
  await expect(agentRows(frame)).toHaveCount(1);
  await expect(frame.locator('.gantt-date')).toHaveText('2026-09-17');
  const widths = await frame.evaluate(() => ({body:document.documentElement.scrollWidth,available:document.documentElement.clientWidth,
    chart:document.getElementById('gantt-scroll').scrollWidth,scroll:document.getElementById('gantt-scroll').clientWidth,
    end:document.querySelector('.gantt-tick:last-child').getBoundingClientRect().right,
    grid:document.querySelector('.gantt-grid').getBoundingClientRect().right}));
  expect(widths.body).toBe(widths.available);
  expect(widths.chart).toBeGreaterThan(widths.scroll);
  expect(widths.end).toBeLessThanOrEqual(widths.grid);
  const inline = (await compactBoxes(frame)).app.height;
  await fullscreen(frame);
  await frame.locator('#sidebar-toggle').click();
  await expect(frame.locator('#sidebar')).toBeVisible();
  await expect(frame.locator('#app')).toHaveAttribute('data-mode','fullscreen');
  await frame.locator('#fullscreen').click();
  await expect.poll(async () => (await compactBoxes(frame)).app.height).toBeCloseTo(inline,1);
  await expect(frame.locator('#footer')).toHaveCount(0);
  await host.assertHealthy();
});

test('multi-day schedules retain left-hand business dates and complete tick timestamps without timezone conversion', async ({page}) => {
  const result = ganttLayoutResult([real('day-1'),{...real('day-2'),date:'2026-09-18'}]);
  const host = await openHost(page), frame = await host.add({result});
  await expect(agentRows(frame)).toHaveCount(2);
  expect(await frame.locator('.gantt-date').allTextContents()).toEqual(['2026-09-17','2026-09-18']);
  await expect(frame.locator('.gantt-tick').first()).toHaveText('08:00');
  await expect(frame.locator('.gantt-tick').last()).toHaveText('09:25');
  await expect(frame.locator('.gantt-tick').last()).toHaveAttribute('title','2026-09-18 09:25:00');
  await host.context('card',{locale:'en-US',theme:'dark'});
  expect(await frame.locator('.gantt-date').allTextContents()).toEqual(['2026-09-17','2026-09-18']);
  await expect(frame.locator('.gantt-tick').last()).toHaveText('09:25');
  await host.assertHealthy();
});

test('a result notification that makes the selected engineer virtual clears its hidden focus and details', async ({page}) => {
  const result = ganttLayoutResult([real('real-a'),real('real-b')]);
  const host = await openHost(page), frame = await host.add({result,autoSize:true});
  await frame.locator('#engineer').selectOption('real-a');
  await expect(frame.locator('#inline-detail')).toContainText('real-a');
  const updated = structuredClone(result);
  updated._meta.gateway_ui.engine_view.solver_job.plan.agents[0].virtual = true;
  await host.result('card',updated);
  await expect(frame.locator('#engineer')).toHaveValue('');
  await expect(frame.locator('#engineer option[value="real-a"]')).toHaveCount(0);
  await expect(frame.locator('#inline-detail')).toBeHidden();
  await expect(agentRows(frame)).toHaveCount(1);
  await expect(agentRows(frame)).toContainText(['real-b']);
  await host.assertHealthy();
});

test('all-virtual and unknown collections remain explicit empty or unknown states, not phantom engineer rows', async ({page}) => {
  const result = ganttLayoutResult([{id:'virtual-a',name:'虚拟工程师',virtual:true}]);
  const host = await openHost(page), frame = await host.add({result,autoSize:true});
  await expect(agentRows(frame)).toHaveCount(0);
  await expect(frame.locator('#gantt-chart')).toContainText('缺少真实排程时间');
  await expect(frame.locator('#engineer option')).toHaveCount(1);
  const unknown = structuredClone(result);
  Object.assign(unknown._meta.gateway_ui.engine_view.solver_job.plan,{agents:null,tickets:null,pois:null});
  await host.result('card',unknown);
  await fullscreen(frame);
  await expect(frame.locator('#side-list')).toContainText('部分集合未知');
  await expect(frame.locator('#engineer')).toBeDisabled();
  await host.assertHealthy();
});

test('zero-duration services stay visible and centered in the independent service block', async ({page}) => {
  const result = ganttLayoutResult([real('real-a')]);
  const ticket = result._meta.gateway_ui.engine_view.solver_job.plan.tickets[0];
  ticket.departure_time = ticket.start_service_time; ticket.duration = 'PT0S';
  const host = await openHost(page), frame = await host.add({result});
  const point = frame.locator('.gantt-bar[data-zero="true"]');
  await expect(point).toHaveCount(1);
  await expect(point).toBeVisible();
  const centers = await point.evaluate(el => {const point=el.getBoundingClientRect(),parent=el.parentElement.getBoundingClientRect();
    return {point:point.top+point.height/2,parent:parent.top+parent.height/2};});
  expect(centers.point).toBeCloseTo(centers.parent,1);
  await point.focus(); await point.press('Enter');
  await expect(frame.locator('#inline-detail')).toContainText(ticket.id);
  await host.assertHealthy();
});

for (const {width,locale} of [{width:920,locale:'zh-CN'},{width:760,locale:'en-US'},
  {width:375,locale:'zh-CN'},{width:320,locale:'en-US'}]) {
  test(`Gantt at ${width}px places the ${locale} engineer filter on the legend row's right`, async ({page}) => {
    const host=await openHost(page),frame=await host.add({result:ganttLayoutResult([real('real-a')]),width,autoSize:true,context:{locale}});
    await expect(agentRows(frame)).toHaveCount(1);
    await expect(frame.locator('.toolbar')).toHaveCount(0);
    await expect(frame.locator('.gantt-heading #engineer')).toBeVisible();
    await expect(frame.locator('.app-header #sidebar-toggle')).toHaveCount(1);
    await expect(frame.getByRole('combobox',{name:locale==='en-US'?'Engineer':'工程师',exact:true})).toBeVisible();
    const boxes=await frame.evaluate(()=>{
      const rect=selector=>{const {top,bottom,left,right}=document.querySelector(selector).getBoundingClientRect();return {top,bottom,left,right};};
      return {row:rect('.gantt-heading'),legend:rect('#gantt-legend'),filter:rect('.gantt-heading .engineer-filter'),
        overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
    });
    expect(boxes.filter.left).toBeGreaterThanOrEqual(boxes.legend.right);
    expect(boxes.filter.top).toBeGreaterThanOrEqual(boxes.row.top);
    expect(boxes.filter.bottom).toBeLessThanOrEqual(boxes.row.bottom);
    expect(boxes.filter.right).toBeGreaterThan(boxes.row.right-20);
    expect(boxes.filter.top).toBeLessThan(boxes.legend.bottom);
    expect(boxes.filter.bottom).toBeGreaterThan(boxes.legend.top);
    expect(boxes.overflow).toBe(false);
    await host.assertHealthy();
  });
}

for (const locale of ['zh-CN','en-US']) {
  test(`Gantt ${locale} removes empty-detail hints in inline and fullscreen but retains chosen details`, async ({page}) => {
    const host=await openHost(page),frame=await host.add({result:ganttLayoutResult([real('real-a')]),autoSize:true,context:{locale}});
    await expect(agentRows(frame)).toHaveCount(1);
    const hint=/选择工程师或工单查看详情|Choose an engineer or ticket|Select an engineer or ticket/;
    await expect(frame.locator('body')).not.toContainText(hint);
    await expect(frame.locator('#inline-detail')).toBeHidden();
    await fullscreen(frame);
    await expect(frame.locator('#side-detail')).toBeEmpty();
    await expect(frame.locator('#side-detail')).toBeHidden();
    await frame.locator('#side-list .ticket-row').first().click();
    await expect(frame.locator('#side-detail')).toBeVisible();
    await expect(frame.locator('#side-detail')).toContainText('real-a');
    await frame.locator('#engineer').selectOption('');
    await expect(frame.locator('#side-detail')).toBeEmpty();
    await expect(frame.locator('#side-detail')).toBeHidden();
    await expect(frame.locator('body')).not.toContainText(hint);
    await frame.locator('#fullscreen').click();
    await agentRows(frame).first().locator('.gantt-label button').click();
    await expect(frame.locator('#inline-detail')).toBeVisible();
    await expect(frame.locator('#inline-detail')).toContainText('real-a');
    await expect(frame.locator('body')).not.toContainText(hint);
    await host.assertHealthy();
  });
}
