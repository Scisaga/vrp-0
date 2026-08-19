import { safeArray } from "./api.js";

export const COST_FIELDS = [
  ["start_price", "cost.start_price", "cost.unit.per_trip"],
  ["node_fee", "cost.node_fee", "cost.unit.per_node"],
  ["max_overload_ratio", "cost.max_overload_ratio", "cost.unit.ratio"],
  ["overload_fee", "cost.overload_fee", "cost.unit.per_event"],
  ["cross_region_threshold", "cost.cross_region_threshold", "cost.unit.meter"],
  ["cross_region_fee", "cost.cross_region_fee", "cost.unit.per_event"],
  ["guaranteed_income", "cost.guaranteed_income", "cost.unit.yuan_per_trip"],
  ["time_restricted_traffic_charge", "cost.time_restricted_traffic_charge", "cost.unit.per_hour"],
  ["elec_price", "cost.elec_price", "cost.unit.per_kwh"],
  ["gas_92_price", "cost.gas_92_price", "cost.unit.per_liter"]
];

export const DEFAULT_COST_PARAMETER = {
  start_price: 200,
  node_fee: 20,
  max_overload_ratio: 1.2,
  overload_fee: 100,
  cross_region_threshold: 100000,
  cross_region_fee: 200,
  guaranteed_income: 0,
  time_restricted_traffic_charge: 50,
  elec_price: 1.5,
  gas_92_price: 8.1
};

const COST_DATA_FIELDS = [
  "start_price",
  "node_fee",
  "overload_fee",
  "cross_region_fee",
  "time_restricted_traffic_charge",
  "elec_price",
  "gas_92_price"
];

export const CONSTRAINT_LABELS = {
  name: "constraint.name",
  agent_capacity: "constraint.agent_capacity",
  agent_max_ticket: "constraint.agent_max_ticket",
  agent_skills_accord_with_ticket_skills: "constraint.agent_skills_accord_with_ticket_skills",
  agent_qualification_levels_match_ticket: "constraint.agent_qualification_levels_match_ticket",
  ref_ticket_after_dep_ticket: "constraint.ref_ticket_after_dep_ticket",
  ref_ticket_same_agent_with_dep_ticket: "constraint.ref_ticket_same_agent_with_dep_ticket",
  service_finished_after_max_end_time: "constraint.service_finished_after_max_end_time",
  ticket_start_service_time_match_expected: "constraint.ticket_start_service_time_match_expected",
  ticket_arrival_time_same_date_with_plan_time: "constraint.ticket_arrival_time_same_date_with_plan_time",
  relation_tickets_same_agent: "constraint.relation_tickets_same_agent",
  minimize_travel_time: "constraint.minimize_travel_time",
  minimize_travel_distance: "constraint.minimize_travel_distance",
  minimize_agent_fixed_cost: "constraint.minimize_agent_fixed_cost",
  same_depo: "constraint.same_depo",
  balance_agent_loading: "constraint.balance_agent_loading",
  balance_agent_loading_ratio: "constraint.balance_agent_loading_ratio",
  balance_agent_working_time: "constraint.balance_agent_working_time",
  minimize_ticket_changing: "constraint.minimize_ticket_changing",
  agent_is_virtual: "constraint.agent_is_virtual"
};

export const DEFAULT_CONSTRAINT_CONFIGURATION = {
  name: "default",
  agent_capacity: "1hard/0medium/0soft",
  agent_max_ticket: "1hard/0medium/0soft",
  agent_skills_accord_with_ticket_skills: "1hard/0medium/0soft",
  agent_qualification_levels_match_ticket: "0hard/100medium/0soft",
  ref_ticket_after_dep_ticket: "0hard/0medium/0soft",
  ref_ticket_same_agent_with_dep_ticket: "0hard/0medium/0soft",
  service_finished_after_max_end_time: "0hard/0medium/0soft",
  ticket_start_service_time_match_expected: "0hard/0medium/100soft",
  ticket_arrival_time_same_date_with_plan_time: "1hard/0medium/0soft",
  relation_tickets_same_agent: "0hard/50medium/0soft",
  minimize_travel_time: "0hard/0medium/1soft",
  minimize_travel_distance: "0hard/0medium/0soft",
  minimize_agent_fixed_cost: "0hard/0medium/20soft",
  same_depo: "1hard/0medium/0soft",
  balance_agent_loading: "0hard/1medium/0soft",
  balance_agent_loading_ratio: "0hard/0medium/0soft",
  balance_agent_working_time: "0hard/0medium/0soft",
  minimize_ticket_changing: "0hard/0medium/1000soft",
  agent_is_virtual: "0hard/1000medium/0soft"
};

export function parseConstraintValue(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(.*?)hard\/(.*?)medium\/(.*?)soft$/i);
  if (!match) {
    return {
      hard: "0",
      medium: "0",
      soft: "0"
    };
  }
  return {
    hard: (match[1] || "").trim() || "0",
    medium: (match[2] || "").trim() || "0",
    soft: (match[3] || "").trim() || "0"
  };
}

export function formatConstraintValue(levels = {}) {
  const normalizeLevel = (value) => {
    const text = String(value ?? "").trim();
    return text === "" ? "0" : text;
  };
  return `${normalizeLevel(levels.hard)}hard/${normalizeLevel(levels.medium)}medium/${normalizeLevel(levels.soft)}soft`;
}

export function todayString() {
  const date = new Date();
  return date.toISOString().slice(0, 10);
}

export function datetimeInputValue(value) {
  if (!value) {
    return "";
  }
  return value.replace(" ", "T").slice(0, 16);
}

export function datetimeApiValue(value) {
  if (!value) {
    return null;
  }
  const normalized = value.includes("T") ? value.replace("T", " ") : value;
  return normalized.length === 16 ? `${normalized}:00` : normalized;
}

export function secondsToTimeInput(totalSeconds = 0) {
  const clamped = Math.max(0, Number(totalSeconds) || 0);
  const hours = String(Math.floor(clamped / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((clamped % 3600) / 60)).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function timeInputToSeconds(value) {
  if (!value) {
    return 0;
  }
  const [hours, minutes] = value.split(":").map((item) => Number(item || 0));
  return (hours * 3600) + (minutes * 60);
}

export function splitTags(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinTags(list) {
  return safeArray(list).join(", ");
}

function canonicalizePoi(poi = {}, address = "", city = "") {
  const current = poi && typeof poi === "object" ? { ...poi } : {};
  const normalized = {
    ...current,
    address: address || current.address || "",
    cityname: city || current.cityname || ""
  };

  const locationCoords = parseLocationString(normalized.location);
  if (locationCoords) {
    const [lng, lat] = locationCoords;
    normalized.loc = { lat, lon: lng };
  } else if (normalized.loc?.lat != null && normalized.loc?.lon != null) {
    normalized.location = `${normalized.loc.lon},${normalized.loc.lat}`;
  }

  const entranceText = normalized.entr_location || normalized.location;
  const entranceCoords = parseLocationString(entranceText);
  if (entranceCoords) {
    const [lng, lat] = entranceCoords;
    normalized.entr_loc = { lat, lon: lng };
    normalized.entr_location = `${lng},${lat}`;
  } else if (normalized.entr_loc?.lat != null && normalized.entr_loc?.lon != null) {
    normalized.entr_location = `${normalized.entr_loc.lon},${normalized.entr_loc.lat}`;
  } else if (normalized.location) {
    normalized.entr_loc = normalized.loc ? { ...normalized.loc } : normalized.entr_loc;
    normalized.entr_location = normalized.location;
  }

  return normalized;
}

export function buildRawPoi(address = "", city = "", existing = null) {
  if (existing?.id || existing?.location || existing?.loc) {
    return canonicalizePoi(existing, address, city);
  }
  return canonicalizePoi({
    id: "",
    name: address || city || "",
    address: address || "",
    cityname: city || "",
    location: "",
    adname: existing?.adname || ""
  }, address, city);
}

function buildPoiIndex(pois) {
  return new Map(
    safeArray(pois)
      .filter((poi) => poi?.id)
      .map((poi) => [poi.id, poi])
  );
}

function resolvePoiReference(value, poiIndex) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return poiIndex.get(value) || { id: value };
  }
  return value;
}

function poiAddress(poi) {
  return poi?.address || poi?.name || poi?.location || poi?.id || "";
}

function hasCostParameterData(costParameter) {
  return COST_DATA_FIELDS.some((key) => Number(costParameter?.[key] || 0) > 0);
}

function normalizeCostParameter(costParameter) {
  if (!costParameter || !hasCostParameterData(costParameter)) {
    return { ...DEFAULT_COST_PARAMETER };
  }
  return { ...DEFAULT_COST_PARAMETER, ...costParameter };
}

function normalizeMapProvider(value) {
  const provider = String(value || "").trim().toUpperCase();
  return ["AMAP", "HERE"].includes(provider) ? provider : "";
}

function poiCity(poi) {
  return poi?.cityname || poi?.adname || poi?.pname || "";
}

function poiCoordinate(poi) {
  if (!poi) {
    return "";
  }
  if (poi.location) {
    return poi.location;
  }
  const loc = poi.loc || poi.entr_loc;
  if (loc?.lat != null && loc?.lon != null) {
    return `${loc.lon},${loc.lat}`;
  }
  return "";
}

export function defaultScenario() {
  const today = todayString();
  return normalizeScenarioForView({
    name: "未命名场景",
    desc: "",
    planning_date: today,
    start_time: `${today} 08:00:00`,
    end_time: `${today} 20:00:00`,
    plan: {
      depos: [],
      agents: [],
      tickets: [],
      skus: [],
      constraint_configuration: { ...DEFAULT_CONSTRAINT_CONFIGURATION },
      cost_parameter: { ...DEFAULT_COST_PARAMETER }
    }
  });
}

function normalizeDepot(depot, poiIndex) {
  const loc = resolvePoiReference(depot?.loc, poiIndex) || {};
  return {
    id: depot?.id || "",
    name: depot?.name || "",
    address: poiAddress(loc),
    city: poiCity(loc),
    poi_location: poiCoordinate(loc),
    loc
  };
}

function normalizeAgent(agent, poiIndex) {
  const startLoc = resolvePoiReference(agent?.start_loc, poiIndex);
  const isVirtual = Boolean(agent?.virtual || agent?.is_virtual);
  return {
    id: agent?.id || "",
    depo_id: agent?.depo_id || "",
    date: agent?.date || todayString(),
    name: agent?.name || "",
    start_address: poiAddress(startLoc),
    start_city: poiCity(startLoc),
    start_location: poiCoordinate(startLoc),
    start_loc: startLoc,
    skills_text: joinTags(agent?.skills),
    skills: safeArray(agent?.skills),
    qualification_text: agent?.qualification_levels ? JSON.stringify(agent.qualification_levels) : "",
    weight: agent?.weight ?? 0,
    vol: agent?.vol ?? 0,
    vehicle_type: agent?.vehicle_type || "CAR",
    fuel_type: agent?.fuel_type ?? "",
    fuel_consumption: agent?.fuel_consumption ?? "",
    rented: Boolean(agent?.rented),
    fix_cost_daily: agent?.fix_cost_daily ?? "",
    shift_start_time_input: datetimeInputValue(agent?.shift_start_time),
    shift_off_time_input: datetimeInputValue(agent?.shift_off_time),
    max_ticket_num: agent?.max_ticket_num ?? 0,
    tickets: safeArray(agent?.tickets),
    is_virtual: isVirtual
  };
}

function normalizeTicketItems(items) {
  return safeArray(items)
    .map((item) => ({
      sku: typeof item?.sku === "string" ? item.sku : item?.sku?.id || "",
      value: Number(item?.value || 0)
    }))
    .filter((item) => item.sku && item.value > 0);
}

function normalizeTicket(ticket, poiIndex) {
  const loc = resolvePoiReference(ticket?.loc, poiIndex) || {};
  return {
    id: ticket?.id || "",
    depo_id: ticket?.depo_id || "",
    pinned: Boolean(ticket?.pinned),
    type: ticket?.type || "Delv",
    address: poiAddress(loc),
    city: poiCity(loc),
    poi_location: poiCoordinate(loc),
    loc,
    skills_text: joinTags(ticket?.skills_required),
    skills_required: safeArray(ticket?.skills_required),
    dep_ticket_ids_text: safeArray(ticket?.dep_tickets).join(", "),
    ref_ticket_ids_text: safeArray(ticket?.ref_tickets).join(", "),
    items: normalizeTicketItems(ticket?.items),
    weight: ticket?.weight ?? 0,
    vol: ticket?.vol ?? 0,
    min_start_time_input: datetimeInputValue(ticket?.min_start_time),
    max_end_time_input: datetimeInputValue(ticket?.max_end_time),
    duration_minutes: durationToMinutes(ticket?.duration),
    agent: ticket?.agent || "",
    arrival_time: ticket?.arrival_time || "",
    create_time_input: datetimeInputValue(ticket?.create_time),
    qualification_text: ticket?.qualification_levels_required ? JSON.stringify(ticket.qualification_levels_required) : ""
  };
}

function normalizeSku(sku) {
  return {
    id: sku?.id || "",
    name: sku?.name || "",
    weight: sku?.weight ?? 0,
    vol: sku?.vol ?? 0
  };
}

export function normalizeScenarioForView(rawScenario) {
  const scenario = rawScenario || {};
  const mapProvider = normalizeMapProvider(scenario.map_provider ?? scenario.mapProvider);
  const plan = scenario.plan || {};
  const normalizedPois = safeArray(plan.pois).map((poi) => canonicalizePoi(poi));
  const poiIndex = buildPoiIndex(normalizedPois);
  const costParameter = normalizeCostParameter(plan.cost_parameter);
  const constraintConfiguration = { ...DEFAULT_CONSTRAINT_CONFIGURATION, ...(plan.constraint_configuration || {}) };
  const normalizedDepos = safeArray(plan.depos).map((depot) => normalizeDepot(depot, poiIndex));
  return {
    ...scenario,
    ...(mapProvider ? { map_provider: mapProvider } : {}),
    planning_date: scenario.planning_date || todayString(),
    start_time_input: datetimeInputValue(scenario.start_time),
    end_time_input: datetimeInputValue(scenario.end_time),
    city_hint: normalizedDepos[0]?.city || "",
    plan: {
      ...plan,
      pois: normalizedPois,
      depos: normalizedDepos,
      agents: safeArray(plan.agents).map((agent) => normalizeAgent(agent, poiIndex)),
      tickets: safeArray(plan.tickets).map((ticket) => normalizeTicket(ticket, poiIndex)),
      skus: safeArray(plan.skus).map(normalizeSku),
      cost_parameter: costParameter,
      constraint_configuration: constraintConfiguration
    }
  };
}

export function buildScenarioPayload(viewScenario) {
  const scenario = viewScenario || {};
  const mapProvider = normalizeMapProvider(scenario.map_provider ?? scenario.mapProvider);
  const plan = scenario.plan || {};
  const payload = {
    name: scenario.name || "",
    desc: scenario.desc || "",
    ...(mapProvider ? { map_provider: mapProvider } : {}),
    planning_date: scenario.planning_date || todayString(),
    start_time: datetimeApiValue(scenario.start_time_input),
    end_time: datetimeApiValue(scenario.end_time_input),
    create_time: scenario.create_time || null,
    update_time: scenario.update_time || null,
    plan: {
      pois: safeArray(plan.pois).map((poi) => canonicalizePoi(poi)),
      depos: safeArray(plan.depos)
        .filter((row) => row.id || row.name || row.address || row.city || row.loc?.location || row.loc?.loc)
        .map((row) => ({
          id: row.id || "",
          name: row.name || "",
          loc: buildRawPoi(row.address, row.city || scenario.city_hint, row.loc)
        })),
      agents: safeArray(plan.agents)
        .filter((row) => row.id || row.name || row.start_address || row.start_city || row.start_loc?.location || row.start_loc?.loc)
        .map((row) => {
          const agent = {
            id: row.id || "",
            depo_id: row.depo_id || "",
            date: row.date || todayString(),
            name: row.name || "",
            start_loc: buildRawPoi(row.start_address, row.start_city || scenario.city_hint, row.start_loc),
            skills: splitTags(row.skills_text),
            qualification_levels: parseJsonObject(row.qualification_text),
            weight: Number(row.weight || 0),
            vol: Number(row.vol || 0),
            vehicle_type: row.vehicle_type || "CAR",
            rented: Boolean(row.rented),
            shift_start_time: datetimeApiValue(row.shift_start_time_input),
            shift_off_time: datetimeApiValue(row.shift_off_time_input),
            max_ticket_num: Number(row.max_ticket_num || 0),
            tickets: []
          };
          if (String(row.fuel_type ?? "").trim()) {
            agent.fuel_type = String(row.fuel_type).trim();
          }
          if (row.fuel_consumption !== null && row.fuel_consumption !== undefined && String(row.fuel_consumption).trim() !== "") {
            agent.fuel_consumption = Number(row.fuel_consumption);
          }
          if (row.fix_cost_daily !== null && row.fix_cost_daily !== undefined && String(row.fix_cost_daily).trim() !== "") {
            agent.fix_cost_daily = Number(row.fix_cost_daily);
          }
          return agent;
        }),
      skus: safeArray(plan.skus)
        .filter((row) => row.id || row.name)
        .map((row) => ({
          id: row.id || "",
          name: row.name || "",
          weight: Number(row.weight || 0),
          vol: Number(row.vol || 0)
        })),
      tickets: safeArray(plan.tickets)
        .filter((row) => row.id || row.address || row.city || row.loc?.location || row.loc?.loc)
        .map((row) => ({
          id: row.id || "",
          depo_id: row.depo_id || "",
          pinned: Boolean(row.pinned),
          type: row.type || "Delv",
          status: "New",
          skills_required: splitTags(row.skills_text),
          qualification_levels_required: parseJsonObject(row.qualification_text),
          dep_tickets: splitTags(row.dep_ticket_ids_text),
          ref_tickets: splitTags(row.ref_ticket_ids_text),
          items: normalizeTicketItems(row.items),
          weight: Number(row.weight || 0),
          vol: Number(row.vol || 0),
          loc: buildRawPoi(row.address, row.city || scenario.city_hint, row.loc),
          create_time: datetimeApiValue(row.create_time_input),
          min_start_time: datetimeApiValue(row.min_start_time_input),
          max_end_time: datetimeApiValue(row.max_end_time_input),
          duration: `PT${Math.max(0, Number(row.duration_minutes || 0))}M`,
          agent: row.agent || null,
          arrival_time: row.arrival_time || null
        })),
      matrix: plan.matrix || null,
      cost_parameter: { ...(plan.cost_parameter || {}) },
      constraint_configuration: { ...(plan.constraint_configuration || {}) },
      score: plan.score || null,
      score_explanation: plan.score_explanation || null
    }
  };

  payload.plan.agents.forEach((agent) => {
    const assignedTicketIds = payload.plan.tickets
      .filter((ticket) => ticket.agent === agent.id)
      .map((ticket) => ticket.id);
    agent.tickets = assignedTicketIds;
  });

  return payload;
}

export function parseJsonObject(text) {
  if (!text || !String(text).trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

export function durationToMinutes(duration) {
  if (!duration || typeof duration !== "string") {
    return 0;
  }
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) {
    return 0;
  }
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return (hours * 60) + minutes + Math.round(seconds / 60);
}

export function nonVirtualAgents(job) {
  return safeArray(job?.plan?.agents).filter((agent) => !agent.is_virtual && !agent.virtual);
}

function hydrateJobPoiReference(value, poiIndex) {
  const resolved = resolvePoiReference(value, poiIndex);
  if (!resolved) {
    return null;
  }
  return canonicalizePoi(resolved);
}

function hydrateJobTicket(ticket, poiIndex) {
  if (!ticket || typeof ticket !== "object") {
    return ticket;
  }
  return {
    ...ticket,
    loc: hydrateJobPoiReference(ticket.loc, poiIndex)
  };
}

function hydrateRoutePoint(point) {
  if (!point || typeof point !== "object") {
    return null;
  }
  if (typeof point.lon === "number" && typeof point.lat === "number") {
    return [point.lat, point.lon];
  }
  if (typeof point.lng === "number" && typeof point.lat === "number") {
    return [point.lng, point.lat];
  }
  return null;
}

function hydrateAgentRoute(route) {
  if (!route || typeof route !== "object") {
    return route;
  }
  return {
    ...route,
    polyline: safeArray(route.polyline)
      .map(hydrateRoutePoint)
      .filter(Boolean)
  };
}

export function hydrateJob(job) {
  if (!job?.plan) {
    return job;
  }

  const normalizedPois = safeArray(job.plan.pois).map((poi) => canonicalizePoi(poi));
  const poiIndex = buildPoiIndex(normalizedPois);
  const normalizedTickets = safeArray(job.plan.tickets).map((ticket) => hydrateJobTicket(ticket, poiIndex));
  const ticketsById = new Map(normalizedTickets.map((ticket) => [ticket.id, ticket]));

  return {
    ...job,
    plan: {
      ...job.plan,
      pois: normalizedPois,
      depos: safeArray(job.plan.depos).map((depot) => ({
        ...depot,
        loc: hydrateJobPoiReference(depot?.loc, poiIndex)
      })),
      tickets: normalizedTickets,
      agents: safeArray(job.plan.agents).map((agent) => ({
        ...agent,
        start_loc: hydrateJobPoiReference(agent?.start_loc, poiIndex),
        routes: safeArray(agent?.routes).map(hydrateAgentRoute),
        tickets: safeArray(agent.tickets)
          .map((ticket) => {
            if (typeof ticket === "string") {
              return ticketsById.get(ticket) || null;
            }
            if (ticket?.id && ticketsById.has(ticket.id)) {
              return ticketsById.get(ticket.id);
            }
            return hydrateJobTicket(ticket, poiIndex);
          })
          .filter(Boolean)
      }))
    }
  };
}

export function parseLocationString(location) {
  if (!location || typeof location !== "string" || !location.includes(",")) {
    return null;
  }
  const [lng, lat] = location.split(",").map((item) => Number(item));
  if (Number.isNaN(lng) || Number.isNaN(lat)) {
    return null;
  }
  return [lng, lat];
}

export function parseApiDateTime(value) {
  if (!value) {
    return null;
  }
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildAgentTimeline(agent) {
  const stops = [];
  const startPosition = parseLocationString(agent?.start_loc?.location);
  const tickets = safeArray(agent?.tickets || []);
  if (startPosition && agent?.shift_start_time) {
    stops.push({
      type: "start",
      label: "始发",
      time: agent.shift_start_time,
      departure_time: agent.shift_start_time,
      position: startPosition
    });
  }

  tickets.forEach((ticket) => {
    const position = parseLocationString(ticket?.loc?.location);
    if (!position) {
      return;
    }
    stops.push({
      type: "ticket",
      ticket_id: ticket.id,
      label: ticket.id,
      time: ticket.arrival_time,
      departure_time: ticket.departure_time || ticket.arrival_time,
      position,
      ticket
    });
  });

  if (startPosition && agent?.tickets_done_time) {
    stops.push({
      type: "return",
      label: "返仓",
      time: agent.tickets_done_time,
      departure_time: agent.tickets_done_time,
      position: startPosition
    });
  }

  return stops.filter((stop) => stop.time);
}
