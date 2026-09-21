const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildMcpApps, staticRoot, projectRoot, sourceRoot, outputFiles } = require("./build-mcp-app.cjs");

function verifyDocument(html) {
  assert(/^\s*<!doctype html>/i.test(html), "MCP App must be a complete HTML document");
  assert(/<html\b/i.test(html) && /<head\b/i.test(html) && /<body\b/i.test(html)
    && /<\/html>\s*$/i.test(html), "MCP App must contain html, head and body elements");
  assert(/<meta\s+charset=["']utf-8["']\s*\/?\s*>/i.test(html), "MCP App must declare UTF-8");
  assert(!/<!-- MCP_(?:STYLE|SCRIPT) -->/.test(html), "MCP build placeholders must be replaced");
  assert(!/\b(?:VrpScenarioGateway|mountScenarioUi|__SCENARIO_COMPONENT_TEMPLATES__)\b/.test(html), "MCP App cannot depend on the legacy Scenario runtime");
  // The upstream SDK includes a roots-URI validator for the bare "file://"
  // scheme. Reject concrete file URLs, not that inert protocol schema string.
  assert(!/\/static\/|sourceMappingURL=|file:\/\/[^"'`\s]|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(html), "MCP App contains a first-party URL, debug source or private key");
  assert(!html.includes(projectRoot), "MCP App cannot expose build machine paths");
  // Mirror Gateway's import-time check over the entire artifact, including
  // caught third-party capability probes. CSP runtime fallback is not enough.
  // This heuristic is not a JavaScript security proof: browser tests also
  // require zero dynamic-compilation attempts before and after SDK startup.
  assert(!/\beval\s*\(|\bnew\s+Function\s*\(/i.test(html), "MCP App fails Gateway dynamic-code policy (MCP_UI_HTML_UNSAFE)");

  const scripts = [...html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi)];
  const styles = [...html.matchAll(/<style\b([^>]*)>[\s\S]*?<\/style\s*>/gi)];
  assert.equal(scripts.length, 1, "MCP App must have one inline script");
  assert.equal(styles.length, 1, "MCP App must have one inline stylesheet");
  assert(!/\b(?:src|export)\b/i.test(scripts[0][1]), "MCP App cannot fetch or recompile a first-party script");
  assert(!/\bconsole\s*(?:(?:\?\.|\.)\s*[a-z]+|(?:\?\.)?\s*\[\s*["'][a-z]+["']\s*\])\s*(?:\?\.)?\s*\(/i.test(scripts[0][0]), "MCP App must not log protocol messages or credentials");
  const shell = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  assert(!/<(?:iframe|link|base|object|embed|form)\b/i.test(shell), "MCP App cannot embed another page, form or require external shell assets");
  assert(!/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(shell), "MCP App cannot redirect with meta refresh");
  assert(!/\son[a-z]+\s*=/i.test(shell), "MCP App cannot use inline event handlers");
  assert(!/\bsrcset\s*=/i.test(shell), "MCP App shell must not fetch image variants");
  for (const match of shell.matchAll(/\b(?:src|href|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    assert(/^(?:#|data:image\/(?:png|svg\+xml);)/i.test(match[1] ?? match[2] ?? match[3]), "MCP App shell contains an external resource or navigation dependency");
  }
  assert(!/@import\s/i.test(styles[0][0]), "MCP App stylesheet must not import external stylesheets");
  for (const match of styles[0][0].matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    assert(/^(?:#|data:image\/(?:png|svg\+xml);)/i.test((match[1] ?? match[2] ?? match[3]).trim()), "MCP App stylesheet must be self-contained");
  }
}

function verifyInputs(inputs) {
  const sourcePrefix = path.relative(projectRoot, sourceRoot).replaceAll(path.sep, "/") + "/";
  const dependencyPrefix = path.relative(projectRoot, path.join(staticRoot, "node_modules")).replaceAll(path.sep, "/") + "/";
  const sharedPresentation = path.relative(projectRoot, path.join(staticRoot, "assets/js/utils/result-presentation.mjs")).replaceAll(path.sep, "/");
  for (const input of inputs) {
    const normalized = input.replaceAll(path.sep, "/");
    assert(normalized === sharedPresentation || normalized.startsWith(sourcePrefix) || normalized.startsWith(dependencyPrefix)
      || /^mcp-contract:mcp-(?:view-validator|network-policy)$/.test(normalized), `Unexpected MCP build input: ${input}`);
    assert(!/(?:^|\/)(?:\.env(?:\.[^/]*)?|application\.properties)$/.test(normalized), "Credential/configuration files must not enter the browser bundle");
    if (normalized.startsWith(dependencyPrefix)) {
      const dependency = normalized.slice(dependencyPrefix.length);
      assert(!/^@modelcontextprotocol\/ext-apps\/.*(?:app|react)-with-deps\./.test(dependency), "MCP SDK must share the preconfigured Zod instance, not embed one via with-deps");
      assert(!/(?:^|\/)node_modules\/zod\//.test(dependency), "MCP SDK must not load a nested, separately configured Zod instance");
      assert(!/^(?:alpinejs(?:-web-components)?|plotly\.js|codemirror|@codemirror|lightweight-charts)\//.test(dependency), "MCP App must not import the legacy UI's runtime dependencies");
      assert(!dependency.startsWith("ajv/") || dependency.startsWith("ajv/dist/runtime/"), "Only standalone Ajv runtime helpers, not the schema compiler, may enter the browser bundle");
    }
    if (normalized !== sharedPresentation && !normalized.startsWith(sourcePrefix)) continue;
    const source = fs.readFileSync(path.resolve(projectRoot, input), "utf8");
    verifyFirstPartySource(source);
  }
}

function verifyFirstPartySource(source) {
  assert(!/\b(?:eval|Function|AsyncFunction)\s*\(/.test(source), "First-party MCP code must not dynamically compile strings");
  assert(!/\b(?:browser_key|rest_key|jwt_secret|private_key|access_token|refresh_token|apiKey)\s*[:=]\s*["'][^"']{8,}["']/.test(source)
    && !/\bBearer\s+[A-Za-z0-9._~-]{12,}/.test(source), "First-party MCP source contains a credential literal");
}

async function verify() {
  assert(process.argv.slice(2).every((arg) => arg === "--check"), "Only --check is supported");
  const first = await buildMcpApps();
  const second = await buildMcpApps();
  for (const kind of ["map", "gantt"]) {
    assert.equal(first[kind].html, second[kind].html, `${kind} MCP App build must be deterministic`);
    const outputBytes = fs.readFileSync(outputFiles[kind]);
    const trackedHtml = new TextDecoder("utf-8", { fatal: true }).decode(outputBytes);
    assert.equal(trackedHtml, first[kind].html, `${kind} artifact is stale; run npm run build:mcp-app`);
    verifyDocument(first[kind].html);
    verifyInputs(first[kind].inputs);
  }
  assert(!first.gantt.inputs.some((input) => /(?:^|\/)maps\.mjs$/.test(input) || input === "mcp-contract:mcp-network-policy"), "Gantt dependency closure must not contain map modules or network policy");
  assert(!/https:\/\/(?:webapi\.amap\.com|js\.api\.here\.com|maps\.hereapi\.com|vdata\.amap\.com)/.test(first.gantt.html), "Gantt artifact must not contain map origins");
  assert(!fs.existsSync(path.join(staticRoot, "mcp-app.html")), "legacy mcp-app.html must be absent");
  console.log("[verify:mcp-app] both deterministic, self-contained artifacts and manifest checks passed (no files written)");
}

if (require.main === module) verify().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { verifyDocument, verifyInputs, verifyFirstPartySource };
