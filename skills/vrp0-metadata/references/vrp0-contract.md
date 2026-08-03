# VRP0 Metadata Contract

## Authoring Model

Run this metadata-authoring skill in the target VRP0 engine repository tag, release commit, or worktree for the image version being released.
The generated files belong in that engine commit's `gateway/` metadata directory and are later imported by Gateway from the configured Git tag.

This authoring workflow is separate from user-facing runtime Skills. Runtime Skills still use Gateway APIs and the imported ImageVersion metadata; they do not read Registry, Git tags, or engine internals directly.

## Image Identity

`image-version.yaml` must use the exact Registry identity that Gateway synced:

```yaml
image:
  name: x-force/vrp-0
  version: 1.0.1-alpha-SNAPSHOT
supported_map_providers:
  - AMAP
  - HERE
```

Generation rule:

1. Start from the published Registry image reference for this ImageVersion.
2. Remove only the image tag suffix `:<version>` or digest suffix `@sha256:...`.
3. Keep the namespace/project path and repository basename exactly as Gateway's Registry sync reports them.
4. Do not shorten the name to the last path segment.

Example: when Gateway syncs `x-force/vrp-0:1.0.1-alpha-SNAPSHOT`, generate `image.name: x-force/vrp-0`, not `vrp-0`.
Gateway rejects the metadata if `image.name` differs from Registry `image_name`.

## Map Provider Capabilities

`supported_map_providers` declares the map providers supported by the image. It must be a non-empty, duplicate-free list containing only `AMAP` and `HERE`. This is an ImageVersion capability declaration; a running Engine Pod still uses exactly one `MAP_PROVIDER` value.

## Request Payload Shape

The VRP0 Gateway `request_payload` must be directly submit-able to the current engine `PUT /scenario` endpoint after Gateway removes the top-level `options` field and injects the effective constraint configuration.

The request payload is an engine `Scenario` object:

```json
{
  "name": "scenario-1",
  "desc": "optional description",
  "planning_date": "2026-06-22",
  "start_time": "2026-06-22 00:00:00",
  "end_time": "2026-06-22 23:59:59",
  "plan": {
    "skus": [],
    "pois": [],
    "depos": [],
    "agents": [],
    "tickets": [],
    "matrix": {},
    "constraint_configuration": {},
    "cost_parameter": {}
  },
  "options": {}
}
```

Required top-level fields:

- `name`
- `planning_date`
- `start_time`
- `end_time`
- `plan`

Required `plan` fields:

- `depos`: depot records.
- `agents`: fleet, engineer, or vehicle records available to serve tickets.
- `tickets`: jobs to assign and sequence.

Optional `plan` fields:

- `skus`: SKU master data used by ticket item lines.
- `pois`: POI records referenced by depots, agents, and tickets.
- `matrix`: engine transit matrix payload.
- `constraint_configuration`: engine constraint weights. Gateway will overwrite this with the effective config before calling `/scenario`.
- `cost_parameter`: engine cost parameter payload.

Optional top-level `options` is Gateway-owned. Gateway reads it for scheduling and removes it before submitting the Scenario to the engine:

- `build_transit_matrix`: boolean
- `matrix_mode`: `AMAP` or `MANHATTAN`
- `draw_route`: boolean
- `resource_spec`: string

Do not generate a schema whose root is `depos`, `agents`, `orders`, or `vehicles`. That shape requires an adapter layer that Gateway does not currently have.

## Core Objects

Date-time strings used by the engine are local date-time strings formatted as `yyyy-MM-dd HH:mm:ss`.

`poi`:

- `id`: string
- `name`: string
- `location`: optional coordinate string in the engine's existing format
- `loc`: optional object with numeric `lat` and `lon`
- `entr_location`: optional coordinate string
- `entr_loc`: optional object with numeric `lat` and `lon`
- `address`: string
- `cityname`: string
- other AMap metadata may appear on engine-produced Scenario payloads

POI references may be either a POI ID string or a POI object because the engine uses Jackson identity references.

`depo`:

- `id`: string
- `name`: string
- `loc`: POI reference

`agent`:

- `id`: string
- `depo_id`: string
- `name`: string
- `start_loc`: POI reference
- `skills`: string array
- `qualification_levels`: object
- `vehicle_type`: `TRUCK`, `CAR`, or `E_BIKE`
- `fuel_type`: `GAS_92` or `ELEC`
- `weight`: optional number, minimum `0`
- `vol`: optional number, minimum `0`
- `max_ticket_num`: optional integer, minimum `0`
- `shift_start_time`: optional date-time string
- `shift_off_time`: optional date-time string
- `tickets`: optional array of ticket IDs

`ticket`:

- `id`: string
- `depo_id`: string
- `type`: `Delv`, `Delv_BH`, or `Inst`
- `status`: `New`, `Assigned`, `Accepted`, `Transit`, `Working`, `Agent_Done`, or `Done`
- `loc`: POI reference
- `items`: optional array of `{ "sku": string, "value": number }`
- `weight`: optional number, minimum `0`
- `vol`: optional number, minimum `0`
- `skills_required`: string array
- `qualification_levels_required`: object
- `dep_tickets`: optional array of ticket IDs
- `ref_tickets`: optional array of ticket IDs
- `relation_tickets`: optional array of ticket IDs
- `min_start_time`: optional date-time string
- `max_end_time`: optional date-time string
- `create_time`: optional date-time string
- `duration`: optional ISO-8601 duration string such as `PT30M`
- `agent`: optional agent ID string
- `original_agent`: optional agent ID string
- `previous_ticket`: optional ticket ID string
- `next_ticket`: optional ticket ID string

`sku`:

- `id`: string
- `name`: string
- `weight`: optional number, minimum `0`
- `vol`: optional number, minimum `0`

## Default Constraint Config

Use `constraint-config.yaml` as JSON-compatible YAML with:

- `defaults`: effective default VRP0 OptaPlanner constraint weights.
- `overridable`: allowlist of score weight fields users may override through Gateway `constraint_overrides`.

Generate these fields from the target engine version's `RoutePlanConstraintConfiguration` source whenever possible. Different engine versions may intentionally have different constraint fields or default values; do not copy defaults from another version by hand.

Score values must use the engine's `HardMediumSoftLongScore` text format:

```text
Nhard/Nmedium/Nsoft
```

Recommended safe overridable fields are the score-weight fields declared in `RoutePlanConstraintConfiguration`, such as:

- `agent_capacity`
- `agent_max_ticket`
- `ticket_start_service_time_match_expected`
- `minimize_travel_time`
- `same_depo`
- `agent_is_virtual`

Do not expose raw platform fields, archive references, scheduler internals, image version refs, or credentials.
