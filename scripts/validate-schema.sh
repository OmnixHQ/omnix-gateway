#!/usr/bin/env bash
set -euo pipefail

# UCP Schema Validation — validates gateway responses against official UCP JSON Schemas
# using ucp-schema CLI (https://github.com/Universal-Commerce-Protocol/ucp-schema)
#
# Prerequisites:
#   - ucp-schema CLI installed (cargo install ucp-schema)
#   - UCP spec repo cloned at $UCP_SPEC_DIR (or ./tests/ucp-spec)
#   - Gateway running at $UCP_BASE_URL (default: http://localhost:3000)
#
# Usage:
#   UCP_BASE_URL=http://localhost:3000 bash scripts/validate-schema.sh

UCP_BASE_URL="${UCP_BASE_URL:-http://localhost:3000}"
UCP_SPEC_DIR="${UCP_SPEC_DIR:-./tests/ucp-spec}"
SCHEMA_BASE="$UCP_SPEC_DIR/source"
SCHEMA_REMOTE_BASE="https://ucp.dev"
AGENT_HEADER="UCP-Agent: schema-validator/1.0"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

PASS=0
FAIL=0
SKIP=0

validate_payload() {
  local label="$1"
  local file="$2"
  local op="$3"

  result=$(ucp-schema validate "$file" \
    --op "$op" \
    --schema-local-base "$SCHEMA_BASE" \
    --schema-remote-base "$SCHEMA_REMOTE_BASE" \
    --json 2>&1) || true

  valid=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('valid',False))" 2>/dev/null || echo "False")

  if [ "$valid" = "True" ]; then
    echo "  [PASS] $label"
    PASS=$((PASS+1))
  else
    errmsg=$(echo "$result" | python3 -c "import sys,json; errs=json.load(sys.stdin).get('errors',[]); print(errs[0]['message'][:100] if errs else 'unknown')" 2>/dev/null || echo "$result")
    echo "  [FAIL] $label — $errmsg"
    FAIL=$((FAIL+1))
  fi
}

wrap_with_ucp_metadata() {
  local input="$1"
  local output="$2"
  local caps_json="$3"

  python3 -c "
import json, sys
with open('$input') as f:
    d = json.load(f)
d['ucp'] = {
    'version': '2026-01-23',
    'capabilities': $caps_json,
    'payment_handlers': {
        'dev.ucp.payment.mock': [{'id': 'mock-pay', 'version': '2026-01-23', 'schema': '$SCHEMA_REMOTE_BASE/schemas/shopping/payment.json'}]
    }
}
with open('$output', 'w') as f:
    json.dump(d, f)
"
}

CHECKOUT_CAPS='{
  "dev.ucp.shopping.checkout": [{"version": "2026-01-23", "schema": "https://ucp.dev/schemas/shopping/checkout.json"}],
  "dev.ucp.shopping.fulfillment": [{"version": "2026-01-23", "schema": "https://ucp.dev/schemas/shopping/fulfillment.json", "extends": "dev.ucp.shopping.checkout"}],
  "dev.ucp.shopping.discount": [{"version": "2026-01-23", "schema": "https://ucp.dev/schemas/shopping/discount.json", "extends": "dev.ucp.shopping.checkout"}]
}'

CATALOG_SEARCH_CAPS='{"dev.ucp.shopping.catalog": [{"version": "2026-01-23", "schema": "https://ucp.dev/schemas/shopping/catalog_search.json"}]}'
CATALOG_LOOKUP_CAPS='{"dev.ucp.shopping.catalog": [{"version": "2026-01-23", "schema": "https://ucp.dev/schemas/shopping/catalog_lookup.json"}]}'

echo "================================================================"
echo "  UCP Schema Validation (ucp-schema $(ucp-schema --version 2>/dev/null || echo 'unknown'))"
echo "  Gateway: $UCP_BASE_URL"
echo "  Schemas: $SCHEMA_BASE"
echo "================================================================"
echo ""

if ! command -v ucp-schema &>/dev/null; then
  echo "ERROR: ucp-schema CLI not found. Install with: cargo install ucp-schema"
  exit 2
fi

if [ ! -d "$SCHEMA_BASE/schemas" ]; then
  echo "ERROR: UCP spec schemas not found at $SCHEMA_BASE/schemas"
  echo "Clone the spec: git clone --depth 1 https://github.com/Universal-Commerce-Protocol/ucp.git $UCP_SPEC_DIR"
  exit 2
fi

TS=$(date +%s)

echo "  Checkout Capability"
echo "  -------------------"

curl -sf -X POST "$UCP_BASE_URL/checkout-sessions" \
  -H "Content-Type: application/json" -H "$AGENT_HEADER" -H "idempotency-key: schema-create-$TS" \
  -d '{"currency":"USD","line_items":[{"quantity":1,"item":{"id":"bouquet_roses","title":"Red Rose"}}],"payment":{"instruments":[],"selected_instrument_id":"instr_1","handlers":[]},"fulfillment":{"methods":[{"type":"shipping","destinations":[{"id":"d1","street_address":"123 Main","address_locality":"Springfield","address_region":"IL","postal_code":"62704","address_country":"US"}],"selected_destination_id":"d1","groups":[{"selected_option_id":"std-ship"}]}]}}' \
  > "$TMPDIR/checkout-create.json" 2>/dev/null

CID=$(python3 -c "import json; print(json.load(open('$TMPDIR/checkout-create.json'))['id'])")

wrap_with_ucp_metadata "$TMPDIR/checkout-create.json" "$TMPDIR/checkout-create-sd.json" "$CHECKOUT_CAPS"
validate_payload "checkout create (op=create)" "$TMPDIR/checkout-create-sd.json" "create"

curl -sf "$UCP_BASE_URL/checkout-sessions/$CID" \
  -H "$AGENT_HEADER" > "$TMPDIR/checkout-read.json" 2>/dev/null
wrap_with_ucp_metadata "$TMPDIR/checkout-read.json" "$TMPDIR/checkout-read-sd.json" "$CHECKOUT_CAPS"
validate_payload "checkout read (op=read)" "$TMPDIR/checkout-read-sd.json" "read"

curl -sf -X PUT "$UCP_BASE_URL/checkout-sessions/$CID" \
  -H "Content-Type: application/json" -H "$AGENT_HEADER" -H "idempotency-key: schema-update-$TS" \
  -d "{\"id\":\"$CID\",\"currency\":\"USD\",\"line_items\":[{\"quantity\":2,\"item\":{\"id\":\"bouquet_roses\",\"title\":\"Red Rose\"}}],\"payment\":{\"instruments\":[],\"selected_instrument_id\":\"instr_1\",\"handlers\":[]},\"fulfillment\":{\"methods\":[{\"type\":\"shipping\",\"destinations\":[{\"id\":\"d1\",\"street_address\":\"123 Main\",\"address_locality\":\"Springfield\",\"address_region\":\"IL\",\"postal_code\":\"62704\",\"address_country\":\"US\"}],\"selected_destination_id\":\"d1\",\"groups\":[{\"selected_option_id\":\"std-ship\"}]}]}}" \
  > "$TMPDIR/checkout-update.json" 2>/dev/null
wrap_with_ucp_metadata "$TMPDIR/checkout-update.json" "$TMPDIR/checkout-update-sd.json" "$CHECKOUT_CAPS"
validate_payload "checkout update (op=update)" "$TMPDIR/checkout-update-sd.json" "update"

C2=$(curl -sf -X POST "$UCP_BASE_URL/checkout-sessions" \
  -H "Content-Type: application/json" -H "$AGENT_HEADER" -H "idempotency-key: schema-cancel-create-$TS" \
  -d '{"currency":"USD","line_items":[{"quantity":1,"item":{"id":"bouquet_roses","title":"Red Rose"}}],"payment":{"instruments":[],"selected_instrument_id":"instr_1","handlers":[]}}' 2>/dev/null)
CID2=$(echo "$C2" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -sf -X POST "$UCP_BASE_URL/checkout-sessions/$CID2/cancel" \
  -H "$AGENT_HEADER" -H "idempotency-key: schema-cancel-$TS" \
  > "$TMPDIR/checkout-cancel.json" 2>/dev/null
wrap_with_ucp_metadata "$TMPDIR/checkout-cancel.json" "$TMPDIR/checkout-cancel-sd.json" "$CHECKOUT_CAPS"
validate_payload "checkout cancel (op=read)" "$TMPDIR/checkout-cancel-sd.json" "read"

echo ""
echo "  Catalog Capability"
echo "  ------------------"

curl -sf "$UCP_BASE_URL/ucp/catalog/search?q=roses" \
  -H "$AGENT_HEADER" > "$TMPDIR/catalog-search.json" 2>/dev/null
wrap_with_ucp_metadata "$TMPDIR/catalog-search.json" "$TMPDIR/catalog-search-sd.json" "$CATALOG_SEARCH_CAPS"
validate_payload "catalog search (op=read)" "$TMPDIR/catalog-search-sd.json" "read"

curl -sf "$UCP_BASE_URL/ucp/products/bouquet_roses" \
  -H "$AGENT_HEADER" > "$TMPDIR/catalog-lookup.json" 2>/dev/null
wrap_with_ucp_metadata "$TMPDIR/catalog-lookup.json" "$TMPDIR/catalog-lookup-sd.json" "$CATALOG_LOOKUP_CAPS"
validate_payload "catalog lookup (op=read)" "$TMPDIR/catalog-lookup-sd.json" "read"

echo ""
echo "  Schema Lint"
echo "  -----------"
LINT_RESULT=$(ucp-schema lint "$SCHEMA_BASE/schemas/" 2>&1)
LINT_EXIT=$?
if [ $LINT_EXIT -eq 0 ]; then
  LINT_COUNT=$(echo "$LINT_RESULT" | grep -oE '[0-9]+ files checked' || echo "unknown")
  echo "  [PASS] spec schemas lint ($LINT_COUNT)"
  PASS=$((PASS+1))
else
  echo "  [FAIL] spec schemas lint"
  echo "$LINT_RESULT" | tail -5
  FAIL=$((FAIL+1))
fi

echo ""
echo "================================================================"
TOTAL=$((PASS+FAIL+SKIP))
echo "  RESULTS: $PASS/$TOTAL passed, $FAIL failed, $SKIP skipped"
echo "================================================================"

if [ $FAIL -gt 0 ]; then
  exit 1
fi
