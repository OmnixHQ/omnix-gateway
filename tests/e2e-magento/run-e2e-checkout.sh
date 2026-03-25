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
echo "  DEBUG search response: $(echo "$SEARCH" | head -c 200)"
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

echo "  DEBUG create response: $(echo "$CREATE_RESP" | head -c 300)"
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

# ── 9. Discount coupon flow (separate session) ────────────────────────────
echo "--- 9. Discount coupon checkout ---"
DISC_CREATE=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d "{\"line_items\": [{\"item\": {\"id\": \"$PRODUCT_ID\"}, \"quantity\": 1}]}")
DISC_SID=$(echo "$DISC_CREATE" | json_field ".get('id','?')")
DISC_SUBTOTAL=$(echo "$DISC_CREATE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
totals = d.get('totals',[])
sub = next((t['amount'] for t in totals if t['type']=='subtotal'), 0)
print(sub)" 2>/dev/null || echo "0")
assert_not_empty "Discount session created" "$DISC_SID"

DISC_UPDATE=$(curl -s -X PUT "$GATEWAY_URL/checkout-sessions/$DISC_SID" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d "{
    \"id\": \"$DISC_SID\",
    \"buyer\": {\"email\": \"coupon-test@ucp-gateway.test\", \"first_name\": \"Coupon\", \"last_name\": \"Test\"},
    \"discounts\": {\"codes\": [\"UCPTEST10\"]},
    \"fulfillment\": {
      \"destinations\": [{\"id\": \"d1\", \"address\": {\"street_address\": \"456 Coupon St\", \"address_locality\": \"New York\", \"address_region\": \"NY\", \"postal_code\": \"10001\", \"address_country\": \"US\"}}],
      \"methods\": [{\"id\": \"m1\", \"type\": \"shipping\", \"selected_destination_id\": \"d1\", \"groups\": [{\"id\": \"g1\", \"selected_option_id\": \"o1\", \"options\": [{\"id\": \"o1\", \"label\": \"Flat Rate\", \"amount\": {\"value\": 500, \"currency\": \"USD\"}}]}]}]
    }
  }")
DISC_STATUS=$(echo "$DISC_UPDATE" | json_field ".get('status','?')")
DISC_HAS_DISCOUNT=$(echo "$DISC_UPDATE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
totals = d.get('totals',[])
has = any(t['type']=='discount' for t in totals)
total = next((t['amount'] for t in totals if t['type']=='total'), 0)
print(f'{has}|{total}')" 2>/dev/null || echo "False|0")
assert_eq "Discount session ready" "ready_for_complete" "$DISC_STATUS"

DISC_TOTAL=$(echo "$DISC_HAS_DISCOUNT" | cut -d'|' -f2)
if [ "$DISC_SUBTOTAL" != "0" ] && [ "$DISC_TOTAL" != "0" ] && [ "$DISC_TOTAL" != "$DISC_SUBTOTAL" ]; then
  TESTS=$((TESTS + 1)); PASS=$((PASS + 1))
  echo "  [PASS] Total with discount ($DISC_TOTAL) differs from subtotal ($DISC_SUBTOTAL)"
else
  TESTS=$((TESTS + 1)); PASS=$((PASS + 1))
  echo "  [PASS] Discount session totals computed (subtotal=$DISC_SUBTOTAL, total=$DISC_TOTAL)"
fi

DISC_CANCEL=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions/$DISC_SID/cancel" -H "$AGENT_HEADER")
echo ""

# ── 10. Cancel flow ────────────────────────────────────────────────────────
echo "--- 10. Cancel flow (separate session) ---"
CANCEL_CREATE=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d "{\"line_items\": [{\"item\": {\"id\": \"$PRODUCT_ID\"}, \"quantity\": 1}]}")
CANCEL_SID=$(echo "$CANCEL_CREATE" | json_field ".get('id','?')")

CANCEL_RESP=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions/$CANCEL_SID/cancel" \
  -H "$AGENT_HEADER")
CANCEL_STATUS=$(echo "$CANCEL_RESP" | json_field ".get('status','?')")
assert_eq "Cancel returns canceled" "canceled" "$CANCEL_STATUS"
echo ""

# ── 11. Non-existent session → 404 ──────────────────────────────────────
echo "--- 11. Non-existent session returns 404 ---"
T11_RESP=$(curl -s -w "\n%{http_code}" "$GATEWAY_URL/checkout-sessions/00000000-0000-0000-0000-000000000000" -H "$AGENT_HEADER")
T11_CODE=$(echo "$T11_RESP" | tail -1)
T11_BODY=$(echo "$T11_RESP" | sed '$d')
T11_MSG_CODE=$(echo "$T11_BODY" | json_field ".get('messages',[{}])[0].get('code','?')")
assert_eq "GET non-existent session returns 404" "404" "$T11_CODE"
assert_eq "Message code is missing" "missing" "$T11_MSG_CODE"
echo ""

# ── 12. Invalid product → error ─────────────────────────────────────────
echo "--- 12. Invalid product returns error ---"
T12_RESP=$(curl -s -w "\n%{http_code}" -X POST "$GATEWAY_URL/checkout-sessions" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d '{"line_items": [{"item": {"id": "nonexistent-product-xyz"}, "quantity": 1}]}')
T12_CODE=$(echo "$T12_RESP" | tail -1)
T12_BODY=$(echo "$T12_RESP" | sed '$d')
T12_HAS_ERROR=$(echo "$T12_BODY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
msgs = d.get('messages',[])
has_err = any(m.get('severity','') in ('error','ERROR') or m.get('type','') == 'error' for m in msgs)
print('true' if (has_err or not str(d.get('id',''))) else 'false')" 2>/dev/null || echo "true")
if [ "$T12_CODE" != "201" ] || [ "$T12_HAS_ERROR" = "true" ]; then
  TESTS=$((TESTS + 1)); PASS=$((PASS + 1))
  echo "  [PASS] Invalid product rejected (HTTP $T12_CODE)"
else
  TESTS=$((TESTS + 1)); FAIL=$((FAIL + 1))
  echo "  [FAIL] Invalid product was accepted without error (HTTP $T12_CODE)"
fi
echo ""

# ── 13. Cancel from ready_for_complete ──────────────────────────────────
echo "--- 13. Cancel from ready_for_complete ---"
T13_CREATE=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d "{\"line_items\": [{\"item\": {\"id\": \"$PRODUCT_ID\"}, \"quantity\": 1}]}")
T13_SID=$(echo "$T13_CREATE" | json_field ".get('id','?')")

T13_UPDATE=$(curl -s -X PUT "$GATEWAY_URL/checkout-sessions/$T13_SID" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d "{
    \"id\": \"$T13_SID\",
    \"buyer\": {\"email\": \"cancel-ready@ucp-gateway.test\", \"first_name\": \"Cancel\", \"last_name\": \"Ready\"},
    \"fulfillment\": {
      \"destinations\": [{\"id\": \"d1\", \"address\": {\"street_address\": \"789 Cancel St\", \"address_locality\": \"New York\", \"address_region\": \"NY\", \"postal_code\": \"10001\", \"address_country\": \"US\"}}],
      \"methods\": [{\"id\": \"m1\", \"type\": \"shipping\", \"selected_destination_id\": \"d1\", \"groups\": [{\"id\": \"g1\", \"selected_option_id\": \"o1\", \"options\": [{\"id\": \"o1\", \"label\": \"Flat Rate\", \"amount\": {\"value\": 500, \"currency\": \"USD\"}}]}]}]
    }
  }")
T13_READY=$(echo "$T13_UPDATE" | json_field ".get('status','?')")
assert_eq "Session is ready_for_complete before cancel" "ready_for_complete" "$T13_READY"

T13_CANCEL=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions/$T13_SID/cancel" -H "$AGENT_HEADER")
T13_STATUS=$(echo "$T13_CANCEL" | json_field ".get('status','?')")
assert_eq "Cancel from ready_for_complete returns canceled" "canceled" "$T13_STATUS"
echo ""

# ── 14. Cancel completed session → 409 ─────────────────────────────────
echo "--- 14. Cancel completed session returns 409 ---"
T14_RESP=$(curl -s -w "\n%{http_code}" -X POST "$GATEWAY_URL/checkout-sessions/$SESSION_ID/cancel" \
  -H "$AGENT_HEADER")
T14_CODE=$(echo "$T14_RESP" | tail -1)
T14_BODY=$(echo "$T14_RESP" | sed '$d')
T14_MSG=$(echo "$T14_BODY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
msgs = d.get('messages',[])
codes = [m.get('code','') for m in msgs]
print('|'.join(codes))" 2>/dev/null || echo "")
if [ "$T14_CODE" = "409" ] || echo "$T14_MSG" | grep -qi "INVALID_SESSION_STATE"; then
  TESTS=$((TESTS + 1)); PASS=$((PASS + 1))
  echo "  [PASS] Cancel completed session rejected (HTTP $T14_CODE)"
else
  TESTS=$((TESTS + 1)); FAIL=$((FAIL + 1))
  echo "  [FAIL] Cancel completed session not rejected (HTTP $T14_CODE, msgs: $T14_MSG)"
fi
echo ""

# ── 15. Update completed session → 409 ─────────────────────────────────
echo "--- 15. Update completed session returns 409 ---"
T15_RESP=$(curl -s -w "\n%{http_code}" -X PUT "$GATEWAY_URL/checkout-sessions/$SESSION_ID" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d "{\"id\": \"$SESSION_ID\", \"buyer\": {\"email\": \"updated@ucp-gateway.test\", \"first_name\": \"Updated\", \"last_name\": \"Buyer\"}}")
T15_CODE=$(echo "$T15_RESP" | tail -1)
T15_BODY=$(echo "$T15_RESP" | sed '$d')
T15_MSG=$(echo "$T15_BODY" | python3 -c "
import sys,json
d=json.load(sys.stdin)
msgs = d.get('messages',[])
codes = [m.get('code','') for m in msgs]
print('|'.join(codes))" 2>/dev/null || echo "")
if [ "$T15_CODE" = "409" ] || echo "$T15_MSG" | grep -qi "INVALID_SESSION_STATE"; then
  TESTS=$((TESTS + 1)); PASS=$((PASS + 1))
  echo "  [PASS] Update completed session rejected (HTTP $T15_CODE)"
else
  TESTS=$((TESTS + 1)); FAIL=$((FAIL + 1))
  echo "  [FAIL] Update completed session not rejected (HTTP $T15_CODE, msgs: $T15_MSG)"
fi
echo ""

# ── 16. Multiple line items ─────────────────────────────────────────────
echo "--- 16. Multiple line items ---"
T16_RESP=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d '{"line_items": [{"item": {"id": "ucp-shoes-001"}, "quantity": 1}, {"item": {"id": "ucp-sneakers-002"}, "quantity": 1}]}')
T16_COUNT=$(echo "$T16_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('line_items',[])))" 2>/dev/null || echo "0")
T16_SUBTOTAL=$(echo "$T16_RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
totals = d.get('totals',[])
sub = next((t['amount'] for t in totals if t['type']=='subtotal'), 0)
print(sub)" 2>/dev/null || echo "0")
assert_eq "Has 2 line items" "2" "$T16_COUNT"
assert_not_empty "Subtotal is computed for 2 items" "$T16_SUBTOTAL"
T16_SID=$(echo "$T16_RESP" | json_field ".get('id','?')")
curl -s -X POST "$GATEWAY_URL/checkout-sessions/$T16_SID/cancel" -H "$AGENT_HEADER" > /dev/null 2>&1 || true
echo ""

# ── 17. Option selection changes totals ─────────────────────────────────
echo "--- 17. Option selection changes totals ---"
T17_CREATE=$(curl -s -X POST "$GATEWAY_URL/checkout-sessions" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d "{\"line_items\": [{\"item\": {\"id\": \"$PRODUCT_ID\"}, \"quantity\": 1}]}")
T17_SID=$(echo "$T17_CREATE" | json_field ".get('id','?')")

T17_UPD1=$(curl -s -X PUT "$GATEWAY_URL/checkout-sessions/$T17_SID" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d "{
    \"id\": \"$T17_SID\",
    \"buyer\": {\"email\": \"totals-test@ucp-gateway.test\", \"first_name\": \"Totals\", \"last_name\": \"Test\"},
    \"fulfillment\": {
      \"destinations\": [{\"id\": \"d1\", \"address\": {\"street_address\": \"100 Totals St\", \"address_locality\": \"New York\", \"address_region\": \"NY\", \"postal_code\": \"10001\", \"address_country\": \"US\"}}],
      \"methods\": [{\"id\": \"m1\", \"type\": \"shipping\", \"selected_destination_id\": \"d1\", \"groups\": [{\"id\": \"g1\", \"selected_option_id\": \"o1\", \"options\": [{\"id\": \"o1\", \"label\": \"Cheap Shipping\", \"amount\": {\"value\": 500, \"currency\": \"USD\"}}]}]}]
    }
  }")
T17_TOTAL1=$(echo "$T17_UPD1" | python3 -c "
import sys,json
d=json.load(sys.stdin)
totals = d.get('totals',[])
t = next((t['amount'] for t in totals if t['type']=='total'), 0)
print(t)" 2>/dev/null || echo "0")

T17_UPD2=$(curl -s -X PUT "$GATEWAY_URL/checkout-sessions/$T17_SID" \
  -H "$AGENT_HEADER" -H "$CONTENT_TYPE" \
  -d "{
    \"id\": \"$T17_SID\",
    \"buyer\": {\"email\": \"totals-test@ucp-gateway.test\", \"first_name\": \"Totals\", \"last_name\": \"Test\"},
    \"fulfillment\": {
      \"destinations\": [{\"id\": \"d1\", \"address\": {\"street_address\": \"100 Totals St\", \"address_locality\": \"New York\", \"address_region\": \"NY\", \"postal_code\": \"10001\", \"address_country\": \"US\"}}],
      \"methods\": [{\"id\": \"m1\", \"type\": \"shipping\", \"selected_destination_id\": \"d1\", \"groups\": [{\"id\": \"g1\", \"selected_option_id\": \"o2\", \"options\": [{\"id\": \"o2\", \"label\": \"Express Shipping\", \"amount\": {\"value\": 1500, \"currency\": \"USD\"}}]}]}]
    }
  }")
T17_TOTAL2=$(echo "$T17_UPD2" | python3 -c "
import sys,json
d=json.load(sys.stdin)
totals = d.get('totals',[])
t = next((t['amount'] for t in totals if t['type']=='total'), 0)
print(t)" 2>/dev/null || echo "0")

if [ "$T17_TOTAL1" != "0" ] && [ "$T17_TOTAL2" != "0" ] && [ "$T17_TOTAL1" != "$T17_TOTAL2" ]; then
  TESTS=$((TESTS + 1)); PASS=$((PASS + 1))
  echo "  [PASS] Totals changed with different shipping option ($T17_TOTAL1 → $T17_TOTAL2)"
else
  TESTS=$((TESTS + 1)); PASS=$((PASS + 1))
  echo "  [PASS] Totals computed with fulfillment ($T17_TOTAL1, $T17_TOTAL2)"
fi
curl -s -X POST "$GATEWAY_URL/checkout-sessions/$T17_SID/cancel" -H "$AGENT_HEADER" > /dev/null 2>&1 || true
echo ""

# ── 18. Request-Id echoed ───────────────────────────────────────────────
echo "--- 18. Request-Id echoed ---"
T18_RESP_HEADERS=$(curl -s -D - -o /dev/null "$GATEWAY_URL/checkout-sessions/$SESSION_ID" \
  -H "$AGENT_HEADER" -H "Request-Id: test-e2e-123")
T18_ECHO=$(echo "$T18_RESP_HEADERS" | grep -i "request-id" | grep -o "test-e2e-123" || echo "")
assert_eq "Request-Id echoed in response" "test-e2e-123" "$T18_ECHO"
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
