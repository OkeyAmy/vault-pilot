#!/usr/bin/env bash
# Runs one tournament epoch every INTERVAL_SECONDS (default 1h).
#
# Anchored receipts only prove precedence if their timestamps are genuinely
# spread over time, so start this early and leave it running.
#
#   ./scripts/run-epochs.sh                  # hourly
#   INTERVAL_SECONDS=900 ./scripts/run-epochs.sh   # every 15 minutes
set -u

INTERVAL="${INTERVAL_SECONDS:-3600}"
cd "$(dirname "$0")/.."

echo "epoch runner starting; interval=${INTERVAL}s"

while true; do
  echo "=== epoch at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  # A single failed epoch (rate limit, RPC blip) must not kill the run.
  if ! pnpm epoch; then
    echo "epoch failed at $(date -u +%Y-%m-%dT%H:%M:%SZ), continuing"
  fi
  sleep "$INTERVAL"
done
