#!/usr/bin/env bash
set -euo pipefail

##
# Seed a Magento tenant in the UCP Gateway database.
#
# Usage:
#   bash tests/e2e-magento/seed-tenant.sh
#
# Prerequisites:
#   - Postgres running (docker-compose.dev.yml)
#   - Magento token in tests/e2e-magento/.magento-token
##

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MAGENTO_URL="${MAGENTO_URL:-http://localhost:8080}"
GATEWAY_PORT="${GATEWAY_PORT:-3000}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_USER="${DB_USER:-ucp}"
DB_NAME="${DB_NAME:-ucp}"
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6380}"

if [ -f "$SCRIPT_DIR/.magento-token" ]; then
  TOKEN=$(cat "$SCRIPT_DIR/.magento-token")
else
  TOKEN=$(curl -s -X POST "${MAGENTO_URL}/rest/V1/integration/admin/token" \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"magentorocks1"}' | tr -d '"')
fi

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "ERROR: No Magento token available."
  exit 1
fi

echo "=== Seeding Magento tenant ==="
echo "Magento URL: $MAGENTO_URL"
echo "Gateway port: $GATEWAY_PORT"
echo "DB: $DB_HOST:$DB_PORT"
echo ""

DB_CONTAINER="${DB_CONTAINER:-ucp-middleware-postgres-1}"

run_psql() {
  if command -v psql > /dev/null 2>&1; then
    PGPASSWORD="$DB_USER" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$1" 2>&1 | grep -v "^$"
  else
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "$1" 2>&1 | grep -v "^$"
  fi
}

echo "1. Ensuring tenants table exists..."
run_psql "
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(255) UNIQUE NOT NULL,
  domain VARCHAR(255) UNIQUE NOT NULL,
  platform VARCHAR(100) NOT NULL,
  adapter_config JSONB NOT NULL DEFAULT '{}',
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);"

echo "2. Upserting magento-e2e tenant..."
run_psql "
DELETE FROM tenants WHERE slug = 'magento-e2e' OR domain = 'localhost:${GATEWAY_PORT}';
INSERT INTO tenants (slug, domain, platform, adapter_config)
VALUES (
  'magento-e2e',
  'localhost:${GATEWAY_PORT}',
  'magento',
  '{\"storeUrl\": \"${MAGENTO_URL}\", \"apiKey\": \"${TOKEN}\"}'::jsonb
);"

REDIS_CONTAINER="${REDIS_CONTAINER:-ucp-middleware-redis-1}"

echo "3. Flushing Redis cache..."
if command -v redis-cli > /dev/null 2>&1; then
  redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" FLUSHALL > /dev/null 2>&1 || true
else
  docker exec "$REDIS_CONTAINER" redis-cli FLUSHALL > /dev/null 2>&1 || true
fi

echo ""
echo "=== Tenant seeded ==="
echo "Domain: localhost:${GATEWAY_PORT} → Magento at ${MAGENTO_URL}"
