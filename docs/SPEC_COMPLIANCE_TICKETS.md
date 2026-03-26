# UCP Spec Compliance Tickets

Generated from audit on 2026-03-26. Data source: `collection://f139fa54-8b7c-42db-a80b-30f9196af7d9`

---

## Phase 1 — Interoperability Blockers (P0 Critical)

Any spec-conformant platform will reject our responses.

### UCPM-230: Fix error response format — add ucp envelope + status
- **Priority:** P0 Critical | **Estimate:** 3 | **Labels:** Backend, API
- **Summary:** Every error response is non-conformant. Must include `ucp` protocol metadata and `status` field. Remove non-spec `detail` field.
- **Files:** `checkout-helpers.ts`, `error-handler.ts`, `agent-header.ts`
- **AC:**
  - [ ] All error responses include `ucp` envelope with version + capabilities
  - [ ] All error responses include `status` field (e.g. `incomplete`, `requires_escalation`)
  - [ ] `detail` field removed
  - [ ] `Request-Id` echoed on error paths
  - [ ] Error codes use lowercase snake_case consistently

### UCPM-231: Fix payment.handlers response — add required spec fields
- **Priority:** P0 Critical | **Estimate:** 2 | **Labels:** Backend, API
- **Summary:** Payment handler objects missing required fields: `version`, `spec`, `config_schema`, `instrument_schemas`, `config`. Internal `PaymentHandler` type has wrong shape.
- **Files:** `commerce.ts`, `discovery.ts`, `checkout-response.ts`, both adapters
- **AC:**
  - [ ] `PaymentHandler` type matches `PaymentHandlerResponseSchema`
  - [ ] Discovery profile handlers have all required fields
  - [ ] Checkout response handlers have all required fields
  - [ ] `spec` and `config_schema` point to real schema URIs

### UCPM-232: Remove expired status — use canceled + expires_at
- **Priority:** P0 Critical | **Estimate:** 2 | **Labels:** Backend
- **Summary:** `expired` is not a valid UCP session status. Valid: `incomplete`, `requires_escalation`, `ready_for_complete`, `complete_in_progress`, `completed`, `canceled`.
- **Files:** `SessionStore.ts:21`, `checkout-helpers.ts:23-25`
- **AC:**
  - [ ] `expired` removed from `SessionStatus` enum
  - [ ] Expiration check uses `expires_at` timestamp comparison
  - [ ] Expired sessions return appropriate error with valid status

### UCPM-233: Extend Idempotency-Key to update, complete, cancel
- **Priority:** P0 Critical | **Estimate:** 2 | **Labels:** Backend, API
- **Summary:** Spec requires `Idempotency-Key` on ALL state-modifying operations. Currently only on create.
- **Files:** `checkout.ts:83` (only location)
- **AC:**
  - [ ] Idempotency-Key checked on update, complete, cancel routes
  - [ ] Cached responses returned for duplicate keys
  - [ ] 24-hour cache TTL maintained

### UCPM-234: Fix AppliedDiscount schema to match UCP spec
- **Priority:** P0 Critical | **Estimate:** 2 | **Labels:** Backend
- **Summary:** `AppliedDiscount` has wrong field names. Current: `{code, type, amount, description}`. Spec: `{title (req), amount (req), code?, automatic?, method?, priority?, allocations?}`.
- **Files:** `SessionStore.ts:35-40`, all discount handling
- **AC:**
  - [ ] `AppliedDiscount` matches spec `AppliedElementSchema`
  - [ ] `description` renamed to `title`
  - [ ] `code` made optional, `type` field removed
  - [ ] Optional fields added: `automatic`, `method`, `priority`, `allocations`

### UCPM-235: Fix create/update request validation — required fields
- **Priority:** P0 Critical | **Estimate:** 2 | **Labels:** Backend, API
- **Summary:** Create schema has `currency` and `payment` as optional; spec says required. Update schema missing required `id`, `currency`, `line_items`, `payment`.
- **Files:** `checkout-schemas.ts:88,100,105-123`
- **AC:**
  - [ ] `currency` required in create request
  - [ ] `payment` required in create request
  - [ ] `id`, `currency`, `line_items`, `payment` required in update request
  - [ ] PUT performs full replacement (not merge)

### UCPM-236: Add fulfillment + discount capabilities to adapter profiles
- **Priority:** P0 Critical | **Estimate:** 1 | **Labels:** Backend, Adapter
- **Summary:** Both adapters implement fulfillment and discount methods but their discovery profiles only declare `dev.ucp.shopping.checkout`. Missing: `dev.ucp.shopping.fulfillment`, `dev.ucp.shopping.discounts`.
- **Files:** `MagentoAdapter.ts:52-75`, `ShopwareAdapter.ts:68-96`, `mock-data.ts`
- **AC:**
  - [ ] Magento profile declares fulfillment + discount capabilities
  - [ ] Shopware profile declares fulfillment + discount capabilities
  - [ ] Mock profile already has them (verify)

---

## Phase 2 — Data Correctness (P1 High)

Responses are parseable but contain wrong data.

### UCPM-237: Widen adapter interface to pass buyer address + shipping method
- **Priority:** P1 High | **Estimate:** 5 | **Labels:** Backend, Adapter
- **Summary:** `placeOrder(cartId, payment)` has no way to pass buyer address, selected shipping method, or buyer email. Both adapters use hardcoded fake addresses (US/NY/10001) and `flatrate` shipping.
- **Files:** `adapter.ts` interface, `MagentoAdapter.ts:260,158`, `ShopwareAdapter.ts:253,295`
- **AC:**
  - [ ] `placeOrder` signature includes checkout context (address, shipping, email)
  - [ ] `setShippingMethod` receives actual address
  - [ ] Magento stops hardcoding `flatrate/flatrate`
  - [ ] Shopware stops hardcoding country `US` and fake address
  - [ ] Buyer email flows through to platform APIs

### UCPM-238: Read currency from platform config instead of hardcoding
- **Priority:** P1 High | **Estimate:** 2 | **Labels:** Backend, Adapter
- **Summary:** Magento hardcodes `USD` everywhere. Shopware defaults to `EUR`. Both should read from platform config.
- **Files:** `MagentoAdapter.ts:109,31,61,293`, `ShopwareAdapter.ts:59`
- **AC:**
  - [ ] Magento reads `base_currency_code` from store config
  - [ ] Shopware reads currency from context response eagerly
  - [ ] Currency propagated to products, cart, totals, orders
  - [ ] No hardcoded currency defaults

### UCPM-239: Fix Shopware context token concurrency race condition
- **Priority:** P1 High | **Estimate:** 3 | **Labels:** Backend, Adapter
- **Summary:** `contextToken` is mutated in-place. Concurrent requests sharing an adapter instance will corrupt each other's tokens.
- **Files:** `ShopwareAdapter.ts:58,362-367,396-402`
- **AC:**
  - [ ] Context token passed explicitly per-request (not stored on instance)
  - [ ] No mutable state on adapter instance
  - [ ] Concurrent checkout flows don't interfere

### UCPM-240: Fix order response — return full UCP Order
- **Priority:** P1 High | **Estimate:** 3 | **Labels:** Backend, API
- **Summary:** Completed checkout response truncates order to `{id, permalink_url}`. `GET /orders/:id` returns `PlatformOrder` not UCP Order format. Non-spec `order_id` and `order_permalink_url` top-level fields.
- **Files:** `checkout-response.ts:80-87,86-87`, `checkout.ts:180-190`
- **AC:**
  - [ ] Completed response returns full `session.order` object
  - [ ] Remove non-spec `order_id`, `order_permalink_url` top-level fields
  - [ ] `GET /orders/:id` returns UCP Order schema or transforms PlatformOrder

### UCPM-241: Fix Shopware shipping cost calculation
- **Priority:** P1 High | **Estimate:** 2 | **Labels:** Backend, Adapter
- **Summary:** Shipping computed as `total - positionPrice` which conflates tax/discounts. Should use Shopware `deliveries` array.
- **Files:** `shopware-mappers.ts:99-103`
- **AC:**
  - [ ] Shipping cost read from `deliveries[].shippingCosts`
  - [ ] Tax and discounts not conflated into shipping

### UCPM-242: Fix fulfillment line_item_ids — populate from cart
- **Priority:** P1 High | **Estimate:** 1 | **Labels:** Backend, Adapter
- **Summary:** Both adapters return `line_item_ids: []` in fulfillment methods/groups. Spec requires line items listed.
- **Files:** `magento-mappers.ts:121,125`, `ShopwareAdapter.ts:202-213`
- **AC:**
  - [ ] Magento fulfillment includes cart item IDs
  - [ ] Shopware fulfillment includes cart item IDs

### UCPM-243: Fix Shopware 404 error mapping
- **Priority:** P1 High | **Estimate:** 1 | **Labels:** Backend, Adapter
- **Summary:** All 404s mapped to `PRODUCT_NOT_FOUND` regardless of endpoint. Cart/order/country 404s get wrong error code.
- **Files:** `ShopwareAdapter.ts:419-420`
- **AC:**
  - [ ] Error codes match the resource type (cart, order, country, product)

### UCPM-244: Fix ready_for_complete validation — check all required data
- **Priority:** P1 High | **Estimate:** 2 | **Labels:** Backend
- **Summary:** `shouldMarkReadyForComplete` only checks fulfillment option selection. Should verify buyer info, payment handler, line items too.
- **Files:** `checkout-validation.ts:44-46`
- **AC:**
  - [ ] Status recalculated on every update (can go back to `incomplete`)
  - [ ] All required fields checked: buyer, payment, line_items, fulfillment

---

## Phase 3 — Feature Gaps (P2 Medium)

Missing capabilities and refinements.

### UCPM-245: Implement webhook delivery infrastructure
- **Priority:** P2 Medium | **Estimate:** 8 | **Labels:** Backend, Infra
- **Summary:** Spec MUST: businesses send webhooks for order events (created, updated, shipped). No webhook delivery exists.
- **AC:**
  - [ ] Webhook URL registration per tenant
  - [ ] Event delivery with retry logic
  - [ ] Order lifecycle events: created, updated, fulfilled, canceled

### UCPM-246: Implement webhook JWT signing
- **Priority:** P2 Medium | **Estimate:** 3 | **Labels:** Backend, Auth
- **Summary:** Spec MUST: sign all webhook payloads with detached JWT using `signing_keys`. `SigningService` exists but is never used for outbound requests.
- **Depends On:** UCPM-245
- **AC:**
  - [ ] All outbound webhooks include `Request-Signature` header
  - [ ] Signature uses key from `signing_keys` array
  - [ ] Platforms can verify using discovery profile keys

### UCPM-247: Implement capability negotiation
- **Priority:** P2 Medium | **Estimate:** 5 | **Labels:** Backend, API
- **Summary:** Gateway never fetches platform's profile or computes capability intersection. Always returns same hardcoded capabilities.
- **AC:**
  - [ ] Fetch platform profile from `UCP-Agent` header URL
  - [ ] Compute intersection of platform + business capabilities
  - [ ] Prune orphaned extensions from response
  - [ ] Cache platform profiles

### UCPM-248: Support context field in checkout sessions
- **Priority:** P2 Medium | **Estimate:** 2 | **Labels:** Backend
- **Summary:** `context` field accepted in create/update schemas but never stored or returned. Should influence currency determination.
- **AC:**
  - [ ] `context` stored in session
  - [ ] `context` returned in response
  - [ ] Currency derivation uses context signals

### UCPM-249: Fix complete_in_progress visibility to platform
- **Priority:** P2 Medium | **Estimate:** 2 | **Labels:** Backend
- **Summary:** `complete_in_progress` status set but never returned — synchronous placeOrder call means platform always sees `completed` or error.
- **AC:**
  - [ ] Async payment flows return `complete_in_progress` immediately
  - [ ] Polling endpoint returns current status
  - [ ] Transition to `completed` on payment confirmation

### UCPM-250: Add variant support to product/line item mapping
- **Priority:** P2 Medium | **Estimate:** 3 | **Labels:** Backend, Adapter
- **Summary:** Both adapters return `variants: []` and ignore `variant_id` in line items.
- **AC:**
  - [ ] Shopware maps variant products from propertyGroups/children
  - [ ] Magento maps configurable product options
  - [ ] `variant_id` flows through addToCart

### UCPM-251: Add missing fulfillment option fields
- **Priority:** P2 Medium | **Estimate:** 2 | **Labels:** Backend, Adapter
- **Summary:** Missing optional fields: `carrier`, `earliest_fulfillment_time`, `latest_fulfillment_time`, `description`. Shopware has this data but doesn't map it.
- **AC:**
  - [ ] Fulfillment options include carrier info
  - [ ] Estimated delivery times mapped when available
  - [ ] `selected_option_id` set from current platform context

### UCPM-252: Improve UCP compliance validator to cover all audit findings
- **Priority:** P1 High | **Estimate:** 5 | **Labels:** Testing, Backend
- **Summary:** Current validator (`scripts/validate-spec-coverage.sh`) has 34 checks. Add checks for ALL findings from the 2026-03-26 audit.
- **AC:**
  - [ ] Error response format checks (ucp envelope, status field, no detail)
  - [ ] Payment handler required fields check
  - [ ] Session status enum validation (no `expired`)
  - [ ] Idempotency-Key on all mutating endpoints
  - [ ] AppliedDiscount schema check
  - [ ] Create/update required fields validation
  - [ ] Adapter profile capability declarations
  - [ ] Fulfillment line_item_ids non-empty
  - [ ] Order response schema compliance
  - [ ] Currency not hardcoded
  - [ ] Address not hardcoded
  - [ ] Error code casing (lowercase snake_case)
  - [ ] Total checks: 34 existing + ~20 new = ~54 checks
  - [ ] Update `docs/UCP_GAP_ANALYSIS.md` with new findings
