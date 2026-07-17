#!/usr/bin/env bash
# Build and upload a Ghost theme via the Admin API.
#
# Usage:
#   .github/deploy-theme.sh --url <ghost-url> --key <id:secret> [options]
#
# Required:
#   --url URL          Ghost site URL (Admin API base)
#   --key ID:SECRET    Ghost Admin API key
#
# Options:
#   --api-version VER  Admin API Accept-Version header (default: v6.0)
#   --skip-build       Upload an existing zip without rebuilding
#   --zip PATH         Use a specific zip file (implies --skip-build)
#   -h, --help         Show this help

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_URL=""
API_KEY=""
API_VERSION="v6.0"
SKIP_BUILD=0
ZIP_PATH=""

usage() {
  sed -n '2,16p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      API_URL="${2:?--url requires a value}"
      shift 2
      ;;
    --key)
      API_KEY="${2:?--key requires a value}"
      shift 2
      ;;
    --api-version)
      API_VERSION="${2:?--api-version requires a value}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --zip)
      ZIP_PATH="${2:?--zip requires a path}"
      SKIP_BUILD=1
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$API_URL" ]]; then
  echo "Missing required --url" >&2
  usage >&2
  exit 1
fi

if [[ -z "$API_KEY" ]]; then
  echo "Missing required --key" >&2
  usage >&2
  exit 1
fi

API_URL="${API_URL%/}"
THEME_NAME="$(node -p "require('./package.json').name")"
DEFAULT_ZIP="${THEME_NAME}.zip"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "→ Building theme zip…"
  npm run zip
  ZIP_PATH="$DEFAULT_ZIP"
fi

if [[ -z "$ZIP_PATH" ]]; then
  ZIP_PATH="$DEFAULT_ZIP"
fi

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "Zip not found: $ZIP_PATH" >&2
  exit 1
fi

echo "→ Creating Admin API JWT…"
TOKEN="$(
  GHOST_ADMIN_API_KEY="$API_KEY" node <<'NODE'
const crypto = require('node:crypto');

const key = process.env.GHOST_ADMIN_API_KEY;
const [id, secret] = key.split(':');
if (!id || !secret) {
  console.error('--key must look like id:secret');
  process.exit(1);
}

const b64url = (value) =>
  Buffer.from(value).toString('base64url');

const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id }));
const now = Math.floor(Date.now() / 1000);
const payload = b64url(
  JSON.stringify({ iat: now, exp: now + 5 * 60, aud: '/admin/' }),
);
const unsigned = `${header}.${payload}`;
const signature = crypto
  .createHmac('sha256', Buffer.from(secret, 'hex'))
  .update(unsigned)
  .digest('base64url');

process.stdout.write(`${unsigned}.${signature}`);
NODE
)"

UPLOAD_URL="${API_URL}/ghost/api/admin/themes/upload/"

echo "→ Uploading $(basename "$ZIP_PATH") ($(du -h "$ZIP_PATH" | awk '{print $1}')) to ${UPLOAD_URL}"
HTTP_CODE="$(
  curl --silent --show-error --fail-with-body \
    --connect-timeout 15 \
    --max-time 120 \
    -o /tmp/ghost-theme-upload.json \
    -w "%{http_code}" \
    -X POST \
    -H "Authorization: Ghost ${TOKEN}" \
    -H "Accept-Version: ${API_VERSION}" \
    -F "file=@${ZIP_PATH};type=application/zip" \
    "$UPLOAD_URL"
)"

echo "← HTTP ${HTTP_CODE}"
if command -v jq >/dev/null 2>&1; then
  jq . /tmp/ghost-theme-upload.json
else
  cat /tmp/ghost-theme-upload.json
  echo
fi

echo "Done. Activate the theme in Ghost Admin if it is not already active."
