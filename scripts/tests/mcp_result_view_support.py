"""TEST-ONLY reference projection for the MCP result-view contract.

This module has no production callers and never loads a domain object, contacts
a service, or computes a missing solver result.  ``project`` consumes archived
JSON; ``analyze`` derives test assertions without adding fields to the wire model.
Keep golden fixture expectations independent of this implementation.
"""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any


MAX_SAFE_INTEGER = 2**53 - 1
MAX_JAVA_DURATION_SECONDS = 2**63 - 1
JOB_STATUSES = {
    "SOLVING_SCHEDULED", "SOLVING_ACTIVE", "NOT_SOLVING", "SOLVING_FINISHED", "ERROR"
}
TICKET_TYPES = {"Delv", "Delv_BH", "Inst"}
TICKET_STATUSES = {"New", "Assigned", "Accepted", "Transit", "Working", "Agent_Done", "Done"}
ROAD_SOURCES = {
    "AMAP_TRUCK", "AMAP_DRIVING", "AMAP_BICYCLE",
    "HERE_TRUCK", "HERE_DRIVING", "HERE_BICYCLE", "CAR_FALLBACK",
}
ROUTE_SOURCES = ROAD_SOURCES | {"ESTIMATED", "ZERO_DISTANCE"}
TIME_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\Z")
DATE_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}\Z")
COORDINATE_NUMBER_PATTERN = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")
DURATION_PATTERN = re.compile(
    r"P(?:([0-9]+)D)?(?:T(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+(?:\.[0-9]{1,9})?)S)?)?\Z"
)
REASON_ORDER = (
    "virtual_or_unknown_engineer", "unknown_assignment", "no_tickets",
    "missing_ticket", "inconsistent_assignment", "invalid_schedule_time",
    "non_monotonic_schedule", "missing_location", "missing_routes",
    "route_count_mismatch", "invalid_route_geometry", "route_endpoint_mismatch",
    "unsupported_route_source",
)


def _identity(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not TIME_PATTERN.fullmatch(value):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def _date(value: Any) -> bool:
    if not isinstance(value, str) or not DATE_PATTERN.fullmatch(value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def _duration(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    match = DURATION_PATTERN.fullmatch(value)
    if not match or not any(part is not None for part in match.groups()):
        return False
    if "T" in value and not any(part is not None for part in match.groups()[1:]):
        return False
    # Duration stays a string: Java's long seconds range, not JavaScript's
    # Number range, is relevant.  Integer arithmetic avoids Decimal context
    # rounding at Long.MAX_VALUE when fractional nanoseconds are present.
    seconds = 0
    for part, multiplier in zip(match.groups(), (86400, 3600, 60, 1)):
        integer = (part or "0").split(".", 1)[0].lstrip("0") or "0"
        if len(integer) > 19:
            return False
        seconds += int(integer) * multiplier
        if seconds > MAX_JAVA_DURATION_SECONDS:
            return False
    return True


def _number(value: Any) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _coordinate(lng: Any, lat: Any) -> tuple[float, float] | None:
    if not _number(lng) or not _number(lat):
        return None
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        return None
    return float(lng), float(lat)


def _poi_coordinate(value: Any) -> tuple[float, float] | None:
    if not isinstance(value, str) or len(value.split(",")) != 2:
        return None
    parts = [part.strip() for part in value.split(",")]
    # Python float also accepts underscores and non-ASCII digits, unlike the
    # intended Java/browser consumers.  Keep the wire vocabulary portable.
    if not all(COORDINATE_NUMBER_PATTERN.fullmatch(part) for part in parts):
        return None
    try:
        return _coordinate(*(float(part) for part in parts))
    except (ValueError, OverflowError):
        return None


def _route_coordinate(value: Any) -> tuple[float, float] | None:
    if not isinstance(value, dict):
        return None
    # Historical raw LOC serializes longitude in `lat`, latitude in `lon`.
    return _coordinate(value.get("lat"), value.get("lon"))


def _same_point(first: tuple[float, float], second: tuple[float, float]) -> bool:
    return all(abs(left - right) <= 0.000001 for left, right in zip(first, second))


class _Projection:
    def __init__(self) -> None:
        self.diagnostics: list[dict[str, str]] = []
        self.diagnostic_keys: set[tuple[str, str]] = set()
        self.fatal = False
        self.pois: dict[str, dict[str, Any]] = {}
        self.inline_pois_found = False
        self.references: list[tuple[str, str, str]] = []

    def diagnostic(self, code: str, path: str, *, fatal: bool = False) -> None:
        item = {"code": code, "path": path}
        if (code, path) not in self.diagnostic_keys:
            self.diagnostics.append(item)
            self.diagnostic_keys.add((code, path))
        self.fatal = self.fatal or fatal

    def scalar(self, source: dict[str, Any], key: str, path: str, kind: str = "string") -> Any:
        value = source.get(key)
        if value is None:
            return None
        item_path = f"{path}/{key}"
        if kind == "boolean":
            if isinstance(value, bool):
                return value
            self.diagnostic("invalid_type", item_path)
            return None
        if not isinstance(value, str):
            self.diagnostic("invalid_type", item_path)
            return None
        valid = True
        code = "invalid_value"
        if kind == "time":
            valid, code = _time(value) is not None, "invalid_time"
        elif kind == "date":
            valid, code = _date(value), "invalid_time"
        elif kind == "duration":
            valid = _duration(value)
        elif kind == "job_status":
            valid = value in JOB_STATUSES
        elif kind == "ticket_type":
            valid = value in TICKET_TYPES
        elif kind == "ticket_status":
            valid = value in TICKET_STATUSES
        elif kind == "route_source":
            valid = value in ROUTE_SOURCES
        elif kind == "location":
            valid, code = _poi_coordinate(value) is not None, "invalid_coordinate"
        if not valid:
            self.diagnostic(code, item_path)
            return None
        return value

    def entity_id(self, source: Any, path: str) -> str | None:
        value = source.get("id") if isinstance(source, dict) else None
        if not _identity(value):
            self.diagnostic("missing_entity_id", f"{path}/id", fatal=True)
            return None
        return value

    def collection(self, source: dict[str, Any], key: str, path: str) -> list[Any] | None:
        value = source.get(key)
        if value is None:
            return None
        if not isinstance(value, list):
            self.diagnostic("invalid_type", f"{path}/{key}")
            return None
        return value

    def poi(self, source: Any, path: str, *, inline: bool = False) -> str | None:
        entity_id = self.entity_id(source, path)
        if entity_id is None:
            return None
        projected = {"id": entity_id}
        for key in ("name", "address", "location"):
            projected[key] = self.scalar(source, key, path, "location" if key == "location" else "string")
        if inline:
            self.inline_pois_found = True
        previous = self.pois.get(entity_id)
        if previous is None:
            self.pois[entity_id] = projected
            return entity_id
        for key in ("name", "address", "location"):
            old, new = previous[key], projected[key]
            if old is not None and new is not None and old != new:
                self.diagnostic("conflicting_poi", f"{path}/{key}", fatal=True)
            elif old is None and new is not None:
                previous[key] = new
        return entity_id

    def reference(self, value: Any, path: str, kind: str) -> str | None:
        if value is None:
            return None
        if kind == "poi" and isinstance(value, dict):
            entity_id = self.poi(value, path, inline=True)
        elif _identity(value):
            entity_id = value
        else:
            # Only an actual null/omitted owner means unassigned.  Turning an
            # invalid non-null owner into null would fabricate that conclusion.
            self.diagnostic(
                "invalid_type" if not isinstance(value, str) else "invalid_value",
                path,
                fatal=kind == "agent",
            )
            return None
        if entity_id is not None:
            self.references.append((kind, entity_id, path))
        return entity_id

    def point(self, value: Any, path: str) -> dict[str, Any] | None:
        if value is None:
            return None
        if _route_coordinate(value) is None:
            self.diagnostic("invalid_coordinate", path)
            return None
        return {"lat": value["lat"], "lon": value["lon"]}

    def transit(self, value: Any, path: str) -> dict[str, Any] | None:
        if value is None:
            return None
        if not isinstance(value, dict):
            self.diagnostic("invalid_type", path)
            return None
        result: dict[str, Any] = {}
        for key in ("distance", "duration"):
            number = value.get(key)
            if number is None:
                result[key] = None
            elif type(number) is int and 0 <= number <= MAX_SAFE_INTEGER:
                result[key] = number
            else:
                result[key] = None
                self.diagnostic("invalid_transit", f"{path}/{key}")
        return result

    def route(self, source: Any, path: str) -> dict[str, Any] | None:
        if source is None:
            return None
        if not isinstance(source, dict):
            self.diagnostic("invalid_type", path)
            return None
        polyline = self.collection(source, "polyline", path)
        projected_line = None
        if polyline is not None:
            projected_line = []
            valid = True
            for index, point in enumerate(polyline):
                if _route_coordinate(point) is None:
                    self.diagnostic("invalid_coordinate", f"{path}/polyline/{index}")
                    valid = False
                else:
                    projected_line.append({"lat": point["lat"], "lon": point["lon"]})
            if not valid:
                projected_line = None
        return {
            "origin": self.point(source.get("origin"), f"{path}/origin"),
            "destination": self.point(source.get("destination"), f"{path}/destination"),
            "polyline": projected_line,
            "route_source": self.scalar(source, "route_source", path, "route_source"),
            "transit": self.transit(source.get("transit"), f"{path}/transit"),
        }

    def agent(self, source: dict[str, Any], path: str) -> dict[str, Any]:
        result = {"id": source["id"]}
        for key, kind in (
            ("name", "string"), ("date", "date"), ("virtual", "boolean"),
            ("shift_start_time", "time"), ("shift_off_time", "time"),
            ("tickets_done_time", "time"),
        ):
            result[key] = self.scalar(source, key, path, kind)
        result["start_loc"] = self.reference(source.get("start_loc"), f"{path}/start_loc", "poi")
        tickets = self.collection(source, "tickets", path)
        result["tickets"] = None
        if tickets is not None:
            valid = True
            for index, ticket in enumerate(tickets):
                if not _identity(ticket):
                    self.diagnostic("invalid_value", f"{path}/tickets/{index}")
                    valid = False
            # A partially valid assignment list must not become a shorter route.
            if valid:
                result["tickets"] = [
                    self.reference(ticket, f"{path}/tickets/{index}", "ticket")
                    for index, ticket in enumerate(tickets)
                ]
        routes = self.collection(source, "routes", path)
        result["routes"] = None if routes is None else [
            self.route(route, f"{path}/routes/{index}") for index, route in enumerate(routes)
        ]
        return result

    def ticket(self, source: dict[str, Any], path: str) -> dict[str, Any]:
        result = {"id": source["id"]}
        for key, kind in (("type", "ticket_type"), ("status", "ticket_status")):
            result[key] = self.scalar(source, key, path, kind)
        result["agent"] = self.reference(source.get("agent"), f"{path}/agent", "agent")
        result["loc"] = self.reference(source.get("loc"), f"{path}/loc", "poi")
        for key in ("min_start_time", "max_end_time", "arrival_time", "start_service_time", "departure_time"):
            result[key] = self.scalar(source, key, path, "time")
        result["duration"] = self.scalar(source, "duration", path, "duration")
        return result

    def entities(self, values: list[Any] | None, kind: str) -> list[dict[str, Any]] | None:
        if values is None:
            return None
        result = []
        seen: set[str] = set()
        for index, source in enumerate(values):
            path = f"/plan/{kind}s/{index}"
            entity_id = self.entity_id(source, path)
            if entity_id is None:
                continue
            if entity_id in seen:
                self.diagnostic("duplicate_entity_id", f"{path}/id", fatal=True)
                continue
            seen.add(entity_id)
            if kind == "poi":
                self.poi(source, path)
            else:
                result.append(getattr(self, kind)(source, path))
        return result


def project(source: Any, gateway_job_id: Any) -> dict[str, Any]:
    """Return a strict, non-mutating test projection and JSON-Pointer diagnostics.

    Invalid identities, conflicting POIs, and invalid non-null ticket owners
    reject the whole model.  Other invalid/missing values become null; routes
    keep their indices and an invalid assignment list becomes wholly unknown.
    Diagnostics refer to raw source fields (``/id`` for the supplied Gateway ID).
    """
    state = _Projection()
    if not isinstance(source, dict):
        state.diagnostic("invalid_source", "", fatal=True)
    if not _identity(gateway_job_id):
        state.diagnostic("invalid_gateway_job_id", "/id", fatal=True)
    if isinstance(source, dict) and not isinstance(source.get("plan"), dict):
        state.diagnostic("missing_plan", "/plan", fatal=True)
    if state.fatal:
        return {"engine_view": None, "diagnostics": sorted(state.diagnostics, key=lambda item: (item["path"], item["code"]))}

    job: dict[str, Any] = {"id": gateway_job_id}
    for key, kind in (
        ("name", "string"), ("status", "job_status"),
        ("start_date_time", "time"), ("end_date_time", "time"),
    ):
        job[key] = state.scalar(source, key, "", kind)
    source_plan = source["plan"]
    raw_pois = state.collection(source_plan, "pois", "/plan")
    raw_agents = state.collection(source_plan, "agents", "/plan")
    raw_tickets = state.collection(source_plan, "tickets", "/plan")
    state.entities(raw_pois, "poi")
    agents = state.entities(raw_agents, "agent")
    tickets = state.entities(raw_tickets, "ticket")
    pois = list(state.pois.values()) if raw_pois is not None or state.inline_pois_found else None
    job["plan"] = {"agents": agents, "tickets": tickets, "pois": pois}
    indexes = {
        "agent": {item["id"] for item in agents or []},
        "ticket": {item["id"] for item in tickets or []},
        "poi": set(state.pois),
    }
    if not state.fatal:
        for kind, entity_id, path in state.references:
            if entity_id not in indexes[kind]:
                state.diagnostic("unknown_reference", path)
    engine_view = None if state.fatal else {
        "kind": "vrp0", "schema_version": 2, "display_model": "vrp0_solver_job", "solver_job": job
    }
    return {
        "engine_view": engine_view,
        "diagnostics": sorted(state.diagnostics, key=lambda item: (item["path"], item["code"])),
    }


def _entity_index(values: Any) -> dict[str, dict[str, Any]] | None:
    if not isinstance(values, list):
        return None
    index: dict[str, dict[str, Any]] = {}
    for item in values:
        if not isinstance(item, dict) or not _identity(item.get("id")) or item["id"] in index:
            return None
        index[item["id"]] = item
    return index


def _ownership(agents: dict[str, Any] | None, tickets: dict[str, Any] | None) -> tuple[bool, dict[str, list[str]]]:
    memberships: dict[str, list[str]] = {}
    if agents is None or tickets is None:
        return False, memberships
    reliable = True
    for agent_id, agent in agents.items():
        if type(agent.get("virtual")) is not bool:
            reliable = False
        listed = agent.get("tickets")
        if not isinstance(listed, list):
            reliable = False
            continue
        for ticket_id in listed:
            if not _identity(ticket_id):
                reliable = False
                continue
            memberships.setdefault(ticket_id, []).append(agent_id)
            if ticket_id not in tickets or tickets[ticket_id].get("agent") != agent_id:
                reliable = False
    for ticket_id, ticket in tickets.items():
        owner = ticket.get("agent")
        actual = memberships.get(ticket_id, [])
        if owner is None:
            reliable = reliable and not actual
        elif not _identity(owner) or owner not in agents or actual != [owner]:
            reliable = False
    return reliable, memberships


def _route_reasons(route: Any, origin: tuple[float, float], destination: tuple[float, float]) -> set[str]:
    if not isinstance(route, dict):
        return {"invalid_route_geometry"}
    reasons: set[str] = set()
    start = _route_coordinate(route.get("origin"))
    end = _route_coordinate(route.get("destination"))
    if start is None or end is None:
        reasons.add("invalid_route_geometry")
    elif not _same_point(start, origin) or not _same_point(end, destination):
        reasons.add("route_endpoint_mismatch")
    source = route.get("route_source")
    line = route.get("polyline")
    if source == "ZERO_DISTANCE":
        transit = route.get("transit")
        if not isinstance(transit, dict) or any(
            type(transit.get(key)) is not int or transit[key] != 0
            for key in ("distance", "duration")
        ):
            reasons.add("invalid_route_geometry")
        if not _same_point(origin, destination):
            reasons.add("route_endpoint_mismatch")
        if line is not None:
            if not isinstance(line, list):
                reasons.add("invalid_route_geometry")
            else:
                for point in line:
                    position = _route_coordinate(point)
                    if position is None or not _same_point(position, origin):
                        reasons.add("invalid_route_geometry")
    else:
        if source not in ROAD_SOURCES:
            reasons.add("unsupported_route_source")
        if not isinstance(line, list) or len(line) < 2:
            reasons.add("invalid_route_geometry")
        else:
            positions = [_route_coordinate(point) for point in line]
            if any(point is None for point in positions):
                reasons.add("invalid_route_geometry")
            elif not _same_point(origin, destination) and not any(
                left != right for left, right in zip(positions, positions[1:])
            ):
                reasons.add("invalid_route_geometry")
            # Providers may snap road geometry away from the business POI.
            # Route endpoints above establish the leg identity; interpolation
            # stays on the supplied polyline, without adding connector lines.
    return reasons


def _analyze_engineer(
    agent: dict[str, Any], tickets: dict[str, Any] | None,
    pois: dict[str, Any] | None, memberships: dict[str, list[str]],
) -> dict[str, Any]:
    agent_id = agent["id"]
    reasons: set[str] = set()
    if agent.get("virtual") is not False:
        reasons.add("virtual_or_unknown_engineer")
    listed = agent.get("tickets")
    assigned: list[dict[str, Any]] = []
    if not isinstance(listed, list) or tickets is None:
        reasons.add("unknown_assignment")
    else:
        if not listed:
            reasons.add("no_tickets")
        for ticket_id in listed:
            if not _identity(ticket_id) or ticket_id not in tickets:
                reasons.add("missing_ticket")
                continue
            ticket = tickets[ticket_id]
            if ticket.get("agent") != agent_id or memberships.get(ticket_id) != [agent_id]:
                reasons.add("inconsistent_assignment")
            assigned.append(ticket)
        if any(ticket.get("agent") == agent_id and ticket_id not in listed for ticket_id, ticket in tickets.items()):
            reasons.add("inconsistent_assignment")

    start = _time(agent.get("shift_start_time"))
    previous = start
    end = None
    if assigned:
        if start is None:
            reasons.add("invalid_schedule_time")
        for ticket in assigned:
            arrival = _time(ticket.get("arrival_time"))
            service = _time(ticket.get("start_service_time"))
            departure = _time(ticket.get("departure_time"))
            if arrival is None or service is None or departure is None:
                reasons.add("invalid_schedule_time")
            elif not (arrival <= service <= departure) or (previous is not None and arrival < previous):
                reasons.add("non_monotonic_schedule")
            previous = departure
            end = departure

    if assigned:
        stops = []
        for poi_id in [agent.get("start_loc")] + [ticket.get("loc") for ticket in assigned]:
            poi = pois.get(poi_id) if pois is not None and _identity(poi_id) else None
            point = _poi_coordinate(poi.get("location")) if isinstance(poi, dict) else None
            if point is None:
                reasons.add("missing_location")
            stops.append(point)
        routes = agent.get("routes")
        if not isinstance(routes, list):
            reasons.add("missing_routes")
        elif not isinstance(listed, list) or len(routes) != len(listed) + 1:
            reasons.add("route_count_mismatch")
        elif len(assigned) == len(listed) and all(point is not None for point in stops):
            # Never drop/reindex bad routes.  The final return slot must exist,
            # but is intentionally not played or required to have geometry.
            for index in range(len(assigned)):
                reasons.update(_route_reasons(routes[index], stops[index], stops[index + 1]))

    eligible = not reasons and bool(assigned) and start is not None and end is not None
    return {
        "id": agent_id,
        "replay_eligible": eligible,
        "reasons": [reason for reason in REASON_ORDER if reason in reasons],
        "replay_start": start.isoformat(sep=" ", timespec="seconds") if eligible else None,
        "replay_end": end.isoformat(sep=" ", timespec="seconds") if eligible else None,
    }


def analyze(engine_view: Any) -> dict[str, Any]:
    """Derive conservative counts and replay eligibility from a canonical view.

    Counts require complete engineer/ticket identity and two-way ownership;
    location or route availability does not affect counts.  Virtual assignments
    count as unassigned, and unknown virtual flags make all counts unknown.
    """
    result: dict[str, Any] = {
        "counts": {"engineer_schedule_count": None, "assigned_ticket_count": None, "unassigned_ticket_count": None},
        "engineers": [], "replay": {"start": None, "end": None},
    }
    if not isinstance(engine_view, dict):
        return result
    job = engine_view.get("solver_job")
    plan = job.get("plan") if isinstance(job, dict) else None
    if not isinstance(plan, dict):
        return result
    agents = _entity_index(plan.get("agents"))
    tickets = _entity_index(plan.get("tickets"))
    pois = _entity_index(plan.get("pois"))
    reliable, memberships = _ownership(agents, tickets)
    if reliable:
        real = {agent_id for agent_id, agent in agents.items() if agent.get("virtual") is False}
        assigned = sum(ticket.get("agent") in real for ticket in tickets.values())
        result["counts"] = {
            "engineer_schedule_count": len(real),
            "assigned_ticket_count": assigned,
            "unassigned_ticket_count": len(tickets) - assigned,
        }
    if agents is not None:
        result["engineers"] = [
            _analyze_engineer(agent, tickets, pois, memberships) for agent in agents.values()
        ]
    eligible = [agent for agent in result["engineers"] if agent["replay_eligible"]]
    if eligible:
        result["replay"] = {
            "start": min(agent["replay_start"] for agent in eligible),
            "end": max(agent["replay_end"] for agent in eligible),
        }
    return result
