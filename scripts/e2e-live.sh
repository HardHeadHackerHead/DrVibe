#!/usr/bin/env bash
# Live end-to-end check of the desktop app against a local Dr. Vibe server.
#
# Start the server first (the Dr. Vibe server, which is not in this repo), on its own
# local database, never production:
#   docker exec drvibe-pg createdb -U drvibe desktope2e
#   DATABASE_URL=postgres://drvibe:drvibe@127.0.0.1:55433/desktope2e \
#   BIND_ADDR=127.0.0.1:8091 PUBLIC_URL=http://localhost:8091 JOBS_ENABLED=false \
#     cargo run -p drvibe-server
#
# Then run this from the desktop repo root:
#   DRVIBE_E2E_SERVER=http://localhost:8091 DRVIBE_E2E_DB=desktope2e scripts/e2e-live.sh
#
# It starts the e2e bridge (src-tauri/src/e2e_bridge.rs), runs
# tests/live/*.test.js through it, and stops the bridge.
set -euo pipefail
cd "$(dirname "$0")/.."

export DRVIBE_E2E_SERVER="${DRVIBE_E2E_SERVER:-http://localhost:8091}"
export DRVIBE_E2E_DB="${DRVIBE_E2E_DB:-desktope2e}"
PORT="${DRVIBE_E2E_BRIDGE_PORT:-8790}"
export DRVIBE_E2E_BRIDGE="http://127.0.0.1:$PORT"

curl -sf "$DRVIBE_E2E_SERVER/healthz" > /dev/null || { echo "no server at $DRVIBE_E2E_SERVER" >&2; exit 1; }

(cd src-tauri && cargo test --no-run -q)
(cd src-tauri && DR_VIBE_WEB_BASE_URL="$DRVIBE_E2E_SERVER" DRVIBE_E2E_BRIDGE_PORT="$PORT" \
  cargo test -q e2e_bridge -- --ignored --nocapture) &
BRIDGE=$!
trap 'curl -s -X POST "$DRVIBE_E2E_BRIDGE/shutdown" > /dev/null || true; wait $BRIDGE 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  curl -s -X POST "$DRVIBE_E2E_BRIDGE/invoke" -d '{"cmd":"get_profile"}' > /dev/null && break
  sleep 1
done

npx vitest run tests/live
