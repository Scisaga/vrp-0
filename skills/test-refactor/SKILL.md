---
name: test-refactor
description: Use when restructuring or rewriting this project's test suite, especially when aligning tests to docs/testing guidance, auditing coverage gaps, reorganizing test directories, or deciding whether to preserve, rewrite, move, or remove existing tests.
---

# Test Refactor

Use this skill when the user asks to reorganize, rewrite, audit, or expand the project's tests.

The target is not just cleaner directories. The target is a stable, meaningful test system where:

- Default tests are fast, deterministic, and free of real external dependencies.
- Solver/domain/service correctness is covered before low-value surface tests.
- External integrations are explicit and opt-in.
- Manual/debug tests do not pollute quality gates.

## Required Workflow

### 1. Read Current Guidance

Before changing tests, read:

- `docs/测试代码指南.md`
- `build.gradle.kts`

Use the guide as the target structure and behavior contract.

### 2. Build A Coverage Inventory First

Do not start by moving files. First produce a compact coverage inventory from project code.

Use this shape:

```text
module | test type | required behavior | priority | target test class | current asset | action
```

Recommended priorities:

- `P0`: solver constraints, domain model behavior, service state flow, repository persistence.
- `P1`: REST/MCP contracts, JSON references, geo/matrix/store utilities.
- `P2`: external integration, E2E flows, manual scripts.

The inventory must be based on `src/main/java`, not on the current test directory layout.

### 3. Classify Existing Tests

Treat existing tests as assets to audit, not as the desired structure.

Classify each relevant test as:

- `preserve`: clear assertions, stable, meaningful, no improper external dependency.
- `rewrite`: useful intent but poor implementation, weak assertions, path-dependent, noisy, flaky, or mixed concerns.
- `manual`: print/report/debug/chart generation or exploratory test.
- `remove`: no clear business value and no useful regression signal.

Do not delete a test just because the directory is messy. Preserve useful regression knowledge.

### 4. Create Target Test Structure

Use this target layout:

```text
src/test/java/
  unit/
  app/
  integration/
  manual/
  support/

src/test/resources/
  fixtures/
    scenarios/
    pois/
    matrices/
    solver_jobs/
  app/
  external/
```

Rules:

- `unit/`: no tag, runs under `test`.
- `app/`: `@Tag("app")`, runs under `appTest`.
- `integration/`: `@Tag("external")`, runs under `externalTest` or `integrationTest`.
- `manual/`: `@Tag("manual")`, runs under `manualTest`.
- `support/`: helpers only, no `*Test`.

### 5. Rewrite By Batch

Use small batches. After each batch, run the relevant gate.

Recommended batch order:

1. Solver constraints and solver helper tests.
2. Domain model tests.
3. Service and repository tests.
4. JSON, geo, matrix, and store tests.
5. REST and MCP application tests.
6. External integration tests.
7. Manual/debug tests.

For each batch:

- Move or create tests in the target structure.
- Replace print-only tests with assertions.
- Replace absolute/local paths with fixtures or temporary directories.
- Keep external calls behind explicit skip guards.
- Preserve regression cases as minimal tests.

### 6. Validation Gates

Default verification:

```bash
./gradlew test appTest
```

When external integration behavior changes:

```bash
./gradlew externalTest
```

This should verify skip behavior by default. Real external execution requires explicit configuration.

For manual tests:

```bash
./gradlew manualTest
```

Do not use manual tests as a quality gate.

## Coverage Expectations

### Unit

Cover:

- `Agent`, `AgentEachDay`, `Ticket`, `RoutePlan`, `Scenario`, `SolverJob`.
- Time windows, loading, driving metrics, departure/done time, moved status.
- JSON identity/reference round trips.
- `StoragePathResolver` and file-store behavior using test directories.

### Solver

Cover every constraint with:

- one positive penalty/reward path;
- one non-trigger path;
- boundary inputs such as null agent, virtual agent, empty skills, empty qualification, missing matrix;
- justification safety.

Also cover:

- `ArrivalTimeUpdatingVariableListener`;
- pinned-ticket move filters;
- difficulty weights if used.

### App

Cover:

- REST status codes and response contracts;
- service state flow;
- repository current/history behavior;
- MCP auth, tools/list, tools/call, and error codes.

### External

Cover only with explicit opt-in:

- AMap query/geocode/reverse-geocode/routing/truck routing;
- address resolver fallback;
- remote scenario creation and solver polling;
- quota, timeout, invalid key, service unavailable.

### Manual

Keep:

- reporting;
- chart generation;
- scenario inspection;
- one-off debug flows.

Manual tests may print output, but must not run in default gates.

## Decision Rules

- Prefer rewriting low-quality tests over carrying weak tests into the new structure.
- Preserve existing high-value regression cases even when the original test is messy.
- Do not add broad abstractions unless multiple tests need the same fixture builder or helper.
- Keep fixtures small and purpose-specific.
- Do not use production data directories in tests.
- Do not make real network calls from `test` or `appTest`.
- If a code behavior is clearly wrong and a new test exposes it, fix the production code and keep the regression test.
