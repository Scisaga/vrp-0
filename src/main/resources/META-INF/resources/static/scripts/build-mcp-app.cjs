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
const outputFiles = {
  map: path.join(staticRoot, "mcp-map-app.html"),
  gantt: path.join(staticRoot, "mcp-gantt-app.html"),
  renderer: path.join(staticRoot, "mcp-map-renderer.html")
};
const outputFile = outputFiles.map;
const manifestFile = path.join(projectRoot, "gateway/image-version.yaml");
const sharedStylesFile = path.join(staticRoot, "assets/css/result-presentation.css");
const logoFile = path.join(staticRoot, "assets/img/vrp-0-logo-120.png");
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

function resourcesFromManifest(manifest) {
  const ui = manifest?.mcp_ui;
  exactKeys(ui, ["contract_version", "result_view_kind", "result_view_schema_version", "resources"], "mcp_ui");
  assert.equal(ui.contract_version, "gateway_mcp_result_v1");
  assert.equal(ui.result_view_kind, "vrp0");
  assert.equal(ui.result_view_schema_version, 2);
  exactKeys(ui.resources, ["map", "gantt"], "mcp_ui.resources");
  const expectedFiles = { map:"mcp-map-app.html", gantt:"mcp-gantt-app.html" };
  const result = {};
  for (const kind of ["map", "gantt"]) {
    const resource = ui.resources[kind];
    exactKeys(resource, kind === "map" ? ["file", "display_modes", "csp", "renderer"] : ["file", "display_modes", "csp"], `mcp_ui.resources.${kind}`);
    assert.equal(resource.file, expectedFiles[kind]);
    exactSet(resource.display_modes, ["inline", "fullscreen"], `mcp_ui.resources.${kind}.display_modes`);
    exactKeys(resource.csp, ["connect_domains", "resource_domains"], `mcp_ui.resources.${kind}.csp`);
    result[kind] = {
      file: resource.file,
      networkPolicy: {
        connectDomains: exactOrigins(resource.csp.connect_domains, `mcp_ui.resources.${kind}.csp.connect_domains`),
        resourceDomains: exactOrigins(resource.csp.resource_domains, `mcp_ui.resources.${kind}.csp.resource_domains`),
      },
    };
    if (kind === "map") {
      exactKeys(resource.renderer, ["file", "csp"], "mcp_ui.resources.map.renderer");
      assert.equal(resource.renderer.file, "mcp-map-renderer.html");
      exactKeys(resource.renderer.csp, ["connect_domains", "resource_domains", "allow_unsafe_eval", "allow_blob_workers"], "mcp_ui.resources.map.renderer.csp");
      assert.equal(resource.renderer.csp.allow_unsafe_eval, true);
      assert.equal(resource.renderer.csp.allow_blob_workers, true);
      result.renderer = {
        file: resource.renderer.file,
        networkPolicy: {
          connectDomains: exactOrigins(resource.renderer.csp.connect_domains, "mcp_ui.resources.map.renderer.csp.connect_domains"),
          resourceDomains: exactOrigins(resource.renderer.csp.resource_domains, "mcp_ui.resources.map.renderer.csp.resource_domains"),
        },
        allowUnsafeEval: true,
        allowBlobWorkers: true
      };
    }
  }
  assert.deepEqual(result.map.networkPolicy, { connectDomains:[], resourceDomains:[] });
  assert.deepEqual(result.gantt.networkPolicy, { connectDomains:[], resourceDomains:[] });
  return result;
}
function networkPolicyFromManifest(manifest, kind = "renderer") { return resourcesFromManifest(manifest)[kind].networkPolicy; }
function readResources() {
  const document = YAML.parseDocument(fs.readFileSync(manifestFile, "utf8"), { uniqueKeys: true });
  assert.equal(document.errors.length, 0, "image-version.yaml must be valid YAML without duplicate keys");
  return resourcesFromManifest(document.toJS({ maxAliasCount: 0 }));
}
function readNetworkPolicy(kind = "renderer") { return readResources()[kind].networkPolicy; }

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

async function compileCss() {
  const cssFile = path.join(sourceRoot, "styles.css");
  const cssSource = fs.readFileSync(cssFile, "utf8");
  const tailwindImport = /@import\s+["']tailwindcss["']\s+source\(none\)\s*;/g;
  assert.equal([...cssSource.matchAll(tailwindImport)].length, 1, "MCP styles must disable automatic Tailwind source scanning");
  assert(!/@import\b/.test(cssSource.replace(tailwindImport, "")), "MCP styles cannot import additional files or external resources");
  const resolvedCss = cssSource.replace(tailwindImport, () =>
    `@import ${JSON.stringify(require.resolve("tailwindcss/index.css"))} source(none);\n${fs.readFileSync(sharedStylesFile, "utf8")}`);
  const css = await postcss([tailwind({ base: sourceRoot }), autoprefixer]).process(resolvedCss, { from: cssFile, map: false });
  assert(!/<\/style/i.test(css.css), "MCP CSS cannot terminate its inline style element");
  return css.css;
}
async function buildMcpApp(kind = "map", css) {
  assert(["map", "gantt"].includes(kind), "unknown MCP resource");
  const resources = readResources();
  const networkPolicy = resources[kind].networkPolicy;
  const validator = standaloneValidator();
  const bundle = await esbuild.build({
    absWorkingDir: projectRoot,
    entryPoints: [path.join(sourceRoot, `${kind}-main.mjs`)],
    nodePaths: [path.join(staticRoot, "node_modules")], bundle:true, write:false, platform:"browser", format:"iife",
    target:["es2020"], charset:"utf8", minify:true, drop:["console"], legalComments:"inline", sourcemap:false, metafile:true,
    plugins:[{name:"mcp-build-time-contract",setup(build){
      build.onResolve({filter:/^(mcp-view-validator|mcp-network-policy)$/},args=>({path:args.path,namespace:"mcp-contract"}));
      build.onLoad({filter:/.*/,namespace:"mcp-contract"},args=>({contents:args.path==="mcp-view-validator"?validator:[
        `export const connectDomains = Object.freeze(${JSON.stringify(networkPolicy.connectDomains)});`,
        `export const resourceDomains = Object.freeze(${JSON.stringify(networkPolicy.resourceDomains)});`
      ].join("\n"),loader:"js",resolveDir:staticRoot}));
    }}]
  });
  assert.equal(bundle.outputFiles.length,1,"MCP App must produce one inline JavaScript bundle");
  let html=fs.readFileSync(path.join(sourceRoot,`${kind}-template.html`),"utf8");
  html=replaceOnce(html,"<!-- MCP_LOGO -->",fs.readFileSync(logoFile).toString("base64"));
  html=replaceOnce(html,"<!-- MCP_STYLE -->",`<style>\n${css ?? await compileCss()}\n</style>`);
  html=replaceOnce(html,"<!-- MCP_SCRIPT -->",`<script>\n${inlineScript(bundle.outputFiles[0].text)}\n</script>`);
  html=html.replace(/\r\n/g,"\n").replace(/\s*$/,"\n");
  assert(Buffer.byteLength(html)<=4*1024*1024,`${resources[kind].file} exceeds 4 MiB`);
  return {kind,html,networkPolicy,inputs:Object.keys(bundle.metafile.inputs)};
}
async function buildRenderer() {
  const resources = readResources();
  const networkPolicy = resources.renderer.networkPolicy;
  const bundle = await esbuild.build({
    absWorkingDir:projectRoot,
    entryPoints:[path.join(sourceRoot,"renderer-main.mjs")],
    nodePaths:[path.join(staticRoot,"node_modules")],bundle:true,write:false,platform:"browser",format:"iife",
    target:["es2020"],charset:"utf8",minify:true,drop:["console"],legalComments:"inline",sourcemap:false,metafile:true,
    plugins:[{name:"mcp-renderer-network-policy",setup(build){
      build.onResolve({filter:/^mcp-network-policy$/},()=>({path:"mcp-network-policy",namespace:"mcp-contract"}));
      build.onLoad({filter:/.*/,namespace:"mcp-contract"},()=>({contents:[
        `export const connectDomains = Object.freeze(${JSON.stringify(networkPolicy.connectDomains)});`,
        `export const resourceDomains = Object.freeze(${JSON.stringify(networkPolicy.resourceDomains)});`
      ].join("\n"),loader:"js",resolveDir:staticRoot}));
    }}]
  });
  assert.equal(bundle.outputFiles.length,1,"Map renderer must produce one inline JavaScript bundle");
  const css=fs.readFileSync(path.join(sourceRoot,"renderer-styles.css"),"utf8");
  assert(!/@import\b|<\/style/i.test(css),"Map renderer CSS must be self-contained");
  let html=fs.readFileSync(path.join(sourceRoot,"renderer-template.html"),"utf8");
  html=replaceOnce(html,"<!-- MCP_RENDERER_STYLE -->",`<style>\n${css}\n</style>`);
  html=replaceOnce(html,"<!-- MCP_RENDERER_SCRIPT -->",`<script>\n${inlineScript(bundle.outputFiles[0].text)}\n</script>`);
  html=html.replace(/\r\n/g,"\n").replace(/\s*$/,"\n");
  assert(Buffer.byteLength(html)<=4*1024*1024,"mcp-map-renderer.html exceeds 4 MiB");
  return {kind:"renderer",html,networkPolicy,inputs:Object.keys(bundle.metafile.inputs)};
}
async function buildMcpApps(){const css=await compileCss();return {map:await buildMcpApp("map",css),gantt:await buildMcpApp("gantt",css),renderer:await buildRenderer()};}

async function main() {
  assert(process.argv.slice(2).every((arg) => arg === "--check"), "Only --check is supported");
  const built = await buildMcpApps();
  if (process.argv.includes("--check")) {
    for (const kind of ["map","gantt","renderer"]) assert.equal(fs.readFileSync(outputFiles[kind],"utf8"),built[kind].html,`${path.basename(outputFiles[kind])} is stale; run npm run build:mcp-app`);
    assert(!fs.existsSync(path.join(staticRoot,"mcp-app.html")),"legacy mcp-app.html must be deleted");
    console.log("[build:mcp-app] all tracked artifacts are current (no files written)");
  } else {
    for (const kind of ["map","gantt","renderer"]) { fs.writeFileSync(outputFiles[kind],built[kind].html,"utf8"); console.log(`[build:mcp-app] wrote ${path.basename(outputFiles[kind])} (${Buffer.byteLength(built[kind].html)} bytes)`); }
    fs.rmSync(path.join(staticRoot,"mcp-app.html"),{force:true});
  }
}
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { buildMcpApp, buildMcpApps, buildRenderer, readResources, resourcesFromManifest, readNetworkPolicy, networkPolicyFromManifest, standaloneValidator, exactOrigins, staticRoot, projectRoot, sourceRoot, outputFile, outputFiles };
