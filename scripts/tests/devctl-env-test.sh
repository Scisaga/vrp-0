#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVCTL_SOURCE="$(cd "$SCRIPT_DIR/.." && pwd)/devctl.sh"
TEST_ROOT="$(mktemp -d)"

cleanup() {
  if [[ -f "$TEST_ROOT/build/local/quarkusRunDebug.pid" ]]; then
    "$TEST_ROOT/scripts/devctl.sh" stop >/dev/null 2>&1 || true
  fi
  if [[ -f "$TEST_ROOT/quarkus-child.pid" ]]; then
    kill -KILL "$(cat "$TEST_ROOT/quarkus-child.pid")" >/dev/null 2>&1 || true
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$TEST_ROOT/scripts"
cp "$DEVCTL_SOURCE" "$TEST_ROOT/scripts/devctl.sh"
chmod +x "$TEST_ROOT/scripts/devctl.sh"

cat >"$TEST_ROOT/gradlew" <<'GRADLE_WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "${MAP_PROVIDER-<unset>}" >"$PWD/observed-map-provider"
printf '%s\n' "$*" >"$PWD/observed-gradle-args"
setsid bash -c '
  trap "exit 0" TERM INT
  while true; do
    sleep 0.1
  done
' quarkus-dev \
  "-Dquarkus-internal.serialized-app-model.path=$PWD/build/tmp/quarkusDev/quarkus-app-model.dat" \
  -jar "$PWD/build/fake-dev.jar" &
printf '%s\n' "$!" >"$PWD/quarkus-child.pid"
trap 'exit 0' TERM INT
while true; do
  sleep 0.1
done
GRADLE_WRAPPER
chmod +x "$TEST_ROOT/gradlew"

wait_for_observation() {
  for _ in {1..40}; do
    [[ -f "$TEST_ROOT/observed-map-provider" && -f "$TEST_ROOT/quarkus-child.pid" ]] && return 0
    sleep 0.05
  done
  echo "Timed out waiting for the fake Gradle wrapper" >&2
  return 1
}

assert_child_stopped() {
  local child_pid
  child_pid="$(cat "$TEST_ROOT/quarkus-child.pid")"
  for _ in {1..20}; do
    if ! kill -0 "$child_pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.05
  done
  echo "Expected detached Quarkus child $child_pid to stop" >&2
  return 1
}

assert_provider() {
  local expected="$1"
  local actual
  actual="$(cat "$TEST_ROOT/observed-map-provider")"
  [[ "$actual" == "$expected" ]] || {
    echo "Expected MAP_PROVIDER=$expected, got $actual" >&2
    return 1
  }
}

assert_no_daemon() {
  grep -Eq '(^| )--no-daemon( |$)' "$TEST_ROOT/observed-gradle-args" || {
    echo "Expected Gradle to run with --no-daemon" >&2
    return 1
  }
}

MAP_PROVIDER=HERE "$TEST_ROOT/scripts/devctl.sh" start >/dev/null
wait_for_observation
assert_provider "<unset>"
assert_no_daemon
"$TEST_ROOT/scripts/devctl.sh" stop >/dev/null
assert_child_stopped

rm -f "$TEST_ROOT/observed-map-provider"
printf 'MAP_PROVIDER=AMAP\n' >"$TEST_ROOT/.env"
MAP_PROVIDER=HERE "$TEST_ROOT/scripts/devctl.sh" start >/dev/null
wait_for_observation
assert_provider "AMAP"
assert_no_daemon
"$TEST_ROOT/scripts/devctl.sh" stop >/dev/null
assert_child_stopped

echo "devctl environment isolation test passed"
