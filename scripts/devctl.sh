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

process_is_running() {
  local pid="$1"
  local process_stat
  local stat_tail
  local state
  [[ -r "/proc/$pid/stat" ]] || return 1
  IFS= read -r process_stat <"/proc/$pid/stat" || return 1
  stat_tail="${process_stat##*) }"
  state="${stat_tail%% *}"
  [[ "$state" != "Z" ]]
}

read_process_cmdline() {
  local pid="$1"
  local -n result="$2"
  local -a arguments=()
  [[ -r "/proc/$pid/cmdline" ]] || return 1
  mapfile -d '' -t arguments <"/proc/$pid/cmdline" || return 1
  ((${#arguments[@]} > 0)) || return 1
  printf -v result '%s ' "${arguments[@]}"
}

is_quarkus_dev_cmdline() {
  local cmdline="$1"
  [[ "$cmdline" == *"-Dquarkus-internal.serialized-app-model.path=$ROOT_DIR/build/"* ]] &&
    [[ "$cmdline" == *"-jar $ROOT_DIR/build/"*"-dev.jar"* ]]
}

is_quarkus_dev_process() {
  local pid="$1"
  local cmdline
  read_process_cmdline "$pid" cmdline || return 1
  is_quarkus_dev_cmdline "$cmdline"
}

is_gradle_launcher_cmdline() {
  local pid="$1"
  local cmdline="$2"
  local cwd
  [[ "$cmdline" == *"quarkusRunDebug"* ]] || return 1

  if [[ "$cmdline" == *"-classpath $ROOT_DIR/gradle/wrapper/gradle-wrapper.jar"* ]] &&
    [[ "$cmdline" == *"org.gradle.wrapper.GradleWrapperMain"* ]]; then
    return 0
  fi

  cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null)" || return 1
  [[ "$cwd" == "$ROOT_DIR" ]] &&
    [[ "$cmdline" == *"./gradlew"* || "$cmdline" == *"$ROOT_DIR/gradlew"* ]]
}

is_gradle_launcher_process() {
  local pid="$1"
  local cmdline
  read_process_cmdline "$pid" cmdline || return 1
  is_gradle_launcher_cmdline "$pid" "$cmdline"
}

is_managed_process() {
  local pid="$1"
  local cmdline
  read_process_cmdline "$pid" cmdline || return 1
  is_quarkus_dev_cmdline "$cmdline" || is_gradle_launcher_cmdline "$pid" "$cmdline"
}

find_direct_managed_pids() {
  local proc
  local pid
  local cmdline
  for proc in /proc/[0-9]*; do
    pid="${proc##*/}"
    if read_process_cmdline "$pid" cmdline &&
      { is_quarkus_dev_cmdline "$cmdline" || is_gradle_launcher_cmdline "$pid" "$cmdline"; }; then
      echo "$pid"
    fi
  done
}

read_process_parent_pid() {
  local pid="$1"
  local -n result="$2"
  local process_stat
  local stat_tail
  local state
  [[ -r "/proc/$pid/stat" ]] || return 1
  IFS= read -r process_stat <"/proc/$pid/stat" || return 1
  stat_tail="${process_stat##*) }"
  read -r state result _ <<<"$stat_tail"
  [[ "$result" =~ ^[0-9]+$ ]]
}

find_related_ancestor_pids() {
  local app_pid="$1"
  local current_pid="$app_pid"
  local parent_pid
  local found_launcher=false
  local -a chain=("$app_pid")

  for _ in {1..16}; do
    read_process_parent_pid "$current_pid" parent_pid || break
    ((parent_pid > 1)) || break
    chain+=("$parent_pid")
    if is_gradle_launcher_process "$parent_pid"; then
      found_launcher=true
      break
    fi
    current_pid="$parent_pid"
  done

  if [[ "$found_launcher" == true ]]; then
    printf '%s\n' "${chain[@]}"
  else
    echo "$app_pid"
  fi
}

find_managed_pids() {
  local pid
  local recorded_pid
  local -a direct_pids=()

  if recorded_pid="$(read_pid 2>/dev/null)" && is_managed_process "$recorded_pid"; then
    echo "$recorded_pid"
  fi

  mapfile -t direct_pids < <(find_direct_managed_pids)
  for pid in "${direct_pids[@]}"; do
    if is_quarkus_dev_process "$pid"; then
      find_related_ancestor_pids "$pid"
    else
      echo "$pid"
    fi
  done

  return 0
}

collect_managed_pids() {
  find_managed_pids | sort -un
}

is_running() {
  local -a managed_pids=()
  mapfile -t managed_pids < <(collect_managed_pids)
  ((${#managed_pids[@]} > 0))
}

any_process_running() {
  local pid
  for pid in "$@"; do
    if process_is_running "$pid"; then
      return 0
    fi
  done
  return 1
}

signal_processes() {
  local signal="$1"
  shift
  local pid
  for pid in "$@"; do
    if process_is_running "$pid"; then
      kill "-$signal" "$pid" 2>/dev/null || true
    fi
  done
}

start() {
  mkdir -p "$RUN_DIR"
  if is_running; then
    local -a managed_pids=()
    mapfile -t managed_pids < <(collect_managed_pids)
    echo "quarkusRunDebug already running: pids ${managed_pids[*]}"
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
  local -a managed_pids=()
  mapfile -t managed_pids < <(collect_managed_pids)
  if ((${#managed_pids[@]} > 0)); then
    signal_processes TERM "${managed_pids[@]}"
    for _ in {1..20}; do
      if ! any_process_running "${managed_pids[@]}"; then
        break
      fi
      sleep 0.25
    done
    local -a remaining_pids=()
    mapfile -t remaining_pids < <(
      for pid in "${managed_pids[@]}"; do
        process_is_running "$pid" && echo "$pid"
      done
      collect_managed_pids
    )
    if ((${#remaining_pids[@]} > 0)); then
      mapfile -t remaining_pids < <(printf '%s\n' "${remaining_pids[@]}" | sort -un)
    fi
    if ((${#remaining_pids[@]} > 0)); then
      signal_processes KILL "${remaining_pids[@]}"
      for _ in {1..20}; do
        if ! any_process_running "${remaining_pids[@]}"; then
          break
        fi
        sleep 0.05
      done
    fi
    mapfile -t remaining_pids < <(
      for pid in "${remaining_pids[@]}"; do
        process_is_running "$pid" && echo "$pid"
      done
      collect_managed_pids
    )
    if ((${#remaining_pids[@]} > 0)); then
      echo "quarkusRunDebug failed to stop" >&2
      return 1
    fi
    echo "quarkusRunDebug stopped"
  else
    echo "quarkusRunDebug not running"
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
