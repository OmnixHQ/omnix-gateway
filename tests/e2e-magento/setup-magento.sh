#!/usr/bin/env bash
set -euo pipefail

##
# Set up Magento for E2E testing.
# Waits for Magento to be healthy, installs if needed, seeds products.
#
# Usage:
#   bash tests/e2e-magento/setup-magento.sh
#
# Prerequisites:
#   docker compose -f platforms/docker-compose.platforms.yml up -d
##

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

MAGENTO_URL="${MAGENTO_URL:-http://localhost:8080}"
MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-600}"

echo "=== Magento E2E Setup ==="
echo "Magento URL: $MAGENTO_URL"
echo ""

# ── 1. Wait for Magento to be healthy ──────────────────────────────────────
echo "1. Waiting for Magento web server (max ${MAX_WAIT_SECONDS}s)..."
elapsed=0
while [ "$elapsed" -lt "$MAX_WAIT_SECONDS" ]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${MAGENTO_URL}/" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" != "000" ]; then
    echo "   Web server responding (HTTP $HTTP_CODE) after ${elapsed}s."
    break
  fi
  sleep 5
  elapsed=$((elapsed + 5))
  if [ $((elapsed % 30)) -eq 0 ]; then
    echo "   Still waiting... (${elapsed}s)"
  fi
done

if [ "$elapsed" -ge "$MAX_WAIT_SECONDS" ]; then
  echo "ERROR: Magento web server did not respond within ${MAX_WAIT_SECONDS}s."
  exit 1
fi

# ── 2. Check if Magento is installed ───────────────────────────────────────
echo "2. Checking Magento installation..."
INSTALL_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "${MAGENTO_URL}/rest/V1/store/storeConfigs" \
  -H 'Accept: application/json' 2>&1 || echo "000")

if [ "$INSTALL_CHECK" = "200" ] || [ "$INSTALL_CHECK" = "401" ]; then
  echo "   Magento is already installed."
else
  echo "   Running Magento install..."
  docker exec platforms-magento-1 php /var/www/html/bin/magento setup:install \
    --base-url="$MAGENTO_URL" \
    --db-host=magento-db \
    --db-name=magento \
    --db-user=magento \
    --db-password=magento \
    --admin-firstname=Admin \
    --admin-lastname=User \
    --admin-email=admin@example.com \
    --admin-user=admin \
    --admin-password=magentorocks1 \
    --language=en_US \
    --currency=USD \
    --timezone=UTC \
    --use-rewrites=1 \
    --backend-frontname=admin \
    --no-interaction
  echo "   Installation complete."
fi

echo "   Waiting for Magento API to be ready..."
api_wait=0
while [ "$api_wait" -lt 120 ]; do
  API_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${MAGENTO_URL}/rest/V1/store/storeConfigs" -H 'Accept: application/json' 2>/dev/null || echo "000")
  if [ "$API_CODE" = "200" ] || [ "$API_CODE" = "401" ]; then
    echo "   API ready (HTTP $API_CODE)."
    break
  fi
  sleep 5
  api_wait=$((api_wait + 5))
done

# ── 3. Set developer mode (skip DI compile) ────────────────────────────────
echo "3. Fixing permissions and setting developer mode..."
docker exec platforms-magento-1 bash -c "chmod -R 777 /var/www/html/var /var/www/html/generated /var/www/html/pub/static 2>/dev/null" || true
docker exec platforms-magento-1 php /var/www/html/bin/magento deploy:mode:set developer 2>/dev/null || true
docker exec platforms-magento-1 php /var/www/html/bin/magento cache:flush 2>/dev/null || true

# ── 4. Seed products ──────────────────────────────────────────────────────
echo "4. Seeding products..."
bash "$PROJECT_ROOT/platforms/magento/setup-products.sh"

# ── 5. Get and display admin token ─────────────────────────────────────────
echo ""
echo "5. Generating admin token..."
RAW_TOKEN=$(curl -s -X POST "${MAGENTO_URL}/rest/V1/integration/admin/token" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{"username":"admin","password":"magentorocks1"}')
TOKEN=$(echo "$RAW_TOKEN" | tr -d '"\n\r ' | grep -oE '[a-zA-Z0-9]{20,}' | head -1)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to get admin token. Raw response:"
  echo "$RAW_TOKEN" | head -5
  exit 1
fi

echo "   Token: $TOKEN"
echo ""
echo "=== Magento setup complete ==="

# Export token for downstream scripts
export MAGENTO_TOKEN="$TOKEN"
echo "$TOKEN" > "$SCRIPT_DIR/.magento-token"
