# E2E Testing Guide

## Architecture

```
tests/
└── conformance/                  # UCP spec conformance tests (Python)
```

> **Note:** Magento and Shopware E2E tests have moved to the private
> `@omnixhq/adapter-magento` and `@omnixhq/adapter-shopware` repos
> as part of the paid adapter split (PR #50).

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

### Inventory & Edge Cases (4 tests)

| #   | Scenario                             | Expected                            |
| --- | ------------------------------------ | ----------------------------------- |
| 21  | Multi-item with different quantities | Line item count >= 1                |
| 22  | Session update with billing_address  | Accepted, session status valid      |
| 23  | Exceed available stock (qty=999999)  | Error or graceful platform handling |
| 24  | Out-of-stock / non-existent product  | HTTP 4xx                            |

### Bash-Only Assertions (additional 6)

| #   | Scenario                             | Expected                  |
| --- | ------------------------------------ | ------------------------- |
| 25  | Health endpoint returns ok           | `{"status":"ok"}`         |
| 26  | Profile has business name            | Non-empty                 |
| 27  | Product search returns results       | At least 1 product        |
| 28  | Multi-item session has correct count | line_items.length matches |
| 29  | Request-Id echoed in response        | Header present            |
| 30  | Cancel from ready_for_complete       | status: `canceled`        |

**Total implemented scenarios: 30**

### Not Yet Implemented — Implementable Now (3 tests)

| #   | Scenario                        | Expected                   | Blocker                         |
| --- | ------------------------------- | -------------------------- | ------------------------------- |
| 31  | Expired session → 410           | HTTP 410 or expired status | Need short TTL env var for test |
| 32  | Update completed session → 409  | HTTP 409                   | None — ready to add             |
| 33  | Option selection changes totals | Total changes with option  | Magento flat rate = 1 option    |

### Not Yet Implementable — Features Not Built (44 scenarios)

These scenarios require features that are planned but not yet implemented in the gateway.

#### Discount Extension (8 scenarios)

| Scenario                               | Required Feature                 | Ticket? |
| -------------------------------------- | -------------------------------- | ------- |
| Stacking rules (priority, exclusive)   | Discount stacking config         | TBD     |
| Per-item discount allocations          | Allocation engine                | TBD     |
| Automatic discounts (no code)          | Auto-discount rules              | TBD     |
| Auth-required codes (user eligibility) | Identity linking + discount auth | TBD     |
| Multiple codes simultaneously          | Multi-code support               | TBD     |
| Discount exceeds subtotal → clamp to 0 | Clamping logic                   | TBD     |
| Percentage + fixed combined            | Mixed discount types             | TBD     |
| Discount on specific items only        | Item-level targeting             | TBD     |

#### Fulfillment Extension (8 scenarios)

| Scenario                                  | Required Feature            | Ticket? |
| ----------------------------------------- | --------------------------- | ------- |
| Multi-group fulfillment (split shipments) | Multi-group support         | TBD     |
| Retail location / store pickup            | Pickup destination type     | TBD     |
| Preorder items with delayed fulfillment   | Preorder product type       | TBD     |
| Digital goods (no shipping needed)        | Digital fulfillment type    | TBD     |
| Multi-destination (ship to multiple)      | Multi-destination routing   | TBD     |
| Fulfillment config flags in profile       | Profile config              | TBD     |
| Contact fields on destinations            | Phone/email on address      | TBD     |
| Shipping cost by weight/dimensions        | Weight-based shipping rules | TBD     |

#### Order Capability (6 scenarios)

| Scenario                               | Required Feature        | Ticket? |
| -------------------------------------- | ----------------------- | ------- |
| Webhook delivery on order complete     | Webhook engine + BullMQ | TBD     |
| Order fulfillment tracking (shipped)   | Fulfillment events      | TBD     |
| Order fulfillment tracking (delivered) | Fulfillment events      | TBD     |
| Order adjustment: refund               | Adjustments engine      | TBD     |
| Order adjustment: return               | Adjustments engine      | TBD     |
| PUT /orders/:id for lifecycle updates  | Order update endpoint   | TBD     |

#### Payment (4 scenarios)

| Scenario                             | Required Feature               | Ticket? |
| ------------------------------------ | ------------------------------ | ------- |
| Real payment gateway (Stripe)        | Payment gateway integration    | TBD     |
| Real payment gateway (PayPal)        | Payment gateway integration    | TBD     |
| Payment failure → escalation → retry | Escalation + continue_url flow | TBD     |
| 3DS / SCA challenge handling         | Browser redirect flow          | TBD     |

#### Extensions & Security (10 scenarios)

| Scenario                                | Required Feature           | Ticket? |
| --------------------------------------- | -------------------------- | ------- |
| AP2 mandates (cryptographic signatures) | AP2 extension              | TBD     |
| Buyer consent (analytics opt-in)        | Consent extension          | TBD     |
| Buyer consent (marketing opt-in)        | Consent extension          | TBD     |
| Buyer consent (CCPA do-not-sell)        | Consent extension          | TBD     |
| Identity linking (OAuth 2.0 flow)       | OAuth endpoints            | TBD     |
| Tokenization (card vault)               | Tokenization endpoints     | TBD     |
| Request-Signature verification          | JWT signing                | TBD     |
| Configurable/variant products           | Variant support in adapter | TBD     |
| Multi-currency checkout                 | Currency conversion        | TBD     |
| Tax calculation (US/EU rules)           | Tax engine                 | TBD     |

#### Nice to Have (8 scenarios)

| Scenario                           | Required Feature        | Ticket? |
| ---------------------------------- | ----------------------- | ------- |
| Gift card as payment instrument    | Gift card support       | No      |
| Subscription/recurring orders      | Subscription engine     | No      |
| Guest → registered user conversion | Identity linking        | TBD     |
| Session transfer between agents    | Session portability     | No      |
| Concurrent session modification    | Optimistic locking      | No      |
| Rate limiting per tenant           | Rate limiter middleware | TBD     |
| Webhook retry on failure           | Retry queue             | TBD     |
| MCP transport binding              | JSON-RPC tools          | TBD     |

**Total: 30 implemented + 3 ready to add + 44 blocked by features = 77 scenarios**

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
