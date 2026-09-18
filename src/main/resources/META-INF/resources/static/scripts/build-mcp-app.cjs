const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const autoprefixer = require("autoprefixer");
const YAML = require("yaml");
const Ajv2020 = require("ajv/dist/2020").default;
const standaloneCode = require("ajv/dist/standalone").default;

const staticRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(staticRoot, "../../../../../..");
const sourceRoot = path.join(projectRoot, "src/main/mcp-ui");
const outputFile = path.join(staticRoot, "mcp-app.html");
const manifestFile = path.join(projectRoot, "docs/integrations/gateway/image-version.yaml");
const schemaFile = path.join(projectRoot, "docs/integrations/gateway/mcp-result-view-schema.json");

function exactKeys(value, keys, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has missing or unknown fields`);
}

function exactSet(value, expected, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  assert.deepEqual([...value].sort(), [...expected].sort(), `${label} has missing, duplicate or unknown values`);
}

function exactOrigins(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  assert.equal(new Set(value).size, value.length, `${label} has duplicate origins`);
  for (const origin of value) {
    assert.equal(typeof origin, "string", `${label} entries must be strings`);
    let url;
    try { url = new URL(origin); } catch { assert.fail(`${label} has an invalid origin`); }
    assert(url.protocol === "https:" && !url.username && !url.password
      && url.origin === origin && !origin.includes("*"), `${label} requires exact HTTPS origins without credentials, paths or wildcards`);
  }
  return [...value].sort();
}

function networkPolicyFromManifest(manifest) {
  const ui = manifest?.mcp_ui;
  exactKeys(ui, ["contract_version", "result_view_kind", "result_view_schema_version", "views", "display_modes", "csp"], "mcp_ui");
  assert.equal(ui.contract_version, "gateway_mcp_result_v1");
  assert.equal(ui.result_view_kind, "vrp0");
  assert.equal(ui.result_view_schema_version, 2);
  exactSet(ui.views, ["map", "gantt"], "mcp_ui.views");
  exactSet(ui.display_modes, ["inline", "fullscreen"], "mcp_ui.display_modes");
  exactKeys(ui.csp, ["connect_domains", "resource_domains"], "mcp_ui.csp");
  return {
    connectDomains: exactOrigins(ui.csp.connect_domains, "mcp_ui.csp.connect_domains"),
    resourceDomains: exactOrigins(ui.csp.resource_domains, "mcp_ui.csp.resource_domains")
  };
}

function readNetworkPolicy() {
  const document = YAML.parseDocument(fs.readFileSync(manifestFile, "utf8"), { uniqueKeys: true });
  assert.equal(document.errors.length, 0, "image-version.yaml must be valid YAML without duplicate keys");
  return networkPolicyFromManifest(document.toJS({ maxAliasCount: 0 }));
}

function standaloneValidator() {
  const schema = JSON.parse(fs.readFileSync(schemaFile, "utf8"));
  const ajv = new Ajv2020({
    strict: true,
    strictNumbers: true,
    allErrors: false,
    code: { source: true, esm: true }
  });
  return standaloneCode(ajv, ajv.compile(schema));
}

function inlineScript(source) {
  return source.replace(/<\/script/gi, "<\\/script");
}

function replaceOnce(source, placeholder, replacement) {
  assert.equal(source.split(placeholder).length, 2, `template.html must contain exactly one ${placeholder}`);
  return source.replace(placeholder, () => replacement);
}

async function buildMcpApp() {
  const networkPolicy = readNetworkPolicy();
  const validator = standaloneValidator();
  const bundle = await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: [path.join(sourceRoot, "main.mjs")],
    nodePaths: [path.join(staticRoot, "node_modules")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: ["es2020"],
    charset: "utf8",
    minify: true,
    // The upstream transport logs complete messages, including public map
    // credentials. Never let protocol payloads enter the browser console.
    drop: ["console"],
    legalComments: "inline",
    sourcemap: false,
    metafile: true,
    plugins: [{
      name: "mcp-build-time-contract",
      setup(build) {
        build.onResolve({ filter: /^(mcp-view-validator|mcp-network-policy)$/ }, (args) => ({ path: args.path, namespace: "mcp-contract" }));
        build.onLoad({ filter: /.*/, namespace: "mcp-contract" }, (args) => ({
          contents: args.path === "mcp-view-validator" ? validator : [
            `export const connectDomains = Object.freeze(${JSON.stringify(networkPolicy.connectDomains)});`,
            `export const resourceDomains = Object.freeze(${JSON.stringify(networkPolicy.resourceDomains)});`
          ].join("\n"),
          loader: "js",
          resolveDir: staticRoot
        }));
      }
    }]
  });
  assert.equal(bundle.outputFiles.length, 1, "MCP App must produce one inline JavaScript bundle");

  const cssFile = path.join(sourceRoot, "styles.css");
  const cssSource = fs.readFileSync(cssFile, "utf8");
  const tailwindImport = /@import\s+["']tailwindcss["']\s+source\(none\)\s*;/g;
  assert.equal([...cssSource.matchAll(tailwindImport)].length, 1, "MCP styles must disable automatic Tailwind source scanning");
  assert(!/@import\b/.test(cssSource.replace(tailwindImport, "")), "MCP styles cannot import additional files or external resources");
  // The source tree deliberately lives outside static/. Resolve the existing
  // package's CSS explicitly, keeping @source paths relative to styles.css.
  const resolvedCss = cssSource.replace(tailwindImport, () =>
    `@import ${JSON.stringify(require.resolve("tailwindcss/index.css"))} source(none);`);
  const css = await postcss([tailwind({ base: sourceRoot }), autoprefixer]).process(resolvedCss, { from: cssFile, map: false });
  assert(!/<\/style/i.test(css.css), "MCP CSS cannot terminate its inline style element");

  let html = fs.readFileSync(path.join(sourceRoot, "template.html"), "utf8");
  html = replaceOnce(html, "<!-- MCP_STYLE -->", `<style>\n${css.css}\n</style>`);
  html = replaceOnce(html, "<!-- MCP_SCRIPT -->", `<script>\n${inlineScript(bundle.outputFiles[0].text)}\n</script>`);
  return { html: html.replace(/\r\n/g, "\n").replace(/\s*$/, "\n"), networkPolicy, inputs: Object.keys(bundle.metafile.inputs) };
}

async function main() {
  assert(process.argv.slice(2).every((arg) => arg === "--check"), "Only --check is supported");
  const { html } = await buildMcpApp();
  if (process.argv.includes("--check")) {
    assert.equal(fs.readFileSync(outputFile, "utf8"), html, "mcp-app.html is stale; run npm run build:mcp-app");
    console.log("[build:mcp-app] tracked artifact is current (no files written)");
  } else {
    fs.writeFileSync(outputFile, html, "utf8");
    console.log(`[build:mcp-app] wrote mcp-app.html (${Buffer.byteLength(html)} bytes)`);
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { buildMcpApp, readNetworkPolicy, networkPolicyFromManifest, standaloneValidator, exactOrigins, staticRoot, projectRoot, sourceRoot, outputFile };
