#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${EXPO_DEV_LOG_FILE:-/tmp/opencode-mobile-expo.log}"
PID_FILE="${EXPO_DEV_PID_FILE:-/tmp/opencode-mobile-expo.pid}"
PORT="${EXPO_DEV_PORT:-8081}"

cd "$ROOT_DIR"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Expo is already running with PID $(cat "$PID_FILE")"
  echo "Log file: $LOG_FILE"
  exit 0
fi

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
fi

nohup "$ROOT_DIR/scripts/start-expo-cloudflare.sh" >"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"

echo "Expo started in background with PID $(cat "$PID_FILE")"
echo "Log file: $LOG_FILE"
