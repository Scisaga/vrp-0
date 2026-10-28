import { test, expect, openHost, mapReady, fullscreen, AGENT } from './host-fixture.mjs';

test('route-fit icon has an accessible name and a hoverable, dismissible tooltip', async ({page}) => {
  const host=await openHost(page),frame=await host.add({width:920,autoSize:true});await mapReady(frame);
  const fit=frame.locator('#fit-map'),tip=frame.locator('#fit-map-tip');
  await expect(fit).toHaveAccessibleName('显示完整路线');
  await expect(fit).toHaveAttribute('aria-describedby','fit-map-tip');
  await expect(fit.locator('svg')).toHaveCount(1);
  await expect(fit.locator('svg')).toHaveAttribute('aria-hidden','true');
  expect((await fit.textContent()).trim()).toBe('');
  const box=await fit.boundingBox();expect(box.width).toBe(36);expect(box.height).toBe(36);
  await expect(tip).toBeHidden();
  await fit.hover();await expect(tip).toBeVisible();await expect(tip).toHaveText('显示完整路线');
  await tip.hover();await expect(tip).toBeVisible();
  // Keep the active keyboard realm in the App while hovering its tooltip.
  await frame.locator('#engineer').press('Escape');await expect(tip).toBeHidden();
  await page.mouse.move(0,0);await fit.hover();await expect(tip).toBeVisible();
  await host.assertHealthy();
});

test('keyboard focus and activation retain the icon and engineer selection and call only the existing fit', async ({page}) => {
  const host=await openHost(page),frame=await host.add();const renderer=await mapReady(frame);
  await frame.locator('#engineer').selectOption(AGENT);
  await expect(renderer.locator('.snapshot-point[data-kind="agent"][data-selected="true"]')).toHaveCount(1);
  const fit=frame.locator('#fit-map'),tip=frame.locator('#fit-map-tip');
  await expect(fit.locator('svg')).toHaveCount(1);
  const viewport=()=>renderer.locator('.snapshot-svg').getAttribute('viewBox');
  const before=await viewport();await frame.getByRole('button',{name:'放大地图',exact:true}).click();expect(await viewport()).not.toBe(before);
  await fit.focus();await expect(tip).toBeVisible();await fit.press('Escape');await expect(tip).toBeHidden();
  await frame.locator('#engineer').focus();await fit.focus();await expect(tip).toBeVisible();
  await fit.press('Enter');await expect.poll(viewport).toBe(before);
  await fit.click();await expect.poll(viewport).toBe(before);
  await expect(frame.locator('#engineer')).toHaveValue(AGENT);
  await expect(fit.locator('svg')).toHaveCount(1);
  expect((await host.pending('card')).length).toBe(0);expect((await host.messages('card')).length).toBe(0);
  await host.assertHealthy();
});

test('locale and theme changes update tooltip and accessible name without replacing the icon', async ({page}) => {
  const host=await openHost(page),frame=await host.add();await mapReady(frame);
  await frame.locator('#engineer').selectOption(AGENT);
  await host.context('card',{locale:'en-US',theme:'dark'});await mapReady(frame);
  const fit=frame.locator('#fit-map'),tip=frame.locator('#fit-map-tip');
  await expect(fit).toHaveAccessibleName('Show full routes');
  await expect(fit.locator('svg')).toHaveCount(1);await fit.focus();
  await expect(tip).toBeVisible();await expect(tip).toHaveText('Show full routes');
  await expect(frame.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(frame.locator('#engineer')).toHaveValue(AGENT);
  await host.context('card',{locale:'zh-CN',theme:'light'});await mapReady(frame);
  await expect(fit).toHaveAccessibleName('显示完整路线');await expect(tip).toHaveText('显示完整路线');
  await expect(fit.locator('svg')).toHaveCount(1);expect((await fit.textContent()).trim()).toBe('');
  await host.assertHealthy();
});

for (const {width,locale,theme} of [{width:320,locale:'en-US',theme:'dark'},{width:920,locale:'zh-CN',theme:'light'}]) {
  test(`route-fit tooltip at ${width}px stays in bounds in inline and fullscreen`, async ({page}) => {
    const host=await openHost(page),frame=await host.add({width,height:900,autoSize:true,context:{locale,theme}});await mapReady(frame);
    for (const mode of ['inline','fullscreen']) {
      if(mode==='fullscreen')await fullscreen(frame);
      await frame.locator('#fit-map').hover();await expect(frame.locator('#fit-map-tip')).toBeVisible();
      const boxes=await frame.evaluate(()=>{
        const tip=document.getElementById('fit-map-tip').getBoundingClientRect(),button=document.getElementById('fit-map').getBoundingClientRect();
        return {left:tip.left,right:tip.right,top:tip.top,bottom:button.bottom,width:document.documentElement.clientWidth,
          overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
      });
      expect(boxes.left).toBeGreaterThanOrEqual(0);expect(boxes.right).toBeLessThanOrEqual(boxes.width);
      expect(boxes.top).toBeGreaterThanOrEqual(boxes.bottom);expect(boxes.overflow).toBe(false);
    }
    await host.assertHealthy();
  });
}

test('route-fit remains disabled before a map result is available', async ({page}) => {
  const host=await openHost(page),frame=await host.add({initial:false});
  const fit=frame.locator('#fit-map');await expect(fit).toBeDisabled();
  await expect(fit).toHaveAccessibleName('显示完整路线');await expect(fit.locator('svg')).toHaveCount(1);
  await fit.evaluate(el=>el.click());expect((await host.pending('card')).length).toBe(0);
  expect(host.requests.some(url=>url.startsWith('https://'))).toBe(false);
  await host.assertHealthy();
});

test('teardown removes the tooltip and its document keyboard listener', async ({page}) => {
  const host=await openHost(page),frame=await host.add();await mapReady(frame);
  await frame.locator('#fit-map').focus();await expect(frame.locator('#fit-map-tip')).toBeVisible();
  await frame.evaluate(()=>{
    const remove=document.removeEventListener;
    window.__removedTooltipKeys=0;
    document.removeEventListener=function(type,listener,...rest){
      if(type==='keydown'&&String(listener).includes('tooltipDismissed'))window.__removedTooltipKeys++;
      return remove.call(this,type,listener,...rest);
    };
  });
  await page.evaluate(()=>window.host.request('card','ui/resource-teardown',{}));
  await expect(frame.locator('#fit-map,#fit-map-tip')).toHaveCount(0);
  expect(await frame.evaluate(()=>window.__removedTooltipKeys)).toBe(1);
  await host.assertHealthy();
});
