const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const { buildScenarioComponentCss } = require("./build-css.cjs");
const { buildHostDependencies } = require("./build-scenario-host-dependencies.cjs");

const root = path.resolve(__dirname, "..");
const componentRequirementsFile = path.resolve(root, "..", "..", "..", "scenario-ui", "component-dependencies.json");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

function requiredIndex(source, marker, from = 0) {
  const index = source.indexOf(marker, from);
  if (index < 0) {
    throw new Error("Scenario workspace source marker is missing: " + marker);
  }
  return index;
}

function scenarioWorkspaceTemplate() {
  const source = read("pages", "scenario-detail.html");
  const rootEnd = source.indexOf("\n");
  const tooltipStart = requiredIndex(source, '  <div\n    x-show="hoveredJobId"');
  const skillsStart = requiredIndex(source, '  <dialog\n    x-ref="skillsDialog"');
  const importStart = requiredIndex(source, '  <dialog\n    x-ref="importSolveRequestDialog"');
  const workspaceStart = requiredIndex(source, '          <section class="flex flex-1 min-h-0 flex-col divide-y-[1.25px] divide-slate-200 min-[1600px]:overflow-hidden">');
  const sidebarMarker = requiredIndex(source, "scenario-sidebar-column");
  const sidebarStart = source.lastIndexOf("\n      <div", sidebarMarker);
  const workspaceEnd = source.lastIndexOf("\n      </div>", sidebarStart);
  const overviewStart = requiredIndex(source, '          <section class="min-h-0 flex flex-col shrink-0">', sidebarMarker);
  const overviewEnd = requiredIndex(source, "\n          </section>", overviewStart) + "\n          </section>".length;
  const availableAgentTrendMarker = requiredIndex(source, "scenario.availableAgentTrend", sidebarMarker);
  const availableAgentTrendStart = source.lastIndexOf("\n          <section", availableAgentTrendMarker);
  const availableAgentTrendEnd = requiredIndex(source, "\n          </section>", availableAgentTrendStart) + "\n          </section>".length;
  const mapStart = source.lastIndexOf("\n        <div", requiredIndex(source, 'x-show="mapPicker.open"', sidebarMarker));
  const mapEnd = requiredIndex(source, "\n        </aside>", mapStart) + "\n        </aside>".length;

  if (rootEnd < 0 || sidebarStart < 0 || workspaceEnd < workspaceStart || overviewEnd < overviewStart || availableAgentTrendEnd < availableAgentTrendStart || mapStart < 0) {
    throw new Error("Scenario workspace source structure is invalid");
  }

  return [
    source.slice(0, rootEnd),
    source.slice(rootEnd + 1, tooltipStart),
    source.slice(tooltipStart, skillsStart),
    source.slice(skillsStart, importStart),
    '  <div class="flex-1 min-h-0 min-[1600px]:overflow-hidden">',
    '    <div class="scenario-main-grid responsive-workspace" :class="(showScenarioOverview || showAvailableAgentTrend) ? (sidebarCollapsed ? \'scenario-main-grid--with-sidebar scenario-main-grid--sidebar-collapsed\' : \'scenario-main-grid--with-sidebar\') : \'\'">',
    '      <div class="responsive-workspace-main flex flex-col min-[1600px]:overflow-hidden">',
    source.slice(workspaceStart, workspaceEnd),
    "      </div>",
    '      <template x-if="showScenarioOverview || showAvailableAgentTrend">',
    '        <div class="scenario-sidebar-column responsive-workspace-aside relative overflow-visible" :class="sidebarCollapsed ? \'scenario-sidebar-column--collapsed\' : \'\'">',
    '          <button type="button" class="scenario-sidebar-toggle ui-tooltip" @click="toggleScenarioSidebar()" :aria-expanded="String(!sidebarCollapsed)" :aria-label="sidebarCollapsed ? \'展开右侧栏\' : \'收起右侧栏\'" :data-tooltip="sidebarCollapsed ? \'展开右侧栏\' : \'收起右侧栏\'">',
    '            <span class="material-symbols-rounded text-[22.5px]" x-text="sidebarCollapsed ? \'chevron_left\' : \'chevron_right\'"></span>',
    '          </button>',
    '          <aside x-show="!sidebarCollapsed" class="scenario-sidebar-panel panel-shell min-h-0 min-[1600px]:h-full">',
    '            <template x-if="showScenarioOverview">',
    source.slice(overviewStart, overviewEnd),
    "            </template>",
    '            <template x-if="showAvailableAgentTrend">',
    source.slice(availableAgentTrendStart, availableAgentTrendEnd),
    "            </template>",
    "          </aside>",
    "        </div>",
    "      </template>",
    "    </div>",
    "  </div>",
    source.slice(mapStart, mapEnd),
    "</div>"
  ].join("\n");
}

function withoutEngineLocalControls(file) {
  return read("pages", file).replace(/<button\b(?=[^>]*\bdata-engine-local-control\b)[\s\S]*?<\/button>/g, "");
}

function escapeInlineScript(value) {
  return value.replace(/<\/script/gi, "<\\/script");
}

function componentRequirements() {
  const requirements = JSON.parse(fs.readFileSync(componentRequirementsFile, "utf8"));
  if (requirements.format !== "component_v1" || requirements.host_runtime !== "scenario_host_runtime_v1") {
    throw new Error("component-dependencies.json 的组件格式或 Host Runtime 版本非法");
  }
  return requirements;
}

async function buildBundle(templates) {
  const output = await esbuild.build({
    entryPoints: [path.join(root, "assets", "js", "scenario-component-entry.js")],
    bundle: true,
    format: "iife",
    globalName: "VrpScenarioComponentEntry",
    platform: "browser",
    target: ["es2020"],
    write: false,
    define: {
      __SCENARIO_COMPONENT_TEMPLATES__: JSON.stringify(templates)
    }
  });
  return output.outputFiles[0].text;
}

async function main() {
  buildHostDependencies();
  const templates = {
    create: scenarioWorkspaceTemplate(),
    result: withoutEngineLocalControls("solver-job-detail.html"),
    map: withoutEngineLocalControls("solver-job-map.html")
  };
  const css = [await buildScenarioComponentCss(), read("assets", "css", "scenario-component.css")].join("\n\n");
  const bundle = await buildBundle(templates);
  const script = [
    bundle,
    "return VrpScenarioComponentEntry.mountScenarioUi(component, root, context, actions, Alpine);"
  ].join("\n");
  const manifest = JSON.stringify(componentRequirements(), null, 2);
  const html = [
    "<!-- Generated by scripts/build-scenario-component.cjs. Do not edit directly. -->",
    '<template data-scenario-ui-manifest>\n' + manifest + '\n</template>',
    "<style>" + css + "</style>",
    '<div id="scenario-root" class="scenario-component-root app-shell"></div>',
    "<script export>\n" + escapeInlineScript(script) + "\n</script>",
    ""
  ].join("\n").replace(/[\t ]+(?=\n)/g, "");
  fs.writeFileSync(path.join(root, "scenario.html"), html);
  console.log("[build:scenario] wrote scenario.html (" + Buffer.byteLength(html) + " bytes)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
