#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.yml"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/docker-service.sh start
  ./scripts/docker-service.sh stop
  ./scripts/docker-service.sh restart
  ./scripts/docker-service.sh status
  ./scripts/docker-service.sh logs
  ./scripts/docker-service.sh build

Commands:
  start    Build Quarkus JVM artifact, then build and start Docker Compose service
  stop     Stop and remove Docker Compose service
  restart  Restart service with fresh build
  status   Show Docker Compose service status
  logs     Tail service logs
  build    Build Quarkus JVM artifact only
EOF
}

require_compose_file() {
  if [[ ! -f "${COMPOSE_FILE}" ]]; then
    echo "docker-compose.yml not found: ${COMPOSE_FILE}" >&2
    exit 1
  fi
}

build_app() {
  echo "[1/2] Building Quarkus JVM artifact..."
  (cd "${PROJECT_ROOT}" && ./gradlew quarkusBuild -x test)
}

start_service() {
  require_compose_file
  build_app
  echo "[2/2] Starting Docker Compose service..."
  (cd "${PROJECT_ROOT}" && docker compose -f "${COMPOSE_FILE}" up --build -d)
}

stop_service() {
  require_compose_file
  echo "Stopping Docker Compose service..."
  (cd "${PROJECT_ROOT}" && docker compose -f "${COMPOSE_FILE}" down)
}

status_service() {
  require_compose_file
  (cd "${PROJECT_ROOT}" && docker compose -f "${COMPOSE_FILE}" ps)
}

logs_service() {
  require_compose_file
  (cd "${PROJECT_ROOT}" && docker compose -f "${COMPOSE_FILE}" logs -f --tail=200)
}

case "${1:-}" in
  start)
    start_service
    ;;
  stop)
    stop_service
    ;;
  restart)
    stop_service
    start_service
    ;;
  status)
    status_service
    ;;
  logs)
    logs_service
    ;;
  build)
    build_app
    ;;
  *)
    usage
    exit 1
    ;;
esac
