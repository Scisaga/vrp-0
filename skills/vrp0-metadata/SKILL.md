---
name: vrp0-metadata
description: Generate and maintain Gateway metadata files for the VRP0 solver project, including request-schema.json, constraint-config.yaml, result-summary-schema.json, and image-version.yaml. Use when Codex is asked to create or update JSON Schema, default constraints, overridable constraint fields, image name identity, or Git tag gateway metadata for vrp0 / VRP routing image versions.
---

# VRP0 Gateway Metadata

Use this skill inside a VRP0 engine repository to create or update the Gateway metadata files for one solver image version.

## Workflow

1. Work in the target VRP0 engine Git tag, release commit, or worktree for the exact image version being released.
2. Read `references/vrp0-contract.md` before changing field names, request shape, or constraint semantics.
3. Generate metadata with this skill's `scripts/create_vrp0_metadata.py`, passing `--engine-root . --require-engine-source`.
4. Write generated files into the engine repository metadata directory, normally `gateway/`.
5. Keep `constraint-config.yaml` JSON-compatible. The current Gateway importer parses it as JSON even though the filename is `.yaml`.
6. If the user asks for only JSON Schema, still regenerate and check whether `constraint-config.yaml` must stay aligned with the current engine constraints.

## Image Name Rule

Set `image.name` in `image-version.yaml` to the exact Registry image name that Gateway syncs as `ImageVersion.image_name`.

- Derive it from the published image reference by removing only the tag suffix `:<version>` or digest suffix `@sha256:...`.
- Keep the namespace/project path and repository basename exactly as Registry/Gateway reports them.
- Do not derive it from the Git repository name, display name, Java package, or only the final path segment.
- For `registry.example.com/x-force/vrp-0:1.0.1-alpha-SNAPSHOT`, use `x-force/vrp-0` when Gateway's Registry allowlist stores names relative to that registry.
- Do not shorten `x-force/vrp-0` to `vrp-0`; Gateway rejects metadata when `image.name` differs from Registry.

Pass the same value to `--image-name`, and pass the Registry tag/version value to `--version`.

## Generate Files

Run from the VRP0 engine repository root. Use the actual installed skill path for `SKILL_DIR`.

```bash
SKILL_DIR=/path/to/vrp0-metadata
python "$SKILL_DIR/scripts/create_vrp0_metadata.py" \
  --engine-root . \
  --require-engine-source \
  --image-name x-force/vrp-0 \
  --version 1.0.1-alpha-SNAPSHOT \
  --output-dir gateway \
  --force
```

The script writes:

- `image-version.yaml`
- `request-schema.json`
- `result-summary-schema.json`
- `constraint-config.yaml`

Use `--force` to overwrite existing files.

## Map Provider Capabilities

`image-version.yaml` declares image-level map capabilities through `supported_map_providers`. The values must be a non-empty subset of `AMAP` and `HERE`; they describe the providers for which the image can be scheduled, not the provider selected by one Engine Pod at runtime.

The generator defaults to both providers. For an image restricted to one provider, pass for example:

```bash
--supported-map-providers HERE
```

`constraint-config.yaml` is generated from the target engine source at the selected tag, release commit, or worktree:
`src/main/java/one/rewind/xforce/vehicle_routing/solver/RoutePlanConstraintConfiguration.java`.
If the engine adds, removes, renames, or changes default constraint weights in a future version,
run the skill in that version's tag, release commit, or worktree so the generated defaults and overridable fields follow that code.

## Edit Rules

- Preserve the engine-facing top-level request shape: `Scenario` fields (`name`, `planning_date`, `start_time`, `end_time`, `plan`) plus optional Gateway `options`.
- Model `plan` as the VRP0 engine `RoutePlan`: `depos`, `agents`, `tickets`, optional `skus`, `pois`, `matrix`, `constraint_configuration`, and `cost_parameter`.
- Use `tickets`, not `orders`, inside `plan`. Do not generate top-level `depos`, `agents`, or `orders` unless Gateway gains an explicit adapter layer.
- Keep POI references compatible with engine JSON identity handling: allow either a POI ID string or a POI object where engine fields can reference a POI.
- Put operational tuning in `constraint-config.yaml`, not in `request_payload`, unless it is true per-request input.
- Expose only safe OptaPlanner score weights in `overridable`; never expose platform-owned fields such as raw engine config, scheduler config, archive refs, or credentials.
- Keep overridable score values as `Nhard/Nmedium/Nsoft` strings because the VRP0 engine deserializes `HardMediumSoftLongScore` from strings.
- Keep `limits_json` in `image-version.yaml` consistent with request schema bounds when both express the same hard limit.
- After generation, compare `request-schema.json` against the current Gateway scheduler and VRP0 engine code. If the generated request cannot be submitted by Gateway as-is to engine `PUT /scenario`, fix this skill and regenerate.
- Do not use the Gateway repository as the generation target. Gateway imports the files from the engine repository Git tag selected by `GATEWAY_CODE_REPOSITORY_TAG_PATTERN`.

## Validation

After generating or editing:

```bash
python -m json.tool gateway/request-schema.json >/dev/null
python -m json.tool gateway/result-summary-schema.json >/dev/null
python -m json.tool gateway/constraint-config.yaml >/dev/null
```

Also validate that `constraint-config.yaml` keys match the score fields declared by the target engine's
`RoutePlanConstraintConfiguration`.

If the metadata is committed into a solver release commit, make sure the configured Git tag points at that commit, then verify Gateway can sync that ImageVersion and view the imported Schema/constraint config from the admin image list.
