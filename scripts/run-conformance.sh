#!/usr/bin/env bash
set -euo pipefail

##
# Run UCP conformance tests against the gateway.
#
# Prerequisites:
#   - Python 3.10+ and uv installed
#   - Gateway running at $SERVER_URL (default: http://localhost:3000)
#
# Usage:
#   bash scripts/run-conformance.sh                    # run all tests
#   bash scripts/run-conformance.sh protocol_test.py   # run one test file
##

SERVER_URL="${SERVER_URL:-http://localhost:3000}"
SIMULATION_SECRET="${SIMULATION_SECRET:-super-secret}"
CONFORMANCE_DIR="tests/conformance"
INPUT="test_data/flower_shop/conformance_input.json"

if [ ! -d "$CONFORMANCE_DIR" ]; then
  echo "Conformance tests not found. Cloning..."
  mkdir -p tests
  git clone --depth 1 https://github.com/Universal-Commerce-Protocol/conformance.git "$CONFORMANCE_DIR"
  git clone --depth 1 https://github.com/Universal-Commerce-Protocol/python-sdk.git tests/sdk/python
fi

if [ ! -d "$CONFORMANCE_DIR/.venv" ]; then
  echo "Installing Python deps..."
  (cd "$CONFORMANCE_DIR" && uv sync)
fi

cd "$CONFORMANCE_DIR"

if [ $# -gt 0 ]; then
  uv run "$1" --server_url="$SERVER_URL" --simulation_secret="$SIMULATION_SECRET" --conformance_input="$INPUT"
else
  TOTAL=0
  PASSED=0
  FAILED=0
  for f in *_test.py; do
    echo "=== $f ==="
    if uv run "$f" --server_url="$SERVER_URL" --simulation_secret="$SIMULATION_SECRET" --conformance_input="$INPUT" 2>&1 | tail -3; then
      PASSED=$((PASSED + 1))
    else
      FAILED=$((FAILED + 1))
    fi
    TOTAL=$((TOTAL + 1))
    echo ""
  done
  echo "=============================="
  echo "Conformance: $PASSED/$TOTAL files passed, $FAILED failed"
fi
