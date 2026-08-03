const fs = require("fs");
const path = require("path");
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const autoprefixer = require("autoprefixer");

const rootDir = path.resolve(__dirname, "..");
const fullInputFile = path.join(rootDir, "assets/css/style.css");
const fullOutputFile = path.join(rootDir, "assets/css/style.compiled.css");
const tailwindInputFile = path.join(rootDir, "assets/css/scenario-tailwind.source.css");
const businessInputFile = path.join(rootDir, "assets/css/scenario-business.source.css");
const retiredScenarioComponentOutputs = [
  path.join(rootDir, "assets/css/scenario-tailwind.compiled.css"),
  path.join(rootDir, "assets/css/scenario-business.compiled.css")
];
const workspaceSourceFile = path.join("/tmp", "vrp0-scenario-workspace-source.html");
const watchMode = process.argv.includes("--watch");

function requiredIndex(source, marker, from = 0) {
  const index = source.indexOf(marker, from);
  if (index < 0) {
    throw new Error(`Scenario workspace source marker is missing: ${marker}`);
  }
  return index;
}

function scenarioWorkspaceSource() {
  const source = fs.readFileSync(path.join(rootDir, "pages/scenario-detail.html"), "utf8");
  const skillsStart = requiredIndex(source, '  <dialog\n    x-ref="skillsDialog"');
  const importStart = requiredIndex(source, '  <dialog\n    x-ref="importSolveRequestDialog"');
  const workspaceStart = requiredIndex(source, '          <section class="flex flex-1 min-h-0 flex-col divide-y-[1.25px] divide-slate-200 min-[1600px]:overflow-hidden">');
  const sidebarMarker = requiredIndex(source, "scenario-sidebar-column");
  const sidebarStart = source.lastIndexOf("\n      <div", sidebarMarker);
  const workspaceEnd = source.lastIndexOf("\n      </div>", sidebarStart);
  const mapStart = source.lastIndexOf("\n        <div", requiredIndex(source, 'x-show="mapPicker.open"', sidebarMarker));
  const mapEnd = requiredIndex(source, "\n        </aside>", mapStart) + "\n        </aside>".length;
  if (sidebarStart < 0 || workspaceEnd < workspaceStart || mapStart < 0) {
    throw new Error("Scenario workspace source structure is invalid");
  }
  return [
    source.slice(skillsStart, importStart),
    source.slice(workspaceStart, workspaceEnd),
    source.slice(mapStart, mapEnd),
    fs.readFileSync(path.join(rootDir, "pages/solver-job-detail.html"), "utf8"),
    fs.readFileSync(path.join(rootDir, "pages/solver-job-map.html"), "utf8")
  ].join("\n");
}

async function compile(css, from, output) {
  const result = await postcss([tailwind(), autoprefixer]).process(css, {
    from,
    to: output
  });
  return result.css;
}

function writeCss(output, css) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, css, "utf8");
}

function removeRetiredScenarioComponentOutputs() {
  retiredScenarioComponentOutputs.forEach((file) => fs.rmSync(file, { force: true }));
}

function scenarioTailwindInput() {
  const source = fs.readFileSync(tailwindInputFile, "utf8");
  return [
    source,
    `@source "${workspaceSourceFile}";`,
    '@source "../js/pages/scenario-detail-page.js";',
    '@source "../js/pages/solver-job-detail-page.js";',
    '@source "../js/pages/solver-job-map-page.js";',
    '@source "../js/scenario-component-entry.js";'
  ].join("\n");
}

async function buildScenarioComponentCss() {
  removeRetiredScenarioComponentOutputs();
  fs.writeFileSync(workspaceSourceFile, scenarioWorkspaceSource(), "utf8");
  const [tailwindCss, businessCss] = await Promise.all([
    compile(scenarioTailwindInput(), tailwindInputFile, path.join(rootDir, "scenario.html")),
    compile(fs.readFileSync(businessInputFile, "utf8"), businessInputFile, path.join(rootDir, "scenario.html"))
  ]);
  return [tailwindCss, businessCss.replace(/\n+$/, "")].join("\n\n");
}

async function buildCss() {
  removeRetiredScenarioComponentOutputs();
  const fullCss = await compile(fs.readFileSync(fullInputFile, "utf8"), fullInputFile, fullOutputFile);
  writeCss(fullOutputFile, fullCss);
  console.log(`[build-css] wrote ${path.relative(rootDir, fullOutputFile)}`);
}

function watch() {
  const watchTargets = [
    path.join(rootDir, "assets/css"),
    path.join(rootDir, "assets/js"),
    path.join(rootDir, "pages"),
    path.join(rootDir, "index.html"),
    path.join(rootDir, "scenario.html")
  ];

  let timeoutId = null;
  const schedule = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      buildCss().catch((error) => {
        console.error("[build-css] failed", error);
      });
    }, 80);
  };

  watchTargets.forEach((target) => {
    if (fs.existsSync(target)) {
      fs.watch(target, { recursive: true }, schedule);
    }
  });
  console.log("[build-css] watching for changes");
}

if (require.main === module) {
  buildCss()
    .then(() => {
      if (watchMode) {
        watch();
      }
    })
    .catch((error) => {
      console.error("[build-css] failed", error);
      process.exitCode = 1;
    });
}

module.exports = { buildCss, buildScenarioComponentCss };
