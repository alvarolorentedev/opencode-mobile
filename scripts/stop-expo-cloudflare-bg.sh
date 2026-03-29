#!/usr/bin/env bash

set -euo pipefail

PID_FILE="${EXPO_DEV_PID_FILE:-/tmp/opencode-mobile-expo.pid}"
PORT="${EXPO_DEV_PORT:-8081}"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    echo "Stopped Expo process $PID"
  fi
  rm -f "$PID_FILE"
fi

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
fi

echo "Expo background server is stopped"
