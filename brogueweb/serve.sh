#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/brogueweb/dist"
PORT="${1:-8080}"

if [ ! -d "$DIST_DIR" ]; then
  echo "error: $DIST_DIR does not exist. Run ./brogueweb/build_web.sh first."
  exit 1
fi

cd "$DIST_DIR"
python3 -m http.server "$PORT"
