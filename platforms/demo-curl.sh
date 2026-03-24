#!/usr/bin/env bash
set -euo pipefail

##
# Demo: Full checkout flow through UCP Gateway → Magento
#
# Prerequisites:
#   1. Magento running:  docker compose -f platforms/docker-compose.platforms.yml up -d
#   2. UCP DB + Redis:   docker compose -f docker-compose.dev.yml up -d
#   3. UCP server:       DATABASE_URL=postgresql://ucp:ucp@localhost:5433/ucp \
#                        REDIS_URL=redis://localhost:6380 \
#                        npx tsx apps/server/src/index.ts
#
# Usage:
#   bash platforms/demo-curl.sh
##

UCP="http://localhost:3000"
AGENT="UCP-Agent: demo-agent/1.0"
JSON="Content-Type: application/json"

echo "========================================="
echo "  UCP Gateway — Full Checkout Demo"
echo "========================================="
echo ""

echo "1. Discover store capabilities"
echo "   GET /.well-known/ucp"
curl -s "$UCP/.well-known/ucp" | python3 -m json.tool
echo ""

echo "2. Search products"
echo "   GET /ucp/products?q=shoes"
PRODUCTS=$(curl -s -H "$AGENT" "$UCP/ucp/products?q=shoes")
echo "$PRODUCTS" | python3 -m json.tool
PRODUCT_ID=$(echo "$PRODUCTS" | python3 -c "import sys,json; print(json.load(sys.stdin)['products'][0]['id'])")
echo ""

echo "3. Get product details"
echo "   GET /ucp/products/$PRODUCT_ID"
curl -s -H "$AGENT" "$UCP/ucp/products/$PRODUCT_ID" | python3 -m json.tool
echo ""

echo "4. Create checkout session"
echo "   POST /ucp/checkout-sessions"
SESSION=$(curl -s -H "$AGENT" -H "$JSON" -X POST "$UCP/ucp/checkout-sessions" -d '{}')
echo "$SESSION" | python3 -m json.tool
SESSION_ID=$(echo "$SESSION" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo ""

echo "5. Set shipping address → triggers ready_for_complete"
echo "   PATCH /ucp/checkout-sessions/$SESSION_ID"
curl -s -H "$AGENT" -H "$JSON" -X PATCH "$UCP/ucp/checkout-sessions/$SESSION_ID" \
  -d '{
    "shipping_address": {
      "first_name": "Jane",
      "last_name": "Doe",
      "line1": "123 Main St",
      "city": "Austin",
      "postal_code": "78701",
      "region": "TX",
      "country_iso2": "US"
    }
  }' | python3 -m json.tool
echo ""

echo "6. Complete checkout"
echo "   POST /ucp/checkout-sessions/$SESSION_ID/complete"
curl -s -H "$AGENT" -H "$JSON" -X POST "$UCP/ucp/checkout-sessions/$SESSION_ID/complete" \
  -d '{"payment": {"token": "demo_token", "provider": "checkmo"}}' | python3 -m json.tool
echo ""

echo "7. Verify session state"
echo "   GET /ucp/checkout-sessions/$SESSION_ID"
curl -s -H "$AGENT" "$UCP/ucp/checkout-sessions/$SESSION_ID" | python3 -m json.tool
echo ""

echo "========================================="
echo "  Demo complete!"
echo "========================================="
