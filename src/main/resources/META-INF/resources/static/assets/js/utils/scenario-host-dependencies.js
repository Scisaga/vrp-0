const REGISTRY_URL = new URL("../../scenario-runtime/registry.json", import.meta.url).toString();
const HOST_RUNTIME_VERSION = "scenario_host_runtime_v1";
const REQUIRED_PREREQUISITES = new Set(["alpine@3.15.3"]);
const REQUIRED_CORE_DEPENDENCIES = new Set(["material_symbols_rounded@2026-06-v1"]);
const REQUIRED_RESULT_DEPENDENCIES = new Set(["plotly_basic@3.3.1"]);

let registryPromise = null;
const scriptLoads = new Map();
const fontLoads = new Map();

export class ScenarioDependencyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function unsupported(message) {
  return new ScenarioDependencyError("SCENARIO_RUNTIME_DEPENDENCY_UNSUPPORTED", message);
}

function versionUnsupported(message) {
  return new ScenarioDependencyError("SCENARIO_RUNTIME_VERSION_UNSUPPORTED", message);
}

function loadFailed(message) {
  return new ScenarioDependencyError("SCENARIO_RUNTIME_DEPENDENCY_LOAD_FAILED", message);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, keys) {
  return isObject(value)
    && Object.keys(value).every((key) => keys.includes(key))
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function requirementKey(requirement) {
  return requirement.id + "@" + requirement.version;
}

function requireExactDependencies(requirements, expected, label) {
  const actual = new Set(requirements.map(requirementKey));
  if (actual.size !== expected.size || [...expected].some((key) => !actual.has(key))) {
    throw versionUnsupported(label + " 未声明当前组件所需的固定依赖集合");
  }
}

function validateRequirements(items, label) {
  if (!Array.isArray(items)) {
    throw versionUnsupported(label + " 必须是数组");
  }
  const keys = new Set();
  items.forEach((item) => {
    if (!hasOnlyKeys(item, ["id", "version"])
        || typeof item.id !== "string" || !item.id
        || typeof item.version !== "string" || !item.version) {
      throw versionUnsupported(label + " 的依赖声明非法");
    }
    const key = requirementKey(item);
    if (keys.has(key)) {
      throw versionUnsupported(label + " 不允许重复依赖");
    }
    keys.add(key);
  });
  return items;
}

function extractManifest(template) {
  const manifests = Array.from(template.content.querySelectorAll("template[data-scenario-ui-manifest]"));
  if (manifests.length !== 1) {
    throw versionUnsupported("Scenario UI 必须包含唯一的 dependency manifest");
  }
  const element = manifests[0];
  if (element.attributes.length !== 1) {
    throw versionUnsupported("Scenario UI dependency manifest 属性非法");
  }

  let manifest;
  try {
    // HTMLTemplateElement stores its children in `content`, so reading only
    // textContent would reject the valid manifest in browser runtimes.
    manifest = JSON.parse(element.content?.textContent || element.textContent || "");
  } catch (_error) {
    throw versionUnsupported("Scenario UI dependency manifest 不是合法 JSON");
  }
  if (!hasOnlyKeys(manifest, ["format", "host_runtime", "host_prerequisites", "dependencies"])
      || manifest.format !== "component_v1"
      || manifest.host_runtime !== HOST_RUNTIME_VERSION
      || !isObject(manifest.dependencies)
      || !hasOnlyKeys(manifest.dependencies, ["core", "views"])
      || !isObject(manifest.dependencies.views)
      || !hasOnlyKeys(manifest.dependencies.views, ["result"])) {
    throw versionUnsupported("Scenario UI dependency manifest 版本或结构不受支持");
  }

  const prerequisites = validateRequirements(manifest.host_prerequisites, "host_prerequisites");
  const core = validateRequirements(manifest.dependencies.core, "dependencies.core");
  const result = validateRequirements(manifest.dependencies.views.result, "dependencies.views.result");
  const keys = new Set();
  [...prerequisites, ...core, ...result].forEach((item) => {
    const key = requirementKey(item);
    if (keys.has(key)) {
      throw versionUnsupported("Scenario UI dependency manifest 不允许跨分组重复依赖");
    }
    keys.add(key);
  });
  requireExactDependencies(prerequisites, REQUIRED_PREREQUISITES, "host_prerequisites");
  requireExactDependencies(core, REQUIRED_CORE_DEPENDENCIES, "dependencies.core");
  requireExactDependencies(result, REQUIRED_RESULT_DEPENDENCIES, "dependencies.views.result");
  element.remove();
  return { prerequisites, core, result };
}

function verifyRegistry(registry) {
  if (!isObject(registry)
      || registry.runtime_version !== HOST_RUNTIME_VERSION
      || !isObject(registry.prerequisites)
      || !isObject(registry.provides)) {
    throw versionUnsupported("Host dependency registry 版本或结构不受支持");
  }
}

function validateProvider(provider) {
  if (!isObject(provider)
      || !["stylesheet", "script"].includes(provider.type)
      || typeof provider.entry !== "string"
      || !provider.entry.startsWith("/static/assets/scenario-runtime/dependencies/")
      || provider.entry.includes("..")
      || provider.entry.includes("?")
      || provider.entry.includes("#")
      || !/^[a-f0-9]{64}$/.test(provider.entry_sha256 || "")
      || !isObject(provider.files)
      || provider.files[provider.entry] !== provider.entry_sha256) {
    throw unsupported("Host dependency registry 条目非法");
  }
  const allowedFields = provider.type === "stylesheet"
    ? ["type", "entry", "entry_sha256", "files", "font_families"]
    : ["type", "entry", "entry_sha256", "files", "global", "version_property"];
  if (Object.keys(provider).some((field) => !allowedFields.includes(field))) {
    throw unsupported("Host dependency registry 条目包含不支持字段");
  }
  if (Object.keys(provider.files).some((url) => !url.startsWith("/static/assets/scenario-runtime/dependencies/")
      || url.includes("..") || url.includes("?") || url.includes("#")
      || !/^[a-f0-9]{64}$/.test(provider.files[url] || ""))) {
    throw unsupported("Host dependency registry 文件条目非法");
  }
  if (provider.type === "script"
      && (typeof provider.global !== "string" || !provider.global
          || typeof provider.version_property !== "string" || !provider.version_property)) {
    throw unsupported("Host script dependency registry 条目非法");
  }
  if (provider.type === "stylesheet" && provider.font_families !== undefined
      && (!Array.isArray(provider.font_families)
          || provider.font_families.some((name) => typeof name !== "string" || !name))) {
    throw unsupported("Host stylesheet dependency registry 字体声明非法");
  }
}

function hexIntegrity(hex) {
  const bytes = new Uint8Array(hex.match(/.{2}/g).map((value) => Number.parseInt(value, 16)));
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return "sha256-" + window.btoa(binary);
}

function verifyPrerequisite(registry, requirement) {
  const provider = registry.prerequisites[requirementKey(requirement)];
  if (!isObject(provider)
      || provider.type !== "global"
      || typeof provider.global !== "string"
      || typeof provider.version_property !== "string") {
    throw unsupported("Host 未提供组件所需前置依赖");
  }
  const global = window[provider.global];
  if (!global || String(global[provider.version_property]) !== requirement.version) {
    throw unsupported("Host 前置依赖版本不匹配");
  }
}

function providerFor(registry, requirement) {
  const provider = registry.provides[requirementKey(requirement)];
  if (!provider) {
    throw unsupported("Host 未提供组件所需依赖");
  }
  validateProvider(provider);
  return provider;
}

function waitForLoad(element) {
  return new Promise((resolve, reject) => {
    element.addEventListener("load", resolve, { once: true });
    element.addEventListener("error", () => reject(loadFailed("Host dependency 加载失败")), { once: true });
  });
}

function fontFileFor(provider) {
  return Object.keys(provider.files).find((url) => /\.(?:ttf|woff2?)$/i.test(url));
}

function fontFormatFor(url) {
  if (/\.woff2$/i.test(url)) {
    return "woff2";
  }
  if (/\.woff$/i.test(url)) {
    return "woff";
  }
  return "truetype";
}

async function waitForFonts(provider) {
  if (!provider.font_families?.length) {
    return;
  }
  const fontFile = fontFileFor(provider);
  if (!fontFile || !document.fonts?.load || typeof FontFace !== "function") {
    throw loadFailed("Host dependency 字体加载环境不受支持");
  }
  try {
    await Promise.all(provider.font_families.map(async (family) => {
      const key = fontFile + "@" + family;
      if (!fontLoads.has(key)) {
        const promise = (async () => {
          // 动态注入 Shadow Root 的 @font-face 不会稳定地注册到 document.fonts。
          // 显式加载受 registry 约束的字体资源；字体样式规则仍只注入组件 Shadow Root。
          const face = new FontFace(
            family,
            'url("' + fontFile + '") format("' + fontFormatFor(fontFile) + '")',
            { style: "normal", weight: "400" }
          );
          await face.load();
          document.fonts.add(face);
        })().catch((error) => {
          fontLoads.delete(key);
          throw error;
        });
        fontLoads.set(key, promise);
      }
      await fontLoads.get(key);
      await document.fonts.load('1em "' + family + '"');
    }));
  } catch (_error) {
    throw loadFailed("Host dependency 字体加载失败");
  }
}

async function appendStylesheet(root, provider) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = provider.entry;
  link.integrity = hexIntegrity(provider.entry_sha256);
  link.crossOrigin = "anonymous";
  const loaded = waitForLoad(link);
  root.appendChild(link);
  await loaded;
  await waitForFonts(provider);
}

function verifyScriptGlobal(provider, requirement) {
  const global = window[provider.global];
  if (!global || String(global[provider.version_property]) !== requirement.version) {
    throw unsupported("Host script dependency 版本不匹配");
  }
}

async function loadScript(provider, requirement) {
  const key = requirementKey(requirement);
  if (window[provider.global]) {
    verifyScriptGlobal(provider, requirement);
    return;
  }
  if (!scriptLoads.has(key)) {
    const promise = (async () => {
      const script = document.createElement("script");
      script.src = provider.entry;
      script.integrity = hexIntegrity(provider.entry_sha256);
      script.crossOrigin = "anonymous";
      const loaded = waitForLoad(script);
      document.head.appendChild(script);
      await loaded;
      verifyScriptGlobal(provider, requirement);
    })().catch((error) => {
      scriptLoads.delete(key);
      if (error instanceof ScenarioDependencyError) {
        throw error;
      }
      throw loadFailed("Host script dependency 加载失败");
    });
    scriptLoads.set(key, promise);
  }
  await scriptLoads.get(key);
}

export async function loadHostDependencyRegistry() {
  if (!registryPromise) {
    registryPromise = fetch(REGISTRY_URL, { credentials: "same-origin", cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) {
          throw loadFailed("Host dependency registry 加载失败");
        }
        try {
          return await response.json();
        } catch (_error) {
          throw versionUnsupported("Host dependency registry 不是合法 JSON");
        }
      })
      .then((registry) => {
        verifyRegistry(registry);
        return registry;
      })
      .catch((error) => {
        registryPromise = null;
        throw error;
      });
  }
  return registryPromise;
}

export async function prepareScenarioDependencies({ template, root, context, registry }) {
  const manifest = extractManifest(template);
  verifyRegistry(registry);
  manifest.prerequisites.forEach((requirement) => verifyPrerequisite(registry, requirement));
  const view = context?.view;
  if (!["create", "result", "map"].includes(view)) {
    throw versionUnsupported("Scenario UI view 不受支持");
  }
  const requirements = view === "result"
    ? [...manifest.core, ...manifest.result]
    : manifest.core;
  const styles = [];
  const scripts = [];
  requirements.forEach((requirement) => {
    const provider = providerFor(registry, requirement);
    if (provider.type === "stylesheet") {
      styles.push(provider);
    } else {
      scripts.push({ provider, requirement });
    }
  });

  root.replaceChildren();
  for (const provider of styles) {
    await appendStylesheet(root, provider);
  }
  await Promise.all(scripts.map(({ provider, requirement }) => loadScript(provider, requirement)));
}
