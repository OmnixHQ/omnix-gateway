#!/usr/bin/env bash
set -euo pipefail

##
# E2E Magento checkout test via UCP Gateway.
# Tests the full flow: search → create → update → complete → verify order.
#
# Usage:
#   bash tests/e2e-magento/run-e2e-checkout.sh
#
# Prerequisites:
#   - Magento running with seeded products
#   - UCP Gateway running on GATEWAY_URL
#   - Tenant configured pointing to Magento
##

GATEWAY_URL="${GATEWAY_URL:-http://localhost:3000}"
AGENT_HEADER="UCP-Agent: e2e-test/1.0"
CONTENT_TYPE="Content-Type: application/json"

PASS=0
FAIL=0
TESTS=0

# ── Test helper ────────────────────────────────────────────────────────────
assert_eq() {
  local label="$1" expected="$2" actual="$3"
  TESTS=$((TESTS + 1))
  if [ "$expected" = "$actual" ]; then
    echo "  [PASS] $label"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label — expected '$expected', got '$actual'"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_empty() {
  local label="$1" value="$2"
  TESTS=$((TESTS + 1))
  if [ -n "$value" ] && [ "$value" != "null" ] && [ "$value" != "None" ] && [ "$value" != "" ]; then
    echo "  [PASS] $label ($value)"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label — value is empty/null"
    FAIL=$((FAIL + 1))
  fi
}

json_field() {
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d${1})" 2>/dev/null || echo "PARSE_ERROR"
}

echo "========================================="
echo "  Magento E2E Checkout Test"
echo "  Gateway: $GATEWAY_URL"
echo "========================================="
echo ""

# ── 1. Health check ────────────────────────────────────────────────────────
echo "--- 1. Gateway health check ---"
HEALTH=$(curl -s "$GATEWAY_URL/health" | json_field ".get('status','?')")
assert_eq "GET /health returns ok" "ok" "$HEALTH"
echo ""

# ── 2. Discovery ───────────────────────────────────────────────────────────
echo "--- 2. UCP profile discovery ---"
PROFILE=$(curl -s "$GATEWAY_URL/.well-known/ucp" -H "$AGENT_HEADER")
PROFILE_NAME=$(echo "$PROFILE" | json_field ".get('business',{}).get('name','?')")
assert_not_empty "Profile has business name" "$PROFILE_NAME"
echo ""

# ── 3. Product search ─────────────────────────────────────────────────────
echo "--- 3. Product search ---"
SEARCH=$(curl -s "$GATEWAY_URL/ucp/products?q=shoes" -H "$AGENT_HEADER")
PRODUCT_ID=$(echo "$SEARCH" | python3 -c "
import sys,json
d=json.load(sys.stdin)
items = d if isinstance(d, list) else d.get('products', d.get('items', []))
if isinstance(items, list) and len(items) > 0:
  print(items[0].get('id', '?'))
else:
  print('NO_PRODUCTS')
" 2>/dev/null || echo "PARSE_ERROR")
assert_not_empty "Product search returns results" "$PRODUCT_ID"
echo "  Product ID for checkout: $PRODUCT_ID"
echo ""

# ── 4. Create checkout session ─────────────────────────────────────────────
echo "--- 4. Create checkout session ---"
CREATE_RESP=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d "{\"line_items\": [{\"item\": {\"id\": \"$PRODUCT_ID\"}, \"quantity\": 1}]}")

SESSION_ID=$(echo "$CREATE_RESP" | json_field ".get('id','?')")
SESSION_STATUS=$(echo "$CREATE_RESP" | json_field ".get('status','?')")
LINE_ITEMS_COUNT=$(echo "$CREATE_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('line_items',[])))" 2>/dev/null || echo "0")

assert_not_empty "Session ID created" "$SESSION_ID"
assert_eq "Session status is incomplete" "incomplete" "$SESSION_STATUS"
assert_eq "Has 1 line item" "1" "$LINE_ITEMS_COUNT"
echo ""

# ── 5. Update with buyer + fulfillment ─────────────────────────────────────
echo "--- 5. Update session (buyer + fulfillment) ---"
UPDATE_RESP=$(curl -s -X PUT "$GATEWAY_URL/checkout-sessions/$SESSION_ID" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d "{
    \"id\": \"$SESSION_ID\",
    \"buyer\": {
      \"email\": \"e2e-test@ucp-gateway.test\",
      \"first_name\": \"E2E\",
      \"last_name\": \"Test\"
    },
    \"fulfillment\": {
      \"destinations\": [{
        \"id\": \"dest-1\",
        \"address\": {
          \"street_address\": \"123 Test St\",
          \"address_locality\": \"New York\",
          \"address_region\": \"NY\",
          \"postal_code\": \"10001\",
          \"address_country\": \"US\"
        }
      }],
      \"methods\": [{
        \"id\": \"method-1\",
        \"type\": \"shipping\",
        \"selected_destination_id\": \"dest-1\",
        \"groups\": [{
          \"id\": \"group-1\",
          \"selected_option_id\": \"opt-flatrate\",
          \"options\": [{
            \"id\": \"opt-flatrate\",
            \"label\": \"Flat Rate\",
            \"amount\": {\"value\": 500, \"currency\": \"USD\"}
          }]
        }]
      }]
    }
  }")

UPDATE_STATUS=$(echo "$UPDATE_RESP" | json_field ".get('status','?')")
assert_eq "Session status is ready_for_complete" "ready_for_complete" "$UPDATE_STATUS"
echo ""

# ── 6. Complete checkout (place order) ─────────────────────────────────────
echo "--- 6. Complete checkout (place order on Magento) ---"
COMPLETE_RESP=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions/$SESSION_ID/complete" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d '{
    "payment": {
      "instruments": [{
        "id": "inst-1",
        "handler_id": "checkmo",
        "type": "offline",
        "selected": true,
        "credential": {"type": "check_money_order"}
      }]
    }
  }')

COMPLETE_STATUS=$(echo "$COMPLETE_RESP" | json_field ".get('status','?')")
ORDER_ID=$(echo "$COMPLETE_RESP" | json_field ".get('order',{}).get('id','?')")

assert_eq "Session status is completed" "completed" "$COMPLETE_STATUS"
assert_not_empty "Order ID returned" "$ORDER_ID"
echo ""

# ── 7. Verify session is completed (GET) ──────────────────────────────────
echo "--- 7. Verify session state ---"
GET_RESP=$(curl -s "$GATEWAY_URL/checkout-sessions/$SESSION_ID" -H "$AGENT_HEADER")
GET_STATUS=$(echo "$GET_RESP" | json_field ".get('status','?')")
assert_eq "GET session shows completed" "completed" "$GET_STATUS"
echo ""

# ── 8. Verify cannot complete again (idempotent) ──────────────────────────
echo "--- 8. Idempotency — complete again returns same result ---"
RETRY_RESP=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions/$SESSION_ID/complete" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d '{"payment": {"instruments": [{"id": "inst-1", "handler_id": "checkmo", "type": "offline", "selected": true, "credential": {"type": "checkmo"}}]}}')
RETRY_STATUS=$(echo "$RETRY_RESP" | json_field ".get('status','?')")
assert_eq "Re-complete returns completed (idempotent)" "completed" "$RETRY_STATUS"
echo ""

# ── 9. Cancel flow ─────────────────────────────────────────────────────────
echo "--- 9. Cancel flow (separate session) ---"
CANCEL_CREATE=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d "{\"line_items\": [{\"item\": {\"id\": \"$PRODUCT_ID\"}, \"quantity\": 1}]}")
CANCEL_SID=$(echo "$CANCEL_CREATE" | json_field ".get('id','?')")

CANCEL_RESP=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions/$CANCEL_SID/cancel" \
  -H "$AGENT_HEADER")
CANCEL_STATUS=$(echo "$CANCEL_RESP" | json_field ".get('status','?')")
assert_eq "Cancel returns canceled" "canceled" "$CANCEL_STATUS"
echo ""

# ── Summary ────────────────────────────────────────────────────────────────
echo "========================================="
echo "  Results: $PASS/$TESTS passed, $FAIL failed"
echo "========================================="

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "FAILED — $FAIL test(s) did not pass."
  exit 1
fi

echo ""
echo "ALL TESTS PASSED"
exit 0
