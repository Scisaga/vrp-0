/**
 * Pure consumers of the canonical schema-2 engine_view. This is not a raw-job
 * projector or a replacement for envelope/JSON Schema validation. In particular,
 * unknown collections stay null and no missing route, time or ownership is made
 * up. Analysis deliberately matches the independent Python contract reference.
 */

const ROAD_SOURCES = new Set([
  "AMAP_TRUCK", "AMAP_DRIVING", "AMAP_BICYCLE",
  "HERE_TRUCK", "HERE_DRIVING", "HERE_BICYCLE", "CAR_FALLBACK",
]);
const REASON_ORDER = [
  "virtual_or_unknown_engineer", "unknown_assignment", "no_tickets",
  "missing_ticket", "inconsistent_assignment", "invalid_schedule_time",
  "non_monotonic_schedule", "missing_location", "missing_routes",
  "route_count_mismatch", "invalid_route_geometry", "route_endpoint_mismatch",
  "unsupported_route_source",
];
const TIME_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/;
const DURATION_PATTERN = /^P(?:([0-9]+)D)?(?:T(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+(?:\.[0-9]{1,9})?)S)?)?$(?![\s\S])/;
const COORDINATE_PATTERN = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
// Match the reference's Python str.strip vocabulary, not JavaScript's subtly
// different trim(): U+0085/control separators are whitespace, U+FEFF is not.
const CONTRACT_SPACE = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;
const trimContractSpace = (value) => value.replace(CONTRACT_SPACE, "");
const identity = (value) => typeof value === "string" && trimContractSpace(value).length > 0;

/** Milliseconds on a timezone-neutral business clock; NOT an actual UTC instant. */
export function parsePlanTime(value) {
  if (typeof value !== "string" || value.length !== 19 || !TIME_PATTERN.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31
      || hour > 23 || minute > 59 || second > 59) return null;
  // Date.UTC(year, ...) remaps years 0..99 to 1900..1999. Set the full year
  // explicitly and round-trip every part to reject calendar normalization.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day || date.getUTCHours() !== hour
      || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null;
  return date.getTime();
}

/** Format the business clock without the browser timezone; invalid values -> "". */
export function formatPlanTime(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return "";
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/** Validate a nonnegative Java Duration string without rounding long seconds. */
export function isPlanDuration(value) {
  if (typeof value !== "string") return false;
  const match = DURATION_PATTERN.exec(value);
  if (match === null || match.slice(1).every((part) => part === undefined)) return false;
  if (value.includes("T") && match.slice(2).every((part) => part === undefined)) return false;
  let seconds = 0n;
  const multipliers = [86400n, 3600n, 60n, 1n];
  for (let i = 1; i <= 4; i += 1) {
    const integer = (match[i] || "0").split(".")[0].replace(/^0+/, "") || "0";
    if (integer.length > 19) return false;
    seconds += BigInt(integer) * multipliers[i - 1];
    if (seconds > 9223372036854775807n) return false;
  }
  return true;
}

function coordinate(lng, lat) {
  if (typeof lng !== "number" || typeof lat !== "number"
      || !Number.isFinite(lng) || !Number.isFinite(lat)
      || lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}

/** Only POI.location is authoritative; never infer from legacy loc/entr_location. */
export function poiPosition(poi) {
  if (!record(poi) || typeof poi.location !== "string") return null;
  const parts = poi.location.split(",").map(trimContractSpace);
  if (parts.length !== 2 || parts.some((part) => !COORDINATE_PATTERN.test(part))) return null;
  return coordinate(Number(parts[0]), Number(parts[1]));
}

/** Historical Route.LOC wire axes: lat contains longitude, lon contains latitude. */
export function routePosition(loc) {
  return record(loc) ? coordinate(loc.lat, loc.lon) : null;
}

function samePoint(first, second) {
  return Math.abs(first[0] - second[0]) <= 0.000001 && Math.abs(first[1] - second[1]) <= 0.000001;
}

function entityIndex(values) {
  if (!Array.isArray(values)) return null;
  const index = new Map();
  for (const item of values) {
    if (!record(item) || !identity(item.id) || index.has(item.id)) return null;
    index.set(item.id, item);
  }
  return index;
}

function ownership(agents, tickets) {
  const memberships = new Map();
  const owned = new Map();
  if (agents === null || tickets === null) return { reliable: false, memberships, owned };
  let reliable = true;
  for (const [agentId, agent] of agents) {
    if (typeof agent.virtual !== "boolean") reliable = false;
    if (!Array.isArray(agent.tickets)) {
      reliable = false;
      continue;
    }
    for (const ticketId of agent.tickets) {
      if (!identity(ticketId)) {
        reliable = false;
        continue;
      }
      if (!memberships.has(ticketId)) memberships.set(ticketId, []);
      memberships.get(ticketId).push(agentId);
      if (!tickets.has(ticketId) || tickets.get(ticketId).agent !== agentId) reliable = false;
    }
  }
  for (const [ticketId, ticket] of tickets) {
    const owner = ticket.agent;
    const actual = memberships.get(ticketId) || [];
    if (owner === null || owner === undefined) {
      if (actual.length) reliable = false;
    } else {
      if (!identity(owner) || !agents.has(owner) || actual.length !== 1 || actual[0] !== owner) reliable = false;
      if (!owned.has(owner)) owned.set(owner, []);
      owned.get(owner).push(ticketId);
    }
  }
  return { reliable, memberships, owned };
}

function routeReasons(route, origin, destination) {
  if (!record(route)) return ["invalid_route_geometry"];
  const reasons = new Set();
  const start = routePosition(route.origin);
  const end = routePosition(route.destination);
  if (start === null || end === null) reasons.add("invalid_route_geometry");
  else if (!samePoint(start, origin) || !samePoint(end, destination)) reasons.add("route_endpoint_mismatch");
  const line = route.polyline;
  if (route.route_source === "ZERO_DISTANCE") {
    const transit = route.transit;
    if (!record(transit) || transit.distance !== 0 || transit.duration !== 0) reasons.add("invalid_route_geometry");
    if (!samePoint(origin, destination)) reasons.add("route_endpoint_mismatch");
    if (line !== null && line !== undefined) {
      if (!Array.isArray(line)) reasons.add("invalid_route_geometry");
      else for (const item of line) {
        const point = routePosition(item);
        if (point === null || !samePoint(point, origin)) reasons.add("invalid_route_geometry");
      }
    }
  } else {
    if (!ROAD_SOURCES.has(route.route_source)) reasons.add("unsupported_route_source");
    if (!Array.isArray(line) || line.length < 2) reasons.add("invalid_route_geometry");
    else {
      const positions = Array.from(line, routePosition);
      if (positions.some((point) => point === null)) reasons.add("invalid_route_geometry");
      else if (!samePoint(origin, destination) && !positions.some((point, i) => i > 0
        && (point[0] !== positions[i - 1][0] || point[1] !== positions[i - 1][1]))) {
        reasons.add("invalid_route_geometry");
      }
      // Route endpoints bind the leg. The provider's polyline may be snapped
      // away from a POI; never demand matching geometry endpoints or add lines.
    }
  }
  return reasons;
}

function analyzeEngineer(agent, tickets, pois, memberships, owned) {
  const reasons = new Set();
  const assigned = [];
  const listed = agent.tickets;
  if (agent.virtual !== false) reasons.add("virtual_or_unknown_engineer");
  if (!Array.isArray(listed) || tickets === null) reasons.add("unknown_assignment");
  else {
    if (!listed.length) reasons.add("no_tickets");
    for (const ticketId of listed) {
      if (!identity(ticketId) || !tickets.has(ticketId)) {
        reasons.add("missing_ticket");
        continue;
      }
      const ticket = tickets.get(ticketId);
      const members = memberships.get(ticketId);
      if (ticket.agent !== agent.id || members?.length !== 1 || members[0] !== agent.id) {
        reasons.add("inconsistent_assignment");
      }
      assigned.push(ticket);
    }
    const listedIds = new Set(listed);
    if ((owned.get(agent.id) || []).some((ticketId) => !listedIds.has(ticketId))) {
      reasons.add("inconsistent_assignment");
    }
  }

  const start = parsePlanTime(agent.shift_start_time);
  let previous = start;
  let end = null;
  if (assigned.length) {
    if (start === null) reasons.add("invalid_schedule_time");
    for (const ticket of assigned) {
      const arrival = parsePlanTime(ticket.arrival_time);
      const service = parsePlanTime(ticket.start_service_time);
      const departure = parsePlanTime(ticket.departure_time);
      if (arrival === null || service === null || departure === null) reasons.add("invalid_schedule_time");
      else if (!(arrival <= service && service <= departure) || (previous !== null && arrival < previous)) {
        reasons.add("non_monotonic_schedule");
      }
      previous = departure;
      end = departure;
    }

    const stops = [agent.start_loc, ...assigned.map((ticket) => ticket.loc)].map((poiId) => {
      const point = poiPosition(pois !== null && identity(poiId) ? pois.get(poiId) : null);
      if (point === null) reasons.add("missing_location");
      return point;
    });
    if (!Array.isArray(agent.routes)) reasons.add("missing_routes");
    else if (!Array.isArray(listed) || agent.routes.length !== listed.length + 1) reasons.add("route_count_mismatch");
    else if (assigned.length === listed.length && stops.every((point) => point !== null)) {
      // Keep N+1 slots intact; the last return slot is not played or required
      // to have geometry. Never compact holes and accidentally remap legs.
      for (let i = 0; i < assigned.length; i += 1) {
        for (const reason of routeReasons(agent.routes[i], stops[i], stops[i + 1])) reasons.add(reason);
      }
    }
  }
  const eligible = !reasons.size && assigned.length > 0 && start !== null && end !== null;
  return {
    id: agent.id,
    replay_eligible: eligible,
    reasons: REASON_ORDER.filter((reason) => reasons.has(reason)),
    replay_start: eligible ? formatPlanTime(start) : null,
    replay_end: eligible ? formatPlanTime(end) : null,
  };
}

function analyzeIndexes(agents, tickets, pois) {
  const result = {
    counts: { engineer_schedule_count: null, assigned_ticket_count: null, unassigned_ticket_count: null },
    engineers: [],
    replay: { start: null, end: null },
  };
  const { reliable, memberships, owned } = ownership(agents, tickets);
  if (reliable) {
    const real = new Set([...agents].filter(([, agent]) => agent.virtual === false).map(([id]) => id));
    let assigned = 0;
    for (const ticket of tickets.values()) if (real.has(ticket.agent)) assigned += 1;
    result.counts = {
      engineer_schedule_count: real.size,
      assigned_ticket_count: assigned,
      unassigned_ticket_count: tickets.size - assigned,
    };
  }
  if (agents !== null) {
    result.engineers = [...agents.values()].map((agent) => analyzeEngineer(agent, tickets, pois, memberships, owned));
  }
  for (const engineer of result.engineers) {
    if (!engineer.replay_eligible) continue;
    if (result.replay.start === null || engineer.replay_start < result.replay.start) result.replay.start = engineer.replay_start;
    if (result.replay.end === null || engineer.replay_end > result.replay.end) result.replay.end = engineer.replay_end;
  }
  return result;
}

function planOf(engineView) {
  return record(engineView) && record(engineView.solver_job) && record(engineView.solver_job.plan)
    ? engineView.solver_job.plan : null;
}

/**
 * Additional scalar checks AFTER JSON Schema, not replay qualification.
 * Null facts and unresolved IDs are legitimate; invalid non-null facts are not.
 * In particular, do not reject a valid partial view for missing routes/POIs or
 * a non-monotonic schedule. Duplicate identities are reported by buildViewModel.
 */
export function validateViewSemantics(engineView) {
  const plan = planOf(engineView);
  if (plan === null || !identity(engineView.solver_job.id)) return false;
  const nullable = (value, valid) => value === null || valid(value);
  const validTime = (value) => parsePlanTime(value) !== null;
  const times = (item, keys) => keys.every((key) => nullable(item[key], validTime));
  const validDate = (value) => typeof value === "string" && value.length === 10
    && parsePlanTime(`${value} 00:00:00`) !== null;
  const collection = (values, valid) => values === null || (Array.isArray(values) && values.every(valid));
  const reference = (value) => nullable(value, identity);
  const validRoute = (route) => route === null || (record(route)
    && nullable(route.origin, (loc) => routePosition(loc) !== null)
    && nullable(route.destination, (loc) => routePosition(loc) !== null)
    && collection(route.polyline, (loc) => routePosition(loc) !== null));
  if (!times(engineView.solver_job, ["start_date_time", "end_date_time"])) return false;
  if (!collection(plan.agents, (agent) => record(agent) && identity(agent.id)
    && nullable(agent.date, validDate)
    && times(agent, ["shift_start_time", "shift_off_time", "tickets_done_time"])
    && reference(agent.start_loc) && collection(agent.tickets, identity)
    && collection(agent.routes, validRoute))) return false;
  if (!collection(plan.tickets, (ticket) => record(ticket) && identity(ticket.id)
    && reference(ticket.agent) && reference(ticket.loc)
    && times(ticket, ["min_start_time", "max_end_time", "arrival_time", "start_service_time", "departure_time"])
    && nullable(ticket.duration, isPlanDuration))) return false;
  return collection(plan.pois, (poi) => record(poi) && identity(poi.id)
    && (poi.location === null || poiPosition(poi) !== null));
}

/** Conservative counts and per-engineer eligibility; no new fields in the wire. */
export function analyze(engineView) {
  const plan = planOf(engineView);
  return analyzeIndexes(entityIndex(plan?.agents), entityIndex(plan?.tickets), entityIndex(plan?.pois));
}

/**
 * Read-only presentation references; null collections are not empty results.
 * The consumer MUST reject invalidIdentity, even when JSON Schema passed:
 * duplicate/blank identities cannot safely bind displayed entities or routes.
 * Incomplete references instead remain available for partial static display.
 */
export function buildViewModel(engineView) {
  const plan = planOf(engineView);
  const agents = entityIndex(plan?.agents);
  const tickets = entityIndex(plan?.tickets);
  const pois = entityIndex(plan?.pois);
  return {
    agents: Array.isArray(plan?.agents) ? plan.agents : null,
    tickets: Array.isArray(plan?.tickets) ? plan.tickets : null,
    pois: Array.isArray(plan?.pois) ? plan.pois : null,
    indexes: { agents: agents || new Map(), tickets: tickets || new Map(), pois: pois || new Map() },
    invalidIdentity: (Array.isArray(plan?.agents) && agents === null)
      || (Array.isArray(plan?.tickets) && tickets === null)
      || (Array.isArray(plan?.pois) && pois === null),
    analysis: analyzeIndexes(agents, tickets, pois),
  };
}

function longitudeDelta(from, to) {
  const delta = to - from;
  return delta > 180 ? delta - 360 : delta < -180 ? delta + 360 : delta;
}

function segmentLength(from, to) {
  const radians = Math.PI / 180;
  const dLat = (to[1] - from[1]) * radians;
  const dLng = longitudeDelta(from[0], to[0]) * radians;
  const haversine = Math.sin(dLat / 2) ** 2
    + Math.cos(from[1] * radians) * Math.cos(to[1] * radians) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))));
}

/** First index whose numeric key is greater than value (also skips zero spans). */
function upperBound(values, value, key = (item) => item) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (key(values[mid]) <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function prepareLine(route, origin) {
  if (route.route_source === "ZERO_DISTANCE") return () => [...origin];
  // Snapshot once: at() never rereads or repairs the supplied wire geometry.
  const points = route.polyline.map(routePosition);
  const cumulative = new Float64Array(points.length);
  for (let i = 1; i < points.length; i += 1) {
    cumulative[i] = cumulative[i - 1] + segmentLength(points[i - 1], points[i]);
  }
  const total = cumulative[cumulative.length - 1];
  return (fraction) => {
    if (fraction <= 0 || total === 0) return [...points[0]];
    if (fraction >= 1) return [...points[points.length - 1]];
    const distance = fraction * total;
    const index = Math.min(upperBound(cumulative, distance), points.length - 1);
    const ratio = (distance - cumulative[index - 1]) / (cumulative[index] - cumulative[index - 1]);
    const from = points[index - 1];
    const to = points[index];
    const longitude = from[0] + longitudeDelta(from[0], to[0]) * ratio;
    return [longitude > 180 ? longitude - 360 : longitude < -180 ? longitude + 360 : longitude,
      from[1] + (to[1] - from[1]) * ratio];
  };
}

/**
 * Prepare only eligible engineers. Travel follows existing provider geometry;
 * waiting/service are at the POI. Snapped endpoints may jump at phase boundaries:
 * this is a planning illustration, never a claim of live/observed positioning.
 * Times are milliseconds. Before/after the plan, ticketId is null; no return leg.
 */
export function buildReplay(model) {
  const schedules = [];
  const indexes = model?.indexes;
  if (!model?.invalidIdentity && indexes?.agents instanceof Map
      && indexes?.tickets instanceof Map && indexes?.pois instanceof Map) {
    for (const engineer of model.analysis?.engineers || []) {
      if (!engineer.replay_eligible) continue;
      const agent = indexes.agents.get(engineer.id);
      const start = parsePlanTime(engineer.replay_start);
      const end = parsePlanTime(engineer.replay_end);
      const origin = poiPosition(indexes.pois.get(agent.start_loc));
      let previousTime = start;
      let previousPoint = origin;
      const legs = agent.tickets.map((ticketId, index) => {
        const ticket = indexes.tickets.get(ticketId);
        const point = poiPosition(indexes.pois.get(ticket.loc));
        const leg = {
          ticketId, point, start: previousTime,
          arrival: parsePlanTime(ticket.arrival_time),
          service: parsePlanTime(ticket.start_service_time),
          departure: parsePlanTime(ticket.departure_time),
          position: prepareLine(agent.routes[index], previousPoint),
        };
        previousTime = leg.departure;
        previousPoint = point;
        return leg;
      });
      schedules.push({ id: agent.id, start, end, origin, legs });
    }
  }
  let start = null;
  let end = null;
  for (const schedule of schedules) {
    start = start === null ? schedule.start : Math.min(start, schedule.start);
    end = end === null ? schedule.end : Math.max(end, schedule.end);
  }
  return {
    start, end,
    at(time, agentIds) {
      if (typeof time !== "number" || !Number.isFinite(time)) return [];
      const selected = agentIds === undefined ? null : new Set(agentIds);
      const positions = [];
      for (const schedule of schedules) {
        if (selected !== null && !selected.has(schedule.id)) continue;
        const { id, legs } = schedule;
        if (time < schedule.start) {
          positions.push({ id, position: [...schedule.origin], phase: "not_started", ticketId: null });
        } else if (time >= schedule.end) {
          positions.push({ id, position: [...legs[legs.length - 1].point], phase: "complete", ticketId: null });
        } else {
          const leg = legs[upperBound(legs, time, (item) => item.departure)];
          const phase = time < leg.arrival ? "travel" : time < leg.service ? "waiting" : "service";
          positions.push({ id, position: phase === "travel"
            ? leg.position((time - leg.start) / (leg.arrival - leg.start)) : [...leg.point],
          phase, ticketId: leg.ticketId });
        }
      }
      return positions;
    },
  };
}
