import {
  ScenarioDependencyError,
  loadHostDependencyRegistry,
  prepareScenarioDependencies
} from "./scenario-host-dependencies.js?v=20260715-scenario-host-dependencies-v1";

/* Fixed extension for vendored alpinejs-web-components@0.1.3. */
const cache = new Map();
const SCENARIO_HTML_URL = new URL("../../../scenario.html", import.meta.url).toString();

function safeTagPart(value) {
  const normalized = String(value || "vrp0")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "vrp0";
}

async function source(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url, { credentials: "same-origin" }).then(async (response) => {
      if (!response.ok) {
        throw new Error("Scenario UI 加载失败（HTTP " + response.status + "）");
      }
      return response.text();
    }).catch((error) => {
      cache.delete(url);
      throw error;
    }));
  }
  return cache.get(url);
}

function exportedScript(template) {
  const scripts = [...template.content.querySelectorAll("script")];
  const exported = scripts.filter((item) => item.hasAttribute("export"));
  if (scripts.length !== 1 || exported.length !== 1 || exported[0].src) {
    throw new Error("Scenario UI 导出脚本非法");
  }
  const code = exported[0].textContent || "";
  exported[0].remove();
  return code;
}

function errorDetail(error) {
  if (error instanceof ScenarioDependencyError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "SCENARIO_RUNTIME_ERROR",
    message: error?.message || "Scenario UI 初始化失败"
  };
}

export function defineScenarioComponent(tag) {
  if (customElements.get(tag)) {
    return tag;
  }
  customElements.define(tag, class extends HTMLElement {
    constructor() {
      super();
      this.context = null;
      this.actions = null;
      this.cleanup = null;
      this.connected = false;
      this.attachShadow({ mode: "open" });
    }

    async connectedCallback() {
      if (this.connected) {
        return;
      }
      this.connected = true;
      try {
        const [html, registry] = await Promise.all([
          source(SCENARIO_HTML_URL),
          loadHostDependencyRegistry()
        ]);
        if (!this.isConnected) {
          return;
        }
        const template = document.createElement("template");
        template.innerHTML = html;
        await prepareScenarioDependencies({
          template,
          root: this.shadowRoot,
          context: this.context,
          registry
        });
        if (!this.isConnected) {
          return;
        }
        const code = exportedScript(template);
        this.shadowRoot.append(template.content.cloneNode(true));
        this.cleanup = await new Function(
          "component",
          "host",
          "root",
          "context",
          "actions",
          "Alpine",
          '"use strict";\n' + code
        )(this, this, this.shadowRoot, this.context, this.actions, window.Alpine);
        this.dispatchEvent(new CustomEvent("scenario-ready", { bubbles: true, composed: true }));
      } catch (error) {
        this.dispatchEvent(new CustomEvent("scenario-error", {
          detail: errorDetail(error),
          bubbles: true,
          composed: true
        }));
      }
    }

    disconnectedCallback() {
      if (typeof this.cleanup === "function") {
        this.cleanup();
      } else {
        this.cleanup?.destroy?.();
      }
      this.cleanup = null;
      this.connected = false;
      this.shadowRoot.replaceChildren();
    }

    updateContext(context) {
      this.context = context;
      try {
        this.cleanup?.updateContext?.(context);
      } catch (error) {
        this.dispatchEvent(new CustomEvent("scenario-error", {
          detail: {
            code: "SCENARIO_CONTEXT_UPDATE_FAILED",
            message: error?.message || "Scenario UI 上下文更新失败"
          },
          bubbles: true,
          composed: true
        }));
      }
      this.dispatchEvent(new CustomEvent("scenario-context-updated", {
        detail: { context },
        bubbles: true,
        composed: true
      }));
    }
  });
  return tag;
}

export function mountScenarioComponent(container, context, actions) {
  const tag = "vrp-scenario-ui-" + safeTagPart(context?.component_version || "vrp0");
  const element = document.createElement(defineScenarioComponent(tag));
  element.context = context;
  element.actions = actions;
  container.replaceChildren(element);
  return element;
}
