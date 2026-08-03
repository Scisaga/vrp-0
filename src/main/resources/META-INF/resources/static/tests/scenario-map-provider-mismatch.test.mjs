import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const hostPagePath = path.resolve(testDirectory, "../assets/js/pages/scenario-component-page.js");

async function loadHostPageModule() {
  const result = await build({
    entryPoints: [hostPagePath],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "host-page-test-stubs",
      setup(buildOptions) {
        buildOptions.onResolve({ filter: /(?:scenario-component-runtime|scenario-component-engine-actions)\.js$|vendor\/codemirror\// }, () => ({
          path: "host-page-test-stub",
          namespace: "host-page-test-stub"
        }));
        buildOptions.onLoad({ filter: /.*/, namespace: "host-page-test-stub" }, () => ({
          contents: `
            export const basicSetup = {};
            export class EditorView {}
            export const EditorState = {};
            export const foldAll = () => {};
            export const unfoldAll = () => {};
            export const linter = () => {};
            export const json = () => {};
            export const jsonParseLinter = () => {};
            export const mountScenarioComponent = () => ({});
            export const engineScenarioActions = () => ({});
          `,
          loader: "js"
        }));
      }
    }]
  });
  const module = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "Conflict",
    headers: { get: () => "application/json" },
    json: async () => payload
  };
}

test("Host 识别图商不兼容并在清除后回填空场景", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  const requests = [];
  const replacements = [];
  const notifications = [];

  globalThis.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.window = {
    confirm: () => true,
    dispatchEvent: (event) => notifications.push(event)
  };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || "GET" });
    if (url === "/scenario" && !options.method) {
      return jsonResponse(400, {
        error_code: "scenario_map_provider_mismatch",
        error_params: { expected_provider: "AMAP" },
        message: "Scenario map_provider must match MAP_PROVIDER=AMAP"
      });
    }
    if (url === "/scenario" && options.method === "DELETE") {
      return jsonResponse(200, { success: true });
    }
    throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
  };

  try {
    const { scenarioComponentPage } = await loadHostPageModule();
    const page = scenarioComponentPage();
    page.element = {
      replaceScenarioDraft(payload) {
        replacements.push(payload);
      },
      clearAvailableAgentTrend() {}
    };

    await page.loadScenarioDraft();

    assert.equal(page.scenarioProviderMismatch, true);
    assert.equal(page.scenarioPersisted, false);
    assert.deepEqual(replacements, []);

    await page.deleteScenario();

    assert.equal(page.scenarioProviderMismatch, false);
    assert.deepEqual(requests, [
      { url: "/scenario", method: "GET" },
      { url: "/scenario", method: "DELETE" }
    ]);
    assert.deepEqual(replacements, [
      { request_payload: null, scenario_persisted: false }
    ]);
    assert.equal(notifications.at(-1).detail.message, "当前场景已删除。");
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.window = previousWindow;
    globalThis.CustomEvent = previousCustomEvent;
  }
});
