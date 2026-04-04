#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${EXPO_DEV_PORT:-8081}"
PUBLIC_URL="${EXPO_PUBLIC_URL:-http://expo.alvarolorente.dev:80}"
START_TARGET="${EXPO_START_TARGET:-go}"

cd "$ROOT_DIR"

if [[ "$START_TARGET" == "dev-client" ]]; then
  START_FLAG="--dev-client"
  echo "Starting Expo dev-client server on port $PORT"
else
  START_FLAG="--go"
  echo "Starting Expo Go dev server on port $PORT"
fi

echo "Advertising packager URL as $PUBLIC_URL"

exec env -u CI EXPO_PACKAGER_PROXY_URL="$PUBLIC_URL" npx expo start --port "$PORT" "$START_FLAG"
