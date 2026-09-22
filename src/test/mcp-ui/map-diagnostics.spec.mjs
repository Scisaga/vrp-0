import { test,expect,openHost,mapReady } from './host-fixture.mjs';

const cases = [
  ['script','renderer_channel_connected','AMAP_SCRIPT_LOAD_FAILED'],
  ['sdk','amap_script_loaded','AMAP_SDK_MISSING'],
  ['map-create','amap_sdk_ready','AMAP_MAP_CREATE_FAILED'],
  ['ready','amap_map_created','AMAP_READY_FAILED'],
  ['overlay','amap_ready','AMAP_OVERLAY_FAILED'],
  ['fit','amap_overlays_added','AMAP_FIT_FAILED']
];

for (const [mode, stage, code] of cases) {
  test(`AMap ${mode} failure exposes only its safe phase diagnostic`, async({page}) => {
    const host=await openHost(page,{mapFailure:mode});
    const frame=await host.add();
    await expect(frame.locator('#map-diagnostic')).toBeVisible();
    await expect(frame.locator('#map-diagnostic')).toHaveText(`诊断：最后成功阶段 ${stage} · 错误码 ${code}`);
    await expect(frame.locator('body')).not.toContainText('sensitive');
    await expect(frame.locator('body')).not.toContainText('secret.invalid');
    await host.assertHealthy();
  });
}

test('renderer without a handshake reports a safe channel failure', async({page}) => {
  const channelHost=await openHost(page,{rendererFailure:'channel',shortMapTimeouts:true});
  const channelFrame=await channelHost.add({id:'channel'});
  await expect(channelFrame.locator('#map-diagnostic')).toHaveText('诊断：最后成功阶段 renderer_document_loaded · 错误码 RENDERER_CHANNEL_FAILED');
  await channelHost.assertHealthy();
});

test('successful map hides diagnostics and English failures localize labels', async({page}) => {
  const host=await openHost(page);const frame=await host.add();await mapReady(frame);
  await expect(frame.locator('#map-diagnostic')).toBeHidden();

  const englishPage=await page.context().newPage();
  const englishHost=await openHost(englishPage,{mapFailure:'sdk'});
  const english=await englishHost.add({id:'english',context:{locale:'en-US'}});
  await expect(english.locator('#map-diagnostic')).toHaveText('Diagnostic: last successful stage amap_script_loaded · error code AMAP_SDK_MISSING');
  await host.assertHealthy();await englishHost.assertHealthy();
});
