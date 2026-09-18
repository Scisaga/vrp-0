"""Offline design-contract tests, not Gateway or MCP Apps integration tests."""

from copy import deepcopy
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import unittest

from jsonschema import Draft202012Validator

from mcp_result_view_fixtures import ROOT, cases, large_expected, large_source, patched, read_json
from mcp_result_view_support import analyze, project


SCHEMA = json.loads((ROOT / "docs/integrations/gateway/mcp-result-view-schema.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA)
JOB_ID = read_json("base-expected.json")["solver_job"]["id"]
AGENT_ID = read_json("base-source.json")["plan"]["agents"][0]["id"]


def nodes(value, path=""):
    yield path, value
    if isinstance(value, dict):
        for key, child in value.items():
            escaped = key.replace("~", "~0").replace("/", "~1")
            yield from nodes(child, f"{path}/{escaped}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from nodes(child, f"{path}/{index}")


class ContractTests(unittest.TestCase):
    def assert_subset(self, actual, expected, path=""):
        if isinstance(expected, dict):
            self.assertIsInstance(actual, dict, path)
            for key, value in expected.items():
                self.assertIn(key, actual, path)
                self.assert_subset(actual[key], value, f"{path}/{key}")
        elif isinstance(expected, list):
            self.assertIsInstance(actual, list, path)
            self.assertEqual(len(actual), len(expected), path)
            for index, value in enumerate(expected):
                self.assert_subset(actual[index], value, f"{path}/{index}")
        else:
            self.assertEqual(actual, expected, path)

    def test_schema_is_draft_2020_12_and_objects_are_closed(self):
        Draft202012Validator.check_schema(SCHEMA)
        self.assertEqual(SCHEMA["$schema"], "https://json-schema.org/draft/2020-12/schema")
        for path, node in nodes(SCHEMA):
            if isinstance(node, dict) and node.get("type") == "object":
                self.assertIs(node.get("additionalProperties"), False, path)
                self.assertEqual(set(node["properties"]), set(node["required"]), path)

    def test_golden_mapping_and_semantic_vectors(self):
        names = set()
        for case in cases():
            with self.subTest(case=case["name"]):
                self.assertNotIn(case["name"], names)
                names.add(case["name"])
                original = deepcopy(case["source"])
                result = project(case["source"], case["gateway_job_id"])
                self.assertEqual(case["source"], original, "Projection mutated archive JSON")
                self.assertEqual(result["engine_view"], case["expected"])
                if not case["diagnostics"]:
                    self.assertEqual(result["diagnostics"], [])
                for required in case["diagnostics"]:
                    self.assertTrue(any(all(item.get(k) == v for k, v in required.items())
                                        for item in result["diagnostics"]),
                                    f"Missing {required}: {result['diagnostics']}")
                for item in result["diagnostics"]:
                    self.assertEqual(set(item), {"code", "path"})
                    self.assertTrue(item["path"] == "" or item["path"].startswith("/"))
                if case["expected"] is None:
                    continue
                VALIDATOR.validate(result["engine_view"])
                before_analysis = deepcopy(result["engine_view"])
                actual = analyze(result["engine_view"])
                self.assertEqual(result["engine_view"], before_analysis, "Analysis mutated wire model")
                self.assert_subset(actual, case["analysis"])
                agents = {item["id"]: item for item in actual["engineers"]}
                for agent_id, reasons in case.get("required_reasons", {}).items():
                    self.assertTrue(set(reasons).issubset(agents[agent_id]["reasons"]))
        self.assertGreaterEqual(len(names), 40)

    def test_every_golden_object_rejects_unknown_fields(self):
        golden = read_json("base-expected.json")
        for path, node in nodes(golden):
            if isinstance(node, dict):
                with self.subTest(path=path):
                    candidate = patched(golden, [{"op": "add", "path": path + "/unreviewed_field", "value": "must not pass"}])
                    self.assertFalse(VALIDATOR.is_valid(candidate))

    def test_every_golden_object_requires_all_defined_fields(self):
        golden = read_json("base-expected.json")
        for path, node in nodes(golden):
            if isinstance(node, dict):
                for key in node:
                    with self.subTest(path=path, key=key):
                        candidate = patched(golden, [{"op": "remove", "path": path + "/" + key}])
                        self.assertFalse(VALIDATOR.is_valid(candidate))

    def test_wrong_version_kind_and_internal_id_are_not_accepted_as_identity(self):
        golden = read_json("base-expected.json")
        for key, value in (("kind", "other"), ("schema_version", 3), ("display_model", "raw_solver_job")):
            candidate = deepcopy(golden)
            candidate[key] = value
            self.assertFalse(VALIDATOR.is_valid(candidate))
        result = project(read_json("base-source.json"), JOB_ID)
        self.assertEqual(result["engine_view"]["solver_job"]["id"], JOB_ID)
        self.assertNotEqual(result["engine_view"]["solver_job"]["id"], read_json("base-source.json")["id"])
        self.assertFalse(VALIDATOR.is_valid(None), "No model belongs to the envelope, not this root Schema")

    def test_schema_enums_match_current_java_sources(self):
        java = ROOT / "src/main/java/one/rewind/xforce"
        definitions = [("solverStatus", java / "vehicle_routing/solver/Status.java", "Status"),
                       ("ticketType", java / "vehicle_routing/domain/ticket/Ticket.java", "Type"),
                       ("ticketStatus", java / "vehicle_routing/domain/ticket/Ticket.java", "Status"),
                       ("routeSource", java / "geo/RouteSource.java", "RouteSource")]
        for definition, file, name in definitions:
            with self.subTest(enum=definition):
                source = re.sub(r"/\*.*?\*/|//[^\n]*", "", file.read_text(), flags=re.S)
                body = re.search(r"\benum\s+" + name + r"\s*\{([^}]+)\}", source).group(1)
                values = {part.strip().strip(";").strip() for part in body.split(",") if part.strip().strip(";").strip()}
                self.assertEqual(set(SCHEMA["$defs"][definition]["enum"]), values | {None})

    def test_schema_numeric_type_and_duration_boundaries(self):
        golden = read_json("base-expected.json")
        invalid = [
            ("/solver_job/plan/agents/0/routes/0/transit/distance", True),
            ("/solver_job/plan/agents/0/routes/0/transit/distance", -1),
            ("/solver_job/plan/agents/0/routes/0/transit/distance", 1.5),
            ("/solver_job/plan/agents/0/routes/0/transit/distance", 9007199254740992),
            ("/solver_job/plan/agents/0/routes/0/origin/lat", 181),
            ("/solver_job/plan/agents/0/routes/0/origin/lon", 91),
            ("/solver_job/plan/agents/0/routes/0/polyline/1", None),
            ("/solver_job/plan/agents/0/tickets/0", None),
        ]
        for duration in (30, "P", "PT", "P1DT", "P1Y", "P1M", "-PT1S", "PT1.1234567890S", "PT١S", "PT1S\n"):
            invalid.append(("/solver_job/plan/tickets/0/duration", duration))
        for path, value in invalid:
            with self.subTest(path=path, value=value):
                self.assertFalse(VALIDATOR.is_valid(patched(golden, [{"op": "replace", "path": path, "value": value}])))
        for duration in (None, "PT0S", "PT30M", "PT1M30.123456789S", "P1DT2H", "PT0.000000001S"):
            VALIDATOR.validate(patched(golden, [{"op": "replace", "path": "/solver_job/plan/tickets/0/duration", "value": duration}]))

    def test_projection_handles_malformed_scalars_without_throwing(self):
        vectors = [
            ("/plan/tickets/0/arrival_time", "٢٠٢٦-09-17 08:20:00", "invalid_time", "/plan/tickets/0/arrival_time"),
            ("/plan/tickets/0/duration", "PT١S", "invalid_value", "/plan/tickets/0/duration"),
            ("/plan/agents/0/tickets/0", None, "invalid_value", "/plan/agents/0/tickets"),
            ("/plan/agents/0/routes/0/polyline/1/lat", 10**1000, "invalid_coordinate", "/plan/agents/0/routes/0/polyline"),
            ("/plan/agents/0/routes/0/transit/distance", True, "invalid_transit", "/plan/agents/0/routes/0/transit/distance"),
        ]
        for location in ("1_20,30", "١٢٠,٣٠", "１２０,３０", "0x78,30", "NaN,30", "Infinity,30", "1e999,30", ",30", "120,30,0"):
            vectors.append(("/plan/pois/0/location", location, "invalid_coordinate", "/plan/pois/0/location"))
        for path, value, code, unknown_path in vectors:
            with self.subTest(path=path, code=code):
                source = patched(read_json("base-source.json"), [{"op": "replace", "path": path, "value": value}])
                result = project(source, JOB_ID)
                VALIDATOR.validate(result["engine_view"])
                self.assertIn(code, [item["code"] for item in result["diagnostics"]])
                value_at_path = result["engine_view"]["solver_job"]
                for segment in unknown_path[1:].split("/"):
                    value_at_path = value_at_path[int(segment)] if isinstance(value_at_path, list) else value_at_path[segment]
                self.assertIsNone(value_at_path)

    def test_zero_coordinates_and_null_holes_are_not_removed(self):
        source = read_json("base-source.json")
        source["plan"]["pois"][0]["location"] = "0,0"
        source["plan"]["agents"][0]["routes"][1] = None
        result = project(source, JOB_ID)
        VALIDATOR.validate(result["engine_view"])
        job = result["engine_view"]["solver_job"]
        self.assertEqual(job["plan"]["pois"][0]["location"], "0,0")
        self.assertEqual(len(job["plan"]["agents"][0]["routes"]), 3)
        self.assertIsNone(job["plan"]["agents"][0]["routes"][1])
        self.assertFalse(analyze(result["engine_view"])["engineers"][0]["replay_eligible"])

    def test_counts_do_not_depend_on_geography(self):
        source = read_json("base-source.json")
        source["plan"]["pois"] = None
        view = project(source, JOB_ID)["engine_view"]
        VALIDATOR.validate(view)
        report = analyze(view)
        self.assertEqual(report["counts"], {"engineer_schedule_count": 1, "assigned_ticket_count": 2, "unassigned_ticket_count": 0})
        self.assertFalse(report["engineers"][0]["replay_eligible"])

    def test_counting_rejects_duplicate_or_conflicting_assignments(self):
        for mutation in ("duplicate_ticket", "wrong_owner", "unknown_virtual", "missing_tickets"):
            with self.subTest(mutation=mutation):
                view = read_json("base-expected.json")
                agent = view["solver_job"]["plan"]["agents"][0]
                if mutation == "duplicate_ticket":
                    agent["tickets"][1] = agent["tickets"][0]
                elif mutation == "wrong_owner":
                    view["solver_job"]["plan"]["tickets"][0]["agent"] = None
                elif mutation == "unknown_virtual":
                    agent["virtual"] = None
                else:
                    agent["tickets"] = None
                report = analyze(view)
                self.assertTrue(all(value is None for value in report["counts"].values()))
                self.assertFalse(report["engineers"][0]["replay_eligible"])

    def test_legacy_coordinates_remain_wire_compatible(self):
        result = project(read_json("base-source.json"), JOB_ID)["engine_view"]
        point = result["solver_job"]["plan"]["agents"][0]["routes"][0]["origin"]
        self.assertEqual(point, {"lat": 120, "lon": 30})
        self.assertTrue(analyze(result)["engineers"][0]["replay_eligible"])
        reversed_axes = deepcopy(result)
        reversed_axes["solver_job"]["plan"]["agents"][0]["routes"][0]["origin"] = {"lat": 30, "lon": 120}
        self.assertFalse(VALIDATOR.is_valid(reversed_axes))

    def test_timezone_independence_in_separate_processes(self):
        snippet = """import json
from mcp_result_view_fixtures import cases
from mcp_result_view_support import analyze, project
print(json.dumps([analyze(project(c['source'],c['gateway_job_id'])['engine_view']) for c in cases() if not c.get('expected_null')],sort_keys=True,ensure_ascii=False))
"""
        outputs = []
        for zone in ("UTC", "Asia/Shanghai", "America/New_York"):
            env = {**os.environ, "TZ": zone, "PYTHONPATH": str(Path(__file__).parent), "PYTHONDONTWRITEBYTECODE": "1"}
            outputs.append(subprocess.check_output([sys.executable, "-B", "-c", snippet], env=env, cwd=ROOT, timeout=30))
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(outputs[0], outputs[2])

    def test_large_recipe_is_reproducible_and_not_truncated(self):
        recipe = read_json("large-recipe.json")
        source = large_source(recipe)
        self.assertEqual(source, large_source(recipe))
        result = project(source, JOB_ID)
        self.assertEqual(result["diagnostics"], [])
        self.assertEqual(result["engine_view"], large_expected(recipe))
        VALIDATOR.validate(result["engine_view"])
        plan = result["engine_view"]["solver_job"]["plan"]
        expected = recipe["expected"]
        self.assertEqual(len(plan["agents"]), recipe["engineer_count"])
        self.assertEqual(len(plan["tickets"]), expected["assigned_ticket_count"])
        self.assertEqual(len(plan["pois"]), expected["poi_count"])
        self.assertEqual(sum(len(a["routes"]) for a in plan["agents"]), expected["route_count"])
        self.assertEqual(len(plan["agents"][0]["routes"][0]["polyline"]), recipe["dense_polyline_points"])
        for before, after in zip(source["plan"]["agents"], plan["agents"]):
            self.assertEqual(after["tickets"], before["tickets"])
            self.assertEqual(after["routes"], before["routes"])
        report = analyze(result["engine_view"])
        self.assertEqual(report["counts"], {k: expected[k] for k in report["counts"]})
        self.assertEqual(report["replay"], {"start": expected["replay_start"], "end": expected["replay_end"]})
        self.assertTrue(all(a["replay_eligible"] for a in report["engineers"]))

    def test_outer_examples_keep_model_summary_and_drawing_separate(self):
        states = set()
        task_keys = {"job_id", "image_version_id", "image_name", "image_version", "status", "map_provider", "expected_solve_duration", "result_score", "created_at", "started_at", "finished_at", "detail_page_url"}
        envelope_keys = {"contract_version", "job_id", "image_version_id", "display_tool_name", "result_state", "view", "engineer_id", "platform_timezone", "task", "result_summary", "engine_view", "map_context"}
        for sample in read_json("payloads.json"):
            if sample["category"] != "tool-result":
                continue
            with self.subTest(sample=sample["name"]):
                message = sample["message"]
                envelope = message["_meta"]["gateway_ui"]
                self.assertEqual(set(envelope), envelope_keys)
                self.assertEqual(set(envelope["task"]), task_keys)
                self.assertEqual(envelope["contract_version"], "gateway_mcp_result_v1")
                self.assertEqual(envelope["platform_timezone"], "+08:00")
                self.assertEqual(envelope["task"]["job_id"], envelope["job_id"])
                self.assertEqual(envelope["task"]["image_version_id"], envelope["image_version_id"])
                self.assertEqual(envelope["display_tool_name"], "gateway.ui.result_" + envelope["image_version_id"])
                self.assertIsNone(envelope["result_summary"])
                summary = message["structuredContent"]
                self.assertEqual(set(summary), {"contract_version", "job_id", "image_version_id", "status", "view", "engineer_id", "result_summary", "ui_available", "detail_page_url"})
                for key in ("contract_version", "job_id", "image_version_id", "view", "engineer_id", "result_summary"):
                    self.assertEqual(summary[key], envelope[key])
                for key in ("status", "detail_page_url"):
                    self.assertEqual(summary[key], envelope["task"][key])
                self.assertIs(summary["ui_available"], True)
                self.assertEqual(message["content"], [{"type": "text", "text": message["content"][0]["text"]}])
                self.assertEqual(json.loads(message["content"][0]["text"]), summary)
                self.assertEqual(envelope["result_state"], sample["expectation"]["result_state"])
                states.add(envelope["result_state"])
                self.assertEqual(envelope["engine_view"] is not None, sample["expectation"]["has_model"])
                if envelope["engine_view"] is not None:
                    VALIDATOR.validate(envelope["engine_view"])
                    self.assertEqual(envelope["engine_view"]["solver_job"]["id"], envelope["job_id"])
                    if envelope["result_state"] == "running":
                        self.assertFalse(any(a["replay_eligible"] for a in analyze(envelope["engine_view"])["engineers"]))
                model_visible = json.dumps([message["content"], message["structuredContent"]])
                for forbidden in ("polyline", "engine_view", "browser_key", "TEST_ONLY_NOT_A_USABLE_KEY"):
                    self.assertNotIn(forbidden, model_visible)
        self.assertEqual(states, {"ready", "running", "not_ready", "failed", "canceled", "timed_out", "archive_failed"})

    def test_outer_error_examples_are_not_success_envelopes(self):
        categories = set()
        for sample in read_json("payloads.json"):
            category = sample["category"]
            if category == "tool-result":
                continue
            categories.add(category)
            with self.subTest(sample=sample["name"]):
                message = sample["message"]
                self.assertNotIn("gateway_ui", json.dumps(message))
                if category == "tool-error":
                    self.assertTrue(message["isError"])
                    error = message["structuredContent"]
                    self.assertEqual(json.loads(message["content"][0]["text"]), error)
                    self.assertEqual(error["code"], sample["expectation"]["error_code"])
                    if not sample["expectation"]["contains_authorized_tool_hint"]:
                        self.assertNotIn("display_tool_name", json.dumps(error))
                else:
                    self.assertEqual(message["jsonrpc"], "2.0")
                    self.assertEqual(message["error"]["data"]["code"], sample["expectation"]["error_code"])
                    if category == "authentication-error":
                        self.assertEqual(sample["http_status"], 401)
                        self.assertEqual(message["error"]["data"]["_meta"]["mcp/www_authenticate"], [sample["headers"]["WWW-Authenticate"]])
        self.assertEqual(categories, {"tool-error", "resource-error", "authentication-error"})

    def test_fixture_factory_does_not_depend_on_projector(self):
        factory = (ROOT / "scripts/tests/mcp_result_view_fixtures.py").read_text()
        self.assertNotIn("import mcp_result_view_support", factory)
        self.assertNotIn("from mcp_result_view_support", factory)


if __name__ == "__main__":
    unittest.main()
