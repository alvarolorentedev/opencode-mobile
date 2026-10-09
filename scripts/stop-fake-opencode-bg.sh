#!/usr/bin/env bash

set -euo pipefail

SERVICE_NAME="${FAKE_OPENCODE_SERVICE:-opencode-fake-v2.service}"
PID_FILE="${FAKE_OPENCODE_PID_FILE:-/tmp/opencode-mobile-fake-opencode-v2.pid}"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

systemctl --user stop "$SERVICE_NAME" >/dev/null 2>&1 || true

# Clear a legacy nohup instance too.
if [[ -f "$PID_FILE" ]]; then
  LEGACY_PID="$(cat "$PID_FILE")"
  kill "$LEGACY_PID" 2>/dev/null || true
  rm -f "$PID_FILE"
fi

echo "$SERVICE_NAME stopped"
