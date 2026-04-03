#!/usr/bin/env bash
set -euo pipefail

# Export selected values from .env into GitHub Actions Secrets and Repository Variables
# Requirements: gh (GitHub CLI) must be installed and authenticated with permissions to set secrets/variables.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh (GitHub CLI) is not installed. Install and authenticate before running this script."
  exit 1
fi

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# Temporary dir for safe file operations
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Detect base64 decoder flag differences (GNU vs BSD)
BASE64_DECODE="--decode"
if ! command -v base64 >/dev/null 2>&1; then
  echo "Error: base64 command not found" >&2
  exit 1
fi
if ! base64 $BASE64_DECODE < /dev/null >/dev/null 2>&1; then
  # try BSD/macOS flag
  BASE64_DECODE="-D"
fi

get_env() {
  local key="$1"
  # shellcheck disable=SC2002,SC2016
  local line
  line=$(grep -m1 -E "^${key}=" "$ENV_FILE" || true)
  if [[ -z "$line" ]]; then
    echo ""
    return
  fi
  echo "${line#*=}"
}

set_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Warning: $name not set in .env — skipping secret creation."
    return
  fi

  if [[ "$DRY_RUN" == true ]]; then
    echo "DRY RUN: gh secret set $name (value length: ${#value})"
    return
  fi

  echo "Setting secret: $name"

  # Special handling for large or binary secrets (the keystore base64)
  if [[ "$name" == "ANDROID_KEYSTORE_BASE64" ]]; then
    local b64file="$TMPDIR/${name}.b64"
    local keystorebin="$TMPDIR/${name}.bin"
    # Normalize: remove all whitespace/newlines (prevents web-ui wrapping issues)
    printf '%s' "$value" | tr -d '[:space:]' > "$b64file"

    # Basic sanity check: require at least some bytes
    if [[ $(wc -c < "$b64file") -lt 100 ]]; then
      echo "Error: $name appears too small (possible corruption); size=$(wc -c < $b64file)" >&2
      return 1
    fi

    # Try decoding to confirm it's valid base64 and a keystore-like blob
    if ! base64 $BASE64_DECODE "$b64file" > "$keystorebin" 2> "$TMPDIR/b64.err"; then
      echo "Error: ANDROID_KEYSTORE_BASE64 failed to decode to binary. See $TMPDIR/b64.err" >&2
      sed -n '1,120p' "$TMPDIR/b64.err" >&2 || true
      return 1
    fi

    # Print non-sensitive diagnostics: lengths and sha256 of decoded bytes
    if command -v sha256sum >/dev/null 2>&1; then
      echo "Decoded keystore size: $(wc -c < "$keystorebin") bytes"
      echo "Decoded keystore sha256: $(sha256sum "$keystorebin" | awk '{print $1}')"
    fi

    # Upload via stdin to avoid shell interpolation/truncation issues
    gh secret set "$name" --body - < "$b64file"
    return $?
  fi

  # Default path for small textual secrets
  printf '%s' "$value" | gh secret set "$name" --body -
}

set_variable() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Warning: $name not set in .env — skipping variable creation."
    return
  fi
  if [[ "$DRY_RUN" == true ]]; then
    echo "DRY RUN: gh variable set $name (value: $value)"
  else
    echo "Setting repository variable: $name"
    gh variable set "$name" --body "$value"
  fi
}

echo "Reading values from $ENV_FILE"

ANDROID_KEYSTORE_BASE64=$(get_env ANDROID_KEYSTORE_BASE64)
ANDROID_KEYSTORE_PASSWORD=$(get_env ANDROID_KEYSTORE_PASSWORD)
ANDROID_KEY_ALIAS=$(get_env ANDROID_KEY_ALIAS)
ANDROID_KEY_PASSWORD=$(get_env ANDROID_KEY_PASSWORD)

EXPO_OWNER=$(get_env EXPO_OWNER)
EXPO_ANDROID_PACKAGE=$(get_env EXPO_ANDROID_PACKAGE)
EXPO_IOS_BUNDLE_IDENTIFIER=$(get_env EXPO_IOS_BUNDLE_IDENTIFIER)

echo "Preparing to upload secrets to GitHub. Ensure you are authenticated with 'gh auth login'."

set_secret ANDROID_KEYSTORE_BASE64 "$ANDROID_KEYSTORE_BASE64"
set_secret ANDROID_KEYSTORE_PASSWORD "$ANDROID_KEYSTORE_PASSWORD"
set_secret ANDROID_KEY_ALIAS "$ANDROID_KEY_ALIAS"
set_secret ANDROID_KEY_PASSWORD "$ANDROID_KEY_PASSWORD"

# The recommended EXPO_* values are non-secret and can be set as repository variables
set_variable EXPO_OWNER "$EXPO_OWNER"
set_variable EXPO_ANDROID_PACKAGE "$EXPO_ANDROID_PACKAGE"
set_variable EXPO_IOS_BUNDLE_IDENTIFIER "$EXPO_IOS_BUNDLE_IDENTIFIER"

echo "Done. If you also want to upload the Google Play service account JSON, run:\n  gh secret set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON --body '$(cat /dev/null)'
Replace the body with the JSON file contents or run: gh secret set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON --body "$(cat path/to/service-account.json)""

exit 0
