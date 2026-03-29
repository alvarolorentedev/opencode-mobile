#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${EXPO_DEV_PORT:-8081}"
PUBLIC_URL="${EXPO_PUBLIC_URL:-http://expo.alvarolorente.dev:80}"

cd "$ROOT_DIR"

echo "Starting Expo Go dev server on port $PORT"
echo "Advertising packager URL as $PUBLIC_URL"

exec env -u CI EXPO_PACKAGER_PROXY_URL="$PUBLIC_URL" npx expo start --port "$PORT" --go
