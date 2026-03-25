# E2E Testing Guide

## Architecture

```
tests/
├── e2e-magento/
│   ├── checkout.test.ts          # 20 vitest scenarios (expanded)
│   ├── run-e2e-checkout.sh       # 26 bash assertions (CI pipeline)
│   ├── setup-magento.sh          # Install + configure Magento
│   ├── seed-products.sh          # Create test products via REST API
│   ├── seed-tenant.sh            # Insert tenant row in Postgres
│   └── vitest.config.ts          # Scoped to e2e-magento/ only
├── e2e-shopware/
│   ├── run-e2e-checkout.sh       # 26 bash assertions (CI pipeline)
│   ├── setup-shopware.sh         # Configure Shopware access key
│   └── seed-tenant.sh            # Insert tenant row in Postgres
└── conformance/                  # UCP spec conformance tests (Python)
```

Two test runners exist per platform:

- **Bash scripts** (`run-e2e-checkout.sh`) — used in CI, lightweight, zero dependencies
- **Vitest** (`checkout.test.ts`) — used locally and in CI, richer assertions, parallel execution

## Common Test Matrix

These scenarios apply to ALL platform adapters. Every new adapter must pass them.

### Checkout Lifecycle (4 tests)

| #   | Scenario                          | Expected                           |
| --- | --------------------------------- | ---------------------------------- |
| 1   | Create session → cancel           | status: `canceled`                 |
| 2   | Complete session → cancel         | HTTP 409                           |
| 3   | Complete session → GET            | status: `completed`, order present |
| 4   | Complete session → complete again | Idempotent (200 or 409)            |

### Validation (4 tests)

| #   | Scenario                         | Expected                          |
| --- | -------------------------------- | --------------------------------- |
| 5   | Create with empty line_items     | HTTP < 500 (may accept or reject) |
| 6   | Create with non-existent product | HTTP 4xx or error message         |
| 7   | Complete without buyer info      | HTTP 4xx                          |
| 8   | Complete without fulfillment     | HTTP 4xx                          |

### Fulfillment (2 tests)

| #   | Scenario                       | Expected                                       |
| --- | ------------------------------ | ---------------------------------------------- |
| 9   | Add fulfillment → check totals | `fulfillment` total present, total >= subtotal |
| 10  | Update destination address     | Valid session, totals > 0                      |

### Discounts (3 tests)

| #   | Scenario                                               | Expected                          |
| --- | ------------------------------------------------------ | --------------------------------- |
| 11  | Apply invalid coupon code                              | No discount applied (amount = 0)  |
| 12  | Apply coupon → clear codes                             | Total reverts to pre-coupon value |
| 13  | Verify math: subtotal + discount + fulfillment = total | Exact equality                    |

### Idempotency (2 tests)

| #   | Scenario                             | Expected                |
| --- | ------------------------------------ | ----------------------- |
| 14  | Same Idempotency-Key, same body      | Returns same session ID |
| 15  | Same Idempotency-Key, different body | HTTP 409                |

### Error Handling (3 tests)

| #   | Scenario                      | Expected                  |
| --- | ----------------------------- | ------------------------- |
| 16  | GET non-existent session      | HTTP 404, code: `missing` |
| 17  | PUT non-existent session      | HTTP 404                  |
| 18  | Complete non-existent session | HTTP 404                  |

### Payment (2 tests)

| #   | Scenario                              | Expected                                 |
| --- | ------------------------------------- | ---------------------------------------- |
| 19  | Complete with unknown payment handler | Completes or errors (platform-dependent) |
| 20  | Full flow → verify order total        | Order total matches session total        |

### Bash-Only Assertions (additional 6)

| #   | Scenario                             | Expected                  |
| --- | ------------------------------------ | ------------------------- |
| 21  | Health endpoint returns ok           | `{"status":"ok"}`         |
| 22  | Profile has business name            | Non-empty                 |
| 23  | Product search returns results       | At least 1 product        |
| 24  | Multi-item session has correct count | line_items.length matches |
| 25  | Request-Id echoed in response        | Header present            |
| 26  | Cancel from ready_for_complete       | status: `canceled`        |

**Total common scenarios: 26**

## Platform-Specific Coverage

### Magento 2.x

| Feature                      | Covered | How                                                      |
| ---------------------------- | ------- | -------------------------------------------------------- |
| Product search (Catalog API) | Yes     | Search by name via REST API                              |
| Guest cart creation          | Yes     | POST /rest/V1/guest-carts                                |
| Add items to cart            | Yes     | POST /rest/V1/guest-carts/{id}/items                     |
| Estimate shipping methods    | Yes     | POST /rest/V1/guest-carts/{id}/estimate-shipping-methods |
| Set shipping information     | Yes     | POST /rest/V1/guest-carts/{id}/shipping-information      |
| Apply coupon code            | Yes     | PUT /rest/V1/guest-carts/{id}/coupons/{code}             |
| Remove coupon code           | Yes     | DELETE /rest/V1/guest-carts/{id}/coupons                 |
| Place order                  | Yes     | PUT /rest/V1/guest-carts/{id}/order                      |
| Payment method: checkmo      | Yes     | Default payment method in tests                          |
| Inventory validation         | Partial | Checked during add-to-cart                               |
| Configurable products        | No      | Only simple products tested                              |
| Multi-store / store views    | No      | Single store view                                        |

### Shopware 6.x

| Feature                     | Covered | How                                                      |
| --------------------------- | ------- | -------------------------------------------------------- |
| Product search (Store API)  | Yes     | POST /store-api/product (contains filter)                |
| Cart creation               | Yes     | GET /store-api/checkout/cart                             |
| Add items to cart           | Yes     | POST /store-api/checkout/cart/line-item                  |
| List shipping methods       | Yes     | GET /store-api/shipping-method (with prices association) |
| Set shipping method         | Yes     | PATCH /store-api/context                                 |
| Apply promotion code        | Yes     | POST /store-api/checkout/cart/code                       |
| Remove promotion code       | Yes     | DELETE /store-api/checkout/cart/code                     |
| Place order                 | Yes     | POST /store-api/checkout/order                           |
| Country resolution          | Yes     | POST /store-api/country (ISO2 → UUID)                    |
| Context token management    | Yes     | sw-context-token header tracking                         |
| Sales Channel products only | Yes     | Store API scope                                          |

## Running Tests

### Locally (requires running platforms)

```bash
# Start infrastructure
docker compose -f docker-compose.dev.yml up -d
docker compose -f platforms/docker-compose.platforms.yml up -d

# Setup Magento (first time only)
bash tests/e2e-magento/setup-magento.sh

# Seed tenants (switches gateway to target platform)
bash tests/e2e-magento/seed-tenant.sh    # or
bash tests/e2e-shopware/seed-tenant.sh

# Start gateway
npm run dev

# Run Magento E2E (vitest — 20 scenarios)
npx vitest run --config tests/e2e-magento/vitest.config.ts

# Run Magento E2E (bash — 26 assertions)
bash tests/e2e-magento/run-e2e-checkout.sh

# Run Shopware E2E (bash — 26 assertions)
bash tests/e2e-shopware/run-e2e-checkout.sh
```

### In CI

E2E tests run automatically on PRs that touch adapter or checkout code:

- `.github/workflows/test-magento-e2e.yml` — triggered by changes in `packages/adapters/src/magento/**`, `apps/server/src/routes/**`, `tests/e2e-magento/**`
- `.github/workflows/test-shopware-e2e.yml` — triggered by changes in `packages/adapters/src/shopware/**`, `apps/server/src/routes/**`, `tests/e2e-shopware/**`

Both workflows:

1. Start Postgres + Redis
2. Start platform (Magento via Docker / Shopware via Docker)
3. Seed test products and tenant
4. Start gateway
5. Run full E2E suite
6. Upload test artifacts on failure

## Important: Tenant Domain Conflict

Both platforms share `localhost:3000` as the gateway domain. Only ONE tenant can own a domain at a time. When switching between platforms locally:

```bash
# Switch to Magento
bash tests/e2e-magento/seed-tenant.sh
# (restart gateway)

# Switch to Shopware
bash tests/e2e-shopware/seed-tenant.sh
# (restart gateway)
```

In CI, each workflow seeds its own tenant — they run in separate jobs so there's no conflict.

## Adding a New Platform Adapter

When implementing a new adapter (e.g., Shopify), create:

1. `tests/e2e-{platform}/run-e2e-checkout.sh` — bash E2E (copy from Magento, adapt product seeding)
2. `tests/e2e-{platform}/seed-tenant.sh` — tenant seeding script
3. `tests/e2e-{platform}/setup-{platform}.sh` — platform setup (if Docker-based)
4. `.github/workflows/test-{platform}-e2e.yml` — CI workflow
5. Optionally: `tests/e2e-{platform}/checkout.test.ts` + `vitest.config.ts` for vitest scenarios

The new adapter MUST pass all 26 common scenarios before merging (per CLAUDE.md rules).
