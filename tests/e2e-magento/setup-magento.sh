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
MAGENTO_CONTAINER="${MAGENTO_CONTAINER:-platforms-magento-1}"
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
  docker exec "$MAGENTO_CONTAINER" php /var/www/html/bin/magento setup:install \
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
docker exec "$MAGENTO_CONTAINER" bash -c "
  mkdir -p /var/www/html/var/log /var/www/html/var/cache /var/www/html/var/page_cache /var/www/html/var/session /var/www/html/generated /var/www/html/pub/static
  find /var/www/html/var -type d -exec chmod 777 {} \; 2>/dev/null
  find /var/www/html/var -type f -exec chmod 666 {} \; 2>/dev/null
  find /var/www/html/generated -type d -exec chmod 777 {} \; 2>/dev/null
  find /var/www/html/pub/static -type d -exec chmod 777 {} \; 2>/dev/null
  touch /var/www/html/var/log/debug.log /var/www/html/var/log/system.log /var/www/html/var/log/exception.log
  chmod 666 /var/www/html/var/log/*.log 2>/dev/null
" || true
docker exec "$MAGENTO_CONTAINER" php /var/www/html/bin/magento deploy:mode:set developer --skip-compilation 2>/dev/null || true
docker exec "$MAGENTO_CONTAINER" php /var/www/html/bin/magento cache:clean 2>/dev/null || true

# ── 4. Seed products ──────────────────────────────────────────────────────
echo "4. Seeding products..."
bash "$PROJECT_ROOT/platforms/magento/setup-products.sh"

# ── 5. Get and display admin token ─────────────────────────────────────────
echo ""
echo "5. Generating admin token..."
TOKEN=""
echo "   Trying CLI token generation..."
TOKEN=$(docker exec "$MAGENTO_CONTAINER" php /var/www/html/bin/magento admin:token:create --admin-user admin 2>/dev/null | tr -d '\n\r ' | grep -oE '[a-zA-Z0-9]{20,}' || true)
TOKEN=$(echo "$TOKEN" | head -1)

if [ -z "$TOKEN" ]; then
  echo "   CLI failed, trying REST API..."
  for attempt in 1 2 3; do
    RAW_TOKEN=$(curl -s -X POST "${MAGENTO_URL}/rest/V1/integration/admin/token" \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json' \
      -d '{"username":"admin","password":"magentorocks1"}' || true)
    TOKEN=$(echo "$RAW_TOKEN" | tr -d '"\n\r ' | grep -oE '[a-zA-Z0-9]{20,}' || true)
    TOKEN=$(echo "$TOKEN" | head -1)
    if [ -n "$TOKEN" ]; then
      break
    fi
    echo "   Attempt $attempt: $(echo "$RAW_TOKEN" | head -1 | cut -c1-100)"
    sleep 5
  done
fi

if [ -z "$TOKEN" ]; then
  echo "ERROR: Failed to get admin token via CLI and REST API."
  exit 1
fi

echo "   Token: $TOKEN"
echo ""
echo "=== Magento setup complete ==="

# Export token for downstream scripts
export MAGENTO_TOKEN="$TOKEN"
echo "$TOKEN" > "$SCRIPT_DIR/.magento-token"
