import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let server, origin;
const amapFixture = `window.amapLoads = (window.amapLoads || 0) + 1;
window.AMap = { Map: class {
  constructor(container) { container.dataset.provider = 'amap'; }
  setMapStyle() {} setLang() {} destroy() {} clearMap() {}
}, InfoWindow: class { close() {} }, Pixel: class {} };`;

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://fixture').pathname;
    if (pathname === '/') {
      res.setHeader('content-type', 'text/html');
      return res.end('<!doctype html><div id="map" style="width:800px;height:600px"></div>');
    }
    if (pathname === '/fixture-amap.js') {
      res.setHeader('content-type', 'text/javascript');
      return res.end(amapFixture);
    }
    const filename = resolve(root, '.' + pathname);
    if (!filename.startsWith(root + '/')) { res.writeHead(404); return res.end(); }
    try { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(filename)); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(r => server.close(r)); });

async function setup(page) {
  await page.goto(origin);
  await page.evaluate(() => {
    // Explicit SDK substitutes: this suite verifies browser-global ownership,
    // instance construction and script loading, not real provider basemaps.
    window.H = {
      service: { Platform: class { createDefaultLayers() { return {}; } } },
      Map: class {
        constructor(container) { container.dataset.provider = 'here'; }
        addEventListener() {} dispose() {} removeObjects() {}
      },
      ui: { UI: { createDefault() { return { getControl() {} }; } } },
      mapevents: { Behavior: class {}, MapEvents: class {} }
    };
  });
}

for (const sequence of [['here', 'amap', 'here', 'amap'], ['amap', 'here', 'amap', 'here', 'amap']]) {
  test(`each component uses its requested SDK: ${sequence.join(' → ')}`, async ({ page }) => {
    await setup(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [index, provider] of sequence.entries()) {
      const actual = await page.evaluate(async ({ provider, index }) => {
        // A different component bundle has its own module cache, as in Gateway.
        const sdk = await import(`/assets/js/utils/amap.js?component=${index}`);
        const container = document.querySelector('#map');
        container._vrpMap?.destroy(); delete container._vrpMap;
        window.VrpScenarioGateway = { context: { map_context: {
          enabled: true, provider, browser_key: 'synthetic-public-key', locale: 'zh-CN',
          js_url: provider === 'amap' ? '/fixture-amap.js' : '', css_url: ''
        } } };
        const map = await sdk.ensureMap(container);
        // The returned instance must carry its SDK for later marker/route work.
        sdk.renderAgentPreview(map, null);
        return { provider: container.dataset.provider, nativeLoads: window.amapLoads || 0 };
      }, { provider, index });
      expect(actual.provider).toBe(provider);
      expect(actual.nativeLoads).toBe(sequence.slice(0, index + 1).includes('amap') ? 1 : 0);
    }
    expect(errors).toEqual([]);
  });
}

test('a HERE map retains its overlay SDK after an AMAP component is opened', async ({ page }) => {
  await setup(page);
  const actual = await page.evaluate(async () => {
    const sdk = await import('/assets/js/utils/amap.js');
    window.VrpScenarioGateway = { context: { map_context: { provider: 'here' } } };
    const hereMap = await sdk.ensureMap(document.querySelector('#map'));
    const savedSdk = hereMap._vrpMapSdk;
    window.VrpScenarioGateway.context.map_context = {
      enabled: true, provider: 'amap', browser_key: 'synthetic-public-key', js_url: '/fixture-amap.js'
    };
    await sdk.ensureMap(document.createElement('div'));
    // Force a new info window after the global AMAP SDK has loaded.
    delete hereMap._vrpTicketInfoWindow;
    sdk.renderAgentPreview(hereMap, null);
    return {
      bound: Boolean(savedSdk?._vrpHereCompatibility),
      correctInfoWindow: Boolean(savedSdk && hereMap._vrpTicketInfoWindow instanceof savedSdk.InfoWindow),
      nativeGlobal: Boolean(window.AMap && !window.AMap._vrpHereCompatibility)
    };
  });
  expect(actual).toEqual({ bound: true, correctInfoWindow: true, nativeGlobal: true });
});
