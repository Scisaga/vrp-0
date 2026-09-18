"""Gateway import files and documentation must keep separate locations."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "skills/vrp0-metadata/scripts/create_vrp0_metadata.py"
IMPORT_FILES = {"image-version.yaml", "result-summary-schema.json", "constraint-config.yaml"}


class GatewayMetadataLayoutTest(unittest.TestCase):
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
                self.assertTrue((workdir / "docs/integrations/gateway/request-schema.json").is_file())


if __name__ == "__main__":
    unittest.main()
