#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="${FAKE_OPENCODE_SERVICE:-opencode-fake-v2.service}"
PORT="${FAKE_OPENCODE_PORT:-4097}"
SCENARIO="${FAKE_OPENCODE_SCENARIO:-happy-path}"
AUTH_USER="${FAKE_OPENCODE_USER:-opencode}"
NODE_BIN="${FAKE_OPENCODE_NODE:-$(command -v node || true)}"
PID_FILE="${FAKE_OPENCODE_PID_FILE:-/tmp/opencode-mobile-fake-opencode-v2.pid}"

# systemd --user needs the runtime bus even when this runs from a non-login shell.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
UNIT_DIR="$CONFIG_HOME/systemd/user"
UNIT_FILE="$UNIT_DIR/$SERVICE_NAME"
ENV_DIR="$CONFIG_HOME/opencode-mobile"
ENV_FILE="$ENV_DIR/fake-opencode.env"

if [[ -z "$NODE_BIN" ]]; then
  echo "node was not found on PATH; set FAKE_OPENCODE_NODE to an absolute node path." >&2
  exit 1
fi

mkdir -p "$UNIT_DIR" "$ENV_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  PASSWORD="${FAKE_OPENCODE_PASSWORD:-$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
  cat >"$ENV_FILE" <<EOF
FAKE_OPENCODE_PORT=$PORT
FAKE_OPENCODE_SCENARIO=$SCENARIO
FAKE_OPENCODE_BASIC_AUTH=$AUTH_USER:$PASSWORD
EOF
  chmod 600 "$ENV_FILE"
  echo "Generated basic-auth credentials in $ENV_FILE"
  echo "  username: $AUTH_USER"
  echo "  password: $PASSWORD"
else
  echo "Using existing credentials from $ENV_FILE"
fi

cat >"$UNIT_FILE" <<EOF
[Unit]
Description=Fake OpenCode V2 server (basic auth) for fake.alvarolorente.dev
After=network.target

[Service]
Type=simple
WorkingDirectory=$ROOT_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $ROOT_DIR/tests/fake-opencode/server-v2.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user stop "$SERVICE_NAME" >/dev/null 2>&1 || true

# Clear a legacy nohup instance or any stray listener on the port before starting.
if [[ -f "$PID_FILE" ]]; then
  LEGACY_PID="$(cat "$PID_FILE")"
  kill "$LEGACY_PID" 2>/dev/null || true
  rm -f "$PID_FILE"
fi
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
fi

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME" >/dev/null
systemctl --user restart "$SERVICE_NAME"

echo "$SERVICE_NAME started on port $PORT"
systemctl --user --no-pager status "$SERVICE_NAME" | head -n 6 || true
