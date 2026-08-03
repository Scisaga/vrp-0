import { copyText, currentHashQueryParam, deleteRequest, formatDateTime, formatDuration, getJson, getUiLocale, isoDurationToSeconds, localizeRequestError, navigate, notify, postJson, translateRequestText } from "../utils/api.js";
import { applyMapLocale, ensureMap, getAgentRouteNotice, loadAmap, mapLocaleRequiresRecreation, renderAgentPreview } from "../utils/map.js";
import { CONSTRAINT_LABELS, hydrateJob, nonVirtualAgents, normalizeScenarioForView, parseApiDateTime, parseConstraintValue } from "../utils/vrp-model.js";
import { buildSolverScoreProgress, latestScorePointAtOrBefore, normalizeScoreText, parseHardMediumSoftScore } from "../utils/solver-score-progress.mjs";
import { shouldShowFullValueTooltip } from "../utils/ui-tooltip.js";

const MIN_GANTT_BLOCK_DURATION = 15 * 60 * 1000;
const PREVIEW_MAP_WARMUP_TIMEOUT_MS = 1200;
const SCORE_CHART_MIN_HEIGHT = 200;
const SCORE_COLORS = Object.freeze({
  hard: "#f43f5e",
  hardStrong: "#e11d48",
  hardZero: "#94a3b8",
  medium: "#f59e0b",
  soft: "#10b981"
});
const SCORE_AXIS_BOTTOM_PADDING = 0.24;
const SCORE_AXIS_TOP_PADDING = 0.12;
const HARD_PENALTY_PLOT_FRACTION = 0.18;

const GANTT_STAGE_STYLES = {
  travel: {
    labelKey: "gantt.travel",
    background: "rgba(59, 130, 246, 0.18)",
    baseBackground: "rgba(59, 130, 246, 0.07)",
    border: "rgba(37, 99, 235, 0.34)",
    text: "#1d4ed8",
    dot: "background:#60a5fa;"
  },
  wait: {
    labelKey: "gantt.waiting",
    background: "rgba(59, 130, 246, 0.34)",
    baseBackground: "rgba(59, 130, 246, 0.10)",
    border: "rgba(37, 99, 235, 0.42)",
    text: "#1e40af",
    dot: "background:#2563eb;"
  },
  service: {
    labelKey: "gantt.service",
    background: "rgba(16, 185, 129, 0.26)",
    baseBackground: "rgba(16, 185, 129, 0.08)",
    border: "rgba(5, 150, 105, 0.32)",
    text: "#047857",
    dot: "background:rgba(16, 185, 129, 0.26);"
  },
  return: {
    labelKey: "gantt.return",
    background: "rgba(139, 92, 246, 0.24)",
    baseBackground: "rgba(139, 92, 246, 0.08)",
    border: "rgba(124, 58, 237, 0.34)",
    text: "#6d28d9",
    dot: "background:#8b5cf6;"
  }
};

const GANTT_OUT_OF_WINDOW_STYLE = {
  border: "rgba(225, 29, 72, 0.98)",
  text: "#be123c",
  dot: "background:#e11d48;box-shadow:0 0 0 2.5px rgba(225,29,72,0.16);"
};

const GANTT_STAGE_LEGEND = [
  ...["travel", "wait", "service", "return"].map((type) => ({
    type,
    labelKey: GANTT_STAGE_STYLES[type].labelKey,
    dotStyle: GANTT_STAGE_STYLES[type].dot
  })),
  {
    type: "out_of_window",
    labelKey: "gantt.outsideExpectation",
    dotStyle: GANTT_OUT_OF_WINDOW_STYLE.dot
  }
];

// The result page has a number of pure view-model builders. Keep their UI
// values semantic here, then resolve them through the component bridge at the
// render boundary instead of relying on Chinese source-text replacement.
function resultText(key, params = {}) {
  return translateRequestText(key, params);
}

function metricValue(value, unit = "") {
  if (value == null) {
    return "--";
  }
  return `${value}${unit}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatTimelineTime(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat(getUiLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value);
}

function formatGanttDateTime(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat(getUiLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(value);
}

function formatGanttDateRangeLabel(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) {
    return "--";
  }
  return `${formatGanttDateTime(start)} - ${formatGanttDateTime(end)}`;
}

function formatSummaryDateTime(value) {
  return formatDateTime(value, getUiLocale());
}

function isConstraintWeightText(value) {
  return /^.*hard\/.*medium\/.*soft$/i.test(String(value || "").trim());
}

function constraintLevelNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : Number.NEGATIVE_INFINITY;
}

function humanJobStatus(status) {
  switch (status) {
    case "SOLVING_SCHEDULED":
      return translateRequestText("status.starting");
    case "SOLVING_ACTIVE":
      return translateRequestText("status.solving");
    case "SOLVING_FINISHED":
      return translateRequestText("status.completed");
    case "ERROR":
      return translateRequestText("status.failed");
    case "NOT_SOLVING":
      return translateRequestText("status.notStarted");
    default:
      return status || "--";
  }
}

function fitViewportToRange(center, span, min, max) {
  const fullSpan = max - min;
  const nextSpan = Math.min(fullSpan, span);
  let start = center - (nextSpan / 2);
  let end = center + (nextSpan / 2);
  if (start < min) {
    end += min - start;
    start = min;
  }
  if (end > max) {
    start -= end - max;
    end = max;
  }
  return {
    min: Math.max(min, start),
    max: Math.min(max, end)
  };
}

function remapViewport(previousViewport, previousRange, nextRange, keyMin, keyMax, minWindowKey) {
  const previousFullSpan = previousRange[keyMax] - previousRange[keyMin];
  const nextFullSpan = nextRange[keyMax] - nextRange[keyMin];
  if (previousFullSpan <= 0 || nextFullSpan <= 0) {
    return {
      min: nextRange[keyMin],
      max: nextRange[keyMax]
    };
  }

  const previousViewportSpan = previousViewport[keyMax] - previousViewport[keyMin];
  const spanRatio = previousViewportSpan / previousFullSpan;
  const centerRatio = (((previousViewport[keyMin] + previousViewport[keyMax]) / 2) - previousRange[keyMin]) / previousFullSpan;
  const nextSpan = clamp(nextFullSpan * spanRatio, nextRange[minWindowKey], nextFullSpan);
  const nextCenter = nextRange[keyMin] + (nextFullSpan * clamp(centerRatio, 0, 1));
  return fitViewportToRange(nextCenter, nextSpan, nextRange[keyMin], nextRange[keyMax]);
}

function parseScoreCurveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreAxisRange(points, level) {
  const values = points
    .map((point) => Number(point?.score?.[level]))
    .filter(Number.isFinite);
  if (!values.length) {
    return [-1, 1];
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const dataSpan = maximum - minimum;
  const span = dataSpan > Number.EPSILON
    ? dataSpan
    : Math.max(Math.abs(maximum) * 0.1, 1);
  return [
    minimum - (span * SCORE_AXIS_BOTTOM_PADDING),
    maximum + (span * SCORE_AXIS_TOP_PADDING)
  ];
}

function scoreChartHeight(chartShell) {
  const availableHeight = Math.round(Number(chartShell?.clientHeight) || 0);
  return Math.max(SCORE_CHART_MIN_HEIGHT, availableHeight);
}

function hardPenaltyAxisMax(points) {
  const maximum = Math.max(0, ...points.map((point) => Number(point?.hardPenalty) || 0));
  return Math.max(1, maximum / HARD_PENALTY_PLOT_FRACTION);
}

function hardPenaltyBarWidth(points) {
  const xValues = points.map((point) => point.x).filter(Number.isFinite).sort((left, right) => left - right);
  const gaps = xValues.slice(1).map((value, index) => value - xValues[index]).filter((gap) => gap > 0);
  if (!gaps.length) {
    return 0.5;
  }
  return Math.max(0.05, Math.min(...gaps) * 0.46);
}

function asValidDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  return parseApiDateTime(value);
}

function latestDate(...values) {
  const dates = values.filter((value) => value instanceof Date && !Number.isNaN(value.getTime()));
  if (!dates.length) {
    return null;
  }
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function earliestDate(...values) {
  const dates = values.filter((value) => value instanceof Date && !Number.isNaN(value.getTime()));
  if (!dates.length) {
    return null;
  }
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function formatStageRange(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) {
    return "--";
  }
  return `${formatGanttDateTime(start)} → ${formatGanttDateTime(end)}`;
}

function detailRow(key, label, value, dotStyle = "") {
  return {
    key,
    label,
    value: value || "--",
    dotStyle
  };
}

function stageDetailRow(type, label, start, end) {
  const style = GANTT_STAGE_STYLES[type];
  return detailRow(`${type}-${label}`, label, start && end ? formatStageRange(start, end) : "--", style?.dot || "");
}

function looksLikeCoordinateText(value) {
  return /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(String(value || "").trim());
}

function ticketAddressText(ticket) {
  const address = String(ticket?.loc?.address || "").trim();
  return address && !looksLikeCoordinateText(address) ? address : "";
}

function ticketCoordinateText(ticket) {
  return String(ticket?.loc?.location || "").trim();
}

function ticketLocationText(ticket) {
  return ticketAddressText(ticket) || ticketCoordinateText(ticket) || "--";
}

function expectedWindow(ticket) {
  const minStart = asValidDate(ticket?.min_start_time);
  const maxEnd = asValidDate(ticket?.max_end_time);
  if (!(minStart instanceof Date) || !(maxEnd instanceof Date) || maxEnd < minStart) {
    return null;
  }
  return { minStart, maxEnd };
}

function serviceWindowStatus(ticket, serviceStart, serviceEnd) {
  const windowRange = expectedWindow(ticket);
  if (!windowRange || !(serviceStart instanceof Date) || !(serviceEnd instanceof Date)) {
    return {
      state: "unknown",
      inWindow: true,
      label: resultText("result.gantt.windowMissing")
    };
  }
  const inWindow = serviceStart >= windowRange.minStart && serviceEnd <= windowRange.maxEnd;
  return {
    state: inWindow ? "in" : "out",
    inWindow,
    label: inWindow ? resultText("result.gantt.withinExpectation") : resultText("gantt.outsideExpectation")
  };
}

function ticketExpectedWindowLabel(ticket) {
  const windowRange = expectedWindow(ticket);
  return windowRange ? formatGanttDateRangeLabel(windowRange.minStart, windowRange.maxEnd) : "--";
}

function agentOperatingRange(agent, fallbackStart = null) {
  return agentOperatingRangeFromStages(agent, buildAgentTimelineStages(agent, fallbackStart));
}

function agentOperatingRangeFromStages(agent, stages) {
  if (!stages.length) {
    return null;
  }
  const stageStart = earliestDate(...stages.map((stage) => stage.segmentStart));
  const stageEnd = latestDate(...stages.map((stage) => stage.segmentEnd));
  const earliestServiceStart = earliestDate(...stages.map((stage) => stage.serviceStart));
  const shiftStart = asValidDate(agent?.shift_start_time);
  const ticketsDone = asValidDate(agent?.tickets_done_time);
  const start = earliestServiceStart instanceof Date && shiftStart instanceof Date && earliestServiceStart < shiftStart
    ? earliestServiceStart
    : (shiftStart || earliestServiceStart || stageStart);
  const end = ticketsDone || stageEnd;
  if (start instanceof Date && end instanceof Date && end > start) {
    return { start, end };
  }
  if (stageStart instanceof Date && stageEnd instanceof Date && stageEnd > stageStart) {
    return { start: stageStart, end: stageEnd };
  }
  const shiftOff = asValidDate(agent?.shift_off_time);
  if (start instanceof Date && shiftOff instanceof Date && shiftOff > start) {
    return { start, end: shiftOff };
  }
  return null;
}

function agentShiftWindow(agent) {
  const start = asValidDate(agent?.shift_start_time);
  const end = asValidDate(agent?.shift_off_time);
  if (start instanceof Date && end instanceof Date) {
    return { start, end };
  }
  return null;
}

function estimateTicketServiceStart(ticket, arrivalTime, fallbackStart) {
  const explicitStart = asValidDate(ticket?.start_service_time);
  const minStart = asValidDate(ticket?.min_start_time);
  return latestDate(explicitStart, arrivalTime, minStart)
    || explicitStart
    || arrivalTime
    || minStart
    || fallbackStart;
}

function estimateTicketServiceEnd(ticket, serviceStart) {
  const explicitDeparture = asValidDate(ticket?.departure_time);
  if (explicitDeparture instanceof Date && !Number.isNaN(explicitDeparture.getTime()) && explicitDeparture > serviceStart) {
    return explicitDeparture;
  }
  const estimatedDurationMillis = isoDurationToSeconds(ticket?.duration) * 1000;
  const fallbackDurationMillis = estimatedDurationMillis > 0 ? estimatedDurationMillis : MIN_GANTT_BLOCK_DURATION;
  return new Date(serviceStart.getTime() + fallbackDurationMillis);
}

function buildStageSegment(type, start, end) {
  if (!(start instanceof Date) || !(end instanceof Date) || end <= start) {
    return null;
  }
  return {
    type,
    label: resultText(GANTT_STAGE_STYLES[type].labelKey),
    start,
    end
  };
}

function buildTicketStages(agent, fallbackStart = null) {
  const shiftStart = asValidDate(agent?.shift_start_time);
  const fallbackDate = asValidDate(fallbackStart);
  const tickets = Array.isArray(agent?.tickets) ? agent.tickets : [];
  let previousDepartureTime = null;
  return tickets.map((ticket, index) => {
    const arrivalTime = asValidDate(ticket?.arrival_time);
    const travelStartCandidate = previousDepartureTime || shiftStart || fallbackDate;
    const serviceStart = estimateTicketServiceStart(ticket, arrivalTime, travelStartCandidate);
    if (!(serviceStart instanceof Date) || Number.isNaN(serviceStart.getTime())) {
      return null;
    }
    const serviceEnd = estimateTicketServiceEnd(ticket, serviceStart);
    const travelEnd = arrivalTime || serviceStart;
    let travelStart = travelStartCandidate || travelEnd;
    if (travelStart > travelEnd) {
      travelStart = travelEnd;
    }
    const waitStart = arrivalTime && arrivalTime < serviceStart ? arrivalTime : null;
    const waitEnd = waitStart ? serviceStart : null;
    const segments = [
      buildStageSegment("travel", travelStart, travelEnd),
      buildStageSegment("wait", waitStart, waitEnd),
      buildStageSegment("service", serviceStart, serviceEnd)
    ].filter(Boolean);
    if (!segments.length) {
      previousDepartureTime = serviceEnd;
      return null;
    }
    const segmentStart = earliestDate(...segments.map((segment) => segment.start));
    const segmentEnd = latestDate(...segments.map((segment) => segment.end));
    const windowStatus = serviceWindowStatus(ticket, serviceStart, serviceEnd);
    previousDepartureTime = serviceEnd;
    return {
      type: "ticket",
      ticket,
      sequence: index + 1,
      segmentStart,
      segmentEnd,
      travelStart,
      travelEnd,
      waitStart,
      waitEnd,
      serviceStart,
      serviceEnd,
      segments,
      detailRows: [
        stageDetailRow("travel", resultText("result.gantt.travelToTicket"), travelStart, travelEnd),
        ...(waitStart && waitEnd ? [stageDetailRow("wait", resultText(GANTT_STAGE_STYLES.wait.labelKey), waitStart, waitEnd)] : []),
        stageDetailRow("service", resultText("result.gantt.performService"), serviceStart, serviceEnd),
        detailRow(`expected-${ticket.id}`, resultText("result.gantt.expectedServiceWindow"), ticketExpectedWindowLabel(ticket)),
        detailRow(
          `window-status-${ticket.id}`,
          resultText("result.gantt.fulfillmentStatus"),
          windowStatus.label
        )
      ]
    };
  }).filter(Boolean);
}

function buildReturnStage(agent, ticketStages) {
  if (!ticketStages.length) {
    return null;
  }
  const lastTicketStage = ticketStages[ticketStages.length - 1];
  const returnStart = lastTicketStage.serviceEnd;
  const returnEnd = asValidDate(agent?.tickets_done_time);
  const segment = buildStageSegment("return", returnStart, returnEnd);
  if (!segment) {
    return null;
  }
  return {
    type: "return",
    ticket: null,
    sequence: ticketStages.length + 1,
    segmentStart: returnStart,
    segmentEnd: returnEnd,
    returnStart,
    returnEnd,
    segments: [segment],
    detailRows: [
      stageDetailRow("return", resultText("result.gantt.returnToDepot"), returnStart, returnEnd)
    ]
  };
}

function buildAgentTimelineStages(agent, fallbackStart = null) {
  const ticketStages = buildTicketStages(agent, fallbackStart);
  const returnStage = buildReturnStage(agent, ticketStages);
  return returnStage ? [...ticketStages, returnStage] : ticketStages;
}

function rangeFromDates(dates) {
  if (!dates.length) {
    return null;
  }
  const timestamps = dates.map((item) => item.getTime());
  const start = new Date(Math.min(...timestamps));
  const end = new Date(Math.max(...timestamps));
  return end > start ? { start, end, total: end.getTime() - start.getTime() } : null;
}

function buildGanttRows(job) {
  return nonVirtualAgents(job).map((agent) => ({
    agent,
    stages: buildAgentTimelineStages(agent)
  }));
}

function buildGanttRange(job, stagedRows) {
  const dates = [
    asValidDate(job?.start_date_time),
    asValidDate(job?.end_date_time)
  ];
  stagedRows.forEach(({ agent, stages }) => {
    dates.push(
      asValidDate(agent?.shift_start_time),
      asValidDate(agent?.tickets_done_time),
      asValidDate(agent?.shift_off_time)
    );
    stages.forEach((stage) => {
      dates.push(stage.segmentStart, stage.segmentEnd);
      stage.segments.forEach((segment) => dates.push(segment.start, segment.end));
    });
  });
  return rangeFromDates(dates.filter((item) => item instanceof Date && !Number.isNaN(item.getTime())));
}

function buildGanttTaskRange(stagedRows) {
  const dates = stagedRows.flatMap(({ stages }) => stages.flatMap((stage) => [stage.segmentStart, stage.segmentEnd]));
  return rangeFromDates(dates.filter((item) => item instanceof Date && !Number.isNaN(item.getTime())));
}

function buildGanttViewport(range, defaultViewport, viewStartTime, viewEndTime) {
  if (!range || !defaultViewport) {
    return null;
  }
  let start = Number.isFinite(viewStartTime) ? viewStartTime : defaultViewport.start.getTime();
  let end = Number.isFinite(viewEndTime) ? viewEndTime : defaultViewport.end.getTime();
  start = clamp(start, range.start.getTime(), range.end.getTime());
  end = clamp(end, start + 1, range.end.getTime());
  if (end - start > range.total) {
    start = range.start.getTime();
    end = range.end.getTime();
  }
  return { start: new Date(start), end: new Date(end), total: end - start };
}

function buildGanttTicks(viewport) {
  if (!viewport) {
    return [];
  }
  const tickCount = 6;
  return Array.from({ length: tickCount }, (_, index) => {
    const ratio = tickCount === 1 ? 0 : index / (tickCount - 1);
    const value = new Date(viewport.start.getTime() + (viewport.total * ratio));
    return {
      key: `${value.getTime()}-${index}`,
      left: ratio * 100,
      label: formatTimelineTime(value),
      offsetClass: index === 0 ? "translate-x-0" : (index === tickCount - 1 ? "-translate-x-full" : "-translate-x-1/2")
    };
  });
}

function buildGanttBars(agent, stages, viewport) {
  if (!viewport) {
    return [];
  }
  return stages.map((stage) => {
    const ticket = stage.ticket;
    const fullSegment = visibleSegment(viewport, stage.segmentStart, stage.segmentEnd);
    if (!fullSegment) {
      return null;
    }
    const left = Math.max(0, Math.min(100, fullSegment.left));
    const rawWidth = fullSegment.width;
    const width = Math.max(1, Math.min(100 - left, rawWidth));
    const anchorLeft = clamp(left + (width / 2), 14, 86);
    const primaryStyle = GANTT_STAGE_STYLES[stage.type === "return" ? "return" : "service"];
    const windowStatus = serviceWindowStatus(stage.ticket, stage.serviceStart, stage.serviceEnd);
    const isOutOfExpectedWindow = stage.type === "ticket" && !windowStatus.inWindow;
    const borderStyle = isOutOfExpectedWindow ? GANTT_OUT_OF_WINDOW_STYLE.border : primaryStyle.border;
    const displayLabel = stage.type === "return" ? resultText("result.gantt.return") : String(stage.sequence);
    const labelCenter = clamp(left + (width / 2), 0, 100);
    const labelStyle = stage.type === "return"
      ? `left:${left}%;width:${width}%;min-width:3.4375rem;`
      : `left:${labelCenter}%;min-width:1.25rem;transform:translateX(-50%);`;
    const segments = stage.segments
      .map((segment) => {
        const innerSegment = segmentWithinBar(visibleSegment(viewport, segment.start, segment.end), fullSegment.left, rawWidth);
        if (!innerSegment) {
          return null;
        }
        const style = GANTT_STAGE_STYLES[segment.type];
        return {
          key: `${stage.type}-${segment.type}-${segment.start.getTime()}`,
          type: segment.type,
          label: segment.label,
          title: `${segment.label} ${formatStageRange(segment.start, segment.end)}`,
          style: `left:${innerSegment.left}%;width:${innerSegment.width}%;background:${style.background};box-shadow:inset 1.25px 0 0 rgba(255,255,255,0.5);`
        };
      })
      .filter(Boolean);
    if (!segments.length) {
      return null;
    }
    const addressText = stage.type === "return"
      ? (agent?.start_loc?.address || agent?.start_loc?.name || resultText("result.gantt.depot"))
      : ticketAddressText(ticket);
    return {
      key: stage.type === "return" ? `${agent.id}-return` : `${agent.id}-${ticket.id}`,
      type: stage.type,
      ticketId: ticket?.id || "",
      label: stage.type === "return" ? resultText("result.gantt.returnToDepot") : ticket.id,
      sequence: stage.sequence,
      left,
      width,
      anchorLeft,
      displayLabel,
      isOutOfExpectedWindow,
      segments,
      barStyle: `left:${left}%;width:${width}%;border-color:${borderStyle};border-width:${isOutOfExpectedWindow ? "2.5px" : "1.25px"};background:${primaryStyle.baseBackground};color:${isOutOfExpectedWindow ? GANTT_OUT_OF_WINDOW_STYLE.text : primaryStyle.text};box-shadow:${isOutOfExpectedWindow ? "0 0 0 1.25px rgba(225,29,72,0.22)" : "none"};`,
      labelStyle: `${labelStyle}color:${isOutOfExpectedWindow ? GANTT_OUT_OF_WINDOW_STYLE.text : primaryStyle.text};text-shadow:0 1.25px 0 rgba(255,255,255,0.55);`,
      engineerName: agent.name || agent.id,
      travelStartText: formatGanttDateTime(stage.travelStart),
      arrivalText: formatGanttDateTime(stage.travelEnd),
      waitStartText: formatGanttDateTime(stage.waitStart),
      waitEndText: formatGanttDateTime(stage.waitEnd),
      serviceStartText: formatGanttDateTime(stage.serviceStart),
      serviceEndText: formatGanttDateTime(stage.serviceEnd),
      returnStartText: formatGanttDateTime(stage.returnStart),
      returnEndText: formatGanttDateTime(stage.returnEnd),
      detailRows: stage.detailRows,
      addressLabel: stage.type === "return" ? resultText("result.gantt.depot") : resultText("result.gantt.address"),
      addressText,
      showLocationInfo: stage.type === "return" || Boolean(addressText)
    };
  }).filter(Boolean);
}

function ganttCompactLabel(viewport) {
  if (!viewport) {
    return "--";
  }
  if (viewport.start.toDateString() === viewport.end.toDateString()) {
    const day = new Intl.DateTimeFormat(getUiLocale(), {
      month: "2-digit",
      day: "2-digit"
    }).format(viewport.start);
    return `${day} ${formatTimelineTime(viewport.start)}–${formatTimelineTime(viewport.end)}`;
  }
  return `${formatGanttDateTime(viewport.start)}–${formatGanttDateTime(viewport.end)}`;
}

function ganttFullLabel(viewport, mode) {
  if (!viewport) {
    return "--";
  }
  const modeLabel = mode === "full_day" ? resultText("result.gantt.fullDay") : resultText("result.gantt.tasks");
  return `${modeLabel} · ${formatGanttDateRangeLabel(viewport.start, viewport.end)}`;
}

function emptyGanttView(mode = "tasks") {
  return {
    range: null,
    taskRange: null,
    defaultViewport: null,
    viewport: null,
    ticks: [],
    rows: [],
    compactLabel: "--",
    fullLabel: "--",
    canToggleMode: false,
    modeHint: mode === "full_day" ? resultText("result.gantt.switchToTasks") : resultText("result.gantt.switchToFullDay")
  };
}

export function buildSolverJobGanttView(job, {
  viewportMode = "tasks",
  viewStartTime = null,
  viewEndTime = null
} = {}) {
  const stagedRows = buildGanttRows(job);
  const range = buildGanttRange(job, stagedRows);
  const taskRange = buildGanttTaskRange(stagedRows);
  if (!range) {
    return {
      ...emptyGanttView(viewportMode),
      rows: stagedRows.map(({ agent, stages }) => {
        const operatingRange = agentOperatingRangeFromStages(agent, stages);
        return {
          agent,
          trackStyle: "display:none;",
          operatingRangeLabel: operatingRange ? `${formatTimelineTime(operatingRange.start)} → ${formatTimelineTime(operatingRange.end)}` : "-",
          bars: [],
          labels: []
        };
      })
    };
  }
  const defaultViewport = viewportMode === "full_day"
    ? { start: new Date(range.start), end: new Date(range.end), total: range.total }
    : (taskRange || range);
  const viewport = buildGanttViewport(range, defaultViewport, viewStartTime, viewEndTime);
  const rows = stagedRows.map(({ agent, stages }) => {
    const operatingRange = agentOperatingRangeFromStages(agent, stages);
    const visibleRange = visibleSegment(viewport, operatingRange?.start, operatingRange?.end);
    const bars = buildGanttBars(agent, stages, viewport);
    return {
      agent,
      trackStyle: visibleRange
        ? `left:${visibleRange.left}%;width:${Math.max(1, visibleRange.width)}%;`
        : "display:none;",
      operatingRangeLabel: operatingRange ? `${formatTimelineTime(operatingRange.start)} → ${formatTimelineTime(operatingRange.end)}` : "-",
      bars,
      labels: bars.map((bar) => ({
        key: `${bar.key}-label`,
        displayLabel: bar.displayLabel,
        style: bar.labelStyle
      }))
    };
  });
  return {
    range,
    taskRange,
    defaultViewport,
    viewport,
    ticks: buildGanttTicks(viewport),
    rows,
    compactLabel: ganttCompactLabel(viewport),
    fullLabel: ganttFullLabel(viewport, viewportMode),
    canToggleMode: Boolean(range && taskRange),
    modeHint: viewportMode === "full_day" ? resultText("result.gantt.switchToTasks") : resultText("result.gantt.switchToFullDay")
  };
}

function visibleSegment(viewport, start, end) {
  if (!(viewport?.start instanceof Date) || !(viewport?.end instanceof Date)) {
    return null;
  }
  if (!(start instanceof Date) || !(end instanceof Date) || end <= start) {
    return null;
  }
  if (end <= viewport.start || start >= viewport.end) {
    return null;
  }
  const clippedStart = start > viewport.start ? start : viewport.start;
  const clippedEnd = end < viewport.end ? end : viewport.end;
  if (clippedEnd <= clippedStart) {
    return null;
  }
  return {
    start: clippedStart,
    end: clippedEnd,
    left: ((clippedStart.getTime() - viewport.start.getTime()) / viewport.total) * 100,
    width: ((clippedEnd.getTime() - clippedStart.getTime()) / viewport.total) * 100
  };
}

function segmentWithinBar(segment, barLeft, barWidth) {
  if (!segment || barWidth <= 0) {
    return null;
  }
  const left = clamp(((segment.left - barLeft) / barWidth) * 100, 0, 100);
  const width = clamp((segment.width / barWidth) * 100, 0, 100 - left);
  if (width <= 0) {
    return null;
  }
  return { left, width };
}

function shortTicketLabel(label) {
  const text = String(label || "").trim();
  if (!text) {
    return "--";
  }
  if (text.length <= 8) {
    return text;
  }
  const parts = text.split("-");
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last.length >= 4) {
      return `${parts[0]}-...${last.slice(-4)}`;
    }
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function solverGatewayBridge() {
  return window.VrpScenarioGateway || null;
}

function isSolverGatewayMode() {
  return Boolean(solverGatewayBridge()?.isScenarioComponent);
}

function firstGatewayObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || null;
}

function looksLikeSolverJob(value) {
  return Boolean(value && typeof value === "object" && (
    value.status
    || value.plan
    || value.score
    || value.metrics
    || value.solution_metrics_list
    || value.solutionMetricsList
  ));
}

function normalizeGatewayResultInput(input) {
  const source = firstGatewayObject(input?.payload, input?.data, input) || {};
  const resultPayload = firstGatewayObject(source.result_payload, source.resultPayload, source.result, source.output);
  const job = firstGatewayObject(
    source.engine_view?.solver_job,
    source.engineView?.solverJob,
    source.job,
    source.solver_job,
    source.solverJob,
    resultPayload?.job,
    resultPayload?.solver_job,
    resultPayload?.solverJob,
    looksLikeSolverJob(resultPayload) ? resultPayload : null,
    looksLikeSolverJob(source) ? source : null
  );
  const scenario = firstGatewayObject(
    source.scenario,
    source.request_payload,
    source.requestPayload,
    source.scenario_payload,
    source.scenarioPayload,
    source.input,
    job?.scenario,
    job?.plan ? job : null
  );
  return { job, scenario };
}

export function solverJobDetailPage() {
  return {
    // Component mounting replaces this with the locale-reactive t() bound to
    // the Scenario catalog. The fallback keeps the standalone page factory
    // deterministic in unit tests without reintroducing source-text lookup.
    t(key, params = {}) {
      return resultText(key, params);
    },
    loading: true,
    error: "",
    gatewayMode: false,
    job: null,
    scenario: null,
    selectedJobId: "",
    notice: "",
    selectedAgentId: "",
    taskSidebarTab: "route",
    hoveredTicketId: "",
    hoveredBusinessId: "",
    businessIdTooltip: { left: 0, top: 0 },
    businessIdHideTimer: null,
    activeGanttTicketKey: "",
    activeGanttTicketId: "",
    activeGanttPopover: null,
    ganttPopoverStyle: {
      position: "fixed",
      width: "min(30rem, calc(100vw - 30px))",
      margin: "0",
      left: "15px",
      top: "15px",
      maxHeight: "calc(100vh - 30px)"
    },
    constraintDialogOpen: false,
    panels: {
      previewMap: true,
      costParameters: true,
      constraints: true
    },
    ganttViewportMode: "tasks",
    ganttViewStartTime: null,
    ganttViewEndTime: null,
    ganttRangeSignature: "",
    ganttView: emptyGanttView(),
    ganttDrag: null,
    scoreCurveViewport: null,
    scoreCurveFullRangeCache: null,
    scoreCurveEventTarget: null,
    scoreCurvePointerTarget: null,
    scoreCurveLastPointerPosition: null,
    scoreCurveHoverRequiresFreshPointerMove: false,
    scoreCurveHighlightTraceIndexes: null,
    scoreHover: {
      visible: false,
      hasSample: false,
      guideLeft: 0,
      guideTop: 0,
      guideHeight: 0,
      tooltipLeft: 0,
      tooltipTop: 0,
      elapsedLabel: "",
      sampleElapsedLabel: "",
      sampleLabel: "",
      hard: "",
      medium: "",
      soft: "",
      scoreText: "",
      sampleX: null
    },
    mapSdkPromise: null,
    previewMapPromise: null,
    previewMapLoading: true,
    ganttReady: false,
    ganttRenderFrame: null,
    ganttViewRefreshFrame: null,
    ganttPopoverRepositionFrame: null,
    ganttPopoverScrollRoot: null,
    disposed: false,
    boundGanttPointerMove: null,
    boundGanttPointerUp: null,
    boundGanttPopoverReposition: null,
    boundGanttPopoverOutsidePointer: null,
    boundGanttPopoverEscape: null,
    boundScoreCurveRelayout: null,
    boundScoreCurvePointerMove: null,
    boundScoreCurvePointerLeave: null,
    boundScoreCurveGlobalPointerMove: null,
    boundScoreCurveVisibilityChange: null,
    boundScoreCurveLifecycleChange: null,
    async init() {
      this.disposed = false;
      this.gatewayMode = isSolverGatewayMode();
      this.selectedJobId = currentHashQueryParam("id");
      this.boundGanttPointerMove = this.onGanttPointerMove.bind(this);
      this.boundGanttPointerUp = this.stopGanttDrag.bind(this);
      this.boundGanttPopoverReposition = this.scheduleGanttPopoverReposition.bind(this);
      this.boundGanttPopoverOutsidePointer = this.onGanttPopoverOutsidePointer.bind(this);
      this.boundGanttPopoverEscape = this.onGanttPopoverEscape.bind(this);
      this.boundScoreCurveRelayout = this.onScoreCurveRelayout.bind(this);
      this.boundScoreCurvePointerMove = this.onScoreCurvePointerMove.bind(this);
      this.boundScoreCurvePointerLeave = this.hideScoreCurveHover.bind(this);
      this.boundScoreCurveGlobalPointerMove = this.onScoreCurveGlobalPointerMove.bind(this);
      this.boundScoreCurveVisibilityChange = this.onScoreCurveVisibilityChange.bind(this);
      this.boundScoreCurveLifecycleChange = this.suppressScoreCurveHoverUntilPointerMoves.bind(this);
      window.addEventListener("resize", this.boundGanttPopoverReposition);
      window.addEventListener("scroll", this.boundGanttPopoverReposition, true);
      this.bindGanttPopoverScrollRoot();
      window.addEventListener("pointerdown", this.boundGanttPopoverOutsidePointer, true);
      window.addEventListener("keydown", this.boundGanttPopoverEscape);
      // 外壳的 pointerleave 是首选清理路径；这个捕获监听是兜底，处理
      // SVG 命中层或滚动容器交接时没有派发 pointerleave 的浏览器边界情况。
      window.addEventListener("pointermove", this.boundScoreCurveGlobalPointerMove, true);
      window.addEventListener("blur", this.boundScoreCurveLifecycleChange);
      window.addEventListener("focus", this.boundScoreCurveLifecycleChange);
      window.addEventListener("pagehide", this.boundScoreCurveLifecycleChange);
      document.addEventListener("visibilitychange", this.boundScoreCurveVisibilityChange);
      document.addEventListener("freeze", this.boundScoreCurveLifecycleChange);
      document.addEventListener("resume", this.boundScoreCurveLifecycleChange);
      // Keep the route preview enabled by default, but start fetching the SDK before
      // the large result object enters Alpine's reactive render cycle.
      this.warmMapSdk().catch(() => {});
      if (this.gatewayMode) {
        solverGatewayBridge()?.registerComponent?.("result", this);
        return;
      }
      await this.refresh();
      window.addEventListener("hashchange", this.handleRouteExit);
      window.addEventListener("vrp:solver-detail-dispose", () => {
        this.stopGanttDrag();
        this.unbindScoreCurvePointerEvents();
        this.hideScoreCurveHover();
      }, { once: true });
    },
    onLocaleChanged() {
      const previewMap = this.$refs?.previewMap?._vrpMap;
      if (mapLocaleRequiresRecreation(previewMap)) {
        this.recreatePreviewMapForLocale().catch(() => {});
      } else {
        applyMapLocale(previewMap);
      }
      if (!this.job) {
        return;
      }
      this.refreshGanttView();
      this.drawScoreCurve();
    },
    handleRouteExit: () => {
      if (!window.location.hash.includes("/solver-job")) {
        window.dispatchEvent(new CustomEvent("vrp:solver-detail-dispose"));
      }
    },
    dispose() {
      this.disposed = true;
      this.cancelDeferredGanttRender();
      this.cancelGanttViewRefresh();
      this.cancelGanttPopoverReposition();
      this.stopGanttDrag();
      this.closeTicketPopover();
      this.unbindScoreCurvePointerEvents();
      window.removeEventListener("resize", this.boundGanttPopoverReposition);
      window.removeEventListener("scroll", this.boundGanttPopoverReposition, true);
      this.unbindGanttPopoverScrollRoot();
      window.removeEventListener("pointerdown", this.boundGanttPopoverOutsidePointer, true);
      window.removeEventListener("keydown", this.boundGanttPopoverEscape);
      window.removeEventListener("pointermove", this.boundScoreCurveGlobalPointerMove, true);
      window.removeEventListener("blur", this.boundScoreCurveLifecycleChange);
      window.removeEventListener("focus", this.boundScoreCurveLifecycleChange);
      window.removeEventListener("pagehide", this.boundScoreCurveLifecycleChange);
      document.removeEventListener("visibilitychange", this.boundScoreCurveVisibilityChange);
      document.removeEventListener("freeze", this.boundScoreCurveLifecycleChange);
      document.removeEventListener("resume", this.boundScoreCurveLifecycleChange);
      if (this.$refs.scoreChart && window.Plotly?.purge) {
        window.Plotly.purge(this.$refs.scoreChart);
      }
      const map = this.$refs.previewMap?._vrpMap;
      map?._vrpTicketInfoWindow?.close?.();
      map?.clearMap?.();
      map?.destroy?.();
      if (this.$refs.previewMap) {
        delete this.$refs.previewMap._vrpMap;
      }
    },
    async refresh() {
      this.selectedJobId = currentHashQueryParam("id");
      if (this.gatewayMode && solverGatewayBridge()?.actions?.load_scenario_result) {
        const response = await solverGatewayBridge().actions.load_scenario_result({
          refresh: true,
          job_id: solverGatewayBridge()?.context?.result_job_id || this.selectedJobId || null,
          include: ["task", "result_summary", "engine_view"]
        });
        if (!response?.ok) {
          this.error = localizeRequestError(response?.error);
          return;
        }
        await this.applyGatewayResult(response.data);
        return;
      }
      this.loading = true;
      this.error = "";
      try {
        const path = this.selectedJobId
          ? `/solver_job/${encodeURIComponent(this.selectedJobId)}?remove_virtual=true`
          : "/solver_job?remove_virtual=true";
        const jobRequest = getJson(path);
        this.beginResultRender();
        await this.waitForMapSdkWarmup();
        this.job = hydrateJob(await jobRequest);
        this.scenario = normalizeScenarioForView(await getJson("/scenario"));
        if (!this.agents().some((agent) => agent.id === this.selectedAgentId)) {
          this.selectedAgentId = this.agents()[0]?.id || "";
        }
        this.hoveredTicketId = "";
        this.closeTicketPopover();
        this.syncGanttViewport();
        this.syncScoreCurveViewport();
        window.dispatchEvent(new CustomEvent("vrp:connection", { detail: { online: true, labelKey: "connection.jobAvailable" } }));
        await this.$nextTick();
        this.drawScoreCurve();
        try {
          await this.drawPreviewMap();
        } finally {
          this.deferGanttRender();
        }
      } catch (error) {
        if (error.status === 404) {
          this.job = null;
          this.scoreCurveViewport = null;
          this.scoreCurveFullRangeCache = null;
          this.scoreCurveEventTarget = null;
          this.unbindScoreCurvePointerEvents();
          this.hideScoreCurveHover();
          this.notice = this.t(this.selectedJobId ? "result.notice.jobMissing" : "result.notice.noJob");
          window.dispatchEvent(new CustomEvent("vrp:connection", { detail: { online: true, labelKey: "connection.noJob" } }));
        } else {
          this.error = localizeRequestError(error);
          notify(this.error, "danger");
          window.dispatchEvent(new CustomEvent("vrp:connection", { detail: { online: false, labelKey: "connection.jobUnavailable" } }));
        }
      } finally {
        this.loading = false;
      }
    },
    async applyGatewayResult(input) {
      this.loading = true;
      this.error = "";
      this.notice = "";
      try {
        const { job, scenario } = normalizeGatewayResultInput(input);
        if (!job) {
          this.beginResultRender();
          this.job = null;
          this.scenario = scenario ? normalizeScenarioForView(scenario) : null;
          this.notice = this.t("result.notice.noRenderableResult");
          return;
        }
        this.beginResultRender();
        await this.waitForMapSdkWarmup();
        this.job = hydrateJob(job);
        this.scenario = scenario ? normalizeScenarioForView(scenario) : normalizeScenarioForView(job);
        if (!this.agents().some((agent) => agent.id === this.selectedAgentId)) {
          this.selectedAgentId = this.agents()[0]?.id || "";
        }
        this.hoveredTicketId = "";
        this.closeTicketPopover();
        this.ganttRangeSignature = "";
        this.scoreCurveViewport = null;
        this.scoreCurveFullRangeCache = null;
        this.syncGanttViewport();
        this.syncScoreCurveViewport();
        await this.$nextTick();
        this.drawScoreCurve();
        try {
          await this.drawPreviewMap();
        } finally {
          this.deferGanttRender();
        }
      } catch (error) {
        this.error = localizeRequestError(error);
        solverGatewayBridge()?.sendError?.(this.error);
      } finally {
        this.loading = false;
        solverGatewayBridge()?.notifyResultState?.(this.error ? null : this.job);
        solverGatewayBridge()?.scheduleResize?.();
      }
    },
    setTaskSidebarTab(tab) {
      this.taskSidebarTab = tab || "route";
      if (this.taskSidebarTab === "route") {
        this.$nextTick(() => this.drawPreviewMap());
      }
    },
    async stopJob() {
      if (!this.job?.id || !this.isJobSolving()) {
        return;
      }
      try {
        this.job = await postJson("/solver_job/terminate");
        this.notice = this.t("result.notice.stopRequested");
        await this.refresh();
      } catch (error) {
        this.error = localizeRequestError(error);
      }
    },
    async deleteJob() {
      if (!this.canDeleteJob() || !window.confirm(this.t("result.notice.deleteConfirm"))) {
        return;
      }
      try {
        await deleteRequest(`/solver_job/${encodeURIComponent(this.job.id)}`);
        this.notice = this.t("result.notice.deleted");
        if (this.selectedJobId) {
          navigate({ target: "result" });
          return;
        }
        await this.refresh();
      } catch (error) {
        this.error = localizeRequestError(error);
      }
    },
    clearNotice() {
      this.notice = "";
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
      this.clearBusinessIdHideTimer();
      this.hoveredBusinessId = id;
      const rect = trigger.getBoundingClientRect?.();
      if (!rect) {
        return;
      }
      const width = 560;
      const height = 85;
      const margin = 15;
      const left = clamp(rect.left, margin, Math.max(margin, window.innerWidth - width - margin));
      const preferredTop = rect.bottom + 7.5;
      this.businessIdTooltip = {
        left,
        top: preferredTop + height > window.innerHeight - margin
          ? Math.max(margin, rect.top - height - 7.5)
          : preferredTop
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
    async copyBusinessId(value = this.hoveredBusinessId) {
      const id = String(value || "").trim();
      if (!id) {
        return;
      }
      try {
        if (!await copyText(id)) {
          throw new Error("copy-failed");
        }
        notify(this.t("result.notice.idCopied"), "success");
      } catch (_error) {
        notify(this.t("result.notice.copyFailed"), "danger");
      }
    },
    async copyCurrentJobId() {
      const value = String(this.job?.id || "").trim();
      if (!value) {
        return;
      }
      try {
        const copied = await copyText(value);
        if (!copied) {
          throw new Error("copy-failed");
        }
        notify(this.t("result.notice.jobIdCopied"), "success");
      } catch (_error) {
        notify(this.t("result.notice.copyFailed"), "danger");
      }
    },
    openMap() {
      navigate({ target: "map", result_job_id: this.job?.id || this.selectedJobId || "" });
    },
    isJobSolving() {
      return this.job?.status === "SOLVING_SCHEDULED" || this.job?.status === "SOLVING_ACTIVE";
    },
    canDeleteJob() {
      return Boolean(this.job?.id) && ["SOLVING_FINISHED", "ERROR"].includes(this.job?.status);
    },
    displaySolveTime(value) {
      return formatDuration(value, this.locale);
    },
    displayMatrixMode(value) {
      const normalized = String(value || "").trim().toUpperCase();
      if (normalized === "MANHATTAN") {
        return "manhattan";
      }
      if (normalized === "AMAP" || normalized === "ROUTING") {
        return "routing";
      }
      return normalized || "--";
    },
    displayBooleanParam(value) {
      if (value == null) {
        return "--";
      }
      return this.t(value ? "boolean.yes" : "boolean.no");
    },
    displayJobDateTime(value) {
      return formatSummaryDateTime(value);
    },
    activeConstraintConfiguration() {
      const candidates = [
        this.job?.plan?.constraint_configuration,
        this.job?.plan?.constraintConfiguration,
        this.job?.constraint_configuration,
        this.job?.constraintConfiguration,
        this.scenario?.plan?.constraint_configuration,
        this.scenario?.plan?.constraintConfiguration
      ];
      return candidates.find((item) => item && typeof item === "object" && !Array.isArray(item)) || {};
    },
    constraintEntries() {
      return Object.entries(this.activeConstraintConfiguration()).filter(([, value]) => (
        isConstraintWeightText(value)
      )).map(([key, value]) => {
        const raw = value == null ? "" : String(value);
        const levels = parseConstraintValue(raw);
        return {
          key,
          label: CONSTRAINT_LABELS[key] ? translateRequestText(CONSTRAINT_LABELS[key]) : key,
          hard: levels.hard,
          medium: levels.medium,
          soft: levels.soft
        };
      }).sort((left, right) => (
        constraintLevelNumber(right.hard) - constraintLevelNumber(left.hard)
        || constraintLevelNumber(right.medium) - constraintLevelNumber(left.medium)
        || constraintLevelNumber(right.soft) - constraintLevelNumber(left.soft)
        || left.key.localeCompare(right.key)
      ));
    },
    constraintCountLabel() {
      const count = this.constraintEntries().length;
      return count ? this.t("result.summary.constraintCountValue", { count }) : this.t("result.summary.none");
    },
    openConstraintDialog() {
      this.constraintDialogOpen = true;
      this.$nextTick(() => {
        if (this.$refs.constraintDialog && !this.$refs.constraintDialog.open) {
          this.$refs.constraintDialog.showModal();
        }
      });
    },
    closeConstraintDialog() {
      if (this.$refs.constraintDialog?.open) {
        this.$refs.constraintDialog.close();
      }
      this.constraintDialogOpen = false;
    },
    summaryStatusBadgeClass(status) {
      switch (status) {
        case "SOLVING_FINISHED":
          return "result-summary-status-success";
        case "SOLVING_ACTIVE":
        case "SOLVING_SCHEDULED":
          return "result-summary-status-running";
        case "ERROR":
          return "result-summary-status-danger";
        default:
          return "result-summary-status-neutral";
      }
    },
    summaryStatusDotClass(status) {
      switch (status) {
        case "SOLVING_FINISHED":
          return "result-summary-status-dot-success";
        case "SOLVING_ACTIVE":
        case "SOLVING_SCHEDULED":
          return "result-summary-status-dot-running";
        case "ERROR":
          return "result-summary-status-dot-danger";
        default:
          return "result-summary-status-dot-neutral";
      }
    },
    jobStatusLabel() {
      return humanJobStatus(this.job?.status);
    },
    agents() {
      if (this.isJobSolving()) {
        return [];
      }
      return nonVirtualAgents(this.job);
    },
    scoreProgress() {
      return buildSolverScoreProgress(this.job);
    },
    scoreCurrentBestPoint() {
      const points = this.scoreProgress().bestPoints;
      return points.length ? points[points.length - 1] : this.scoreProgress().finalPoint;
    },
    scoreCurrentHardLabel() {
      const point = this.scoreCurrentBestPoint();
      if (!point) {
        return "Hard --";
      }
      return point.score.hard < 0
        ? this.t("result.score.hardPenalty", { value: point.score.hard })
        : this.t("result.score.hardFeasible");
    },
    scoreCurrentHardClass() {
      return this.scoreCurrentBestPoint()?.score?.hard < 0
        ? "text-rose-700"
        : "text-emerald-700";
    },
    scoreCurvePoints() {
      return this.scoreProgress().allPoints;
    },
    scoreCurveFullRange() {
      const points = this.scoreCurvePoints();
      if (!points.length) {
        return null;
      }
      const xValues = points.map((point) => point.x);
      const rawXMin = Math.min(...xValues);
      const rawXMax = Math.max(...xValues);
      const rawXSpan = rawXMax - rawXMin;
      const xPadding = rawXSpan > 0 ? Math.max(rawXSpan * 0.12, 0.5) : 1;
      return {
        xMin: rawXMin - xPadding,
        xMax: rawXMax + xPadding,
        minXWindow: Math.max((rawXSpan || (xPadding * 2)) * 0.15, 0.1)
      };
    },
    syncScoreCurveViewport() {
      const nextRange = this.scoreCurveFullRange();
      if (!nextRange) {
        this.scoreCurveViewport = null;
        this.scoreCurveFullRangeCache = null;
        return;
      }

      const previousRange = this.scoreCurveFullRangeCache;
      const previousViewport = this.scoreCurveViewport;
      this.scoreCurveFullRangeCache = nextRange;

      if (!previousRange || !previousViewport) {
        this.scoreCurveViewport = {
          xMin: nextRange.xMin,
          xMax: nextRange.xMax
        };
        return;
      }

      const xRestored = Math.abs(previousViewport.xMin - previousRange.xMin) < 1e-6
        && Math.abs(previousViewport.xMax - previousRange.xMax) < 1e-6;
      if (xRestored) {
        this.scoreCurveViewport = {
          xMin: nextRange.xMin,
          xMax: nextRange.xMax
        };
        return;
      }

      const nextX = remapViewport(previousViewport, previousRange, nextRange, "xMin", "xMax", "minXWindow");
      this.scoreCurveViewport = {
        xMin: nextX.min,
        xMax: nextX.max
      };
    },
    canZoomInScoreCurve() {
      const range = this.scoreCurveFullRangeCache;
      const viewport = this.scoreCurveViewport;
      if (!range || !viewport) {
        return false;
      }
      const xSpan = viewport.xMax - viewport.xMin;
      return xSpan > range.minXWindow + 1e-6;
    },
    canZoomOutScoreCurve() {
      const range = this.scoreCurveFullRangeCache;
      const viewport = this.scoreCurveViewport;
      if (!range || !viewport) {
        return false;
      }
      return viewport.xMin > range.xMin + 1e-6
        || viewport.xMax < range.xMax - 1e-6;
    },
    zoomScoreCurve(factor) {
      const range = this.scoreCurveFullRangeCache;
      const viewport = this.scoreCurveViewport;
      if (!range || !viewport) {
        return;
      }
      const currentXSpan = viewport.xMax - viewport.xMin;
      const nextXSpan = clamp(currentXSpan * factor, range.minXWindow, range.xMax - range.xMin);
      const xCenter = viewport.xMin + (currentXSpan / 2);
      const nextX = fitViewportToRange(xCenter, nextXSpan, range.xMin, range.xMax);
      this.scoreCurveViewport = {
        xMin: nextX.min,
        xMax: nextX.max
      };
      this.drawScoreCurve();
    },
    resetScoreCurveViewport() {
      const range = this.scoreCurveFullRangeCache || this.scoreCurveFullRange();
      if (!range) {
        return;
      }
      this.scoreCurveFullRangeCache = range;
      this.scoreCurveViewport = {
        xMin: range.xMin,
        xMax: range.xMax
      };
      this.drawScoreCurve();
    },
    bindScoreCurveEvents() {
      const chart = this.$refs.scoreChart;
      if (!chart) {
        return;
      }
      if (chart.on && this.boundScoreCurveRelayout && this.scoreCurveEventTarget !== chart) {
        chart.on("plotly_relayout", this.boundScoreCurveRelayout);
        this.scoreCurveEventTarget = chart;
      }
      const hoverTarget = this.$refs.scoreChartShell || chart;
      if (this.scoreCurvePointerTarget !== hoverTarget) {
        this.unbindScoreCurvePointerEvents();
        // 监听图表外壳：Plotly 的 SVG 命中层只覆盖绘图区，外壳还能收到
        // 坐标轴留白和下方离开图表时的指针事件，而不干扰缩放和拖拽。
        hoverTarget.addEventListener("pointermove", this.boundScoreCurvePointerMove, true);
        hoverTarget.addEventListener("pointerleave", this.boundScoreCurvePointerLeave);
        this.scoreCurvePointerTarget = hoverTarget;
      }
    },
    unbindScoreCurvePointerEvents() {
      const target = this.scoreCurvePointerTarget;
      if (target) {
        target.removeEventListener("pointermove", this.boundScoreCurvePointerMove, true);
        target.removeEventListener("pointerleave", this.boundScoreCurvePointerLeave);
      }
      this.scoreCurvePointerTarget = null;
    },
    onScoreCurveVisibilityChange() {
      // 页面恢复可见时也清理，避免因浏览器切换标签期间事件顺序不同而
      // 重新展示离开前遗留的悬浮状态。
      this.suppressScoreCurveHoverUntilPointerMoves();
    },
    suppressScoreCurveHoverUntilPointerMoves() {
      this.scoreCurveHoverRequiresFreshPointerMove = true;
      this.hideScoreCurveHover();
    },
    onScoreCurveGlobalPointerMove(event) {
      // 只在浮框已展示时做越界清理，正常的显示和更新仍由图表外壳处理。
      // 这样即使下移进入 Gantt 图时外壳未收到 pointerleave，也能立即隐藏。
      if (!this.scoreHover.visible) {
        return;
      }
      const geometry = this.scoreCurvePlotGeometry();
      if (!geometry) {
        this.hideScoreCurveHover();
        return;
      }
      const pointerLeft = event.clientX - geometry.rect.left;
      const pointerTop = event.clientY - geometry.rect.top;
      const insidePlot = pointerLeft >= geometry.left && pointerLeft <= geometry.left + geometry.width
        && pointerTop >= geometry.top && pointerTop <= geometry.top + geometry.height;
      if (!insidePlot) {
        this.hideScoreCurveHover();
      }
    },
    scoreCurvePlotGeometry() {
      const chart = this.$refs.scoreChart;
      const rect = chart?.getBoundingClientRect?.();
      const layout = chart?._fullLayout;
      const xAxis = layout?.xaxis;
      const yAxis = layout?.yaxis;
      if (!rect || !xAxis || !yAxis || !Number.isFinite(xAxis._offset) || !Number.isFinite(yAxis._offset)
        || !Number.isFinite(xAxis._length) || !Number.isFinite(yAxis._length)
        || xAxis._length <= 0 || yAxis._length <= 0) {
        return null;
      }
      return {
        rect,
        left: xAxis._offset,
        top: yAxis._offset,
        width: xAxis._length,
        height: yAxis._length
      };
    },
    formatScoreCurveElapsed(elapsedSeconds) {
      return this.t("result.score.elapsedSeconds", { value: Number(elapsedSeconds).toFixed(2) });
    },
    setScoreCurveHoverElementsVisible(visible) {
      [this.$refs.scoreHoverGuide, this.$refs.scoreHoverTooltip].forEach((element) => {
        if (!element?.style) {
          return;
        }
        // x-bind:style 会在页面恢复时重写 style 属性，可能覆盖掉 display:none。
        // hidden 属性不受该绑定影响，作为同步隐藏的最终保障。
        element.hidden = !visible;
        if (visible) {
          element.style.removeProperty("display");
        } else {
          element.style.setProperty("display", "none", "important");
        }
      });
    },
    hideScoreCurveHover() {
      this.scoreHover = {
        ...this.scoreHover,
        visible: false,
        hasSample: false,
        sampleX: null
      };
      // 页面冻结或失焦时，Alpine 的 DOM 更新可能晚于浏览器恢复绘制；
      // 同步隐藏元素，避免恢复后短暂展示旧位置的浮框。
      this.setScoreCurveHoverElementsVisible(false);
      this.updateScoreCurveHoverHighlight(null);
    },
    updateScoreCurveHoverHighlight(sample) {
      const chart = this.$refs.scoreChart;
      const indexes = this.scoreCurveHighlightTraceIndexes;
      if (!chart || !window.Plotly?.restyle || !indexes) {
        return;
      }
      const restyle = (index, values) => window.Plotly.restyle(chart, values, [index]);
      const empty = { x: [[]], y: [[]] };
      if (!sample) {
        restyle(indexes.medium, empty);
        restyle(indexes.soft, empty);
        restyle(indexes.hardBar, { ...empty, text: [[]] });
        restyle(indexes.hardZero, empty);
        return;
      }

      restyle(indexes.medium, { x: [[sample.x]], y: [[sample.score.medium]] });
      restyle(indexes.soft, { x: [[sample.x]], y: [[sample.score.soft]] });
      if (sample.hardPenalty > 0) {
        restyle(indexes.hardBar, {
          x: [[sample.x]],
          y: [[sample.hardPenalty]],
          text: [[String(sample.score.hard)]]
        });
        restyle(indexes.hardZero, empty);
      } else {
        restyle(indexes.hardBar, { ...empty, text: [[]] });
        restyle(indexes.hardZero, { x: [[sample.x]], y: [[0]] });
      }
    },
    onScoreCurvePointerMove(event) {
      const geometry = this.scoreCurvePlotGeometry();
      const viewport = this.scoreCurveViewport || this.scoreCurveFullRangeCache || this.scoreCurveFullRange();
      if (!geometry || !viewport) {
        if (this.scoreHover.visible) {
          this.hideScoreCurveHover();
        }
        return;
      }

      const pointerLeft = event.clientX - geometry.rect.left;
      const pointerTop = event.clientY - geometry.rect.top;
      const insidePlot = pointerLeft >= geometry.left && pointerLeft <= geometry.left + geometry.width
        && pointerTop >= geometry.top && pointerTop <= geometry.top + geometry.height;
      if (!insidePlot) {
        this.scoreCurveHoverRequiresFreshPointerMove = false;
        this.scoreCurveLastPointerPosition = { x: event.clientX, y: event.clientY };
        if (this.scoreHover.visible) {
          this.hideScoreCurveHover();
        }
        return;
      }

      const hasFreshPointerPosition = !this.scoreCurveLastPointerPosition
        || this.scoreCurveLastPointerPosition.x !== event.clientX
        || this.scoreCurveLastPointerPosition.y !== event.clientY;
      if (this.scoreCurveHoverRequiresFreshPointerMove && !hasFreshPointerPosition) {
        return;
      }
      this.scoreCurveHoverRequiresFreshPointerMove = false;
      this.scoreCurveLastPointerPosition = { x: event.clientX, y: event.clientY };

      const elapsedSeconds = viewport.xMin
        + ((pointerLeft - geometry.left) / geometry.width) * (viewport.xMax - viewport.xMin);
      // 历史最优是阶梯线：每段水平线都沿用左端真实采样的得分。
      // 最终解是独立的真实结束事件；两类事件都只能读取当前光标时间及以前的点。
      const sample = latestScorePointAtOrBefore(this.scoreProgress().allPoints, elapsedSeconds);
      const tooltipWidth = 310;
      const tooltipHeight = 187.5;
      const tooltipLeft = clamp(
        pointerLeft + 15,
        geometry.left + 7.5,
        Math.max(geometry.left + 7.5, geometry.rect.width - tooltipWidth - 7.5)
      );
      const tooltipTop = clamp(
        pointerTop + 15,
        geometry.top + 7.5,
        Math.max(geometry.top + 7.5, geometry.top + geometry.height - tooltipHeight - 7.5)
      );
      this.setScoreCurveHoverElementsVisible(true);
      this.scoreHover = {
        visible: true,
        hasSample: Boolean(sample),
        guideLeft: pointerLeft,
        guideTop: geometry.top,
        guideHeight: geometry.height,
        tooltipLeft,
        tooltipTop,
        elapsedLabel: this.formatScoreCurveElapsed(elapsedSeconds),
        sampleElapsedLabel: sample ? this.formatScoreCurveElapsed(sample.x) : "",
        sampleLabel: sample?.label || "",
        hard: sample?.score?.hard ?? "",
        medium: sample?.score?.medium ?? "",
        soft: sample?.score?.soft ?? "",
        scoreText: sample?.scoreText || "",
        sampleX: sample?.x ?? null
      };
      this.updateScoreCurveHoverHighlight(sample);
    },
    onScoreCurveRelayout(eventData) {
      const range = this.scoreCurveFullRangeCache || this.scoreCurveFullRange();
      if (!range || !eventData) {
        return;
      }

      const nextViewport = {
        ...(this.scoreCurveViewport || {
          xMin: range.xMin,
          xMax: range.xMax
        })
      };

      if (eventData["xaxis.autorange"]) {
        nextViewport.xMin = range.xMin;
        nextViewport.xMax = range.xMax;
      } else {
        const nextXMin = parseScoreCurveNumber(eventData["xaxis.range[0]"]);
        const nextXMax = parseScoreCurveNumber(eventData["xaxis.range[1]"]);
        if (nextXMin != null && nextXMax != null) {
          nextViewport.xMin = nextXMin;
          nextViewport.xMax = nextXMax;
        }
      }

      this.scoreCurveViewport = nextViewport;
    },
    refreshGanttView() {
      const view = this.isJobSolving()
        ? emptyGanttView(this.ganttViewportMode)
        : buildSolverJobGanttView(this.job, {
          viewportMode: this.ganttViewportMode,
          viewStartTime: this.ganttViewStartTime,
          viewEndTime: this.ganttViewEndTime
        });
      this.ganttView = view;
      if (!view.range || !view.viewport) {
        this.ganttViewStartTime = null;
        this.ganttViewEndTime = null;
        this.ganttRangeSignature = "";
        return view;
      }
      this.ganttViewStartTime = view.viewport.start.getTime();
      this.ganttViewEndTime = view.viewport.end.getTime();
      this.ganttRangeSignature = `${this.ganttViewportMode}-${view.range.start.getTime()}-${view.range.end.getTime()}-${view.defaultViewport?.start?.getTime() ?? ""}-${view.defaultViewport?.end?.getTime() ?? ""}`;
      return view;
    },
    scheduleGanttViewRefresh() {
      if (this.ganttViewRefreshFrame != null || this.disposed) {
        return;
      }
      const refresh = () => {
        this.ganttViewRefreshFrame = null;
        if (this.disposed) {
          return;
        }
        this.refreshGanttView();
        this.scheduleGanttPopoverReposition();
      };
      this.ganttViewRefreshFrame = window.requestAnimationFrame
        ? window.requestAnimationFrame(refresh)
        : window.setTimeout(refresh, 0);
    },
    cancelGanttViewRefresh() {
      if (this.ganttViewRefreshFrame == null) {
        return;
      }
      if (window.cancelAnimationFrame) {
        window.cancelAnimationFrame(this.ganttViewRefreshFrame);
      } else {
        window.clearTimeout(this.ganttViewRefreshFrame);
      }
      this.ganttViewRefreshFrame = null;
    },
    ganttRange() {
      return this.ganttView?.range || null;
    },
    ganttTaskRange() {
      return this.ganttView?.taskRange || null;
    },
    ganttDefaultViewportRange() {
      return this.ganttView?.defaultViewport || null;
    },
    ganttMinWindow() {
      const range = this.ganttRange();
      if (!range) {
        return 0;
      }
      return Math.min(range.total, 15 * 60 * 1000);
    },
    syncGanttViewport() {
      this.ganttViewStartTime = null;
      this.ganttViewEndTime = null;
      return this.refreshGanttView();
    },
    ganttViewport() {
      return this.ganttView?.viewport || null;
    },
    ganttViewportLabel() {
      const viewport = this.ganttViewport();
      if (!viewport) {
        return "--";
      }
      return formatGanttDateRangeLabel(viewport.start, viewport.end);
    },
    ganttViewportCompactLabel() {
      return this.ganttView?.compactLabel || "--";
    },
    canToggleGanttViewportMode() {
      return Boolean(this.ganttView?.canToggleMode);
    },
    toggleGanttViewportMode() {
      if (!this.canToggleGanttViewportMode()) {
        return;
      }
      this.ganttViewportMode = this.ganttViewportMode === "full_day" ? "tasks" : "full_day";
      this.ganttRangeSignature = "";
      this.syncGanttViewport();
      this.scheduleGanttPopoverReposition();
    },
    ganttViewportModeLabel() {
      return this.t(this.ganttViewportMode === "full_day" ? "result.gantt.fullDayPeriod" : "result.gantt.taskPeriod");
    },
    ganttViewportModeHint() {
      return this.ganttView?.modeHint || "";
    },
    ganttRangeStartLabel() {
      const range = this.ganttRange();
      return range ? formatTimelineTime(range.start) : "--";
    },
    ganttRangeEndLabel() {
      const range = this.ganttRange();
      return range ? formatTimelineTime(range.end) : "--";
    },
    ganttSelectionStartLabel() {
      const viewport = this.ganttViewport();
      return viewport ? formatTimelineTime(viewport.start) : "--";
    },
    ganttSelectionEndLabel() {
      const viewport = this.ganttViewport();
      return viewport ? formatTimelineTime(viewport.end) : "--";
    },
    ganttSelectionStyle() {
      const metrics = this.ganttSelectionMetrics();
      return `left:${metrics.left}%;width:${metrics.width}%;`;
    },
    ganttHandleStyle(side) {
      const metrics = this.ganttSelectionMetrics();
      const left = side === "start" ? metrics.left : metrics.right;
      return `left:${left}%;`;
    },
    ganttSelectionMetrics() {
      const range = this.ganttRange();
      const viewport = this.ganttViewport();
      if (!range || !viewport) {
        return { left: 0, width: 100, right: 100 };
      }
      const left = ((viewport.start.getTime() - range.start.getTime()) / range.total) * 100;
      const width = ((viewport.end.getTime() - viewport.start.getTime()) / range.total) * 100;
      return {
        left,
        width,
        right: left + width
      };
    },
    startGanttHandleDrag(side, event) {
      const range = this.ganttRange();
      const track = this.$refs.ganttRangeTrack;
      if (!range || !track) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.syncGanttViewport();
      this.ganttDrag = { side };
      window.addEventListener("pointermove", this.boundGanttPointerMove);
      window.addEventListener("pointerup", this.boundGanttPointerUp);
      window.addEventListener("pointercancel", this.boundGanttPointerUp);
    },
    onGanttPointerMove(event) {
      const range = this.ganttRange();
      const track = this.$refs.ganttRangeTrack;
      if (!this.ganttDrag || !range || !track) {
        return;
      }
      const rect = track.getBoundingClientRect();
      if (!rect.width) {
        return;
      }
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const pointTime = range.start.getTime() + (range.total * ratio);
      const minWindow = this.ganttMinWindow();
      if (this.ganttDrag.side === "start") {
        const nextStart = clamp(pointTime, range.start.getTime(), this.ganttViewEndTime - minWindow);
        this.ganttViewStartTime = Math.round(nextStart);
        this.scheduleGanttViewRefresh();
        return;
      }
      const nextEnd = clamp(pointTime, this.ganttViewStartTime + minWindow, range.end.getTime());
      this.ganttViewEndTime = Math.round(nextEnd);
      this.scheduleGanttViewRefresh();
    },
    stopGanttDrag() {
      this.ganttDrag = null;
      if (this.boundGanttPointerMove) {
        window.removeEventListener("pointermove", this.boundGanttPointerMove);
      }
      if (this.boundGanttPointerUp) {
        window.removeEventListener("pointerup", this.boundGanttPointerUp);
        window.removeEventListener("pointercancel", this.boundGanttPointerUp);
      }
    },
    canZoomInGantt() {
      const viewport = this.ganttViewport();
      const minWindow = this.ganttMinWindow();
      return Boolean(viewport && viewport.total > minWindow + 1000);
    },
    canZoomOutGantt() {
      const viewport = this.ganttViewport();
      const range = this.ganttRange();
      return Boolean(viewport && range && viewport.total < range.total - 1000);
    },
    canPanGantt(direction) {
      const viewport = this.ganttViewport();
      const range = this.ganttRange();
      if (!viewport || !range) {
        return false;
      }
      if (direction < 0) {
        return viewport.start.getTime() > range.start.getTime();
      }
      return viewport.end.getTime() < range.end.getTime();
    },
    zoomGantt(factor) {
      const range = this.ganttRange();
      const viewport = this.ganttViewport();
      if (!range || !viewport) {
        return;
      }
      const minWindow = this.ganttMinWindow();
      const currentStart = viewport.start.getTime();
      const currentEnd = viewport.end.getTime();
      const center = currentStart + ((currentEnd - currentStart) / 2);
      const nextDuration = Math.max(minWindow, Math.min(range.total, (currentEnd - currentStart) * factor));
      let start = center - (nextDuration / 2);
      let end = center + (nextDuration / 2);
      if (start < range.start.getTime()) {
        start = range.start.getTime();
        end = start + nextDuration;
      }
      if (end > range.end.getTime()) {
        end = range.end.getTime();
        start = end - nextDuration;
      }
      this.ganttViewStartTime = Math.round(start);
      this.ganttViewEndTime = Math.round(end);
      this.refreshGanttView();
      this.scheduleGanttPopoverReposition();
    },
    panGantt(direction) {
      const range = this.ganttRange();
      const viewport = this.ganttViewport();
      if (!range || !viewport) {
        return;
      }
      const duration = viewport.total;
      const step = duration * 0.25 * direction;
      let start = viewport.start.getTime() + step;
      let end = viewport.end.getTime() + step;
      if (start < range.start.getTime()) {
        start = range.start.getTime();
        end = start + duration;
      }
      if (end > range.end.getTime()) {
        end = range.end.getTime();
        start = end - duration;
      }
      this.ganttViewStartTime = Math.round(start);
      this.ganttViewEndTime = Math.round(end);
      this.refreshGanttView();
      this.scheduleGanttPopoverReposition();
    },
    resetGanttViewport() {
      const defaultViewport = this.ganttDefaultViewportRange();
      if (!defaultViewport) {
        return;
      }
      this.ganttViewStartTime = defaultViewport.start.getTime();
      this.ganttViewEndTime = defaultViewport.end.getTime();
      this.refreshGanttView();
      this.scheduleGanttPopoverReposition();
    },
    ganttTicks() {
      return this.ganttView?.ticks || [];
    },
    selectedAgent() {
      return this.agents().find((item) => item.id === this.selectedAgentId) || null;
    },
    selectedAgentRouteNotice() {
      return getAgentRouteNotice(this.selectedAgent());
    },
    selectedAgentTickets() {
      return this.selectedAgent()?.tickets || [];
    },
    openScenarioTicket(ticketId) {
      const value = String(ticketId || "").trim();
      if (!value) {
        return;
      }
      navigate({ target: "create", intent: "focus_ticket", ticket_id: value });
    },
    agentField(agent, snakeKey, camelKey = snakeKey) {
      return agent?.[snakeKey] ?? agent?.[camelKey] ?? null;
    },
    displayAgentField(value) {
      if (value == null || value === "") {
        return "--";
      }
      return String(value);
    },
    displayAgentMeasurement(value, unit) {
      const displayValue = this.displayAgentField(value);
      return displayValue === "--" || !unit ? displayValue : `${displayValue} ${unit}`;
    },
    agentFuelConsumptionUnit(agent) {
      const fuelType = String(this.agentField(agent, "fuel_type", "fuelType") || "").trim().toUpperCase();
      if (fuelType === "GAS_92") {
        return "L/100km";
      }
      if (fuelType === "ELEC") {
        return "kWh/100km";
      }
      return "";
    },
    agentRentedLabel(agent) {
      const value = this.agentField(agent, "rented");
      return this.t(value === true || String(value).trim().toLowerCase() === "true" ? "result.agent.leased" : "result.agent.owned");
    },
    agentVehicleCostRows(agent) {
      return [
        { key: "weight", label: this.t("result.agent.weight"), value: this.displayAgentMeasurement(this.agentField(agent, "weight"), this.t("result.agent.ton")) },
        { key: "vol", label: this.t("result.agent.volume"), value: this.displayAgentMeasurement(this.agentField(agent, "vol"), "m³") },
        { key: "vehicleType", label: this.t("result.agent.vehicleType"), value: this.displayAgentField(this.agentField(agent, "vehicle_type", "vehicleType")) },
        { key: "fuelType", label: this.t("result.agent.fuelType"), value: this.displayAgentField(this.agentField(agent, "fuel_type", "fuelType")) },
        { key: "fuelConsumption", label: this.t("result.agent.fuelConsumption"), value: this.displayAgentMeasurement(this.agentField(agent, "fuel_consumption", "fuelConsumption"), this.agentFuelConsumptionUnit(agent)) },
        { key: "rented", label: this.t("result.agent.rented"), value: this.agentRentedLabel(agent), kind: "pill" },
        { key: "fixCostDaily", label: this.t("result.agent.fixedDailyCost"), value: this.displayAgentMeasurement(this.agentField(agent, "fix_cost_daily", "fixCostDaily")) }
      ];
    },
    sideTabItems() {
      return [
        { key: "route", label: this.t("result.sidebar.route") },
        { key: "engineer", label: this.t("result.sidebar.engineer") },
        { key: "tickets", label: this.t("result.sidebar.tickets") }
      ];
    },
    isSideTabActive(tab) {
      return this.taskSidebarTab === tab;
    },
    selectAgent(agentId, ticketId = "") {
      this.selectedAgentId = agentId;
      this.hoveredTicketId = ticketId || "";
      if (!ticketId) {
        this.closeTicketPopover();
        return;
      }
      this.drawPreviewMap();
    },
    async clickTimelineBar(agentId, bar, event = null) {
      if (!bar?.key) {
        return;
      }
      this.selectedAgentId = agentId;
      this.hoveredTicketId = bar.ticketId || "";
      const shouldOpen = this.activeGanttTicketKey !== bar.key;
      if (!shouldOpen) {
        this.closeTicketPopover();
        return;
      }
      this.activeGanttTicketKey = bar.key;
      this.activeGanttTicketId = bar.ticketId || "";
      this.activeGanttPopover = bar;
      this.drawPreviewMap();
      await this.$nextTick();
      const dialog = this.$refs.ganttTicketDialog;
      if (dialog && !dialog.matches(":popover-open")) {
        dialog.showPopover();
      }
      this.positionGanttPopover(event?.currentTarget || null);
    },
    hoverTicket(ticketId) {
      this.hoveredTicketId = ticketId;
      this.drawPreviewMap();
    },
    toggleTicketPopover(ticketKey, ticketId = "") {
      const shouldOpen = this.activeGanttTicketKey !== ticketKey;
      if (!shouldOpen) {
        this.closeTicketPopover();
        return;
      }
      this.activeGanttTicketKey = ticketKey;
      this.activeGanttTicketId = ticketId;
      this.drawPreviewMap();
    },
    closeTicketPopover() {
      this.activeGanttTicketKey = "";
      this.activeGanttTicketId = "";
      this.activeGanttPopover = null;
      const dialog = this.$refs?.ganttTicketDialog;
      if (dialog?.matches(":popover-open")) {
        dialog.hidePopover();
      }
      this.drawPreviewMap();
    },
    ganttPopoverAnchorElement(fallback = null) {
      if (fallback?.getBoundingClientRect) {
        return fallback;
      }
      const key = this.activeGanttTicketKey;
      if (!key) {
        return null;
      }
      return [...(this.$root?.querySelectorAll?.("[data-gantt-bar-key]") || [])]
        .find((element) => element.dataset.ganttBarKey === key) || null;
    },
    positionGanttPopover(fallbackAnchor = null) {
      const dialog = this.$refs?.ganttTicketDialog;
      const anchor = this.ganttPopoverAnchorElement(fallbackAnchor);
      if (!dialog?.matches(":popover-open") || !anchor?.getBoundingClientRect || !this.activeGanttPopover) {
        return;
      }
      const margin = 15;
      const gap = 10;
      const rect = anchor.getBoundingClientRect();
      dialog.style.visibility = "hidden";
      const dialogRect = dialog.getBoundingClientRect();
      const width = Math.min(dialogRect.width || 560, Math.max(0, window.innerWidth - (margin * 2)));
      const maxHeight = Math.max(150, window.innerHeight - (margin * 2));
      const height = Math.min(dialogRect.height || 325, maxHeight);
      const maxLeft = Math.max(margin, window.innerWidth - width - margin);
      const left = clamp(rect.left + (rect.width / 2) - (width / 2), margin, maxLeft);
      const below = rect.bottom + gap;
      const above = rect.top - height - gap;
      const preferredTop = below + height <= window.innerHeight - margin ? below : above;
      const top = clamp(preferredTop, margin, Math.max(margin, window.innerHeight - height - margin));
      this.ganttPopoverStyle = {
        position: "fixed",
        width: "min(30rem, calc(100vw - 30px))",
        margin: "0",
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        maxHeight: `${Math.round(maxHeight)}px`
      };
      dialog.style.visibility = "";
    },
    bindGanttPopoverScrollRoot() {
      const scrollRoot = this.$root?.getRootNode?.();
      if (!scrollRoot?.addEventListener || scrollRoot === this.ganttPopoverScrollRoot) {
        return;
      }
      this.unbindGanttPopoverScrollRoot();
      scrollRoot.addEventListener("scroll", this.boundGanttPopoverReposition, true);
      this.ganttPopoverScrollRoot = scrollRoot;
    },
    unbindGanttPopoverScrollRoot() {
      this.ganttPopoverScrollRoot?.removeEventListener?.("scroll", this.boundGanttPopoverReposition, true);
      this.ganttPopoverScrollRoot = null;
    },
    scheduleGanttPopoverReposition() {
      if (!this.activeGanttPopover || this.ganttPopoverRepositionFrame != null || this.disposed) {
        return;
      }
      const reposition = () => {
        this.ganttPopoverRepositionFrame = null;
        if (!this.activeGanttPopover || this.disposed) {
          return;
        }
        this.positionGanttPopover();
      };
      this.ganttPopoverRepositionFrame = window.requestAnimationFrame
        ? window.requestAnimationFrame(reposition)
        : window.setTimeout(reposition, 0);
    },
    cancelGanttPopoverReposition() {
      if (this.ganttPopoverRepositionFrame == null) {
        return;
      }
      if (window.cancelAnimationFrame) {
        window.cancelAnimationFrame(this.ganttPopoverRepositionFrame);
      } else {
        window.clearTimeout(this.ganttPopoverRepositionFrame);
      }
      this.ganttPopoverRepositionFrame = null;
    },
    onGanttPopoverOutsidePointer(event) {
      const dialog = this.$refs?.ganttTicketDialog;
      if (!dialog?.matches(":popover-open") || dialog.contains(event.target)) {
        return;
      }
      const anchor = this.ganttPopoverAnchorElement();
      if (anchor?.contains(event.target)) {
        return;
      }
      this.closeTicketPopover();
    },
    onGanttPopoverEscape(event) {
      if (event.key === "Escape" && this.activeGanttPopover) {
        event.preventDefault();
        this.closeTicketPopover();
      }
    },
    isTicketPopoverOpen(ticketKey) {
      return this.activeGanttTicketKey === ticketKey;
    },
    activePreviewTicketId() {
      return this.hoveredTicketId || this.activeGanttTicketId || "";
    },
    async togglePreviewMapPanel() {
      this.panels.previewMap = !this.panels.previewMap;
      if (this.panels.previewMap) {
        await this.$nextTick();
        await this.drawPreviewMap();
      }
    },
    warmMapSdk() {
      if (this.gatewayMode && solverGatewayBridge()?.context?.map_context?.enabled === false) {
        return Promise.resolve(null);
      }
      if (this.mapSdkPromise) {
        return this.mapSdkPromise;
      }
      const promise = loadAmap();
      this.mapSdkPromise = promise;
      promise.catch(() => {
        if (this.mapSdkPromise === promise) {
          this.mapSdkPromise = null;
        }
      });
      return promise;
    },
    async waitForMapSdkWarmup() {
      const mapSdkPromise = this.warmMapSdk().catch(() => null);
      let timeoutId = null;
      try {
        return await Promise.race([
          mapSdkPromise,
          new Promise((resolve) => {
            timeoutId = window.setTimeout(() => resolve(null), PREVIEW_MAP_WARMUP_TIMEOUT_MS);
          })
        ]);
      } finally {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId);
        }
      }
    },
    preparePreviewMap() {
      if (this.taskSidebarTab !== "route" || !this.panels.previewMap || this.disposed || this.isJobSolving()
        || (this.gatewayMode && solverGatewayBridge()?.context?.map_context?.enabled === false)) {
        return Promise.resolve(null);
      }
      if (this.previewMapPromise) {
        return this.previewMapPromise;
      }
      const promise = (async () => {
        await this.$nextTick();
        if (this.disposed || this.isJobSolving() || !this.$refs.previewMap) {
          return null;
        }
        await this.warmMapSdk();
        if (this.disposed || this.isJobSolving() || !this.$refs.previewMap) {
          return null;
        }
        return ensureMap(this.$refs.previewMap, { zoom: 11 });
      })();
      this.previewMapPromise = promise;
      promise.catch(() => {
        if (this.previewMapPromise === promise) {
          this.previewMapPromise = null;
        }
      });
      return promise;
    },
    async recreatePreviewMapForLocale() {
      const container = this.$refs?.previewMap;
      const previousMap = container?._vrpMap;
      if (!container || !mapLocaleRequiresRecreation(previousMap)) {
        return;
      }
      this.previewMapLoading = true;
      previousMap._vrpTicketInfoWindow?.close?.();
      previousMap.clearMap?.();
      previousMap.destroy?.();
      delete container._vrpMap;
      delete container._vrpTicketInfoWindow;
      this.previewMapPromise = null;
      // drawPreviewMap creates AMap with lang + mapStyle together, then
      // redraws the selected agent, route and ticket overlays from this.job.
      await this.drawPreviewMap();
    },
    waitForPreviewMapFrames(count = 1) {
      return new Promise((resolve) => {
        const nextFrame = () => {
          if (count <= 0) {
            resolve();
            return;
          }
          count -= 1;
          if (window.requestAnimationFrame) {
            window.requestAnimationFrame(nextFrame);
            return;
          }
          window.setTimeout(nextFrame, 0);
        };
        nextFrame();
      });
    },
    async resizePreviewMapWhenVisible(map, frames = 1) {
      if (!map) {
        return;
      }
      await this.$nextTick();
      await this.waitForPreviewMapFrames(frames);
      map.resize?.();
    },
    beginResultRender() {
      this.cancelDeferredGanttRender();
      this.cancelGanttViewRefresh();
      this.previewMapLoading = !this.$refs?.previewMap?._vrpMap;
      this.ganttView = emptyGanttView(this.ganttViewportMode);
      this.ganttReady = false;
    },
    deferGanttRender() {
      this.cancelDeferredGanttRender();
      if (this.disposed || this.isJobSolving()) {
        this.ganttReady = true;
        return;
      }
      const render = () => {
        this.ganttRenderFrame = null;
        if (!this.disposed) {
          this.ganttReady = true;
        }
      };
      this.ganttRenderFrame = window.requestAnimationFrame
        ? window.requestAnimationFrame(render)
        : window.setTimeout(render, 0);
    },
    cancelDeferredGanttRender() {
      if (this.ganttRenderFrame == null) {
        return;
      }
      if (window.cancelAnimationFrame) {
        window.cancelAnimationFrame(this.ganttRenderFrame);
      } else {
        window.clearTimeout(this.ganttRenderFrame);
      }
      this.ganttRenderFrame = null;
    },
    async drawPreviewMap() {
      if (this.taskSidebarTab !== "route" || !this.panels.previewMap || !this.$refs.previewMap) {
        return;
      }
      const isInitialMapLoad = !this.$refs.previewMap._vrpMap;
      if (isInitialMapLoad) {
        this.previewMapLoading = true;
      }
      try {
        // The preview container is hidden with x-show while solving. Creating a
        // HERE map at that point gives it a zero-sized viewport, which remains
        // blank after the next refresh unless the viewport is explicitly resized.
        if (this.isJobSolving()) {
          const existingMap = this.$refs.previewMap._vrpMap;
          existingMap?._vrpTicketInfoWindow?.close?.();
          existingMap?.clearMap?.();
          return;
        }
        const map = await this.preparePreviewMap();
        if (!map) {
          return;
        }
        // x-show has just made the sidebar visible after the task completes.
        // Wait for layout to settle, then resize before HERE calculates bounds.
        await this.resizePreviewMapWhenVisible(map, 2);
        map._vrpTicketInfoWindow?.close?.();
        if (!this.selectedAgent()) {
          map.clearMap();
          return;
        }
        renderAgentPreview(map, this.selectedAgent(), this.activePreviewTicketId());
        // A second resize accommodates provider layout work triggered by adding
        // overlays and fitting the route bounds.
        await this.resizePreviewMapWhenVisible(map);
      } finally {
        if (isInitialMapLoad) {
          this.previewMapLoading = false;
        }
      }
    },
    drawScoreCurve() {
      if (!window.Plotly || !this.$refs.scoreChart || !this.job) {
        return;
      }
      this.syncScoreCurveViewport();
      const progress = this.scoreProgress();
      const viewport = this.scoreCurveViewport;
      const bestPoints = progress.bestPoints;
      const finalPoints = progress.finalPoint ? [progress.finalPoint] : [];
      const displayPoints = progress.allPoints;
      // 最终解可能差于历史最优，因而不会被接到阶梯线上；仍需在同一时间轴上
      // 显示它的 Hard 罚分柱。若最终解已经作为结束点延长了历史最优，则复用该柱。
      const hardPoints = progress.finalPoint
        && !bestPoints.some((point) => point.x === progress.finalPoint.x && point.scoreText === progress.finalPoint.scoreText)
        ? [...bestPoints, progress.finalPoint]
        : bestPoints;
      const barWidth = hardPenaltyBarWidth(hardPoints);
      const traces = [
        {
          type: "bar",
          x: hardPoints.map((point) => point.x),
          y: hardPoints.map((point) => point.hardPenalty),
          yaxis: "y3",
          width: barWidth,
          text: hardPoints.map((point) => point.hardPenalty > 0 ? String(point.score.hard) : ""),
          textposition: "outside",
          textfont: { color: SCORE_COLORS.hardStrong, size: 12.5 },
          cliponaxis: false,
          marker: { color: "rgba(244, 63, 94, 0.80)", line: { color: SCORE_COLORS.hardStrong, width: 1.25 } },
          hoverinfo: "skip",
          showlegend: false
        },
        {
          type: "scatter",
          mode: "markers",
          x: hardPoints.filter((point) => point.hardPenalty === 0).map((point) => point.x),
          y: hardPoints.filter((point) => point.hardPenalty === 0).map(() => 0),
          yaxis: "y3",
          marker: { color: SCORE_COLORS.hardZero, size: 7.5 },
          hoverinfo: "skip",
          showlegend: false
        },
        {
          type: "scatter",
          mode: "lines+markers",
          x: bestPoints.map((point) => point.x),
          y: bestPoints.map((point) => point.score.medium),
          name: "Medium",
          line: { color: SCORE_COLORS.medium, width: 3.125, shape: "hv" },
          marker: { color: SCORE_COLORS.medium, size: 6.25, line: { color: "#ffffff", width: 1.25 } },
          hoverinfo: "skip",
          showlegend: false
        },
        {
          type: "scatter",
          mode: "lines+markers",
          x: bestPoints.map((point) => point.x),
          y: bestPoints.map((point) => point.score.soft),
          yaxis: "y2",
          name: "Soft",
          line: { color: SCORE_COLORS.soft, width: 3.125, shape: "hv" },
          marker: { color: SCORE_COLORS.soft, size: 6.25, line: { color: "#ffffff", width: 1.25 } },
          hoverinfo: "skip",
          showlegend: false
        },
        {
          type: "scatter",
          mode: "markers",
          x: finalPoints.map((point) => point.x),
          y: finalPoints.map((point) => point.score.medium),
          marker: { color: SCORE_COLORS.medium, size: 11.25, symbol: "diamond", line: { color: "#ffffff", width: 2.5 } },
          hoverinfo: "skip",
          showlegend: false
        },
        {
          type: "scatter",
          mode: "markers",
          x: finalPoints.map((point) => point.x),
          y: finalPoints.map((point) => point.score.soft),
          yaxis: "y2",
          marker: { color: SCORE_COLORS.soft, size: 11.25, symbol: "diamond", line: { color: "#ffffff", width: 2.5 } },
          hoverinfo: "skip",
          showlegend: false
        }
      ];
      const highlightTraceIndexes = {
        medium: traces.length,
        soft: traces.length + 1,
        hardBar: traces.length + 2,
        hardZero: traces.length + 3
      };
      traces.push(
        {
          type: "scatter",
          mode: "markers",
          x: [],
          y: [],
          marker: { color: "#ffffff", size: 13.75, line: { color: SCORE_COLORS.medium, width: 3.75 } },
          hoverinfo: "skip",
          showlegend: false
        },
        {
          type: "scatter",
          mode: "markers",
          x: [],
          y: [],
          yaxis: "y2",
          marker: { color: "#ffffff", size: 13.75, line: { color: SCORE_COLORS.soft, width: 3.75 } },
          hoverinfo: "skip",
          showlegend: false
        },
        {
          type: "bar",
          x: [],
          y: [],
          yaxis: "y3",
          width: barWidth,
          marker: { color: "rgba(225, 29, 72, 0.42)", line: { color: SCORE_COLORS.hardStrong, width: 3.75 } },
          hoverinfo: "skip",
          showlegend: false
        },
        {
          type: "scatter",
          mode: "markers",
          x: [],
          y: [],
          yaxis: "y3",
          marker: { color: "#ffffff", size: 13.75, line: { color: SCORE_COLORS.hardZero, width: 3.75 } },
          hoverinfo: "skip",
          showlegend: false
        }
      );
      this.scoreCurveHighlightTraceIndexes = highlightTraceIndexes;
      window.Plotly.react(this.$refs.scoreChart, traces, {
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        height: scoreChartHeight(this.$refs.scoreChartShell),
        margin: { l: 75, r: 75, t: 7.5, b: 42.5 },
        dragmode: "zoom",
        hovermode: false,
        showlegend: false,
        barmode: "overlay",
        xaxis: {
          type: "linear",
          automargin: true,
          color: "#94a3b8",
          gridcolor: "rgba(51,65,85,0.4)",
          title: { text: this.t("result.score.durationAxis"), font: { size: 13.75 } },
          tickfont: { size: 12.5 },
          range: viewport ? [viewport.xMin, viewport.xMax] : undefined
        },
        yaxis: {
          fixedrange: true,
          automargin: true,
          title: { text: this.t("result.score.mediumAxis"), font: { color: SCORE_COLORS.medium, size: 13.75 } },
          tickfont: { color: SCORE_COLORS.medium, size: 12.5 },
          gridcolor: "rgba(148,163,184,0.25)",
          zerolinecolor: "rgba(148,163,184,0.4)",
          range: scoreAxisRange(displayPoints, "medium"),
          showline: true,
          linecolor: SCORE_COLORS.medium,
          ticks: "outside",
          tickcolor: SCORE_COLORS.medium,
          zeroline: false,
          showspikes: false
        },
        yaxis2: {
          fixedrange: true,
          overlaying: "y",
          side: "right",
          automargin: true,
          title: { text: this.t("result.score.softAxis"), font: { color: SCORE_COLORS.soft, size: 13.75 } },
          tickfont: { color: SCORE_COLORS.soft, size: 12.5 },
          showgrid: false,
          zeroline: false,
          range: scoreAxisRange(displayPoints, "soft"),
          showline: true,
          linecolor: SCORE_COLORS.soft,
          ticks: "outside",
          tickcolor: SCORE_COLORS.soft
        },
        yaxis3: {
          fixedrange: true,
          overlaying: "y",
          anchor: "x",
          side: "left",
          visible: false,
          range: [0, hardPenaltyAxisMax(hardPoints)]
        },
        annotations: [{
          xref: "paper",
          yref: "paper",
          x: 0,
          y: 0.02,
          text: this.t("result.score.hardPenaltyAxis"),
          showarrow: false,
          xanchor: "left",
          yanchor: "bottom",
          font: { size: 12.5, color: SCORE_COLORS.hardStrong }
        }]
      }, { displayModeBar: false, responsive: true });
      this.bindScoreCurveEvents();
      this.updateScoreCurveHoverHighlight(null);
    },
    ganttLegend() {
      return GANTT_STAGE_LEGEND.map((item) => ({ ...item, label: translateRequestText(item.labelKey) }));
    },
    ganttRow(agent) {
      return this.ganttView?.rows?.find((row) => row.agent?.id === agent?.id) || null;
    },
    timelineBars(agent) {
      return this.ganttRow(agent)?.bars || [];
    },
    agentTimelineTrackStyle(agent) {
      return this.ganttRow(agent)?.trackStyle || "display:none;";
    },
    agentOperatingRangeLabel(agent) {
      if (!Array.isArray(agent?.tickets) || !agent.tickets.length) {
        return "-";
      }
      const range = agentOperatingRange(agent);
      return range ? `${formatTimelineTime(range.start)} → ${formatTimelineTime(range.end)}` : "--";
    },
    agentOperatingRangeDetail(agent) {
      if (!Array.isArray(agent?.tickets) || !agent.tickets.length) {
        return "-";
      }
      const range = agentOperatingRange(agent);
      return range ? formatGanttDateRangeLabel(range.start, range.end) : "--";
    },
    agentShiftWindowLabel(agent) {
      const range = agentShiftWindow(agent);
      return range ? formatGanttDateRangeLabel(range.start, range.end) : "--";
    },
    ticketServiceWindowLabel(ticket) {
      return ticketExpectedWindowLabel(ticket);
    },
    ticketLocationText,
    ticketCoordinateText,
    timelineLabels(agent) {
      return this.ganttRow(agent)?.labels || [];
    },
    taskSummaryRows() {
      const status = this.job?.status;
      // end_date_time 是业务规划时间窗的结束，不是引擎任务的实际完成时刻。
      // 终态任务应展示持久化状态写回时记录的 update_time。
      const completedAt = status === "SOLVING_FINISHED" || status === "ERROR"
        ? this.job?.update_time
        : null;
      return [
        {
          key: "jobId",
          label: this.t("result.summary.jobId"),
          value: this.job?.id || "--",
          kind: "jobId"
        },
        {
          key: "createTime",
          label: this.t("result.summary.createdAt"),
          value: this.displayJobDateTime(this.job?.create_time),
          valueClass: "result-summary-value-time"
        },
        {
          key: "completeTime",
          label: this.t("result.summary.completedAt"),
          value: this.displayJobDateTime(completedAt),
          valueClass: "result-summary-value-time"
        }
      ];
    },
    summarySections() {
      const status = this.job?.status;
      const solving = this.isJobSolving();
      const metrics = status === "SOLVING_FINISHED" ? (this.job?.metrics || {}) : {};
      const scoreText = solving ? "--" : (normalizeScoreText(this.job?.score ?? this.job?.plan?.score) || "--");
      const parsedScore = parseHardMediumSoftScore(scoreText);
      const infeasibleScore = !solving && scoreText !== "--" && (parsedScore ? parsedScore.hard < 0 : scoreText.startsWith("-"));
      return [
        {
          key: "solve",
          title: this.t("result.summary.solver"),
          icon: "hub",
          iconClass: "result-summary-icon-brand",
          rows: [
            {
              key: "score",
              label: this.t("result.summary.score"),
              value: scoreText,
              kind: parsedScore ? "score" : "value",
              segments: parsedScore ? [
                {
                  key: "hard",
                  label: this.t("result.summary.scoreHard"),
                  value: String(parsedScore.hard),
                  colorClass: "result-summary-score-hard"
                },
                {
                  key: "medium",
                  label: this.t("result.summary.scoreMedium"),
                  value: String(parsedScore.medium),
                  colorClass: "result-summary-score-medium"
                },
                {
                  key: "soft",
                  label: this.t("result.summary.scoreSoft"),
                  value: String(parsedScore.soft),
                  colorClass: "result-summary-score-soft"
                }
              ] : [],
              valueClass: `result-summary-value-score${infeasibleScore ? " result-summary-value-danger" : ""}`,
              wide: true,
              layoutClass: "result-summary-row-score"
            },
            {
              key: "constraintCount",
              label: this.t("result.summary.constraintCount"),
              value: this.constraintCountLabel(),
              kind: "constraintCount",
              layoutClass: "result-summary-row-constraint"
            },
            {
              key: "solveTime",
              label: this.t("result.summary.solveDuration"),
              value: this.displaySolveTime(this.job?.solve_time ?? this.job?.solveTime),
              layoutClass: "result-summary-row-solve-time"
            }
          ]
        },
        {
          key: "business",
          title: this.t("result.summary.business"),
          icon: "monitoring",
          iconClass: "result-summary-icon-brand",
          gridClass: "result-summary-grid-single",
          rows: [
            {
              key: "distance",
              label: this.t("result.summary.totalDistance"),
              value: metricValue(metrics.distance_total != null ? (metrics.distance_total / 1000).toFixed(1) : null, " km"),
              layoutClass: "result-summary-row-distance"
            },
            {
              key: "duration",
              label: this.t("result.summary.totalDeliveryDuration"),
              value: metricValue(metrics.duration_total != null ? Math.round(metrics.duration_total / 60) : null, " min"),
              layoutClass: "result-summary-row-duration"
            },
            {
              key: "costTotal",
              label: this.t("result.summary.estimatedTotalCost"),
              value: metricValue(metrics.cost_total != null ? metrics.cost_total.toFixed(2) : null, ` ${this.t("result.unit.cost")}`),
              layoutClass: "result-summary-row-cost-total"
            },
            {
              key: "tonKmCost",
              label: this.t("result.summary.costPerTonKm"),
              value: metricValue(metrics.cost_per_ton_per_km != null ? metrics.cost_per_ton_per_km.toFixed(3) : null, ` ${this.t("result.unit.costPerTonKm")}`),
              layoutClass: "result-summary-row-ton-km-cost"
            }
          ]
        }
      ];
    },
    technicalSummaryRows() {
      return [
        {
          key: "matrixMode",
          label: this.t("result.summary.matrixMode"),
          value: this.displayMatrixMode(this.job?.matrix_mode ?? this.job?.matrixMode),
          layoutClass: "result-summary-row-matrix-mode"
        },
        {
          key: "buildTransitMatrix",
          label: this.t("result.summary.buildMatrix"),
          value: this.displayBooleanParam(this.job?.build_transit_matrix ?? this.job?.buildTransitMatrix),
          layoutClass: "result-summary-row-build-matrix"
        },
        {
          key: "drawRoute",
          label: this.t("result.summary.drawRoutes"),
          value: this.displayBooleanParam(this.job?.draw_route ?? this.job?.drawRoute),
          layoutClass: "result-summary-row-draw-route"
        }
      ];
    },
    hasHardViolation() {
      if (this.isJobSolving()) {
        return false;
      }
      const scoreText = normalizeScoreText(this.job?.score ?? this.job?.plan?.score);
      const parsedScore = parseHardMediumSoftScore(scoreText);
      return parsedScore ? parsedScore.hard < 0 : Boolean(scoreText && scoreText.startsWith("-"));
    },
  };
}
