"""Read synthetic contract vectors; never import the reference projector.

Golden JSON and patches are authored independently of the code under test.
Large vectors are materialized in memory, never in development data/ or db/.
"""

from copy import deepcopy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "docs/integrations/gateway/fixtures/mcp-result-view"


def read_json(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def patched(value, operations):
    """Apply the fixture subset of JSON Patch: add, replace and remove."""
    result = deepcopy(value)
    for operation in operations:
        path = operation["path"]
        if not path:
            if operation["op"] == "remove":
                raise ValueError("Cannot remove a fixture root")
            result = deepcopy(operation["value"])
            continue
        if not path.startswith("/"):
            raise ValueError("Fixture path must be a JSON Pointer")
        parts = [p.replace("~1", "/").replace("~0", "~") for p in path[1:].split("/")]
        parent = result
        for part in parts[:-1]:
            parent = parent[int(part)] if isinstance(parent, list) else parent[part]
        key = parts[-1]
        if isinstance(parent, list):
            index = len(parent) if key == "-" else int(key)
            if operation["op"] == "add":
                parent.insert(index, deepcopy(operation["value"]))
            elif operation["op"] == "replace":
                parent[index] = deepcopy(operation["value"])
            elif operation["op"] == "remove":
                parent.pop(index)
            else:
                raise ValueError("Unsupported fixture patch operation")
        elif operation["op"] in {"add", "replace"}:
            if operation["op"] == "replace" and key not in parent:
                raise KeyError(path)
            parent[key] = deepcopy(operation["value"])
        elif operation["op"] == "remove":
            del parent[key]
        else:
            raise ValueError("Unsupported fixture patch operation")
    return result


def cases():
    source = read_json("base-source.json")
    expected = read_json("base-expected.json")
    gantt_expected = read_json("gantt-expected.json")
    for case in read_json("cases.json"):
        map_expected = None if case.get("expected_null") else patched(expected, case.get("expected_patch", []))
        if map_expected is not None and map_expected["solver_job"]["plan"]["pois"] is not None:
            plan = map_expected["solver_job"]["plan"]
            referenced = {agent.get("start_loc") for agent in plan["agents"] or []}
            referenced.update(ticket.get("loc") for ticket in plan["tickets"] or [])
            plan["pois"] = [poi for poi in plan["pois"] if poi["id"] in referenced]
        yield {
            **case,
            "gateway_job_id": case.get("gateway_job_id", expected["solver_job"]["id"]),
            "source": patched(source, case.get("source_patch", [])),
            "expected": map_expected,
            "profiles": {
                "map": {"engine_view": map_expected, "diagnostics": case["diagnostics"]},
                "gantt": gantt_expected[case["name"]],
            },
        }


def large_source(recipe=None):
    """Deterministic synthetic input, with intentionally non-lexical ticket order."""
    recipe = recipe or read_json("large-recipe.json")
    source = read_json("base-source.json")
    template_agent = source["plan"]["agents"][0]
    template_ticket = source["plan"]["tickets"][0]
    source["plan"] = {"agents": [], "tickets": [], "pois": []}
    plan = source["plan"]
    for i in range(recipe["engineer_count"]):
        agent_id = f"synthetic-engineer-{i:03d}-260917"
        positions = [(round(110 + i / 1000 + j / 10000, 6), round(30 + j / 10000, 6))
                     for j in range(recipe["tickets_per_engineer"] + 1)]
        poi_ids = [f"synthetic-poi-{i:03d}-{j}" for j in range(len(positions))]
        for poi_id, (lng, lat) in zip(poi_ids, positions):
            plan["pois"].append({"id": poi_id, "name": "合成位置", "address": "测试地址，非业务数据", "location": f"{lng},{lat}"})
        agent = deepcopy(template_agent)
        agent.update(id=agent_id, name=f"合成工程师 {i}", start_loc=poi_ids[0], tickets=[], routes=[], tickets_done_time="2026-09-17 10:00:00")
        for j in range(recipe["tickets_per_engineer"]):
            ticket_id = f"synthetic-ticket-{i:03d}-{recipe['tickets_per_engineer'] - j}"
            ticket = deepcopy(template_ticket)
            # Fixed recipe uses five ten-minute service blocks, each preceded by travel.
            minute = 10 + j * 20
            arrival = f"2026-09-17 {8 + minute // 60:02d}:{minute % 60:02d}:00"
            minute += 10
            departure = f"2026-09-17 {8 + minute // 60:02d}:{minute % 60:02d}:00"
            ticket.update(id=ticket_id, agent=agent_id, loc=poi_ids[j + 1], arrival_time=arrival,
                          min_start_time=arrival, start_service_time=arrival, departure_time=departure,
                          max_end_time="2026-09-17 18:00:00", duration="PT10M")
            plan["tickets"].append(ticket)
            agent["tickets"].append(ticket_id)
        stops = positions + [positions[0]]
        for leg in range(len(stops) - 1):
            origin, destination = stops[leg:leg + 2]
            size = recipe["dense_polyline_points"] if i == 0 and leg == 0 else 3
            polyline = [{"lat": round(origin[0] + (destination[0] - origin[0]) * n / (size - 1), 9),
                         "lon": round(origin[1] + (destination[1] - origin[1]) * n / (size - 1), 9)}
                        for n in range(size)]
            agent["routes"].append({"origin": {"lat": origin[0], "lon": origin[1]},
                                    "destination": {"lat": destination[0], "lon": destination[1]},
                                    "polyline": polyline, "route_source": "AMAP_DRIVING",
                                    "transit": {"distance": 100, "duration": 600}})
        plan["agents"].append(agent)
    return source


def large_expected(recipe=None):
    """Expected identity mapping of the already-whitelisted synthetic plan.

    Deliberately do not filter fields or call the code under test.  Root values
    and Gateway identity come from the independently authored golden baseline;
    every generated plan field must survive unchanged, including all points.
    """
    expected = read_json("base-expected.json")
    expected["solver_job"]["plan"] = large_source(recipe)["plan"]
    return expected


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--list", action="store_true", help="List independently authored golden cases")
    mode.add_argument("--case", help="Print a fully materialized input/golden/assertion vector")
    mode.add_argument("--large", action="store_true", help="Print the deterministic large source and expected invariants")
    arguments = parser.parse_args()
    if arguments.list:
        output = [case["name"] for case in read_json("cases.json")]
    elif arguments.large:
        output = {"source": large_source(), "expected": {"engine_view": large_expected(), "diagnostics": []},
                  "expected_invariants": read_json("large-recipe.json")["expected"]}
    else:
        selected = next((case for case in cases() if case["name"] == arguments.case), None)
        if selected is None:
            parser.error("Unknown case; use --list")
        output = {"name": selected["name"], "gateway_job_id": selected["gateway_job_id"],
                  "source": selected["source"],
                  "expected": {"engine_view": selected["expected"], "diagnostics": selected["diagnostics"],
                               "analysis": selected["analysis"], "required_reasons": selected.get("required_reasons", {})}}
    print(json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False))
