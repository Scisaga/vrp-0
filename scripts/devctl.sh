#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/build/local"
PID_FILE="$RUN_DIR/quarkusRunDebug.pid"
LOG_FILE="$RUN_DIR/quarkusRunDebug.log"
ENV_FILE="$ROOT_DIR/.env"
COMMAND="${1:-}"
PROJECT_ENV=()

usage() {
  echo "Usage: $0 <start|stop|restart>" >&2
}

set_project_env() {
  local key="$1"
  local value="$2"
  local index
  for index in "${!PROJECT_ENV[@]}"; do
    if [[ "${PROJECT_ENV[$index]%%=*}" == "$key" ]]; then
      PROJECT_ENV[$index]="$key=$value"
      return
    fi
  done
  PROJECT_ENV+=("$key=$value")
}

load_project_env() {
  PROJECT_ENV=()
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Environment file not found; starting with application defaults: $ENV_FILE" >&2
    return
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    set_project_env "$key" "$value"
  done <"$ENV_FILE"
}

read_pid() {
  [[ -s "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  echo "$pid"
}

is_running() {
  local pid
  pid="$(read_pid)" || return 1
  if is_process_tree_running "$pid"; then
    return 0
  fi
  local -a quarkus_pids=()
  mapfile -t quarkus_pids < <(find_quarkus_dev_pids)
  ((${#quarkus_pids[@]} > 0))
}

is_process_tree_running() {
  local pid="$1"
  kill -0 -- "-$pid" >/dev/null 2>&1 || kill -0 "$pid" >/dev/null 2>&1
}

is_quarkus_dev_process() {
  local pid="$1"
  local cmdline
  [[ -r "/proc/$pid/cmdline" ]] || return 1
  cmdline="$(tr '\0' ' ' 2>/dev/null <"/proc/$pid/cmdline")" || return 1
  [[ "$cmdline" == *"-Dquarkus-internal.serialized-app-model.path=$ROOT_DIR/build/"* ]] &&
    [[ "$cmdline" == *"-jar $ROOT_DIR/build/"*"-dev.jar"* ]]
}

find_quarkus_dev_pids() {
  local proc
  local pid
  for proc in /proc/[0-9]*; do
    pid="${proc##*/}"
    if is_quarkus_dev_process "$pid"; then
      echo "$pid"
    fi
  done
}

stop_targets_running() {
  local launcher_pid="$1"
  shift
  local pid
  if is_process_tree_running "$launcher_pid"; then
    return 0
  fi
  for pid in "$@"; do
    if is_quarkus_dev_process "$pid"; then
      return 0
    fi
  done
  return 1
}

signal_quarkus_dev_processes() {
  local signal="$1"
  shift
  local pid
  for pid in "$@"; do
    if is_quarkus_dev_process "$pid"; then
      kill "-$signal" "$pid" 2>/dev/null || true
    fi
  done
}

kill_process_tree() {
  local pid="$1"
  local signal="$2"
  if kill -0 -- "-$pid" >/dev/null 2>&1; then
    kill "-$signal" -- "-$pid"
  else
    kill "-$signal" "$pid"
  fi
}

start() {
  mkdir -p "$RUN_DIR"
  if is_running; then
    echo "quarkusRunDebug already running: pid $(cat "$PID_FILE")"
    return
  fi

  load_project_env
  local -a child_env=(
    env -i
    "HOME=${HOME:-/tmp}"
    "PATH=${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
  )
  if [[ -n "${JAVA_HOME:-}" ]]; then
    child_env+=("JAVA_HOME=$JAVA_HOME")
  fi
  child_env+=("${PROJECT_ENV[@]}")
  (
    cd "$ROOT_DIR"
    setsid "${child_env[@]}" ./gradlew --no-daemon quarkusRunDebug -Dquarkus.console.enabled=false < /dev/null >"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
  )
  sleep 1
  if ! is_running; then
    echo "quarkusRunDebug failed to start, log $LOG_FILE" >&2
    rm -f "$PID_FILE"
    return 1
  fi
  echo "quarkusRunDebug started: pid $(cat "$PID_FILE"), log $LOG_FILE"
}

stop() {
  if [[ ! -f "$PID_FILE" ]]; then
    echo "quarkusRunDebug not running"
    return
  fi

  local pid
  if ! pid="$(read_pid)"; then
    echo "quarkusRunDebug pid file existed but was invalid"
    rm -f "$PID_FILE"
    return
  fi
  local -a quarkus_pids=()
  mapfile -t quarkus_pids < <(find_quarkus_dev_pids)
  if is_process_tree_running "$pid" || ((${#quarkus_pids[@]} > 0)); then
    if is_process_tree_running "$pid"; then
      kill_process_tree "$pid" TERM
    fi
    signal_quarkus_dev_processes TERM "${quarkus_pids[@]}"
    for _ in {1..20}; do
      if ! stop_targets_running "$pid" "${quarkus_pids[@]}"; then
        break
      fi
      sleep 0.25
    done
    if stop_targets_running "$pid" "${quarkus_pids[@]}"; then
      if is_process_tree_running "$pid"; then
        kill_process_tree "$pid" KILL
      fi
      signal_quarkus_dev_processes KILL "${quarkus_pids[@]}"
    fi
    for _ in {1..20}; do
      if ! stop_targets_running "$pid" "${quarkus_pids[@]}"; then
        break
      fi
      sleep 0.05
    done
    if stop_targets_running "$pid" "${quarkus_pids[@]}"; then
      echo "quarkusRunDebug failed to stop" >&2
      return 1
    fi
    echo "quarkusRunDebug stopped"
  else
    echo "quarkusRunDebug pid file existed but process was not running"
  fi
  rm -f "$PID_FILE"
}

case "$COMMAND" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    start
    ;;
  *)
    usage
    exit 2
    ;;
esac
