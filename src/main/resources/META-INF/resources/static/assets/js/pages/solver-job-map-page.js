import { copyText, currentHashQueryParam, formatDateTime, getJson, localizeRequestError, navigate, notify } from "../utils/api.js";
import { applyMapLocale, getAgentRouteNotice, mapLocaleRequiresRecreation, renderSimulation } from "../utils/map.js";
import { hydrateJob, nonVirtualAgents, parseApiDateTime } from "../utils/vrp-model.js";
import { shouldShowFullValueTooltip } from "../utils/ui-tooltip.js";

const SIMULATION_STEP = 5 * 60 * 1000;
const AUTO_REFRESH_INTERVAL = 5 * 1000;
const PLAYBACK_SPEED_OPTIONS = [
  { value: 1, label: "1x" },
  { value: 2, label: "2x" },
  { value: 4, label: "4x" },
  { value: 8, label: "8x" }
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function padTime(value) {
  return String(value).padStart(2, "0");
}

function formatSimulationTimestamp(value) {
  const date = new Date(Number(value));
  return `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(date.getDate())} ${padTime(date.getHours())}:${padTime(date.getMinutes())}:${padTime(date.getSeconds())}`;
}

function sameSimulationDay(min, max) {
  const start = new Date(Number(min));
  const end = new Date(Number(max));
  return start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === end.getDate();
}

function mapGatewayBridge() {
  return window.VrpScenarioGateway || null;
}

function isMapGatewayMode() {
  return Boolean(mapGatewayBridge()?.isScenarioComponent);
}

function firstGatewayObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || null;
}

function looksLikeMapJob(value) {
  return Boolean(value && typeof value === "object" && (
    value.status
    || value.plan
    || value.score
    || value.metrics
    || value.solution_metrics_list
    || value.solutionMetricsList
  ));
}

function normalizeGatewayMapInput(input) {
  const source = firstGatewayObject(input?.payload, input?.data, input) || {};
  const resultPayload = firstGatewayObject(source.result_payload, source.resultPayload, source.result, source.output);
  return firstGatewayObject(
    source.engine_view?.solver_job,
    source.engineView?.solverJob,
    source.job,
    source.solver_job,
    source.solverJob,
    resultPayload?.job,
    resultPayload?.solver_job,
    resultPayload?.solverJob,
    looksLikeMapJob(resultPayload) ? resultPayload : null,
    looksLikeMapJob(source) ? source : null
  );
}

export function simulationBounds(job) {
  const agents = nonVirtualAgents(job);
  const routeStartTimes = [];
  const taskEndTimes = [];
  agents.forEach((agent) => {
    const tickets = agent.tickets || [];
    const agentTaskEndTimes = tickets
      .map((ticket) => parseApiDateTime(ticket.departure_time || ticket.arrival_time))
      .filter(Boolean);
    if (!agentTaskEndTimes.length) {
      return;
    }

    taskEndTimes.push(...agentTaskEndTimes);
    const routeStart = parseApiDateTime(agent.shift_start_time)
      || tickets.map((ticket) => parseApiDateTime(ticket.arrival_time)).find(Boolean);
    if (routeStart) {
      routeStartTimes.push(routeStart);
    }
  });
  if (!routeStartTimes.length || !taskEndTimes.length) {
    const now = Date.now();
    return { min: now, max: now + (3600 * 1000) };
  }
  const min = Math.min(...routeStartTimes.map((date) => date.getTime()));
  const max = Math.max(...taskEndTimes.map((date) => date.getTime()));
  if (max < min) {
    return { min, max: min };
  }
  return {
    min,
    max
  };
}

function taskState(agent, simulationValue) {
  const current = new Date(Number(simulationValue));
  const tickets = agent?.tickets || [];
  for (let index = 0; index < tickets.length; index += 1) {
    const ticket = tickets[index];
    const arrive = parseApiDateTime(ticket.arrival_time);
    const depart = parseApiDateTime(ticket.departure_time || ticket.arrival_time);
    if (!arrive || !depart) {
      continue;
    }
    if (current < arrive) {
      return {
        current: index === 0 ? "__map_waiting_departure__" : `__map_travel__:${ticket.id}`,
        next: ticket.id
      };
    }
    if (current >= arrive && current < depart) {
      return {
        current: ticket.id,
        next: tickets[index + 1]?.id || "__map_return__"
      };
    }
  }
  return {
    current: tickets.length ? "__map_return_complete__" : "__map_no_task__",
    next: "--"
  };
}

function focusedEta(agent, simulationValue) {
  const current = new Date(Number(simulationValue));
  const tickets = agent?.tickets || [];
  for (let index = 0; index < tickets.length; index += 1) {
    const ticket = tickets[index];
    const arrive = parseApiDateTime(ticket.arrival_time);
    const depart = parseApiDateTime(ticket.departure_time || ticket.arrival_time);
    if (!arrive || !depart) {
      continue;
    }
    if (current < arrive) {
      return ticket.arrival_time;
    }
    if (current >= arrive && current <= depart) {
      return tickets[index + 1]?.arrival_time || agent?.tickets_done_time || agent?.shift_off_time || "";
    }
  }
  return agent?.tickets_done_time || agent?.shift_off_time || "";
}

function completedTaskCount(agent, simulationValue) {
  const current = new Date(Number(simulationValue));
  return (agent?.tickets || []).reduce((count, ticket) => {
    const depart = parseApiDateTime(ticket.departure_time || ticket.arrival_time);
    return depart && current >= depart ? count + 1 : count;
  }, 0);
}

function remainingTaskCount(agent, simulationValue) {
  const total = (agent?.tickets || []).length;
  return Math.max(0, total - completedTaskCount(agent, simulationValue));
}

export function solverJobMapPage() {
  return {
    job: null,
    selectedJobId: "",
    loading: true,
    error: "",
    hoveredBusinessId: "",
    businessIdTooltip: { left: 0, top: 0 },
    businessIdHideTimer: null,
    gatewayMode: false,
    simulationValue: 0,
    bounds: { min: 0, max: 0 },
    visibilityMap: {},
    routeVisibilityMap: {},
    isResettingForSolve: false,
    focusAgentId: "",
    focusOnlyMode: false,
    isBigScreenMode: false,
    followFocusedAgent: false,
    playTimer: null,
    playbackSession: 0,
    refreshTimer: null,
    playbackSpeed: 1,
    timelineDrag: false,
    hasRenderedMap: false,
    activeMapContainer: null,
    mapResizeObserver: null,
    mapResizeFrame: null,
    isLoadingJob: false,
    boundTimelinePointerMove: null,
    boundTimelinePointerUp: null,
    boundFullscreenChange: null,
    boundHashChange: null,
    currentMapCanvas() {
      const primaryContainer = this.isBigScreenMode ? this.$refs.bigscreenMapCanvas : this.$refs.defaultMapCanvas;
      if (primaryContainer?.isConnected) {
        return primaryContainer;
      }
      return [this.$refs.defaultMapCanvas, this.$refs.bigscreenMapCanvas]
        .find((container) => container?.isConnected) || null;
    },
    syncMapContainer() {
      const nextContainer = this.currentMapCanvas();
      if (!nextContainer) {
        return null;
      }
      if (this.activeMapContainer && this.activeMapContainer !== nextContainer) {
        const oldMap = this.activeMapContainer._vrpMap;
        if (oldMap && typeof oldMap.destroy === "function") {
          try {
            oldMap.destroy();
          } catch (_error) {
            // Ignore destroy errors and fall back to creating a fresh map instance.
          }
        }
        delete this.activeMapContainer._vrpMap;
        delete this.activeMapContainer._vrpTicketInfoWindow;
        this.hasRenderedMap = false;
      }
      if (this.activeMapContainer !== nextContainer) {
        nextContainer.innerHTML = "";
      }
      this.activeMapContainer = nextContainer;
      this.observeMapContainerResize(nextContainer);
      return nextContainer;
    },
    observeMapContainerResize(container) {
      if (!container || typeof ResizeObserver !== "function") {
        return;
      }
      if (this.mapResizeObserver?.container === container) {
        return;
      }
      this.mapResizeObserver?.observer?.disconnect?.();
      const observer = new ResizeObserver(() => {
        if (this.mapResizeFrame != null) {
          window.cancelAnimationFrame(this.mapResizeFrame);
        }
        this.mapResizeFrame = window.requestAnimationFrame(() => {
          this.mapResizeFrame = null;
          container._vrpMap?.resize?.();
        });
      });
      observer.observe(container);
      this.mapResizeObserver = { container, observer };
    },
    waitForFrames(count = 1) {
      return new Promise((resolve) => {
        const step = () => {
          if (count <= 0) {
            resolve();
            return;
          }
          count -= 1;
          window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
      });
    },
    async refreshMapLayout(fitMode = "visible") {
      await this.$nextTick();
      await this.waitForFrames(2);
      const container = this.syncMapContainer();
      const map = container?._vrpMap;
      if (map && typeof map.resize === "function") {
        map.resize();
      }
      await this.renderMap({ fitMode });
      await this.waitForFrames(1);
      const resizedMap = this.syncMapContainer()?._vrpMap;
      if (resizedMap && typeof resizedMap.resize === "function") {
        resizedMap.resize();
      }
    },
    async init() {
      this.gatewayMode = isMapGatewayMode();
      this.selectedJobId = currentHashQueryParam("id");
      this.boundTimelinePointerMove = this.onTimelinePointerMove.bind(this);
      this.boundTimelinePointerUp = this.stopTimelineDrag.bind(this);
      this.boundFullscreenChange = this.onFullscreenChange.bind(this);
      this.boundHashChange = () => {
        if (!window.location.hash.includes("/solver-map")) {
          this.dispose();
        }
      };
      document.addEventListener("fullscreenchange", this.boundFullscreenChange);
      if (this.gatewayMode) {
        this.loading = false;
        mapGatewayBridge()?.registerComponent?.("extra", this);
        return;
      }
      await this.loadJob();
      window.addEventListener("hashchange", this.boundHashChange, { once: true });
    },
    onLocaleChanged() {
      const container = this.activeMapContainer || this.currentMapCanvas();
      const map = container?._vrpMap;
      if (!mapLocaleRequiresRecreation(map)) {
        applyMapLocale(map);
        return;
      }
      map._vrpTicketInfoWindow?.close?.();
      map.clearMap?.();
      map.destroy?.();
      delete container._vrpMap;
      delete container._vrpTicketInfoWindow;
      this.hasRenderedMap = false;
      // renderSimulation creates AMap with lang + mapStyle together, then
      // restores the current simulation state and visible business overlays.
      this.renderMap({ fitMode: "visible" }).catch(() => {});
    },
    startRefreshPolling() {
      if (this.refreshTimer) {
        return;
      }
      this.refreshTimer = window.setInterval(() => this.loadJob({ notifyOnError: false }), AUTO_REFRESH_INTERVAL);
    },
    stopRefreshPolling() {
      if (!this.refreshTimer) {
        return;
      }
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    },
    dispose() {
      this.stopPlayback();
      this.stopRefreshPolling();
      this.stopTimelineDrag();
      this.clearMapContent();
      this.mapResizeObserver?.observer?.disconnect?.();
      this.mapResizeObserver = null;
      if (this.mapResizeFrame != null) {
        window.cancelAnimationFrame(this.mapResizeFrame);
        this.mapResizeFrame = null;
      }
      const mapContainer = this.activeMapContainer || this.currentMapCanvas();
      mapContainer?._vrpMap?.destroy?.();
      if (mapContainer) {
        delete mapContainer._vrpMap;
      }
      if (this.boundFullscreenChange) {
        document.removeEventListener("fullscreenchange", this.boundFullscreenChange);
      }
      if (this.boundHashChange) {
        window.removeEventListener("hashchange", this.boundHashChange);
      }
      this.exitFullscreen();
    },
    rawAgents() {
      return nonVirtualAgents(this.job);
    },
    agents() {
      return this.isResettingForSolve ? [] : this.rawAgents();
    },
    isJobSolving(job = this.job) {
      return job?.status === "SOLVING_SCHEDULED" || job?.status === "SOLVING_ACTIVE";
    },
    stopPlayback() {
      this.playbackSession += 1;
      if (this.playTimer) {
        clearTimeout(this.playTimer);
        this.playTimer = null;
      }
    },
    clearMapContent() {
      const container = this.activeMapContainer || this.currentMapCanvas();
      const map = container?._vrpMap;
      if (!map) {
        return;
      }
      map._vrpTicketInfoWindow?.close?.();
      if (typeof map.clearMap === "function") {
        map.clearMap();
      }
      delete map._vrpSimulationState;
    },
    resetVisibilityState(agentList = []) {
      this.visibilityMap = {};
      this.routeVisibilityMap = {};
      agentList.forEach((agent) => {
        this.visibilityMap[agent.id] = true;
        this.routeVisibilityMap[agent.id] = true;
      });
    },
    resetForResolving(bounds) {
      this.isResettingForSolve = true;
      this.stopPlayback();
      this.stopTimelineDrag();
      this.bounds = bounds;
      this.simulationValue = bounds.min;
      this.resetVisibilityState();
      this.focusAgentId = "";
      this.focusOnlyMode = false;
      this.followFocusedAgent = false;
      this.hasRenderedMap = false;
      this.clearMapContent();
    },
    restoreResolvedDefaults(bounds, agentList) {
      this.isResettingForSolve = false;
      this.stopPlayback();
      this.bounds = bounds;
      this.simulationValue = bounds.min;
      this.resetVisibilityState(agentList);
      this.focusAgentId = "";
      this.focusOnlyMode = false;
      this.followFocusedAgent = false;
      this.hasRenderedMap = false;
    },
    reconcileInteractiveState(bounds, agentList) {
      this.isResettingForSolve = false;
      this.bounds = bounds;
      this.simulationValue = this.normalizeSimulationValue(
        Number.isFinite(Number(this.simulationValue)) ? this.simulationValue : bounds.min
      );
      const agentIds = new Set(agentList.map((agent) => agent.id));
      agentList.forEach((agent) => {
        if (this.visibilityMap[agent.id] == null) {
          this.visibilityMap[agent.id] = true;
        }
        if (this.routeVisibilityMap[agent.id] == null) {
          this.routeVisibilityMap[agent.id] = true;
        }
      });
      Object.keys(this.visibilityMap).forEach((agentId) => {
        if (!agentIds.has(agentId)) {
          delete this.visibilityMap[agentId];
        }
      });
      Object.keys(this.routeVisibilityMap).forEach((agentId) => {
        if (!agentIds.has(agentId)) {
          delete this.routeVisibilityMap[agentId];
        }
      });
    },
    async applyGatewayResult(input) {
      if (this.isLoadingJob) {
        return;
      }
      this.isLoadingJob = true;
      this.loading = true;
      this.error = "";
      try {
        const previousJob = this.job;
        const rawJob = normalizeGatewayMapInput(input);
        if (!rawJob) {
          this.job = null;
          this.error = this.t("map.notice.gatewayNoRenderableResult");
          this.clearMapContent();
          return;
        }
        const nextJob = hydrateJob(rawJob);
        const wasSolving = this.isJobSolving(previousJob);
        this.job = nextJob;
        const isSolving = this.isJobSolving(nextJob);
        const bounds = simulationBounds(nextJob);
        const nextAgents = nonVirtualAgents(nextJob);

        if (isSolving) {
          this.resetForResolving(bounds);
          await this.refreshMapLayout("visible");
          return;
        }

        if (!previousJob || wasSolving) {
          this.restoreResolvedDefaults(bounds, nextAgents);
        } else {
          this.reconcileInteractiveState(bounds, nextAgents);
        }
        this.syncFocusedAgent();
        await this.refreshMapLayout(!previousJob || wasSolving ? "visible" : "preserve");
      } catch (error) {
        this.job = null;
        this.error = localizeRequestError(error);
        mapGatewayBridge()?.sendError?.(this.error);
      } finally {
        this.loading = false;
        this.isLoadingJob = false;
        mapGatewayBridge()?.scheduleResize?.();
      }
    },
    async loadJob(options = {}) {
      this.selectedJobId = currentHashQueryParam("id");
      if (this.gatewayMode && mapGatewayBridge()?.actions?.load_scenario_result) {
        const response = await mapGatewayBridge().actions.load_scenario_result({
          refresh: true,
          job_id: mapGatewayBridge()?.context?.result_job_id || this.selectedJobId || null,
          include: ["task", "result_summary", "engine_view"]
        });
        if (!response?.ok) {
          this.error = localizeRequestError(response?.error);
          return;
        }
        await this.applyGatewayResult(response.data);
        return;
      }
      if (this.isLoadingJob) {
        return;
      }
      this.isLoadingJob = true;
      this.loading = true;
      this.error = "";
      try {
        const previousJob = this.job;
        const path = this.selectedJobId
          ? `/solver_job/${encodeURIComponent(this.selectedJobId)}?remove_virtual=true`
          : "/solver_job?remove_virtual=true";
        const nextJob = hydrateJob(await getJson(path));
        const wasSolving = this.isJobSolving(previousJob);
        this.job = nextJob;
        const isSolving = this.isJobSolving(nextJob);
        const bounds = simulationBounds(nextJob);
        const nextAgents = nonVirtualAgents(nextJob);

        if (isSolving) {
          this.startRefreshPolling();
          this.resetForResolving(bounds);
          await this.refreshMapLayout("visible");
          window.dispatchEvent(new CustomEvent("vrp:connection", { detail: { online: true, labelKey: "connection.mapReady" } }));
          return;
        }

        this.stopRefreshPolling();
        if (!previousJob || wasSolving) {
          this.restoreResolvedDefaults(bounds, nextAgents);
        } else {
          this.reconcileInteractiveState(bounds, nextAgents);
        }
        this.syncFocusedAgent();
        const fitMode = !previousJob
          ? "visible"
          : (wasSolving ? "visible" : "preserve");
        await this.refreshMapLayout(fitMode);
        window.dispatchEvent(new CustomEvent("vrp:connection", { detail: { online: true, labelKey: "connection.mapReady" } }));
      } catch (error) {
        this.job = null;
        this.error = localizeRequestError(error);
        if (options.notifyOnError !== false) {
          notify(this.error, "danger");
        }
        window.dispatchEvent(new CustomEvent("vrp:connection", { detail: { online: false, labelKey: "connection.mapFailed" } }));
      } finally {
        this.loading = false;
        this.isLoadingJob = false;
      }
    },
    playbackSpeedOptions() {
      return PLAYBACK_SPEED_OPTIONS;
    },
    playbackIntervalMs() {
      return Math.max(200, 800 / Number(this.playbackSpeed || 1));
    },
    playbackStepMs() {
      return SIMULATION_STEP * Number(this.playbackSpeed || 1);
    },
    setPlaybackSpeed(value) {
      const parsed = Number(value);
      if (!PLAYBACK_SPEED_OPTIONS.some((option) => option.value === parsed)) {
        return;
      }
      this.playbackSpeed = parsed;
      if (this.playTimer) {
        this.stopPlayback();
        this.togglePlay();
      }
    },
    simulationRatio() {
      const { min, max } = this.bounds;
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        return 0;
      }
      return (Number(this.simulationValue) - min) / (max - min);
    },
    timelineThumbStyle() {
      return `left:${this.simulationRatio() * 100}%;`;
    },
    timelineFillStyle() {
      return `width:${this.simulationRatio() * 100}%;`;
    },
    normalizeSimulationValue(rawValue) {
      const { min, max } = this.bounds;
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
        return min;
      }
      const bounded = clamp(Number(rawValue), min, max);
      if (max - bounded < (SIMULATION_STEP / 2)) {
        return max;
      }
      const steps = Math.round((bounded - min) / SIMULATION_STEP);
      return clamp(min + (steps * SIMULATION_STEP), min, max);
    },
    async setSimulationValue(nextValue) {
      this.simulationValue = this.normalizeSimulationValue(nextValue);
      await this.renderMap();
    },
    async updateSimulationFromPointer(clientX) {
      const track = this.$refs.timelineTrack;
      if (!track) {
        return;
      }
      const rect = track.getBoundingClientRect();
      if (!rect.width) {
        return;
      }
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const nextValue = this.bounds.min + ((this.bounds.max - this.bounds.min) * ratio);
      await this.setSimulationValue(nextValue);
    },
    async jumpTimeline(event) {
      await this.updateSimulationFromPointer(event.clientX);
    },
    startTimelineDrag(event) {
      event.preventDefault();
      event.stopPropagation();
      this.timelineDrag = true;
      window.addEventListener("pointermove", this.boundTimelinePointerMove);
      window.addEventListener("pointerup", this.boundTimelinePointerUp);
      window.addEventListener("pointercancel", this.boundTimelinePointerUp);
    },
    async onTimelinePointerMove(event) {
      if (!this.timelineDrag) {
        return;
      }
      await this.updateSimulationFromPointer(event.clientX);
    },
    stopTimelineDrag() {
      this.timelineDrag = false;
      if (this.boundTimelinePointerMove) {
        window.removeEventListener("pointermove", this.boundTimelinePointerMove);
      }
      if (this.boundTimelinePointerUp) {
        window.removeEventListener("pointerup", this.boundTimelinePointerUp);
        window.removeEventListener("pointercancel", this.boundTimelinePointerUp);
      }
    },
    simulationTicks() {
      const { min, max } = this.bounds;
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
        return [];
      }
      const sameDay = sameSimulationDay(min, max);
      const total = max - min;
      const tickCount = total === 0 ? 1 : (this.isBigScreenMode ? 6 : 5);
      return Array.from({ length: tickCount }, (_, index) => {
        const ratio = tickCount === 1 ? 0 : index / (tickCount - 1);
        const value = min + (total * ratio);
        const date = new Date(Math.round(value));
        const timeLabel = total < (60 * 60 * 1000)
          ? `${padTime(date.getHours())}:${padTime(date.getMinutes())}:${padTime(date.getSeconds())}`
          : `${padTime(date.getHours())}:${padTime(date.getMinutes())}`;
        const dateLabel = sameDay
          ? `${date.getMonth() + 1}/${date.getDate()}`
          : `${date.getFullYear()}/${padTime(date.getMonth() + 1)}/${padTime(date.getDate())}`;
        return {
          key: `${Math.round(value)}-${index}`,
          left: ratio * 100,
          timeLabel,
          dateLabel,
          offsetClass: "-translate-x-1/2"
        };
      });
    },
    firstVisibleAgentId() {
      return this.agents().find((agent) => this.visibilityMap[agent.id] !== false)?.id || "";
    },
    syncFocusedAgent() {
      const agentIds = new Set(this.agents().map((agent) => agent.id));
      if (!agentIds.has(this.focusAgentId)) {
        this.focusAgentId = "";
      }
      if (this.focusAgentId && this.visibilityMap[this.focusAgentId] !== false) {
        return;
      }
      if (this.isBigScreenMode) {
        this.focusAgentId = this.firstVisibleAgentId();
      } else if (!this.focusOnlyMode) {
        this.focusAgentId = "";
      }
      if (!this.focusAgentId) {
        this.focusOnlyMode = false;
      }
    },
    effectiveVisibilityMap() {
      const visibleMap = {};
      this.agents().forEach((agent) => {
        const baseVisible = this.visibilityMap[agent.id] !== false;
        visibleMap[agent.id] = this.focusOnlyMode
          ? this.focusAgentId === agent.id && baseVisible
          : baseVisible;
      });
      return visibleMap;
    },
    effectiveRouteVisibilityMap() {
      const routeMap = {};
      const visibleMap = this.effectiveVisibilityMap();
      this.agents().forEach((agent) => {
        routeMap[agent.id] = visibleMap[agent.id] !== false && this.routeVisibilityMap[agent.id] !== false;
      });
      return routeMap;
    },
    async renderMap(options = {}) {
      const container = this.syncMapContainer();
      if (!container) {
        return;
      }
      if (!this.job || this.isResettingForSolve) {
        this.clearMapContent();
        this.hasRenderedMap = false;
        return;
      }
      const fitMode = options.fitMode
        || (this.followFocusedAgent && this.focusAgentId ? "follow" : (this.hasRenderedMap ? "preserve" : "visible"));
      await renderSimulation(
        container,
        this.job,
        this.effectiveVisibilityMap(),
        this.effectiveRouteVisibilityMap(),
        this.currentSimulationTime(),
        {
          focusedAgentId: this.focusAgentId,
          followFocusedAgent: this.followFocusedAgent,
          fitMode,
          mapTheme: "dark",
          refreshOverlays: options.refreshOverlays === true
        }
      );
      this.hasRenderedMap = true;
    },
    currentSimulationTime() {
      return formatSimulationTimestamp(this.simulationValue);
    },
    shouldShowReplayEmptyState() {
      return !this.job || this.isResettingForSolve;
    },
    replayEmptyStateIcon() {
      return this.isResettingForSolve ? "hourglass_top" : "work_history";
    },
    replayEmptyStateTitle() {
      if (this.isResettingForSolve) {
        return this.t("map.empty.solvingReplayTitle");
      }
      return this.t(this.selectedJobId ? "map.empty.jobMissingTitle" : "map.empty.noJobTitle");
    },
    replayEmptyStateDescription() {
      if (this.isResettingForSolve) {
        return this.t("map.empty.solvingReplayDescription");
      }
      return this.t(this.selectedJobId
        ? "map.empty.jobMissingReplayDescription"
        : "map.empty.noJobReplayDescription");
    },
    taskPanelEmptyTitle() {
      if (this.isResettingForSolve) {
        return this.t("map.empty.solvingTaskPanelTitle");
      }
      return this.t(this.selectedJobId ? "map.empty.jobMissingTitle" : "map.empty.noJobTitle");
    },
    taskPanelEmptyDescription() {
      if (this.isResettingForSolve) {
        return this.t("map.empty.solvingTaskPanelDescription");
      }
      return this.t(this.selectedJobId
        ? "map.empty.jobMissingTaskPanelDescription"
        : "map.empty.noJobTaskPanelDescription");
    },
    formattedSimulationTime() {
      return formatDateTime(this.currentSimulationTime());
    },
    async updateSimulation(value) {
      await this.setSimulationValue(value);
    },
    async togglePlay() {
      if (this.isResettingForSolve) {
        return;
      }
      if (this.playTimer) {
        this.stopPlayback();
        return;
      }
      if (Number(this.simulationValue) >= this.bounds.max) {
        this.simulationValue = this.bounds.min;
        await this.renderMap({
          fitMode: this.followFocusedAgent && this.focusAgentId ? "focused" : "visible",
          refreshOverlays: true
        });
      }
      const session = this.playbackSession + 1;
      this.playbackSession = session;
      const step = async () => {
        if (this.playbackSession !== session) {
          return;
        }
        const next = Math.min(this.bounds.max, Number(this.simulationValue) + this.playbackStepMs());
        this.simulationValue = next;
        await this.renderMap({ refreshOverlays: true });
        if (this.playbackSession !== session) {
          return;
        }
        if (next >= this.bounds.max) {
          this.stopPlayback();
          return;
        }
        this.playTimer = window.setTimeout(step, this.playbackIntervalMs());
      };
      this.playTimer = window.setTimeout(step, this.playbackIntervalMs());
    },
    async resetTime() {
      this.simulationValue = this.bounds.min;
      await this.renderMap({ fitMode: this.followFocusedAgent && this.focusAgentId ? "focused" : "preserve" });
    },
    async showAllAgents() {
      this.focusOnlyMode = false;
      this.agents().forEach((agent) => {
        this.visibilityMap[agent.id] = true;
        this.routeVisibilityMap[agent.id] = true;
      });
      if (!this.isBigScreenMode) {
        this.focusAgentId = "";
      } else if (!this.focusAgentId) {
        this.focusAgentId = this.firstVisibleAgentId();
      }
      await this.renderMap({ fitMode: "visible" });
    },
    async fitView() {
      const fitMode = this.focusAgentId && this.focusOnlyMode ? "focused" : "visible";
      await this.renderMap({ fitMode });
    },
    fullscreenTarget() {
      const pageRoot = this.$refs.pageRoot;
      const root = pageRoot?.getRootNode?.();
      return root?.host || pageRoot;
    },
    fullscreenElement() {
      const root = this.$refs.pageRoot?.getRootNode?.();
      return document.fullscreenElement || root?.fullscreenElement || null;
    },
    isPageFullscreen() {
      const pageRoot = this.$refs.pageRoot;
      const root = pageRoot?.getRootNode?.();
      return document.fullscreenElement === this.fullscreenTarget()
        || root?.fullscreenElement === pageRoot;
    },
    async enterFullscreen() {
      const target = this.fullscreenTarget();
      if (!target || this.isPageFullscreen() || typeof target.requestFullscreen !== "function") {
        return;
      }
      try {
        await target.requestFullscreen();
      } catch (_error) {
        notify(this.t("map.notice.fullscreenEnterFailed"), "warning");
      }
    },
    async exitFullscreen() {
      if (!this.fullscreenElement() || typeof document.exitFullscreen !== "function") {
        return;
      }
      try {
        await document.exitFullscreen();
      } catch (_error) {
        notify(this.t("map.notice.fullscreenExitFailed"), "warning");
      }
    },
    async onFullscreenChange() {
      const inPageFullscreen = this.isPageFullscreen();
      if (!inPageFullscreen && this.isBigScreenMode) {
        this.isBigScreenMode = false;
        this.followFocusedAgent = false;
        this.focusOnlyMode = false;
        this.focusAgentId = "";
        this.syncFocusedAgent();
        await this.refreshMapLayout("visible");
        return;
      }
      if (inPageFullscreen && this.isBigScreenMode) {
        await this.refreshMapLayout("visible");
      }
    },
    backToDetail() {
      navigate({ target: "result", result_job_id: this.job?.id || this.selectedJobId || "" });
    },
    clearError() {
      this.error = "";
    },
    clearBusinessIdHideTimer() {
      if (this.businessIdHideTimer) {
        window.clearTimeout(this.businessIdHideTimer);
        this.businessIdHideTimer = null;
      }
    },
    showBusinessIdTooltip(value, event = null) {
      const id = String(value || "").trim();
      const trigger = event?.currentTarget;
      if (!shouldShowFullValueTooltip(trigger, id)) {
        this.clearBusinessIdHideTimer();
        this.hoveredBusinessId = "";
        return;
      }
      const rect = trigger.getBoundingClientRect?.();
      if (!rect) {
        return;
      }
      this.clearBusinessIdHideTimer();
      this.hoveredBusinessId = id;
      const margin = 15;
      const width = 560;
      this.businessIdTooltip = {
        left: clamp(rect.left, margin, Math.max(margin, window.innerWidth - width - margin)),
        top: rect.bottom + 7.5
      };
    },
    hideBusinessIdTooltip(value) {
      if (this.hoveredBusinessId !== String(value || "")) {
        return;
      }
      this.clearBusinessIdHideTimer();
      this.businessIdHideTimer = window.setTimeout(() => {
        this.hoveredBusinessId = "";
        this.businessIdHideTimer = null;
      }, 120);
    },
    async copyBusinessId() {
      try {
        if (!await copyText(this.hoveredBusinessId)) {
          throw new Error("copy-failed");
        }
        notify(this.t("map.notice.idCopied"), "success");
      } catch (_error) {
        notify(this.t("map.notice.copyFailed"), "danger");
      }
    },
    isFocused(agentId) {
      return this.focusAgentId === agentId;
    },
    isAgentVisible(agentId) {
      return this.effectiveVisibilityMap()[agentId] !== false;
    },
    isRouteVisible(agentId) {
      return this.routeVisibilityMap[agentId] !== false;
    },
    agentDisplayName(agent) {
      return agent?.name || String(agent?.id || "").trim() || "--";
    },
    currentStateLabel(value) {
      const raw = String(value || "");
      if (raw === "__map_waiting_departure__") return this.t("map.waitingDeparture");
      if (raw === "__map_return_complete__") return this.t("map.returnOrComplete");
      if (raw === "__map_no_task__") return this.t("map.noTask");
      if (raw === "__map_return__") return this.t("gantt.return");
      if (raw.startsWith("__map_travel__:")) {
        return `${this.t("gantt.travel")} ${raw.slice("__map_travel__:".length)}`;
      }
      return raw;
    },
    agentRouteNotice(agent) {
      return getAgentRouteNotice(agent);
    },
    agentStatusLabel(agent) {
      return this.t(this.agentStatusKey(agent));
    },
    agentStatusKey(agent) {
      if (!agent) return "map.unselected";
      if (this.visibilityMap[agent.id] === false) return "map.hidden";
      const state = this.currentState(agent);
      if (state.current === "__map_waiting_departure__") return "map.waitingDeparture";
      if (state.current === "__map_return_complete__") return "status.completed";
      if (state.current === "__map_no_task__") return "map.noTask";
      if (state.current.startsWith("__map_travel__:")) return "map.driving";
      return "map.inService";
    },
    agentStatusClass(agent) {
      switch (this.agentStatusKey(agent)) {
        case "status.completed":
          return "bg-slate-200/80 text-slate-700";
        case "map.waitingDeparture":
          return "bg-sky-500/15 text-sky-700";
        case "map.driving":
          return "bg-amber-500/15 text-amber-700";
        case "map.inService":
          return "bg-emerald-500/15 text-emerald-700";
        case "map.hidden":
          return "bg-rose-500/15 text-rose-700";
        default:
          return "bg-slate-200/80 text-slate-700";
      }
    },
    visibleAgentCount() {
      return this.agents().filter((agent) => this.visibilityMap[agent.id] !== false).length;
    },
    currentFocusAgent() {
      return this.agents().find((agent) => agent.id === this.focusAgentId) || null;
    },
    currentFocusCurrentTask() {
      return this.currentStateLabel(this.currentState(this.currentFocusAgent()).current);
    },
    currentFocusNextTask() {
      return this.currentStateLabel(this.currentState(this.currentFocusAgent()).next);
    },
    currentFocusEtaText() {
      return formatDateTime(focusedEta(this.currentFocusAgent(), this.simulationValue));
    },
    currentFocusRemainingTasks() {
      return remainingTaskCount(this.currentFocusAgent(), this.simulationValue);
    },
    currentFocusCompletedTasks() {
      return completedTaskCount(this.currentFocusAgent(), this.simulationValue);
    },
    currentFocusTotalTasks() {
      return (this.currentFocusAgent()?.tickets || []).length;
    },
    currentFocusRouteLabel() {
      const focused = this.currentFocusAgent();
      if (!focused) {
        return "--";
      }
      return this.t(this.isRouteVisible(focused.id) ? "map.routeVisible" : "map.routeHidden");
    },
    currentFocusFollowLabel() {
      return this.t(this.followFocusedAgent ? "map.followFocused" : "map.freeView");
    },
    currentFocusVisibilityLabel() {
      const focused = this.currentFocusAgent();
      if (!focused) {
        return "--";
      }
      return this.t(this.visibilityMap[focused.id] === false ? "map.mapHidden" : "map.visible");
    },
    async toggleBigScreenMode() {
      if (this.isBigScreenMode) {
        if (this.isPageFullscreen()) {
          await this.exitFullscreen();
          return;
        }
        this.isBigScreenMode = false;
        this.followFocusedAgent = false;
        this.focusOnlyMode = false;
        this.focusAgentId = "";
        this.syncFocusedAgent();
        await this.refreshMapLayout("visible");
        return;
      }

      const fullscreenPromise = this.enterFullscreen();
      this.isBigScreenMode = true;
      this.followFocusedAgent = false;
      this.focusOnlyMode = false;
      if (this.isBigScreenMode) {
        if (!this.focusAgentId) {
          this.focusAgentId = this.firstVisibleAgentId() || this.agents()[0]?.id || "";
        }
      } else {
        this.focusAgentId = "";
      }
      this.syncFocusedAgent();
      await fullscreenPromise;
      await this.refreshMapLayout("visible");
    },
    async toggleFollowFocusedAgent() {
      this.followFocusedAgent = !this.followFocusedAgent;
      await this.renderMap({ fitMode: this.followFocusedAgent && this.focusAgentId ? "focused" : "preserve" });
    },
    async selectBigScreenAgent(agentId) {
      if (this.isResettingForSolve) {
        return;
      }
      this.visibilityMap[agentId] = true;
      this.routeVisibilityMap[agentId] = true;
      this.focusAgentId = agentId;
      this.focusOnlyMode = false;
      await this.renderMap({ fitMode: "focused" });
    },
    async toggleFocusAgent(agentId) {
      if (this.isResettingForSolve) {
        return;
      }
      if (this.focusAgentId === agentId && this.focusOnlyMode) {
        this.focusOnlyMode = false;
        this.focusAgentId = "";
      } else {
        this.visibilityMap[agentId] = true;
        this.routeVisibilityMap[agentId] = true;
        this.focusAgentId = agentId;
        this.focusOnlyMode = true;
      }
      await this.renderMap({ fitMode: this.focusAgentId ? "focused" : "visible" });
    },
    async toggleAgentRoute(agentId) {
      if (this.isResettingForSolve) {
        return;
      }
      this.routeVisibilityMap[agentId] = this.routeVisibilityMap[agentId] === false;
      await this.renderMap({ fitMode: "preserve" });
    },
    async toggleAgentVisibility(agentId) {
      if (this.isResettingForSolve) {
        return;
      }
      const nextVisible = this.visibilityMap[agentId] === false;
      this.visibilityMap[agentId] = nextVisible;
      if (nextVisible) {
        this.routeVisibilityMap[agentId] = true;
      }
      if (!nextVisible && this.focusAgentId === agentId) {
        this.focusAgentId = "";
      }
      this.syncFocusedAgent();
      await this.renderMap({ fitMode: this.focusAgentId ? "focused" : "visible" });
    },
    async toggleCurrentFocusVisibility() {
      const focused = this.currentFocusAgent();
      if (!focused) {
        return;
      }
      await this.toggleAgentVisibility(focused.id);
    },
    async toggleCurrentFocusRoute() {
      const focused = this.currentFocusAgent();
      if (!focused) {
        return;
      }
      await this.toggleAgentRoute(focused.id);
    },
    async toggleAgent(agentId) {
      await this.toggleAgentVisibility(agentId);
    },
    async hideAgent(agentId) {
      if (this.isResettingForSolve) {
        return;
      }
      this.visibilityMap[agentId] = false;
      if (this.focusAgentId === agentId) {
        this.focusAgentId = "";
      }
      this.syncFocusedAgent();
      await this.renderMap({ fitMode: this.focusAgentId ? "focused" : "visible" });
    },
    currentState(agent) {
      if (this.isResettingForSolve || !agent) {
        return {
          current: "--",
          next: "--"
        };
      }
      return taskState(agent, this.simulationValue);
    },
    jumpableNextTicketId(agent) {
      const nextTicketId = this.currentState(agent).next;
      if (!nextTicketId || nextTicketId === "--" || nextTicketId === "__map_return__") {
        return "";
      }
      return (agent?.tickets || []).some((ticket) => ticket?.id === nextTicketId) ? nextTicketId : "";
    },
    openScenarioTicket(ticketId) {
      const value = String(ticketId || "").trim();
      if (!value) {
        return;
      }
      navigate({ target: "create", intent: "focus_ticket", ticket_id: value });
    }
  };
}
