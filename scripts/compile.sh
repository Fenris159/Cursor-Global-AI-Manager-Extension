#!/bin/sh
# Compile the extension. Run from project root: ./scripts/compile.sh
# Finds node via PATH or common install locations (no personal paths in script).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE=""

if command -v node >/dev/null 2>&1; then
  NODE="node"
elif [ -x "/usr/local/bin/node" ]; then
  NODE="/usr/local/bin/node"
elif [ -x "/opt/homebrew/bin/node" ]; then
  NODE="/opt/homebrew/bin/node"
fi

if [ -z "$NODE" ]; then
  echo "Node.js was not found. Install from https://nodejs.org or add Node to your PATH."
  exit 1
fi

cd "$ROOT"
exec "$NODE" "$SCRIPT_DIR/compile.js"
