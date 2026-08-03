const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "assets", "scenario-runtime");
const dependencyRoot = path.join(runtimeRoot, "dependencies");
const componentRequirementsFile = path.resolve(root, "..", "..", "..", "scenario-ui", "component-dependencies.json");

const materialVersion = "2026-06-v1";
const plotlyVersion = "3.3.1";
const runtimeVersion = "scenario_host_runtime_v1";
const materialFamily = "Material Symbols Rounded Scenario 2026-06-v1";
const retiredTailwindDependencyDirectory = path.join(dependencyRoot, "tailwind_scenario");

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function staticUrl(...parts) {
  return `/static/assets/scenario-runtime/dependencies/${parts.join("/")}`;
}

function requireRequirements() {
  const requirements = JSON.parse(fs.readFileSync(componentRequirementsFile, "utf8"));
  const prerequisites = (requirements.host_prerequisites || []).map((item) => `${item.id}@${item.version}`);
  const core = (requirements.dependencies?.core || []).map((item) => `${item.id}@${item.version}`);
  const result = (requirements.dependencies?.views?.result || []).map((item) => `${item.id}@${item.version}`);
  const expected = [
    [`alpine@3.15.3`],
    [`material_symbols_rounded@${materialVersion}`],
    [`plotly_basic@${plotlyVersion}`]
  ];
  const actual = [prerequisites, core, result];
  const matchesExpected = actual.every((items, index) => items.length === expected[index].length
      && expected[index].every((key) => items.includes(key)));
  if (requirements.format !== "component_v1"
      || requirements.host_runtime !== runtimeVersion
      || !matchesExpected) {
    throw new Error("component-dependencies.json 与 Host dependency 版本不一致");
  }
  const declared = [
    ...prerequisites,
    ...core,
    ...result
  ];
  if (declared.length !== new Set(declared).size) {
    throw new Error("component-dependencies.json 不允许重复依赖");
  }
}

function materialCss() {
  return `@font-face {
  font-family: "${materialFamily}";
  font-style: normal;
  font-weight: 400;
  src: url("./material-symbols-rounded.ttf") format("truetype");
}

.material-symbols-rounded {
  font-family: "${materialFamily}";
  font-style: normal;
  font-weight: normal;
  display: inline-block;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  font-feature-settings: "liga";
  -webkit-font-smoothing: antialiased;
}
`;
}

function filesMetadata(entries) {
  return Object.fromEntries(entries.map(([url, file]) => [url, sha256(file)]));
}

function writeRegistry() {
  const materialDir = path.join(dependencyRoot, "material_symbols_rounded", materialVersion);
  const plotlyDir = path.join(dependencyRoot, "plotly_basic", plotlyVersion);
  const materialCssFile = path.join(materialDir, "material-symbols-rounded.css");
  const materialFontFile = path.join(materialDir, "material-symbols-rounded.ttf");
  const plotlyFile = path.join(plotlyDir, "plotly-basic.min.js");

  const materialEntry = staticUrl("material_symbols_rounded", materialVersion, "material-symbols-rounded.css");
  const materialFont = staticUrl("material_symbols_rounded", materialVersion, "material-symbols-rounded.ttf");
  const plotlyEntry = staticUrl("plotly_basic", plotlyVersion, "plotly-basic.min.js");
  const registry = {
    runtime_version: runtimeVersion,
    prerequisites: {
      "alpine@3.15.3": {
        type: "global",
        global: "Alpine",
        version_property: "version"
      }
    },
    provides: {
      [`material_symbols_rounded@${materialVersion}`]: {
        type: "stylesheet",
        entry: materialEntry,
        entry_sha256: sha256(materialCssFile),
        files: filesMetadata([[materialEntry, materialCssFile], [materialFont, materialFontFile]]),
        font_families: [materialFamily]
      },
      [`plotly_basic@${plotlyVersion}`]: {
        type: "script",
        entry: plotlyEntry,
        entry_sha256: sha256(plotlyFile),
        files: filesMetadata([[plotlyEntry, plotlyFile]]),
        global: "Plotly",
        version_property: "version"
      }
    }
  };
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function buildHostDependencies() {
  requireRequirements();
  fs.rmSync(retiredTailwindDependencyDirectory, { recursive: true, force: true });
  const materialDir = path.join(dependencyRoot, "material_symbols_rounded", materialVersion);
  const plotlyDir = path.join(dependencyRoot, "plotly_basic", plotlyVersion);

  fs.mkdirSync(materialDir, { recursive: true });
  fs.writeFileSync(path.join(materialDir, "material-symbols-rounded.css"), materialCss(), "utf8");
  copy(path.join(root, "assets", "fonts", "material-symbols-rounded.ttf"), path.join(materialDir, "material-symbols-rounded.ttf"));
  copy(
    path.join(root, "node_modules", "plotly.js", "dist", "plotly-basic.min.js"),
    path.join(plotlyDir, "plotly-basic.min.js")
  );
  writeRegistry();
  console.log("[build:host-dependencies] wrote Scenario Host dependency registry and resources");
}

if (require.main === module) {
  try {
    buildHostDependencies();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = { buildHostDependencies };
