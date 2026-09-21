import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../../main/resources/META-INF/resources/static/package.json', import.meta.url));
const { buildMcpApp, buildRenderer, exactOrigins, networkPolicyFromManifest, readNetworkPolicy, standaloneValidator, staticRoot, projectRoot } = require('./scripts/build-mcp-app.cjs');
const { verifyDocument, verifyInputs, verifyFirstPartySource } = require('./scripts/verify-mcp-app.cjs');
const { build } = require('esbuild');
const manifest = () => ({ mcp_ui: {
  contract_version: 'gateway_mcp_result_v1', result_view_kind: 'vrp0', result_view_schema_version: 2,
  resources: {
    map: { file:'mcp-map-app.html', display_modes:['inline','fullscreen'], csp:{ connect_domains:[], resource_domains:[] },
      renderer:{file:'mcp-map-renderer.html',csp:{allow_unsafe_eval:true,allow_blob_workers:true,connect_domains:['https://z.example','https://a.example'],resource_domains:['https://sdk.example:8443']}}},
    gantt: { file:'mcp-gantt-app.html', display_modes:['inline','fullscreen'], csp:{ connect_domains:[], resource_domains:[] } }
  }
} });
const document = (script = '"use strict";') => `<!doctype html><html><head><meta charset="utf-8"><style>body{color:red}</style></head><body><script>${script}</script></body></html>`;

test('manifest build policy is a strict, normalized copy, not an implicit approval', () => {
  const original = manifest(), snapshot = structuredClone(original);
  assert.deepEqual(networkPolicyFromManifest(original), {
    connectDomains: ['https://a.example','https://z.example'], resourceDomains: ['https://sdk.example:8443']
  });
  assert.deepEqual(original, snapshot);
  const empty = manifest(); empty.mcp_ui.resources.map.renderer.csp.connect_domains = []; empty.mcp_ui.resources.map.renderer.csp.resource_domains = [];
  assert.deepEqual(networkPolicyFromManifest(empty), {connectDomains:[],resourceDomains:[]}, 'empty arrays express a valid declaration, not a working map');
  assert.ok(readNetworkPolicy('renderer').resourceDomains.includes('https://js.api.here.com'));
  assert.ok(readNetworkPolicy('renderer').resourceDomains.includes('https://vdata.amap.com'));
  assert.ok(readNetworkPolicy('renderer').connectDomains.includes('https://vdata.amap.com'));
  assert.ok(readNetworkPolicy('renderer').resourceDomains.includes('https://restapi.amap.com'));
  assert.deepEqual(readNetworkPolicy('map'), {connectDomains:[],resourceDomains:[]});
  for (const change of [
    value => { delete value.mcp_ui; },
    value => { value.mcp_ui.entry_path = '/other.html'; },
    value => { delete value.mcp_ui.resources; },
    value => { value.mcp_ui.contract_version = 'unknown'; },
    value => { value.mcp_ui.result_view_kind = 'other'; },
    value => { value.mcp_ui.result_view_schema_version = '2'; },
    value => { value.mcp_ui.resources = {map:value.mcp_ui.resources.map}; },
    value => { value.mcp_ui.resources.extra = value.mcp_ui.resources.map; },
    value => { value.mcp_ui.resources.map.display_modes = ['inline','fullscreen','pip']; },
    value => { value.mcp_ui.resources.map.csp = null; },
    value => { value.mcp_ui.resources.map.csp.frame_domains = ['https://evil.example']; },
    value => { value.mcp_ui.resources.map.csp.connect_domains = 'https://api.example'; },
    value => { value.mcp_ui.resources.map.csp.resource_domains = ['https://sdk.example/path']; },
    value => { delete value.mcp_ui.resources.map.renderer; },
    value => { value.mcp_ui.resources.map.renderer.file = 'other.html'; },
    value => { value.mcp_ui.resources.map.renderer.csp.allow_unsafe_eval = false; },
    value => { value.mcp_ui.resources.map.renderer.csp.allow_blob_workers = 'true'; }
  ]) {
    const value = manifest(); change(value);
    assert.throws(() => networkPolicyFromManifest(value));
  }
});

test('network origin declarations reject credentials, URL suffixes, wildcard and non-HTTPS schemes', () => {
  for (const value of [null, {}, 'https://a.example', [null], [42],
    ['http://a.example'], ['//a.example'], ['https://a.example/'], ['https://a.example/path'],
    ['https://a.example?key=value'], ['https://a.example#fragment'], ['https://user:secret@a.example'],
    ['https://*.example'], ['https://a.example','https://a.example'], ['javascript:alert(1)'],
    ['https://a.example:443']]) assert.throws(() => exactOrigins(value, 'fixture'));
  assert.deepEqual(exactOrigins(['https://a.example:8443'], 'fixture'), ['https://a.example:8443']);
});

test('artifact verifier rejects external first-party dependencies, HTML handlers and sensitive output', () => {
  verifyDocument(document());
  verifyDocument(document().replace('<body>', '<body><img src="data:image/png;base64,AA=="><a href="#details">Details</a>'));
  const changes = [
    value => value.replace('<!doctype html>', ''),
    value => value.replace('<meta charset="utf-8">', ''),
    value => value.replace('<body>', '<body><iframe></iframe>'),
    value => value.replace('<body>', '<body><base href="https://evil.example">'),
    value => value.replace('<body>', '<body><link rel="stylesheet" href="asset.css">'),
    value => value.replace('<body>', '<body><img src=asset.png>'),
    value => value.replace('<body>', '<body><img src="https://example.com/logo.png">'),
    value => value.replace('<body>', '<body><img srcset="asset.png 2x">'),
    value => value.replace('<body>', '<body onload="alert(1)">'),
    value => value.replace('color:red', 'background:url(asset.png)'),
    value => value.replace('color:red', 'background:url("../asset.png")'),
    value => value.replace('color:red', 'background:url(https://example.com/asset.png)'),
    value => value.replace('body{color:red}', '@import "asset.css";'),
    value => value.replace('<script>', '<script src="asset.js">'),
    value => value.replace('<script>', '<script export>'),
    value => value.replace('<body>', '<body><!-- MCP_SCRIPT -->'),
    value => value.replace('"use strict";', 'window.VrpScenarioGateway;'),
    value => value.replace('"use strict";', 'const path="/static/private.json";'),
    value => value.replace('"use strict";', 'const path="file:///home/private.json";'),
    value => value.replace('"use strict";', 'const key="-----BEGIN PRIVATE KEY-----";'),
    value => value.replace('"use strict";', '// sourceMappingURL=app.js.map'),
    value => value.replace('"use strict";', `const path=${JSON.stringify(projectRoot)};`),
    value => value.replace('"use strict";', 'console.debug({browser_key:"synthetic-value"});'),
    value => value.replace('"use strict";', 'console?.log("payload");'),
    value => value.replace('"use strict";', 'console["log"]("payload");')
  ];
  for (const change of changes) assert.throws(() => verifyDocument(change(document())));
});

test('Gateway dynamic-code scan rejects even caught capability probes in the final artifact', () => {
  // Keep these expectations aligned with Gateway's literal, case-insensitive
  // /\beval\s*\(|\bnew\s+Function\s*\(/i rule, not just executable paths.
  for (const source of ['eval("payload")', 'new Function("")',
    'try{new Function("")}catch{}', 'try{eval("")}catch{}',
    'new\nFunction \t("")', 'EVAL \n ("payload")', 'new FUNCTION("")',
    'const inert="new Function(";', '// eval("payload")']) {
    assert.throws(() => verifyDocument(document(source)));
  }
  for (const source of ['const scheme="file://";', 'const evaluator = "plain text";',
    'const Functionality = {};', 'const evaluation = "not dynamic code";']) {
    verifyDocument(document(source));
  }
});

test('first-party code cannot dynamically compile strings or embed credential literals', () => {
  verifyFirstPartySource('const browser_key = context.browser_key; element.textContent = label;');
  for (const value of ['eval("payload")', 'Function("payload")', 'new Function("payload")',
    'new AsyncFunction("payload")', 'const browser_key="synthetic-public-browser-key";',
    'const rest_key="synthetic-server-key";', 'const header="Bearer synthetic-token-value";']) {
    assert.throws(() => verifyFirstPartySource(value));
  }
});

test('browser dependency closure excludes engine config, prebundled SDK, old runtime and Ajv compiler', () => {
  const nodeModules = path.relative(projectRoot, path.join(staticRoot,'node_modules')).replaceAll(path.sep,'/');
  verifyInputs(['mcp-contract:mcp-view-validator','mcp-contract:mcp-network-policy',
    `${nodeModules}/ajv/dist/runtime/ucs2length.js`, `${nodeModules}/@modelcontextprotocol/ext-apps/dist/src/app.js`,
    `${nodeModules}/@modelcontextprotocol/client/dist/client/index.js`, `${nodeModules}/zod/v4/core/core.js`]);
  for (const input of ['.env','src/main/resources/application.properties',
    'src/main/resources/META-INF/resources/static/assets/js/utils/api.js', 'mcp-contract:unknown',
    `${nodeModules}/@modelcontextprotocol/ext-apps/dist/src/app-with-deps.js`,
    `${nodeModules}/@modelcontextprotocol/ext-apps/dist/src/react/react-with-deps.js`,
    `${nodeModules}/@modelcontextprotocol/client/node_modules/zod/v4/core/core.js`,
    `${nodeModules}/ajv/dist/2020.js`, `${nodeModules}/ajv/dist/compile/index.js`,
    `${nodeModules}/alpinejs/dist/module.esm.js`, `${nodeModules}/plotly.js/dist/plotly-basic.min.js`,
    `${nodeModules}/codemirror/dist/index.js`]) assert.throws(() => verifyInputs([input]));
});

test('actual browser bundle uses the ordinary SDK entry and one shared Zod v4 dependency', async () => {
  const { html, inputs } = await buildMcpApp();
  verifyDocument(html);
  verifyInputs(inputs);
  const officialLogo = fs.readFileSync(path.join(staticRoot, 'assets/img/vrp-0-logo-120.png')).toString('base64');
  assert.ok(html.includes(`data:image/png;base64,${officialLogo}`), 'MCP header must inline the existing VRP-0 logo');
  assert.ok(!html.includes('M5 8h8l6 16h8M5 24l7-16h15'), 'MCP header must not contain an invented logo');
  assert.ok(!html.includes('mcp-network-policy'), 'strict parent must not contain vendor policy');
  const nodeModules = path.relative(projectRoot, path.join(staticRoot,'node_modules')).replaceAll(path.sep,'/');
  assert.ok(inputs.includes(`${nodeModules}/@modelcontextprotocol/ext-apps/dist/src/app.js`));
  assert.ok(!inputs.some(input => /(?:app|react)-with-deps/.test(input)));
  const zodInputs = inputs.filter(input => /(?:^|\/)zod\//.test(input));
  assert.ok(zodInputs.length > 0);
  assert.ok(zodInputs.every(input => input.startsWith(`${nodeModules}/zod/v4/`)),
    'all SDK schemas and the pre-initialization config must share the same Zod v4 module instance');

  const renderer = await buildRenderer();
  for (const domains of Object.values(readNetworkPolicy('renderer'))) {
    assert.ok(renderer.html.includes(`Object.freeze(${JSON.stringify(domains)})`),
      'renderer network policy must match the manifest');
  }
  assert.ok(renderer.inputs.some(input => /(?:^|\/)maps\.mjs$/.test(input)));
  assert.ok(!inputs.some(input => /(?:^|\/)maps\.mjs$/.test(input)));
});

test('canonical Ajv2020 standalone validator preserves strict shape, null holes and finite numbers', async () => {
  const source = standaloneValidator();
  assert.ok(!/\b(?:eval|Function|AsyncFunction)\s*\(/.test(source));
  const bundle = await build({stdin:{contents:source,resolveDir:staticRoot,sourcefile:'standalone-validator.mjs'},
    bundle:true,write:false,platform:'node',format:'esm',target:['es2020'],metafile:true});
  assert.ok(Object.keys(bundle.metafile.inputs).every(input => !/ajv\/dist\/(?:compile|core|2020)/.test(input)));
  const {default:validate} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const base = JSON.parse(fs.readFileSync(new URL('../../../docs/integrations/gateway/fixtures/mcp-result-view/base-expected.json', import.meta.url), 'utf8'));
  assert.equal(validate(base), true);
  assert.equal(validate(null), false);
  const hole = structuredClone(base); hole.solver_job.plan.agents[0].routes[1] = null;
  assert.equal(validate(hole), true);
  for (const change of [
    value => { value.unknown = true; },
    value => { delete value.display_model; },
    value => { value.solver_job.id = ''; },
    value => { value.solver_job.plan.agents[0].tickets.push(null); },
    value => { value.solver_job.plan.agents[0].routes[0].polyline[1] = null; },
    value => { value.solver_job.plan.agents[0].routes[0].origin.lat = Infinity; },
    value => { value.solver_job.plan.agents[0].routes[0].origin.lon = NaN; },
    value => { value.solver_job.plan.agents[0].routes[0].transit.distance = Number.MAX_SAFE_INTEGER + 1; }
  ]) {
    const value = structuredClone(base); change(value); assert.equal(validate(value), false);
  }
  const calendar = structuredClone(base); calendar.solver_job.plan.agents[0].date = '2026-02-30';
  assert.equal(validate(calendar), true, 'calendar semantics belong to the additional semantic validator, not JSON Schema regex');
});

test('console and MCP share only the extracted result presentation, not the console runtime', async () => {
  const sharedJs = 'src/main/resources/META-INF/resources/static/assets/js/utils/result-presentation.mjs';
  verifyInputs([sharedJs]);
  const { html, inputs } = await buildMcpApp();
  assert.ok(inputs.includes(sharedJs));
  const consoleJs = fs.readFileSync(path.join(staticRoot, 'assets/js/pages/solver-job-detail-page.js'), 'utf8');
  assert.match(consoleJs, /import .*GANTT_STAGE_STYLES.*result-presentation\.mjs/);
  assert.doesNotMatch(consoleJs, /const GANTT_STAGE_STYLES\s*=/);
  for (const name of ['style.css', 'scenario-business.source.css']) {
    assert.match(fs.readFileSync(path.join(staticRoot, 'assets/css', name), 'utf8'), /@import "\.\/result-presentation\.css"/);
  }
  const sharedCss = fs.readFileSync(path.join(staticRoot, 'assets/css/result-presentation.css'), 'utf8');
  for (const selector of ['result-timeline-bar','result-sequence-badge','result-phase-key','result-detail-value','result-summary-score-hard']) {
    assert.ok(sharedCss.includes(`.${selector}`));
    assert.ok(html.includes(`.${selector}`));
  }
  for (const input of ['assets/js/utils/api.js','assets/js/pages/solver-job-detail-page.js','assets/js/utils/vrp-model.js']) {
    assert.throws(() => verifyInputs([`src/main/resources/META-INF/resources/static/${input}`]));
  }
});
