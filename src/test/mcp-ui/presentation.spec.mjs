import fs from 'node:fs';
import { test, expect, openHost, message, mapReady, fullscreen } from './host-fixture.mjs';
import { GANTT_STAGE_STYLES } from '../../main/resources/META-INF/resources/static/assets/js/utils/result-presentation.mjs';

const staticRoot = new URL('../../main/resources/META-INF/resources/static/', import.meta.url);

// Compare production console primitives and the production MCP HTML in Chromium.
// This does not load the console controller into the MCP sandbox.
test('MCP timeline reuses console bar, badge, legend and metadata presentation under strict CSP', async ({ page, context }) => {
  const host = await openHost(page), frame = await host.add(); await mapReady(frame);
  await frame.locator('#tab-gantt').click();
  const consolePage = await context.newPage();
  const template = fs.readFileSync(new URL('pages/solver-job-detail.html', staticRoot), 'utf8');
  const classes = prefix => template.match(new RegExp(`class="(${prefix}[^\"]*)"`))[1];
  await consolePage.setContent(`<style>${fs.readFileSync(new URL('assets/css/style.compiled.css', staticRoot), 'utf8')}</style>
    <div class="result-presentation" style="position:relative;height:120px">
    <button id="bar" class="${classes('result-timeline-bar')}" style="width:100px;border-color:${GANTT_STAGE_STYLES.service.border};background:${GANTT_STAGE_STYLES.service.baseBackground};color:${GANTT_STAGE_STYLES.service.text}"></button>
    <span id="badge" class="${classes('result-sequence-badge')}">1</span>
    <span id="legend" class="${classes('result-phase-key')}">行程</span>
    <span id="value" class="${classes('result-detail-value')}">08:00</span></div>`);
  const presentation = (locator, properties) => locator.evaluate((element, keys) => Object.fromEntries(keys.map(key => [key, getComputedStyle(element)[key]])), properties);
  for (const [selector, reference, properties] of [
    ['.gantt-visit', '#bar', ['height','borderRadius','borderTopWidth','fontSize','borderTopColor','backgroundColor','color']],
    ['.result-sequence-badge', '#badge', ['borderRadius','lineHeight','backgroundColor','boxShadow']],
    ['.result-phase-key', '#legend', ['borderRadius','fontSize','paddingLeft','borderTopWidth']],
    ['.summary-value', '#value', ['fontFamily','fontVariantNumeric']],
  ]) {
    expect(await presentation(frame.locator(selector).first(), properties)).toEqual(await presentation(consolePage.locator(reference), properties));
  }
  for (const [phase, key] of [['travel','travel'],['waiting','wait'],['service','service']]) {
    const bar = frame.locator(`.gantt-bar[data-phase="${phase}"]`).first();
    await expect(bar).toBeVisible();
    expect(await bar.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(GANTT_STAGE_STYLES[key].background);
    expect(await bar.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(40);
  }
  await expect(frame.locator('#gantt-legend')).toContainText('等待');
  await frame.locator('.gantt-bar[data-phase="service"]').first().focus();
  await frame.locator('.gantt-bar[data-phase="service"]').first().press('Enter');
  await expect(frame.locator('#inline-detail')).toContainText('ticket-b');
  await consolePage.close();await host.assertHealthy();
});

test('shared score styling preserves exact long values and unknown or nonstandard scores', async ({ page }) => {
  const result = message();result._meta.gateway_ui.task.result_score = '0hard/-9223372036854775807medium/-860643soft';
  const host = await openHost(page), frame = await host.add({result});
  await expect(frame.locator('.result-summary-score-medium')).toHaveText('medium-9223372036854775807');
  await expect(frame.locator('.summary-score .summary-value')).toHaveAttribute('aria-label', result._meta.gateway_ui.task.result_score);
  result._meta.gateway_ui.task.result_score = null;await host.result('card', result);
  await expect(frame.locator('.summary-score')).toContainText('未知');
  result._meta.gateway_ui.task.result_score = 'unrecognized-score';await host.result('card', result);
  await expect(frame.locator('.summary-score')).toContainText('unrecognized-score');await host.assertHealthy();
});

for (const width of [375, 768, 1100]) test(`shared result presentation fits ${width}px, dark host and fullscreen`, async ({ page }) => {
  const host = await openHost(page), frame = await host.add({width, height:820, context:{locale:'en-US'}});await mapReady(frame);
  await frame.locator('#tab-gantt').click();
  expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await fullscreen(frame);
  await host.context('card', {theme:'dark', styles:{variables:{'--color-background-primary':'rgb(12, 22, 32)'}}});
  await expect(frame.locator('.gantt-visit').first()).toBeVisible();
  expect(await frame.locator('.gantt-scroll').evaluate(el => el.clientHeight)).toBeGreaterThan(150);
  expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await frame.locator('.result-sequence-badge').first().evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(32, 60, 54)');
  await host.assertHealthy();
});
