import Alpine from "../vendor/alpinejs/module.esm.js";
import "./components/date-time-24-input.js";
import { frameShell } from "./components/frame.js";
import { scenarioComponentPage } from "./pages/scenario-component-page.js";
import { solverJobListPage } from "./pages/solver-job-list-page.js";
import { quotaPage } from "./pages/quota-page.js";
import { mcpPage } from "./pages/mcp-page.js";
import { warmMapRuntime } from "./utils/map-runtime-preload.js";
import { initUiTooltips } from "./utils/ui-tooltip.js";

window.Alpine = Alpine;

// Start the configured map SDK in parallel with the app shell. Map views reuse
// this promise, while non-map UI remains independent from SDK availability.
warmMapRuntime().catch(() => {});

Alpine.data("frameShell", frameShell);
Alpine.data("scenarioComponentPage", scenarioComponentPage);
Alpine.data("solverJobListPage", solverJobListPage);
Alpine.data("quotaPage", quotaPage);
Alpine.data("mcpPage", mcpPage);

initUiTooltips(document);
Alpine.start();
