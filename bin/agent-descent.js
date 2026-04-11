#!/bin/sh
REAL_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
exec "$REAL_DIR/../node_modules/.bin/tsx" "$REAL_DIR/../src/index.ts" "$@"
