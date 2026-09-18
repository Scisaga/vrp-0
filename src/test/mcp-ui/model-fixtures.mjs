// Test-only bridge to the existing, independently authored golden vectors.
// Never runs the projector, writes fixtures, or reads development job data.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const prelude = `
import json, sys
sys.path.insert(0, 'scripts/tests')
from mcp_result_view_fixtures import cases, large_expected, read_json
from mcp_result_view_support import analyze
`;

function pythonJSON(script) {
  const result = spawnSync("python3", ["-B", "-c", prelude + script], {
    cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Contract fixture export failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

export function contractCases() {
  return pythonJSON(`
print(json.dumps([{
    'name': case['name'], 'view': case['expected'],
    'golden': case['analysis'], 'requiredReasons': case.get('required_reasons', {}),
    'reference': analyze(case['expected'])
} for case in cases()], ensure_ascii=False, allow_nan=False))
`);
}

export function largeView() {
  return pythonJSON(`
view = large_expected()
print(json.dumps({'view': view, 'reference': analyze(view),
                  'recipe': read_json('large-recipe.json')}, allow_nan=False))
`);
}
