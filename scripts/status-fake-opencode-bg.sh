#!/usr/bin/env bash

set -euo pipefail

SERVICE_NAME="${FAKE_OPENCODE_SERVICE:-opencode-fake-v2.service}"
PORT="${FAKE_OPENCODE_PORT:-4097}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
ENV_FILE="$CONFIG_HOME/opencode-mobile/fake-opencode.env"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

if systemctl --user is-active --quiet "$SERVICE_NAME"; then
  echo "$SERVICE_NAME is running"
else
  echo "$SERVICE_NAME is not running"
fi

echo "Port: $PORT"
echo "Credentials: $ENV_FILE"

systemctl --user --no-pager status "$SERVICE_NAME" 2>/dev/null | head -n 6 || true
