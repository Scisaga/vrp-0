import { test, expect, openHost, mapReady, fullscreen, message, AGENT, JOB, VERSION } from './host-fixture.mjs';

async function layout(frame) {
  return frame.evaluate(() => {
    const rect = selector => {
      const {width, height, top, bottom} = document.querySelector(selector).getBoundingClientRect();
      return {width, height, top, bottom};
    };
    return {
      canvas: rect('#map-canvas'), legend: rect('#map-legend'), app: rect('#app'),
      toolbar: rect('.toolbar'), fullscreen: rect('#fullscreen'), switch: rect('.app-switch'),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  });
}

async function expectNoFooter(frame) {
  await expect(frame.locator('footer,#footer,.app-footer')).toHaveCount(0);
  await expect(frame.getByText('只读结果 · 业务计划时间', {exact:true})).toHaveCount(0);
  await expect(frame.getByText('Read-only result · Business plan time', {exact:true})).toHaveCount(0);
  await expect(frame.locator('#open-gantt')).toBeVisible();
  const boxes = await layout(frame);
  expect(boxes.app.bottom).toBeCloseTo(boxes.switch.bottom, 1);
}

for (const {width, ratio} of [
  {width:920, ratio:1.5}, {width:760, ratio:1.5},
  {width:700, ratio:1}, {width:444, ratio:1}, {width:375, ratio:1}, {width:320, ratio:1}
]) {
  test(`inline map at ${width}px keeps its ${ratio === 1 ? 'square' : '3:2'} canvas after host auto-sizing`, async ({page}) => {
    const host = await openHost(page);
    const frame = await host.add({width, autoSize:true});
    const renderer = await mapReady(frame);
    await expect(frame.locator('.app-header')).toHaveCount(0);
    await expect(frame.locator('.toolbar #fullscreen')).toBeVisible();
    await expect(frame.locator('.map-panel #map-legend')).toHaveCount(0);
    await expect(frame.locator('#map-legend button')).toHaveCount(1);
    await expect.poll(async () => (await layout(frame)).canvas.width / (await layout(frame)).canvas.height).toBeCloseTo(ratio, 2);
    const boxes = await layout(frame);
    expect(boxes.canvas.width).toBe(width);
    expect(boxes.legend.top).toBeGreaterThanOrEqual(boxes.canvas.bottom);
    expect(boxes.fullscreen.top).toBeGreaterThanOrEqual(boxes.toolbar.top);
    expect(boxes.fullscreen.bottom).toBeLessThanOrEqual(boxes.toolbar.bottom);
    expect(boxes.overflow).toBe(false);
    await expect.poll(() => page.locator('#card').evaluate(el => el.clientHeight)).toBe(Math.ceil(boxes.app.height));
    await expect(renderer.locator('#map')).toHaveAttribute('data-mock-map','ready');
    const {padding, horizontal} = await renderer.evaluate(() => ({
      padding:window.__mapStats.fitPadding,
      horizontal:Math.ceil(Math.max(24, ...[...document.querySelectorAll('.mcp-marker')].map(el => el.getBoundingClientRect().width / 2 + 8)))
    }));
    expect(padding).toEqual([24,24,horizontal,horizontal]);
    expect(horizontal).toBeLessThan(60);
    await expectNoFooter(frame);
    await host.assertHealthy();
  });
}

for (const provider of ['AMAP', 'HERE']) {
  test(`${provider} initial, filtered and explicit fits measure wide labels without wasting vertical space`, async ({page}) => {
    const result = message(), envelope = result._meta.gateway_ui;
    envelope.task.map_provider = provider;
    envelope.map_context.provider = provider;
    envelope.map_context.js_url = provider === 'AMAP' ? 'https://webapi.amap.com/maps?v=1.4.15' : 'https://js.api.here.com/v3/3.2/mapsjs-core.js';
    envelope.engine_view.solver_job.plan.agents[0].name = 'Alexandra Thompson';
    const host = await openHost(page), frame = await host.add({result,width:444,autoSize:true});
    const renderer = await mapReady(frame);
    const horizontal = await renderer.locator('.mcp-marker[data-kind="agent"]').evaluate(el => Math.ceil(el.getBoundingClientRect().width / 2 + 8));
    expect(horizontal).toBeGreaterThan(24);
    const expected = provider === 'AMAP' ? [24,24,horizontal,horizontal] : [24,horizontal,24,horizontal];
    const fits = () => renderer.evaluate(() => window.__mapStats.fits);
    const padding = () => renderer.evaluate(() => window.__mapStats.fitPadding);
    expect(await padding()).toEqual(expected);
    const initial = await fits();
    await frame.locator('#engineer').selectOption(AGENT);
    await expect.poll(fits).toBe(initial + 1);
    expect(await padding()).toEqual(expected);
    await frame.locator('#fit-map').click();
    await expect.poll(fits).toBe(initial + 2);
    expect(await padding()).toEqual(expected);
    await host.assertHealthy();
  });
}

test('resizing and fullscreen preserve selection, map instance and viewport while restoring inline ratios', async ({page}) => {
  const host = await openHost(page);
  const frame = await host.add({width:920, height:900, autoSize:true});
  const renderer = await mapReady(frame);
  await frame.locator('#engineer').selectOption(AGENT);
  const view = {center:[120.2,30.3], zoom:9};
  await renderer.evaluate(({center,zoom}) => window.__mapStats.maps[0].setZoomAndCenter(zoom,center), view);
  const fits = await renderer.evaluate(() => window.__mapStats.fits);

  await fullscreen(frame);
  await expect.poll(async () => (await layout(frame)).app.height).toBe(900);
  const boxes = await layout(frame);
  expect(boxes.canvas.height).toBeGreaterThan(920 / 1.5);
  expect(boxes.legend.top).toBeGreaterThanOrEqual(boxes.canvas.bottom);
  await expect(frame.locator('#sidebar')).toBeVisible();
  await expectNoFooter(frame);

  await frame.locator('#fullscreen').click();
  await expect(frame.locator('#app')).toHaveAttribute('data-mode','inline');
  await expect.poll(async () => (await layout(frame)).canvas.width / (await layout(frame)).canvas.height).toBeCloseTo(1.5, 2);
  await page.locator('#card').evaluate(el => {el.style.width = '375px';});
  await expect.poll(async () => (await layout(frame)).canvas.height).toBe(375);
  await page.locator('#card').evaluate(el => {el.style.width = '920px';});
  await expect.poll(async () => (await layout(frame)).canvas.width / (await layout(frame)).canvas.height).toBeCloseTo(1.5, 2);

  await expect(frame.locator('#engineer')).toHaveValue(AGENT);
  expect(await renderer.evaluate(() => ({maps:window.__mapStats.maps.length, destroyed:window.__mapStats.destroyed,
    fits:window.__mapStats.fits, center:window.__mapStats.maps[0].center, zoom:window.__mapStats.maps[0].zoom})))
    .toEqual({maps:1, destroyed:0, fits, ...view});
  await host.assertHealthy();
});

test('map footer stays removed across selection, locale, theme and display mode changes without losing Gantt or replay controls', async ({page}) => {
  const host = await openHost(page);
  const frame = await host.add({width:920, height:900, autoSize:true});
  await mapReady(frame);
  await expectNoFooter(frame);
  await frame.locator('#engineer').selectOption(AGENT);
  await host.context('card', {locale:'en-US', theme:'dark'});
  await mapReady(frame);
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(frame.locator('#open-gantt')).toHaveText('View Gantt schedule');
  await expectNoFooter(frame);
  await fullscreen(frame);
  await expect(frame.locator('#playback')).toBeVisible();
  await expect(frame.locator('#playback-label')).toHaveText('Planned replay · Not live tracking');
  await expectNoFooter(frame);
  await host.context('card', {locale:'zh-CN', theme:'light'});
  await mapReady(frame);
  await expect(frame.locator('#open-gantt')).toHaveText('查看 Gantt 排程');
  await expect(frame.locator('#playback-label')).toHaveText('规划回放 · 非实时位置');
  await expectNoFooter(frame);
  await frame.locator('#fullscreen').click();
  await expect(frame.locator('#app')).toHaveAttribute('data-mode', 'inline');
  await expect(frame.locator('#engineer')).toHaveValue(AGENT);
  await expectNoFooter(frame);
  expect(await host.pending('card')).toHaveLength(0);
  expect(await host.messages('card')).toHaveLength(0);
  await frame.locator('#open-gantt').click();
  await expect.poll(async () => (await host.messages('card')).length).toBe(1);
  expect(await host.messages('card')).toEqual([{role:'user', content:[{
    type:'text', text:JSON.stringify({intent:'show_job_gantt', job_id:JOB, image_version_id:VERSION})
  }]}]);
  await expectNoFooter(frame);
  await host.assertHealthy();
});
