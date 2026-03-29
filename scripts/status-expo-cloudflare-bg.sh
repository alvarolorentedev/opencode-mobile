#!/usr/bin/env bash

set -euo pipefail

PID_FILE="${EXPO_DEV_PID_FILE:-/tmp/opencode-mobile-expo.pid}"
LOG_FILE="${EXPO_DEV_LOG_FILE:-/tmp/opencode-mobile-expo.log}"
PORT="${EXPO_DEV_PORT:-8081}"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Expo is running with PID $(cat "$PID_FILE")"
else
  echo "Expo is not running"
fi

echo "Port: $PORT"
echo "Log file: $LOG_FILE"
