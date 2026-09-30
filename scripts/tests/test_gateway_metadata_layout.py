"""Gateway metadata layout and the generated request contract stay aligned."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "skills/vrp0-metadata/scripts/create_vrp0_metadata.py"
IMPORT_FILES = {"image-version.yaml", "result-summary-schema.json", "constraint-config.yaml"}


def load_generator():
    spec = importlib.util.spec_from_file_location("create_vrp0_metadata", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GatewayMetadataLayoutTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.generator = load_generator()

    def test_repository_layout(self):
        self.assertEqual({p.name for p in (ROOT / "gateway").iterdir()}, IMPORT_FILES)
        references = ROOT / "docs/integrations/gateway"
        for name in ("README.md", "request-schema.json", "mcp-result-view-schema.json", "fixtures"):
            self.assertTrue((references / name).exists(), name)
        for name in IMPORT_FILES:
            self.assertFalse((references / name).exists(), name)

    def test_generator_separates_import_files_and_reference_schema(self):
        for output_dir in (None, "export"):
            with self.subTest(output_dir=output_dir), tempfile.TemporaryDirectory() as temporary:
                workdir = Path(temporary)
                command = [
                    sys.executable, "-B", str(GENERATOR),
                    "--engine-root", str(ROOT), "--require-engine-source",
                    "--image-name", "x-force/vrp-0", "--version", "test-layout",
                ]
                if output_dir:
                    command.extend(["--output-dir", output_dir])
                subprocess.run(command, cwd=workdir, check=True, capture_output=True, text=True)
                metadata = workdir / (output_dir or "gateway")
                self.assertEqual({p.name for p in metadata.iterdir()}, IMPORT_FILES)
                generated_schema = workdir / "docs/integrations/gateway/request-schema.json"
                self.assertTrue(generated_schema.is_file())
                self.assertEqual(
                    json.loads(generated_schema.read_text(encoding="utf-8")),
                    self.generator.request_schema(),
                )

    def test_location_contract_keeps_plan_pois_conditional(self):
        schema = self.generator.request_schema()
        definitions = schema["$defs"]

        self.assertEqual(definitions["routePlan"]["required"], ["depos", "agents", "tickets"])
        self.assertNotIn("pois", definitions["routePlan"]["required"])
        self.assertEqual(definitions["depo"]["required"], ["id", "loc"])
        self.assertEqual(definitions["agent"]["required"], ["id", "start_loc"])
        self.assertEqual(definitions["ticket"]["required"], ["id", "type", "loc"])

        poi_ref_options = definitions["poiRef"]["oneOf"]
        self.assertEqual(len(poi_ref_options), 2)
        self.assertIn({"type": "string", "minLength": 1}, poi_ref_options)
        self.assertIn({"$ref": "#/$defs/poi"}, poi_ref_options)
        self.assertFalse(any(option.get("type") == "null" for option in poi_ref_options))

        for description in (
            definitions["routePlan"]["description"],
            definitions["routePlan"]["properties"]["pois"]["description"],
            definitions["depo"]["properties"]["loc"]["description"],
            definitions["agent"]["properties"]["start_loc"]["description"],
            definitions["ticket"]["properties"]["loc"]["description"],
        ):
            self.assertIn("plan.pois", description)
            self.assertIn("字符串", description)
            self.assertIn("完整", description)
            self.assertIn("不要混用", description)

        for description in (
            definitions["routePlan"]["properties"]["pois"]["description"],
            definitions["depo"]["properties"]["loc"]["description"],
            definitions["agent"]["properties"]["start_loc"]["description"],
            definitions["ticket"]["properties"]["loc"]["description"],
        ):
            self.assertIn("唯一", description)
            self.assertIn("坐标", description)

        example = definitions["routePlan"]["examples"][0]
        poi_ids = {poi["id"] for poi in example["pois"]}
        references = {
            *(depo["loc"] for depo in example["depos"]),
            *(agent["start_loc"] for agent in example["agents"]),
            *(ticket["loc"] for ticket in example["tickets"]),
        }
        self.assertTrue(references)
        self.assertTrue(all(isinstance(reference, str) for reference in references))
        self.assertLessEqual(references, poi_ids)

    def test_reference_request_schema_matches_generator(self):
        reference_schema = json.loads(
            (ROOT / "docs/integrations/gateway/request-schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual(reference_schema, self.generator.request_schema())


if __name__ == "__main__":
    unittest.main()
