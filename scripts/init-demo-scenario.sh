#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEFAULT_BASE_URL="http://localhost:8080"
DEFAULT_SCENARIO_FILE="${PROJECT_ROOT}/src/test/resources/fixtures/scenarios/json1.json"

BASE_URL="${DEFAULT_BASE_URL}"
SCENARIO_FILE="${DEFAULT_SCENARIO_FILE}"
ASSUME_YES=false
CURL_NO_PROXY_ARGS=()

usage() {
  cat <<EOF
Usage:
  ./scripts/init-demo-scenario.sh [--base-url <url>] [--file <path>] [--yes]

Options:
  --base-url <url>  Target VRP service base URL. Default: ${DEFAULT_BASE_URL}
  --file <path>     Scenario JSON file to import. Default: src/test/resources/fixtures/scenarios/json1.json
  --yes             Overwrite existing scenario without interactive confirmation
  --help            Show this help message
EOF
}

log() {
  printf '[demo-init] %s\n' "$*"
}

die() {
  printf '[demo-init] ERROR: %s\n' "$*" >&2
  exit 1
}

trim_trailing_slash() {
  local value="$1"
  while [[ "${value}" == */ ]]; do
    value="${value%/}"
  done
  printf '%s' "${value}"
}

url_host() {
  local url="$1"
  local remainder="${url#*://}"
  remainder="${remainder%%/*}"
  if [[ "${remainder}" == *"@"* ]]; then
    remainder="${remainder##*@}"
  fi
  if [[ "${remainder}" == \[*\] ]]; then
    printf '%s' "${remainder#[}"
    return
  fi
  if [[ "${remainder}" == *:* ]]; then
    printf '%s' "${remainder%%:*}"
    return
  fi
  printf '%s' "${remainder}"
}

configure_proxy_behavior() {
  local host
  host="$(url_host "${BASE_URL}")"
  case "${host}" in
    localhost|127.0.0.1|::1)
      CURL_NO_PROXY_ARGS=(--noproxy '*')
      ;;
    *)
      CURL_NO_PROXY_ARGS=()
      ;;
  esac
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --base-url)
        [[ $# -ge 2 ]] || die "Missing value for --base-url"
        BASE_URL="$2"
        shift 2
        ;;
      --file)
        [[ $# -ge 2 ]] || die "Missing value for --file"
        SCENARIO_FILE="$2"
        shift 2
        ;;
      --yes)
        ASSUME_YES=true
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

resolve_paths() {
  BASE_URL="$(trim_trailing_slash "${BASE_URL}")"
  configure_proxy_behavior

  if [[ "${SCENARIO_FILE}" != /* ]]; then
    SCENARIO_FILE="${PROJECT_ROOT}/${SCENARIO_FILE}"
  fi
}

http_request() {
  local method="$1"
  local url="$2"
  local body_file="${3:-}"
  local response_file
  local http_code
  local curl_args=(
    -sS
    -X "${method}"
    -H "Accept: application/json"
    -w '%{http_code}'
    -o
  )

  response_file="$(mktemp)"
  curl_args+=("${response_file}")

  if [[ -n "${body_file}" ]]; then
    curl_args+=(
      -H "Content-Type: application/json"
      --data-binary "@${body_file}"
    )
  fi

  set +e
  http_code="$(curl "${CURL_NO_PROXY_ARGS[@]}" "${curl_args[@]}" "${url}")"
  local curl_status=$?
  set -e

  if [[ ${curl_status} -ne 0 ]]; then
    rm -f "${response_file}"
    die "Request failed: ${method} ${url}"
  fi

  local response_body
  response_body="$(cat "${response_file}")"
  rm -f "${response_file}"

  printf '%s\n%s' "${http_code}" "${response_body}"
}

confirm_overwrite() {
  local answer
  printf 'A scenario already exists. Overwrite it? [y/N]: '
  read -r answer
  case "${answer}" in
    y|Y|yes|YES|Yes)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_prerequisites() {
  require_cmd curl
  [[ -f "${SCENARIO_FILE}" ]] || die "Scenario file not found: ${SCENARIO_FILE}"
}

fetch_current_scenario() {
  http_request "GET" "${BASE_URL}/scenario/optional"
}

delete_current_scenario() {
  local result http_code response_body
  result="$(http_request "DELETE" "${BASE_URL}/scenario")"
  http_code="${result%%$'\n'*}"
  response_body="${result#*$'\n'}"

  case "${http_code}" in
    200|404)
      return 0
      ;;
    *)
      printf '%s\n' "${response_body}" >&2
      die "Failed to delete current scenario, HTTP ${http_code}"
      ;;
  esac
}

import_scenario() {
  local result http_code response_body
  log "Importing scenario from ${SCENARIO_FILE}"
  result="$(http_request \
    "PUT" \
    "${BASE_URL}/scenario?build=true&matrix_mode=MANHATTAN" \
    "${SCENARIO_FILE}")"
  http_code="${result%%$'\n'*}"
  response_body="${result#*$'\n'}"

  if [[ "${http_code}" != "200" ]]; then
    printf '%s\n' "${response_body}" >&2
    die "Scenario import failed, HTTP ${http_code}"
  fi

  log "Scenario import succeeded."
}

main() {
  parse_args "$@"
  resolve_paths
  ensure_prerequisites

  log "Checking current scenario at ${BASE_URL}"
  local result http_code response_body trimmed_body
  result="$(fetch_current_scenario)"
  http_code="${result%%$'\n'*}"
  response_body="${result#*$'\n'}"

  if [[ "${http_code}" != "200" ]]; then
    printf '%s\n' "${response_body}" >&2
    die "Failed to query current scenario, HTTP ${http_code}"
  fi

  trimmed_body="$(printf '%s' "${response_body}" | tr -d '[:space:]')"
  if [[ "${trimmed_body}" == "null" ]]; then
    log "No current scenario found."
    import_scenario
    exit 0
  fi

  log "Current scenario detected."
  if [[ "${ASSUME_YES}" != "true" ]]; then
    if ! confirm_overwrite; then
      log "Overwrite cancelled by user."
      exit 0
    fi
  fi

  log "Deleting current scenario before import."
  delete_current_scenario
  import_scenario
}

main "$@"
