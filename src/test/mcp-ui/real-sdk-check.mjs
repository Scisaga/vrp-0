/** Opt-in live acceptance. Never imported by the offline test suite.
 * Uses a caller-provided local MCP host, real Gateway read-only data and the
 * Gateway-published parent/renderer artifacts. It never patches CSP or swaps
 * in a local key; strict-parent + isolated-renderer is the only supported mode.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readEnvelope } from '../../main/mcp-ui/bridge.mjs';

assert.equal(process.env.MCP_REAL_SDK, '1', 'Explicit MCP_REAL_SDK=1 is required for live network tests');
for (const name of ['MCP_PREVIEW_DIR', 'MCP_REAL_JOB_ID']) assert.ok(process.env[name], `${name} is required`);

const require = createRequire(new URL('../../main/resources/META-INF/resources/static/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const { buildMcpApps, outputFiles } = require('./scripts/build-mcp-app.cjs');
const hostModule = file => import(pathToFileURL(path.resolve(process.env.MCP_PREVIEW_DIR, file)).href);
const { createPreviewServer } = await hostModule('server.mjs');
const { createGatewayClient } = await hostModule('transport.mjs');
const { readPreviewConfig } = await hostModule('config.mjs');
const cfg = await readPreviewConfig();
assert.ok(cfg.pat, 'Configured preview PAT is required');

const built = await buildMcpApps();
const localMap = await readFile(outputFiles.map, 'utf8');
const localRenderer = await readFile(outputFiles.renderer, 'utf8');
assert.equal(localMap, built.map.html, 'Build the current Map artifact before live acceptance');
assert.equal(localRenderer, built.renderer.html, 'Build the current renderer before live acceptance');
const hash = value => createHash('sha256').update(value).digest('hex');
const out = process.env.MCP_REAL_REPORT_DIR || '/tmp/vrp0-mcp-real-sdk';
await mkdir(out, { recursive:true, mode:0o700 });
const report = {
  at:new Date().toISOString(),
  scope:'Local simulated MCP host + real Gateway task + real isolated map renderer; NOT desktop/client certification',
  local_map_sha256:hash(localMap), local_renderer_sha256:hash(localRenderer), checks:{},
};

let key = '', server, browser, context, client;
const clean = value => String(value).replaceAll(cfg.pat, '[REDACTED]').replaceAll(key || '__NO_KEY__', '[REDACTED]')
  .replace(/https?:\/\/[^\s"'<>]+/g, value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return '[URL]'; } })
  .slice(0, 600);

try {
  client = createGatewayClient({ endpoint:cfg.endpoint, token:cfg.pat });
  await client.initialize();
  const { tools } = await client.listTools();
  const job = process.env.MCP_REAL_JOB_ID;
  const detail = await client.callTool('gateway.solver_jobs.get_detail', { job_id:job });
  const mapToolName = detail._meta?.gateway_ui?.map_display_tool_name;
  const ganttToolName = detail._meta?.gateway_ui?.gantt_display_tool_name;
  assert.equal(typeof mapToolName, 'string', 'Task must expose a map display tool');
  assert.equal(typeof ganttToolName, 'string', 'Task must expose a Gantt display tool');
  const mapTool = tools.find(item => item.name === mapToolName);
  const ganttTool = tools.find(item => item.name === ganttToolName);
  assert.ok(mapTool && ganttTool, 'Both discovered display tools must be in the current catalog');

  const mapResult = await client.callTool(mapToolName, { job_id:job });
  assert.notEqual(mapResult.isError, true);
  const envelope = mapResult._meta.gateway_ui;
  assert.equal(envelope.map_context.enabled, true);
  assert.equal(envelope.map_context.provider, 'AMAP');
  key = envelope.map_context.browser_key;
  assert.ok(key, 'Use the Gateway browser key; never substitute a local key');
  const rendererUrl = new URL(envelope.map_context.renderer_url);
  assert.equal(rendererUrl.origin, envelope.map_context.renderer_origin);
  assert.match(rendererUrl.pathname, /^\/mcp-apps\/renderers\/[0-9a-f]{32}\/[0-9a-f]{64}\.html$/);

  const ganttResult = await client.callTool(ganttToolName, { job_id:job });
  assert.notEqual(ganttResult.isError, true);
  const ganttEnvelope = readEnvelope(ganttResult, {
    viewKind:'gantt', expectedJobId:job,
    expectedVersionId:envelope.image_version_id, expectedToolName:ganttToolName,
  });
  assert.deepEqual(ganttEnvelope.map_context, {
    enabled:false, provider:envelope.task.map_provider, browser_key:'', js_url:'', css_url:null,
    locale:ganttEnvelope.map_context.locale, renderer_url:'', renderer_origin:'',
  });
  report.checks.gantt_has_no_map_capability = true;

  const mapUri = mapTool._meta.ui.resourceUri;
  const mapResource = await client.readResource(mapUri);
  const mapContent = mapResource.contents.find(item => item.uri === mapUri);
  const publishedMap = mapContent?.text;
  assert.equal(publishedMap, localMap, 'Gateway Map resource must match this checkout');
  assert.deepEqual(mapContent?._meta?.ui?.csp?.frameDomains, [envelope.map_context.renderer_origin]);

  const rendererResponse = await fetch(rendererUrl);
  assert.equal(rendererResponse.status, 200);
  const rendererCsp = rendererResponse.headers.get('content-security-policy') || '';
  assert.match(rendererCsp, /script-src[^;]*'unsafe-eval'[^;]*'wasm-unsafe-eval'/);
  assert.match(rendererCsp, /worker-src blob:/);
  assert.match(rendererCsp, /sandbox allow-scripts allow-same-origin/);
  assert.doesNotMatch(rendererCsp, /frame-ancestors/);
  const publishedRenderer = await rendererResponse.text();
  assert.equal(publishedRenderer, localRenderer, 'Gateway renderer must match this checkout');
  assert(!publishedRenderer.includes(job) && !publishedRenderer.includes(key), 'Renderer HTML must stay task/key independent');
  report.published = { map_sha256:hash(publishedMap), renderer_sha256:hash(publishedRenderer), renderer_csp:rendererCsp };

  server = await createPreviewServer({ endpoint:cfg.endpoint, getConfiguredPat:async () => cfg.pat,
    clientFactory:options => createGatewayClient(options) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless:true });
  context = await browser.newContext({ viewport:{width:1400,height:1800}, deviceScaleFactor:1 });
  const page = await context.newPage();
  const pageErrors = [], failedRequests = [], mapRequests = [];
  page.on('pageerror', error => pageErrors.push(clean(error.message)));
  context.on('request', request => {
    if (request.url().startsWith('https:')) mapRequests.push(clean(request.url()));
  });
  context.on('requestfailed', request => failedRequests.push({ url:clean(request.url()), error:clean(request.failure()?.errorText) }));

  await page.goto(origin, { waitUntil:'domcontentloaded' });
  await expect(page.locator('#connection-status')).toHaveText('已连接', { timeout:30000 });
  await page.locator('#tool').selectOption(mapToolName);
  await page.locator('#task-id').fill(job);
  await page.locator('#view').selectOption('map');
  await page.locator('#open-app').click();
  await expect(page.locator('#flow [data-step="result"]')).toHaveAttribute('data-state', 'complete', { timeout:45000 });

  const appFrame = page.frames().find(frame => frame.url().startsWith(origin + '/frame/'));
  assert.ok(appFrame, 'Preview must create the strict MCP App frame');
  await expect(appFrame.locator('#map-state')).toBeHidden({ timeout:45000 });
  await expect(appFrame.locator('#map-canvas')).toHaveAttribute('data-renderer-map', 'ready');
  await expect.poll(() => appFrame.childFrames().some(frame => frame.url().startsWith(rendererUrl.origin + '/'))).toBe(true);
  const rendererFrame = appFrame.childFrames().find(frame => frame.url().startsWith(rendererUrl.origin + '/'));
  assert.ok(rendererFrame, 'Map App must use the isolated renderer frame');
  await expect(rendererFrame.locator('#map')).toBeVisible();
  await expect(rendererFrame.locator('.mcp-marker').first()).toBeVisible({ timeout:30000 });

  await appFrame.locator('#fullscreen').click();
  await expect(page.locator('#display-mode')).toHaveValue('fullscreen');
  await expect(appFrame.locator('#playback')).toBeVisible();
  await appFrame.locator('#fullscreen').click();
  await expect(page.locator('#display-mode')).toHaveValue('inline');
  report.checks.iframe_map_ready = true;
  report.checks.fullscreen_round_trip = true;
  report.requests = [...new Set(mapRequests)];
  report.failed_requests = failedRequests;
  report.page_errors = pageErrors;
  assert.deepEqual(pageErrors, []);
  await appFrame.locator('#app').screenshot({ path:path.join(out, 'isolated-renderer.png') });
  await page.locator('#close-app').click();
  await expect(page.locator('#frame-container iframe')).toHaveCount(0);
  report.checks.teardown = true;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = clean(error.message);
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
  client?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode:0o600 });
  console.log(JSON.stringify({ passed:report.passed, report:path.join(out, 'report.json'), failure:report.failure }));
}
